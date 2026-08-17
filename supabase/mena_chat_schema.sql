-- Mena live-chat escalation storage.
--
-- WHY THIS TABLE HAS NO ANON POLICIES AT ALL:
-- The public anon key ships in plain JS (js/supabase.js) — anyone can read
-- it from page source. A `for select to anon using (true)` policy on a
-- chat-transcript table would let ANY visitor dump every OTHER visitor's
-- transcript (including whatever emails/questions they typed), because
-- RLS can't restrict `using (true)` to "only the caller's own session" —
-- there is no per-guest identity to check it against. And a session_id
-- being hard to guess doesn't help either: a blanket policy exposes the
-- FULL table to anyone who queries it without a filter, not just to
-- someone who already knows one session_id.
--
-- So: guests never touch this table directly. All writes from the chat
-- widget (escalating a conversation) and all reads from the chat widget
-- (polling "did an admin reply yet") go through two Supabase Edge
-- Functions (supabase/functions/mena-escalate and
-- supabase/functions/mena-session-status), which use the service-role key
-- server-side and only ever return the one session_id the caller already
-- has. Deploy those functions for this table to actually be usable — see
-- supabase/functions/README.md.
--
-- Starkworth admins (already using real Supabase Auth logins per
-- rls_policies.sql) read and reply through the normal authenticated REST
-- API, gated by the same is_starkworth_admin() function used for
-- agreements/workers/contacts.

create table if not exists public.mena_chats (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  user_email text,
  status text not null default 'escalated' check (status in ('escalated', 'admin_replied', 'closed')),
  last_question text not null,
  -- Full transcript as [{ "sender": "user"|"bot"|"admin", "text": "...", "ts": "ISO8601" }, ...]
  messages jsonb not null default '[]'::jsonb,
  unread_by_admin boolean not null default true,
  unread_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mena_chats_updated_at_idx on public.mena_chats (updated_at desc);
create index if not exists mena_chats_unread_admin_idx on public.mena_chats (unread_by_admin) where unread_by_admin = true;

alter table public.mena_chats enable row level security;

-- No anon policies — see note above. Only admins (authenticated + the
-- existing is_starkworth_admin() check from rls_policies.sql) and the
-- service role (used inside the Edge Functions, which bypasses RLS
-- entirely) can touch this table.
create policy "admins can read mena chats" on public.mena_chats
  for select to authenticated using (public.is_starkworth_admin());

create policy "admins can update mena chats" on public.mena_chats
  for update to authenticated using (public.is_starkworth_admin());

-- Keep updated_at current on every write, same convention as the rest of
-- the schema would use if it had triggers — small and worth having here
-- since the admin Live Chat tab sorts by this column.
create or replace function public.set_mena_chat_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mena_chats_set_updated_at on public.mena_chats;
create trigger mena_chats_set_updated_at
  before update on public.mena_chats
  for each row execute function public.set_mena_chat_updated_at();
