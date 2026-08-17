// Mena "did an admin reply yet?" endpoint.
//
// Called by the chat widget (js/mena-chat.js) — on load, and while a chat
// is in escalated status — with only the session_id already stored in the
// visitor's own localStorage. Runs with the service-role key so it can
// read public.mena_chats despite that table having no anon SELECT policy
// (see supabase/mena_chat_schema.sql for why), and only ever returns the
// one row matching the session_id it was given.
//
// Deploy: supabase functions deploy mena-session-status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sessionId = String(body.session_id ?? "");
  if (!UUID_RE.test(sessionId)) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid session_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("mena_chats")
    .select("status, messages, unread_by_user")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!data) {
    return new Response(JSON.stringify({ ok: true, found: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hadNewReply = data.unread_by_user;

  // Mark as read now that the widget has fetched it, so the "check Mena"
  // banner doesn't keep reappearing for the same reply. Best-effort: if
  // this fails, the worst case is the banner shows once more next time.
  if (hadNewReply) {
    await supabase
      .from("mena_chats")
      .update({ unread_by_user: false })
      .eq("session_id", sessionId);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      found: true,
      status: data.status,
      messages: data.messages,
      hadNewReply,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
