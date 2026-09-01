-- Affiliate, referral, payout, and weekly task infrastructure for Starkworth.
--
-- This extends the existing workers/agreements model with:
--   1. Unique referral codes for every worker and account owner.
--   2. Global affiliate settings controlled by admins.
--   3. Weekly earning, payout, withdrawal, commission, and task schedule tables.
--   4. RLS policies so users can read only their own rows, while admins manage all data.

create or replace function public.is_starkworth_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'admin@starkworth.org'
  );
$$;

-- ===== Existing tables: add affiliate/task columns =====
alter table if exists public.workers
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists weekly_value_usd numeric(12,2) default 0,
  add column if not exists task_start_date date,
  add column if not exists task_end_date date,
  add column if not exists daily_time_slots jsonb not null default '[]'::jsonb;

alter table if exists public.agreements
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists weekly_value_usd numeric(12,2) default 0,
  add column if not exists task_start_date date,
  add column if not exists task_end_date date,
  add column if not exists daily_time_slots jsonb not null default '[]'::jsonb;

create unique index if not exists workers_referral_code_idx on public.workers (referral_code) where referral_code is not null;
create unique index if not exists agreements_referral_code_idx on public.agreements (referral_code) where referral_code is not null;
create index if not exists workers_referred_by_code_idx on public.workers (referred_by_code);
create index if not exists agreements_referred_by_code_idx on public.agreements (referred_by_code);

-- ===== Referral code generator =====
create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.workers where referral_code = code)
      and not exists (select 1 from public.agreements where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.ensure_referral_fields()
returns trigger
language plpgsql
as $$
begin
  if new.referral_code is null or btrim(new.referral_code) = '' then
    new.referral_code := public.generate_referral_code();
  end if;

  if new.daily_time_slots is null then
    new.daily_time_slots := '[]'::jsonb;
  end if;

  return new;
end;
$$;

drop trigger if exists workers_ensure_referral_fields on public.workers;
create trigger workers_ensure_referral_fields
  before insert on public.workers
  for each row execute function public.ensure_referral_fields();

drop trigger if exists agreements_ensure_referral_fields on public.agreements;
create trigger agreements_ensure_referral_fields
  before insert on public.agreements
  for each row execute function public.ensure_referral_fields();

update public.workers
set referral_code = public.generate_referral_code()
where referral_code is null or btrim(referral_code) = '';

update public.agreements
set referral_code = public.generate_referral_code()
where referral_code is null or btrim(referral_code) = '';

-- ===== Affiliate settings =====
create table if not exists public.affiliate_settings (
  id integer primary key default 1,
  default_direct_pct numeric(5,2) not null default 5,
  second_tree_enabled boolean not null default false,
  second_tree_pct numeric(5,2) not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.affiliate_settings (id)
values (1)
on conflict (id) do nothing;

-- ===== Dedicated affiliate accounts =====
-- Affiliate identities are intentionally separate from workers and account owners.
create table if not exists public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  referral_code text not null unique,
  referred_by_code text,
  status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_accounts_referred_by_code_idx
  on public.affiliate_accounts (referred_by_code);

create or replace function public.generate_affiliate_referral_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  loop
    code := 'AFF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.affiliate_accounts where referral_code = code)
      and not exists (select 1 from public.workers where referral_code = code)
      and not exists (select 1 from public.agreements where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_affiliate_account_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'portal_type', '') = 'affiliate' then
    insert into public.affiliate_accounts (email, full_name, referral_code, referred_by_code)
    values (lower(new.email), coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)), public.generate_affiliate_referral_code(), nullif(new.raw_user_meta_data ->> 'referred_by_code', ''))
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_affiliate on auth.users;
create trigger on_auth_user_created_affiliate
  after insert on auth.users
  for each row execute function public.create_affiliate_account_profile();

alter table public.affiliate_accounts enable row level security;

drop policy if exists "affiliate users can read own profile" on public.affiliate_accounts;
create policy "affiliate users can read own profile" on public.affiliate_accounts
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(email) or public.is_starkworth_admin());

drop policy if exists "admins can manage affiliate profiles" on public.affiliate_accounts;
create policy "admins can manage affiliate profiles" on public.affiliate_accounts
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

