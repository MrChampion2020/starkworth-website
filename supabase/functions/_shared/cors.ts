// Shared CORS headers for Mena's Edge Functions. The chat widget calls
// these from starkworth.org (or a local dev server), a different origin
// from *.functions.supabase.co, so both the preflight OPTIONS request and
// the real response need these headers.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
