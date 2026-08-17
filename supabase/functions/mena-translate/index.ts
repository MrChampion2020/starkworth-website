// Translates text for Mena's multilingual voice mode (js/mena-voice.js).
//
// Used two ways:
//  1. Incoming: a visitor speaks or types in their chosen language ->
//     translated to English -> fed into the existing English-only KB
//     matching in js/chatbot.js.
//  2. Outgoing: Mena's English reply -> translated to the visitor's
//     chosen language -> spoken aloud (and shown) in that language.
//
// Runs server-side specifically so the paid translation API key is never
// shipped to the browser — same reasoning as every other Edge Function in
// this project (see supabase/mena_chat_schema.sql for the fuller version
// of this argument re: the public anon key).
//
// Deploy: supabase functions deploy mena-translate
// Requires: supabase secrets set GOOGLE_TRANSLATE_API_KEY=your-key-here
// (Google Cloud Console -> APIs & Services -> Credentials, with the
// "Cloud Translation API" enabled on the project). This uses the simple
// API-key-authenticated Translation API v2 REST endpoint — no service
// account/OAuth setup needed.
//
// Swapping providers (e.g. DeepL): replace the single fetch call in
// translateText() below with that provider's API — the request/response
// contract this function exposes to the client (text, targetLang,
// sourceLang in; translatedText, detectedSourceLang out) doesn't need to
// change, so nothing in js/mena-voice.js has to change either.

import { corsHeaders } from "../_shared/cors.ts";

const MAX_TEXT_LENGTH = 2000;

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

  const text = String(body.text ?? "").slice(0, MAX_TEXT_LENGTH);
  const targetLang = String(body.targetLang ?? "").trim();
  const sourceLang = body.sourceLang ? String(body.sourceLang).trim() : undefined;

  if (!text || !targetLang) {
    return new Response(JSON.stringify({ ok: false, error: "text and targetLang are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Translation isn't configured yet (missing GOOGLE_TRANSLATE_API_KEY)." }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const result = await translateText(apiKey, text, targetLang, sourceLang);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function translateText(
  apiKey: string,
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
): Promise<{ translatedText: string; detectedSourceLang: string | null }> {
  const params = new URLSearchParams({ key: apiKey });
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      ...(sourceLang ? { source: sourceLang } : {}),
      format: "text",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Translation API returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const translation = data?.data?.translations?.[0];
  if (!translation) throw new Error("Translation API returned no result");

  return {
    translatedText: translation.translatedText,
    detectedSourceLang: translation.detectedSourceLanguage || null,
  };
}