create or replace function public.set_affiliate_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists affiliate_settings_set_updated_at on public.affiliate_settings;
create trigger affiliate_settings_set_updated_at
  before update on public.affiliate_settings
  for each row execute function public.set_affiliate_settings_updated_at();

-- ===== History tables =====
create table if not exists public.affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  portal_type text not null check (portal_type in ('worker', 'owner')),
  week_start date not null,
  week_end date not null,
  weekly_value_usd numeric(12,2) not null default 0,
  task_start_date date,
  task_end_date date,
  daily_time_slots jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'paid', 'adjusted')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_earnings_email_idx on public.affiliate_earnings (email, week_start desc);

create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  portal_type text not null check (portal_type in ('worker', 'owner')),
  week_start date not null,
  week_end date not null,
  amount_usd numeric(12,2) not null default 0,
  payout_method text,
  reference text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_payouts_email_idx on public.affiliate_payouts (email, created_at desc);

create table if not exists public.affiliate_withdrawals (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  portal_type text not null check (portal_type in ('worker', 'owner')),
  amount_usd numeric(12,2) not null default 0,
  destination text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'paid')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  notes text
);

create index if not exists affiliate_withdrawals_email_idx on public.affiliate_withdrawals (email, requested_at desc);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_email text not null,
  referrer_portal_type text not null check (referrer_portal_type in ('worker', 'owner')),
  referred_email text not null,
  referred_portal_type text not null check (referred_portal_type in ('worker', 'owner')),
  tier integer not null check (tier in (1, 2)),
  rate_pct numeric(5,2) not null default 5,
  base_amount_usd numeric(12,2) not null default 0,
  commission_usd numeric(12,2) not null default 0,
  week_start date not null,
  week_end date not null,
  second_tree_enabled boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_commissions_referrer_idx on public.affiliate_commissions (referrer_email, created_at desc);

create table if not exists public.weekly_task_assignments (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  portal_type text not null check (portal_type in ('worker', 'owner')),
  task_name text not null,
  week_start date not null,
  week_end date not null,
  task_start_date date not null,
  task_end_date date not null,
  daily_time_slots jsonb not null default '[]'::jsonb,
  weekly_value_usd numeric(12,2) not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'paused')),
  created_at timestamptz not null default now()
);

create index if not exists weekly_task_assignments_email_idx on public.weekly_task_assignments (email, week_start desc);

