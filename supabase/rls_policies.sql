-- Run this in the Supabase SQL Editor for this project.
--
-- WHY: right now every table (agreements, workers, contacts) is reachable
-- with the public anon key that already ships in js/supabase.js. That key
-- is visible to anyone who views page source. Without Row Level Security,
-- anyone can call the Supabase REST API directly with that key to read,
-- edit, or delete every agreement, worker, and contact record -- completely
-- bypassing the admin.html login screen, whether it checks a password or
-- (as of this update) a real Supabase Auth login.
--
-- This script:
--   1. Turns on Row Level Security for all three tables.
--   2. Keeps the public forms working by allowing anonymous INSERT only.
--   3. Restricts SELECT/UPDATE/DELETE to signed-in admin accounts you list below.
--   4. Lets a signed-in Annotator read (only) their own worker row, for
--      pages/worker-dashboard.html.
--   5. Lets a signed-in Account Owner read (only) their own agreement row,
--      for pages/client-dashboard.html.

alter table public.agreements enable row level security;
alter table public.workers enable row level security;
alter table public.contacts enable row level security;

-- Replace with the real email(s) of Starkworth staff who should have admin
-- access. Create these as users under Authentication > Users in the
-- Supabase dashboard, then sign in with them on pages/admin.html.
-- (Postgres arrays need single quotes around each value.)
create or replace function public.is_starkworth_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'admin@starkworth.org'
    -- , 'second-admin@starkworth.org'
  );
$$;

-- ===== agreements =====
create policy "anon can submit agreements" on public.agreements
  for insert to anon with check (true);

create policy "admins can read agreements" on public.agreements
  for select to authenticated using (public.is_starkworth_admin());

create policy "account owners can read own agreement" on public.agreements
  for select to authenticated using (auth.jwt() ->> 'email' = email);

create policy "admins can update agreements" on public.agreements
  for update to authenticated using (public.is_starkworth_admin());

create policy "admins can delete agreements" on public.agreements
  for delete to authenticated using (public.is_starkworth_admin());

-- ===== workers =====
create policy "anon can submit worker registrations" on public.workers
  for insert to anon with check (true);

create policy "admins can read workers" on public.workers
  for select to authenticated using (public.is_starkworth_admin());

create policy "workers can read own row" on public.workers
  for select to authenticated using (auth.jwt() ->> 'email' = email);

create policy "admins can update workers" on public.workers
  for update to authenticated using (public.is_starkworth_admin());

create policy "admins can delete workers" on public.workers
  for delete to authenticated using (public.is_starkworth_admin());

-- ===== contacts =====
create policy "anon can submit contact messages" on public.contacts
  for insert to anon with check (true);

create policy "admins can read contacts" on public.contacts
  for select to authenticated using (public.is_starkworth_admin());

create policy "admins can delete contacts" on public.contacts
  for delete to authenticated using (public.is_starkworth_admin());
