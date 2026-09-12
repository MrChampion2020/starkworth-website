// Initializes a Paystack transaction for a StarkAC learner's plan payment.
//
// Currency is chosen automatically from the trainee's country: Nigeria pays
// in NGN, everyone else pays in USD. There is no currency picker in the UI,
// and no Naira amount is stored or shown anywhere in the site - for a
// Nigerian trainee this function converts the USD plan price to NGN using a
// live exchange rate fetched right here, at the moment checkout opens, and
// hands that number straight to Paystack. The only place it's ever visible
// is the Paystack checkout screen itself.
//
// Cards, bank transfer and USSD are all offered - that's Paystack's standard
// checkout behaviour, not something this function needs to configure.
//
// Requires the PAYSTACK_SECRET_KEY secret. See supabase/starkac_paystack.sql
// for full setup notes (webhook URL, enabling USD on the Paystack account).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NIGERIA_NAMES = new Set(["nigeria", "ng", "nga", "federal republic of nigeria"]);

// Used only if the live rate lookup below fails, so checkout never breaks
// outright - correct it here if it drifts far from the real rate.
const FALLBACK_USD_TO_NGN = 1600;

async function usdToNgnRate(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    const rate = Number(data?.rates?.NGN);
    return rate > 0 ? rate : FALLBACK_USD_TO_NGN;
  } catch {
    return FALLBACK_USD_TO_NGN;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!paystackSecret) return json({ ok: false, error: "Payment service is not configured yet" }, 500);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user?.email) return json({ ok: false, error: "Invalid session" }, 401);
  const email = userData.user.email.toLowerCase();

  const { data: trainee, error: traineeError } = await admin
    .from("starkac_trainees")
    .select("full_name, plan, country")
    .eq("email", email)
    .maybeSingle();
  if (traineeError || !trainee) return json({ ok: false, error: "StarkAC learner profile not found" }, 404);

  const { data: pricing, error: pricingError } = await admin
    .from("starkac_plan_pricing")
    .select("price_usd")
    .eq("plan", trainee.plan)
    .maybeSingle();
  if (pricingError || !pricing || !(Number(pricing.price_usd) > 0)) {
    return json({ ok: false, error: "Pricing is not set up for this plan" }, 400);
  }
  const priceUsd = Number(pricing.price_usd);

  const isNigeria = NIGERIA_NAMES.has(String(trainee.country || "").trim().toLowerCase());
  const currency = isNigeria ? "NGN" : "USD";
  const amountMajor = isNigeria ? Math.round(priceUsd * (await usdToNgnRate())) : priceUsd;
  const amountMinor = Math.round(amountMajor * 100); // Paystack expects kobo/cents, every currency it supports.

  const reference = `STARKAC-PS-${crypto.randomUUID()}`;
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://starkworth.org";

  const initResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: amountMinor,
      currency,
      reference,
      callback_url: `${siteUrl}/starkac/dashboard.html?ref=${reference}`,
      channels: ["card", "bank", "bank_transfer", "ussd"],
      metadata: {
        trainee_email: email,
        plan: trainee.plan,
        full_name: trainee.full_name,
        custom_fields: [{ display_name: "StarkAC Plan", variable_name: "plan", value: trainee.plan }],
      },
    }),
  });
  const payment = await initResponse.json();
  if (!initResponse.ok || !payment?.data?.authorization_url) {
    return json({ ok: false, error: payment?.message || "Could not initialize payment" }, 502);
  }

  const { error: insertError } = await admin.from("starkac_payments").insert({
    trainee_email: email,
    payment_reference: reference,
    amount_usd: priceUsd,
    amount_charged: amountMajor,
    currency,
    provider: "paystack",
    provider_reference: payment.data.reference || reference,
    paystack_authorization_url: payment.data.authorization_url,
  });
  if (insertError) return json({ ok: false, error: "Could not record the payment attempt" }, 500);

  return json({ ok: true, checkoutUrl: payment.data.authorization_url, paymentReference: reference, currency, amount: amountMajor });
});