create table if not exists public.affiliate_referrer_rules (
  id uuid primary key default gen_random_uuid(),
  referrer_email text not null,
  referrer_portal_type text not null check (referrer_portal_type in ('worker', 'owner')),
  second_tree_enabled boolean not null default false,
  second_tree_pct numeric(5,2) not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists affiliate_referrer_rules_referrer_idx
  on public.affiliate_referrer_rules (referrer_email, referrer_portal_type);

-- Affiliate accounts also use the shared history tables, while remaining a
-- distinct portal type from workers and account owners.
alter table public.affiliate_earnings drop constraint if exists affiliate_earnings_portal_type_check;
alter table public.affiliate_earnings add constraint affiliate_earnings_portal_type_check check (portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_payouts drop constraint if exists affiliate_payouts_portal_type_check;
alter table public.affiliate_payouts add constraint affiliate_payouts_portal_type_check check (portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_withdrawals drop constraint if exists affiliate_withdrawals_portal_type_check;
alter table public.affiliate_withdrawals add constraint affiliate_withdrawals_portal_type_check check (portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_commissions drop constraint if exists affiliate_commissions_referrer_portal_type_check;
alter table public.affiliate_commissions add constraint affiliate_commissions_referrer_portal_type_check check (referrer_portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_commissions drop constraint if exists affiliate_commissions_referred_portal_type_check;
alter table public.affiliate_commissions add constraint affiliate_commissions_referred_portal_type_check check (referred_portal_type in ('worker', 'owner', 'affiliate'));
alter table public.weekly_task_assignments drop constraint if exists weekly_task_assignments_portal_type_check;
alter table public.weekly_task_assignments add constraint weekly_task_assignments_portal_type_check check (portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_referrer_rules drop constraint if exists affiliate_referrer_rules_referrer_portal_type_check;
alter table public.affiliate_referrer_rules add constraint affiliate_referrer_rules_referrer_portal_type_check check (referrer_portal_type in ('worker', 'owner', 'affiliate'));

-- ===== RLS =====
alter table public.affiliate_settings enable row level security;
alter table public.affiliate_earnings enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_withdrawals enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.weekly_task_assignments enable row level security;
alter table public.affiliate_referrer_rules enable row level security;

-- Settings: admins only.
drop policy if exists "admins can read affiliate settings" on public.affiliate_settings;
create policy "admins can read affiliate settings" on public.affiliate_settings
  for select to authenticated using (public.is_starkworth_admin());

drop policy if exists "authenticated can read affiliate settings" on public.affiliate_settings;
create policy "authenticated can read affiliate settings" on public.affiliate_settings
  for select to authenticated using (true);

drop policy if exists "admins can update affiliate settings" on public.affiliate_settings;
create policy "admins can update affiliate settings" on public.affiliate_settings
  for update to authenticated using (public.is_starkworth_admin());

drop policy if exists "admins can insert affiliate settings" on public.affiliate_settings;
create policy "admins can insert affiliate settings" on public.affiliate_settings
  for insert to authenticated with check (public.is_starkworth_admin());

-- Earnings.
drop policy if exists "users can read own earnings" on public.affiliate_earnings;
create policy "users can read own earnings" on public.affiliate_earnings
  for select to authenticated using (auth.jwt() ->> 'email' = email or public.is_starkworth_admin());

drop policy if exists "admins can manage earnings" on public.affiliate_earnings;
create policy "admins can manage earnings" on public.affiliate_earnings
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

-- Payouts.
drop policy if exists "users can read own payouts" on public.affiliate_payouts;
create policy "users can read own payouts" on public.affiliate_payouts
  for select to authenticated using (auth.jwt() ->> 'email' = email or public.is_starkworth_admin());

drop policy if exists "admins can manage payouts" on public.affiliate_payouts;
create policy "admins can manage payouts" on public.affiliate_payouts
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

-- Withdrawals.
drop policy if exists "users can read own withdrawals" on public.affiliate_withdrawals;
create policy "users can read own withdrawals" on public.affiliate_withdrawals
  for select to authenticated using (auth.jwt() ->> 'email' = email or public.is_starkworth_admin());

drop policy if exists "users can request own withdrawals" on public.affiliate_withdrawals;
create policy "users can request own withdrawals" on public.affiliate_withdrawals
  for insert to authenticated with check (auth.jwt() ->> 'email' = email or public.is_starkworth_admin());

drop policy if exists "admins can manage withdrawals" on public.affiliate_withdrawals;
create policy "admins can manage withdrawals" on public.affiliate_withdrawals
  for update to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

-- Commission history.
drop policy if exists "users can read own commissions" on public.affiliate_commissions;
create policy "users can read own commissions" on public.affiliate_commissions
  for select to authenticated using (auth.jwt() ->> 'email' = referrer_email or public.is_starkworth_admin());

drop policy if exists "admins can manage commissions" on public.affiliate_commissions;
create policy "admins can manage commissions" on public.affiliate_commissions
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

-- Weekly task assignments.
drop policy if exists "users can read own task assignments" on public.weekly_task_assignments;
create policy "users can read own task assignments" on public.weekly_task_assignments
  for select to authenticated using (auth.jwt() ->> 'email' = email or public.is_starkworth_admin());

drop policy if exists "admins can manage task assignments" on public.weekly_task_assignments;
create policy "admins can manage task assignments" on public.weekly_task_assignments
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "users can read own referrer rules" on public.affiliate_referrer_rules;
create policy "users can read own referrer rules" on public.affiliate_referrer_rules
  for select to authenticated using (auth.jwt() ->> 'email' = referrer_email or public.is_starkworth_admin());

drop policy if exists "admins can manage referrer rules" on public.affiliate_referrer_rules;
create policy "admins can manage referrer rules" on public.affiliate_referrer_rules
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());
