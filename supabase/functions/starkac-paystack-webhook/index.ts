// Paystack webhook receiver for StarkAC payments.
//
// Configure this URL in the Paystack Dashboard -> Settings -> API Keys &
// Webhooks:
//   https://<your-project-ref>.functions.supabase.co/starkac-paystack-webhook
//
// Paystack calls this server-to-server (no user session), so authenticity is
// verified via the x-paystack-signature header - an HMAC-SHA512 of the raw
// request body keyed with your PAYSTACK_SECRET_KEY - rather than a bearer
// token. Requests that fail that check are rejected outright.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function hmacSha512Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!paystackSecret) return json({ ok: false, error: "Payment service is not configured" }, 500);

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") || "";
  const expected = await hmacSha512Hex(paystackSecret, rawBody);
  if (!signature || signature !== expected) {
    return json({ ok: false, error: "Invalid signature" }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Invalid payload" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const reference = event?.data?.reference;
  if (!reference) return json({ ok: true }); // Nothing we track - ack so Paystack stops retrying.

  if (event.event === "charge.success") {
    // Defense in depth: re-verify server-to-server with Paystack rather than
    // trusting the webhook payload's amount/status directly.
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verified = await verifyResponse.json();
    if (!verifyResponse.ok || verified?.data?.status !== "success") {
      return json({ ok: true }); // Ack, but don't mark as paid on an unverified success.
    }

    const { data: payment } = await admin
      .from("starkac_payments")
      .select("id, trainee_email, status")
      .eq("payment_reference", reference)
      .maybeSingle();
    if (!payment) return json({ ok: true });

    if (payment.status !== "paid") {
      await admin
        .from("starkac_payments")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          channel: verified.data.channel || null,
          provider_reference: String(verified.data.id ?? reference),
        })
        .eq("id", payment.id);

      await admin
        .from("starkac_trainees")
        .update({ status: "onboarded" })
        .eq("email", payment.trainee_email)
        .eq("status", "waiting");
    }
  } else if (["charge.failed", "transfer.failed"].includes(event.event)) {
    await admin.from("starkac_payments").update({ status: "failed" }).eq("payment_reference", reference).neq("status", "paid");
  }

  return json({ ok: true });
});
