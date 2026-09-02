import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, full_name } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: "Email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: true, sent: false, reason: "RESEND_API_KEY is not configured" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Starkworth <mena@starkworth.org>",
        to: [email],
        subject: "Your Starkworth affiliate account is ready",
        text: `Hi ${full_name || "there"},\n\nYour Starkworth affiliate account has been saved successfully. Sign in at https://starkworth.org/pages/affiliate.html to access your referral link and dashboard.\n\nThis is a notification only and does not control your account access.`,
      }),
    });

    return new Response(JSON.stringify({ ok: response.ok, sent: response.ok }), { status: response.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (_error) {
    return new Response(JSON.stringify({ ok: false, sent: false }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
