# Mena chat & voice Edge Functions

Three small Supabase Edge Functions back Mena's "talk to a human" path
and her multilingual voice mode. They exist specifically so the browser
never needs direct read/write access to `public.mena_chats` — or a paid
translation API key — with the public anon key. See the comment at the
top of `supabase/mena_chat_schema.sql` for the fuller version of that
argument.

## Deploy

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli), logged
in and linked to this project (`supabase link --project-ref <ref>`).

```bash
# 1. Run the schema migration once, in the Supabase SQL Editor or via CLI:
supabase db execute -f supabase/mena_chat_schema.sql

# 2. Deploy all three functions:
supabase functions deploy mena-escalate
supabase functions deploy mena-session-status
supabase functions deploy mena-translate
```

No extra configuration is required for `mena-escalate` or
`mena-session-status` — Supabase automatically injects `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` into every Edge Function's environment.
`mena-translate` needs one secret of your own — see below.

## Required for voice mode in other languages: a translation API key

Mena's knowledge base is English-only, so the language selector and mic
button in `pages/support.html` (powered by `js/mena-voice.js`) work by
translating non-English input to English before matching, and English
replies back to the visitor's language before speaking them aloud. That
translation step needs `mena-translate` to have a Google Cloud
Translation API key:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create
   (or pick) a project, enable the **Cloud Translation API**, then create
   an **API key** under APIs & Services -> Credentials. This is the
   simple API-key auth mode (Translation API v2) — no service account or
   OAuth setup needed.
2. Set it as a secret:
   ```bash
   supabase secrets set GOOGLE_TRANSLATE_API_KEY=your-key-here
   ```

Without this secret, voice mode still works for **English** (speech
input/output both function via the browser's built-in Web Speech API,
which is free and needs no key) — selecting another language will just
leave messages untranslated rather than erroring, since `mena-translate`
fails soft (see `js/mena-voice.js`'s `translate()`).

Translation is billed per character by Google — check current pricing
before enabling for a high-traffic page. To use a different provider
(e.g. DeepL), edit `translateText()` in
`supabase/functions/mena-translate/index.ts` — it's a single `fetch`
call; the request/response shape the function exposes to the client
doesn't need to change.

## Optional: email Starkworth staff on escalation

`mena-escalate` will try to send an email via [Resend](https://resend.com)
if a `RESEND_API_KEY` secret is set:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
```

Without this secret, escalation still works exactly the same — the chat
is saved and shows up in the **Live Chat** tab in `pages/admin.html` with
an unread badge, admins just won't get an email nudge. If you use a
different email provider, edit `sendAdminEmail()` in
`supabase/functions/mena-escalate/index.ts` — it's a single `fetch` call,
swap the URL/payload for your provider's API and the rest of the function
is unaffected.

## What the client calls

- `js/mena-chat.js` posts to `${SUPABASE_URL}/functions/v1/mena-escalate`
  when a visitor asks for a human, or on a first-timer greeting.
- The same file posts to
  `${SUPABASE_URL}/functions/v1/mena-session-status` to check whether an
  admin has replied to an already-escalated session, and to pull down
  their reply.
- `js/mena-voice.js` posts to `${SUPABASE_URL}/functions/v1/mena-translate`
  whenever a non-English language is selected — once to translate the
  visitor's message to English before matching, and again to translate
  Mena's reply to their language before speaking it aloud.

Both are called with the same `apikey` / `Authorization: Bearer
<anon key>` headers used for every other Supabase REST call in this repo
— that satisfies Supabase's platform-level "is this a valid project key"
check; the functions' own logic never trusts the anon key for anything
beyond that.
