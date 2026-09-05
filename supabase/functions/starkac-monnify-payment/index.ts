import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user?.email) return json({ ok: false, error: "Invalid session" }, 401);
  const email = userData.user.email.toLowerCase();
  const { data: trainee, error: traineeError } = await admin.from("starkac_trainees").select("full_name,plan,plan_price_usd").eq("email", email).maybeSingle();
  if (traineeError || !trainee) return json({ ok: false, error: "StarkAC learner profile not found" }, 404);
  const amount = ({ beginner_20: 20, intermediate_35: 35, senior_50: 50 } as Record<string, number>)[trainee.plan];
  if (!amount) return json({ ok: false, error: "Invalid learner plan" }, 400);
  const reference = `STARKAC-${crypto.randomUUID()}`;
  const authResponse = await fetch("https://api.monnify.com/api/v1/auth/login", { method: "POST", headers: { Authorization: `Basic ${btoa(`${Deno.env.get("MONNIFY_API_KEY")}:${Deno.env.get("MONNIFY_SECRET_KEY")}`)}`, "Content-Type": "application/json" } });
  const auth = await authResponse.json();
  if (!authResponse.ok || !auth.responseBody?.accessToken) return json({ ok: false, error: "Payment service unavailable" }, 502);
  const initResponse = await fetch("https://api.monnify.com/api/v1/merchant/transactions/init-transaction", { method: "POST", headers: { Authorization: `Bearer ${auth.responseBody.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount, customerName: trainee.full_name, customerEmail: email, paymentReference: reference, paymentDescription: `StarkAC ${trainee.plan} training`, currencyCode: "USD", contractCode: Deno.env.get("MONNIFY_CONTRACT_CODE"), redirectUrl: `${Deno.env.get("PUBLIC_SITE_URL") || "https://starkworth.org"}/starkac/dashboard.html` }) });
  const payment = await initResponse.json();
  if (!initResponse.ok || !payment.responseBody?.checkoutUrl) return json({ ok: false, error: "Could not initialize payment" }, 502);
  await admin.from("starkac_payments").insert({ trainee_email: email, payment_reference: reference, amount_usd: amount, provider_reference: payment.responseBody.transactionReference });
  return json({ ok: true, checkoutUrl: payment.responseBody.checkoutUrl, paymentReference: reference });
});
