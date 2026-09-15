// Admin-only StarkAC trainer provisioning. Trainers never self-register -
// this is the sole way a trainer account comes into existence, matching
// "only the admin should provide access to the trainers."
//
// Creates (or invites) the Supabase Auth user and the public.starkac_trainers
// row together, then emails the trainer a Supabase invite link that lands on
// pages/reset-password.html to set their own password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);

  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_starkworth_admin");
  if (adminError || !isAdmin) return json({ ok: false, error: "Admin access required" }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // no body - handled by the validation below
  }
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  if (!email || !fullName) return json({ ok: false, error: "Email and full name are required" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://starkworth.org";

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/pages/reset-password.html`,
    data: { full_name: fullName },
  });
  // If this email already has a Starkworth account of any kind, the invite
  // fails (user exists) - that's fine, they'll sign in to the trainer portal
  // with their existing password. Any other error is worth surfacing.
  if (inviteError && !/already been registered|already exists/i.test(inviteError.message || "")) {
    return json({ ok: false, error: inviteError.message || "Could not invite the trainer" }, 500);
  }

  const { data: callerUser } = await caller.auth.getUser(token);
  const { error: upsertError } = await admin
    .from("starkac_trainers")
    .upsert(
      { email, full_name: fullName, active: true, created_by: callerUser?.user?.email?.toLowerCase() || null },
      { onConflict: "email" }
    );
  if (upsertError) return json({ ok: false, error: "Could not save the trainer record" }, 500);

  return json({ ok: true, invited: !inviteError });
});
