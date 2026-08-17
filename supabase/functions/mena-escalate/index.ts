// Mena escalation endpoint.
//
// Called by the chat widget (js/mena-chat.js) when a visitor's
// conversation needs a human: either they explicitly asked for one, or
// Mena silently escalates on a first-timer greeting/orientation question
// so a team member can jump in proactively.
//
// Runs with the service-role key (never exposed to the browser) so it can
// write to public.mena_chats even though that table has no anon RLS
// policies — see supabase/mena_chat_schema.sql for why that's deliberate.
//
// Deploy: supabase functions deploy mena-escalate
// Optional email alert: set a RESEND_API_KEY secret (or adapt sendAdminEmail
// below for whatever provider you use) — without it, escalation still
// works, admins just won't get an email and rely on the admin.html
// "Live Chat" tab instead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_TEXT_LENGTH = 2000;
const MAX_MESSAGES = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IncomingMessage {
  sender: "user" | "bot" | "admin";
  text: string;
  ts?: string;
}

function clean(text: unknown, max = MAX_TEXT_LENGTH): string {
  return String(text ?? "").slice(0, max);
}

function sanitizeMessages(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_MESSAGES)
    .filter((m) => m && typeof m === "object" && ["user", "bot", "admin"].includes((m as any).sender))
    .map((m: any) => ({
      sender: m.sender,
      text: clean(m.text),
      ts: typeof m.ts === "string" ? m.ts : new Date().toISOString(),
    }));
}

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

  const lastQuestion = clean(body.last_question) || "(no question provided)";
  const userEmail = body.user_email ? clean(body.user_email, 320) : null;
  const messages = sanitizeMessages(body.messages);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Upsert: if this session already exists (e.g. the visitor escalates a
  // second time later in the same browser), merge in the latest transcript
  // and re-flag it unread for admin rather than creating a duplicate row.
  const { data: existing } = await supabase
    .from("mena_chats")
    .select("id, messages")
    .eq("session_id", sessionId)
    .maybeSingle();

  const mergedMessages = existing
    ? [...(existing.messages as IncomingMessage[]), ...messages].slice(-MAX_MESSAGES)
    : messages;

  const { error } = await supabase.from("mena_chats").upsert(
    {
      session_id: sessionId,
      user_email: userEmail,
      status: "escalated",
      last_question: lastQuestion,
      messages: mergedMessages,
      unread_by_admin: true,
    },
    { onConflict: "session_id" },
  );

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Best-effort email alert — failures here must never break escalation
  // itself, since the admin.html Live Chat tab is the source of truth.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    try {
      await sendAdminEmail(resendKey, sessionId, lastQuestion, userEmail);
    } catch (_err) {
      // Swallow — escalation already succeeded above.
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function sendAdminEmail(
  apiKey: string,
  sessionId: string,
  lastQuestion: string,
  userEmail: string | null,
) {
  // Swap this for whatever provider you actually configure — Resend's API
  // is used here as a concrete example, not a hard dependency.
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Mena <mena@starkworth.org>",
      to: ["admin@starkworth.org"],
      subject: "A visitor asked to speak with a human on starkworth.org",
      text:
        `Session: ${sessionId}\n` +
        `From: ${userEmail || "(guest, no email on file)"}\n` +
        `Last question: ${lastQuestion}\n\n` +
        `Open the Live Chat tab in the admin panel to see the full conversation and reply.`,
    }),
  });
}
