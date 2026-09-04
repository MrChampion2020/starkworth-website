-- Affiliate, referral, payout, and weekly task infrastructure for Starkworth.
--
-- This extends the existing workers/agreements model with:
--   1. Unique referral codes for every worker and account owner.
--   2. Global affiliate settings controlled by admins.
--   3. Weekly earning, payout, withdrawal, commission, and task schedule tables.
--   4. RLS policies so users can read only their own rows, while admins manage all data.

-- All privileged users live in their own table; this keeps admin identities
-- separate from worker, owner, and affiliate profiles.
create table if not exists public.starkworth_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  role text not null default 'super_admin' check (role in ('super_admin', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.starkworth_admins (email, display_name, role)
values ('admin@starkworth.org', 'Starkworth Admin', 'super_admin')
on conflict (email) do nothing;

create or replace function public.is_starkworth_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.starkworth_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and a.active
  );
$$;

-- ===== Existing tables: add affiliate/task columns =====
alter table if exists public.workers
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists weekly_value_usd numeric(12,2) default 0,
  add column if not exists earning_period text not null default 'weekly',
  add column if not exists task_start_date date,
  add column if not exists task_end_date date,
  add column if not exists daily_time_slots jsonb not null default '[]'::jsonb;

alter table if exists public.agreements
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists weekly_value_usd numeric(12,2) default 0,
  add column if not exists earning_period text not null default 'weekly',
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

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_email text not null,
  referrer_portal_type text not null check (referrer_portal_type in ('worker', 'owner', 'affiliate')),
  referred_email text not null,
  referred_portal_type text not null check (referred_portal_type in ('worker', 'owner', 'affiliate')),
  referral_code text not null,
  status text not null default 'captured' check (status in ('captured', 'onboarded', 'eligible', 'inactive')),
  captured_at timestamptz not null default now(),
  onboarded_at timestamptz,
  updated_at timestamptz not null default now(),
  notes text
);

create unique index if not exists affiliate_referrals_unique_idx on public.affiliate_referrals (referrer_email, referred_email, referred_portal_type);
create index if not exists affiliate_referrals_referrer_idx on public.affiliate_referrals (referrer_email, captured_at desc);

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

create or replace function public.record_affiliate_referral(p_referred_email text, p_referred_portal_type text, p_referral_code text)
returns void language plpgsql security definer set search_path = public
as $$
declare referrer record;
begin
  if nullif(trim(p_referral_code), '') is null then return; end if;
  select email, 'affiliate'::text as portal_type into referrer from public.affiliate_accounts where referral_code = p_referral_code limit 1;
  if referrer.email is null then select email, 'worker'::text as portal_type into referrer from public.workers where referral_code = p_referral_code limit 1; end if;
  if referrer.email is null then select email, 'owner'::text as portal_type into referrer from public.agreements where referral_code = p_referral_code limit 1; end if;
  if referrer.email is null or lower(referrer.email) = lower(p_referred_email) then return; end if;
  insert into public.affiliate_referrals (referrer_email, referrer_portal_type, referred_email, referred_portal_type, referral_code)
  values (lower(referrer.email), referrer.portal_type, lower(p_referred_email), p_referred_portal_type, p_referral_code)
  on conflict (referrer_email, referred_email, referred_portal_type) do update set referral_code = excluded.referral_code, updated_at = now();
end;
$$;

create or replace function public.require_referral_code()
returns trigger language plpgsql as $$
begin
  if nullif(trim(new.referred_by_code), '') is null then
    raise exception 'A referral code is required to complete onboarding';
  end if;
  if not exists (select 1 from public.affiliate_accounts where referral_code = trim(new.referred_by_code))
    and not exists (select 1 from public.workers where referral_code = trim(new.referred_by_code))
    and not exists (select 1 from public.agreements where referral_code = trim(new.referred_by_code)) then
    raise exception 'The referral code is invalid';
  end if;
  return new;
end;
$$;

create or replace function public.link_existing_referral(
  p_referrer_email text,
  p_referrer_portal_type text,
  p_referred_email text,
  p_referred_portal_type text,
  p_referral_code text default null,
  p_notes text default 'Linked manually by admin'
)
returns public.affiliate_referrals
language plpgsql security definer set search_path = public
as $$
declare
  ref_code text := nullif(trim(p_referral_code), '');
  linked public.affiliate_referrals;
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  if lower(trim(p_referrer_portal_type)) not in ('worker', 'owner', 'affiliate') or lower(trim(p_referred_portal_type)) not in ('worker', 'owner', 'affiliate') then raise exception 'Invalid portal type'; end if;
  if lower(trim(p_referrer_email)) = lower(trim(p_referred_email)) then raise exception 'Referrer and referred user must be different'; end if;

  if ref_code is null then
    select referral_code into ref_code from public.affiliate_accounts where lower(email) = lower(trim(p_referrer_email)) limit 1;
    if ref_code is null then select referral_code into ref_code from public.workers where lower(email) = lower(trim(p_referrer_email)) limit 1; end if;
    if ref_code is null then select referral_code into ref_code from public.agreements where lower(email) = lower(trim(p_referrer_email)) limit 1; end if;
  end if;
  if ref_code is null then raise exception 'Referrer referral code was not found'; end if;

  insert into public.affiliate_referrals
    (referrer_email, referrer_portal_type, referred_email, referred_portal_type, referral_code, status, onboarded_at, notes)
  values
    (lower(trim(p_referrer_email)), lower(trim(p_referrer_portal_type)), lower(trim(p_referred_email)), lower(trim(p_referred_portal_type)), ref_code, 'onboarded', now(), p_notes)
  on conflict (referrer_email, referred_email, referred_portal_type)
  do update set referrer_portal_type = excluded.referrer_portal_type, referral_code = excluded.referral_code,
    status = 'onboarded', onboarded_at = coalesce(affiliate_referrals.onboarded_at, now()), notes = excluded.notes, updated_at = now()
  returning * into linked;
  return linked;
end;
$$;

grant execute on function public.link_existing_referral(text, text, text, text, text, text) to authenticated;

drop trigger if exists workers_require_referral_code on public.workers;
create trigger workers_require_referral_code before insert on public.workers
  for each row execute function public.require_referral_code();

drop trigger if exists agreements_require_referral_code on public.agreements;
create trigger agreements_require_referral_code before insert on public.agreements
  for each row execute function public.require_referral_code();

create or replace function public.create_affiliate_account_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'portal_type', '') = 'affiliate' then
    if nullif(trim(new.raw_user_meta_data ->> 'referred_by_code'), '') is null then
      raise exception 'A referral code is required to create an affiliate account';
    end if;
    if not exists (select 1 from public.affiliate_accounts where referral_code = trim(new.raw_user_meta_data ->> 'referred_by_code'))
      and not exists (select 1 from public.workers where referral_code = trim(new.raw_user_meta_data ->> 'referred_by_code'))
      and not exists (select 1 from public.agreements where referral_code = trim(new.raw_user_meta_data ->> 'referred_by_code')) then
      raise exception 'The referral code is invalid';
    end if;
    insert into public.affiliate_accounts (email, full_name, referral_code, referred_by_code)
    values (lower(new.email), coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)), public.generate_affiliate_referral_code(), nullif(new.raw_user_meta_data ->> 'referred_by_code', ''))
    on conflict (email) do nothing;
    perform public.record_affiliate_referral(lower(new.email), 'affiliate', nullif(new.raw_user_meta_data ->> 'referred_by_code', ''));
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_affiliate on auth.users;
create trigger on_auth_user_created_affiliate
  after insert on auth.users
  for each row execute function public.create_affiliate_account_profile();

create or replace function public.record_owner_auth_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'portal_type', '') = 'owner' then
    perform public.record_affiliate_referral(lower(new.email), 'owner', new.raw_user_meta_data ->> 'referred_by_code');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_owner_referral on auth.users;
create trigger on_auth_user_created_owner_referral after insert on auth.users
  for each row execute function public.record_owner_auth_referral();

create or replace function public.record_worker_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_affiliate_referral(lower(new.email), 'worker', new.referred_by_code);
  return new;
end;
$$;

drop trigger if exists workers_record_affiliate_referral on public.workers;
create trigger workers_record_affiliate_referral after insert on public.workers
  for each row execute function public.record_worker_referral();

create or replace function public.record_owner_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_affiliate_referral(lower(new.email), 'owner', new.referred_by_code);
  return new;
end;
$$;

drop trigger if exists agreements_record_affiliate_referral on public.agreements;
create trigger agreements_record_affiliate_referral after insert on public.agreements
  for each row execute function public.record_owner_referral();

-- Backfill referrals captured before this history table existed.
do $$
declare row record;
begin
  for row in select email, referred_by_code from public.workers where nullif(referred_by_code, '') is not null loop
    perform public.record_affiliate_referral(lower(row.email), 'worker', row.referred_by_code);
  end loop;
  for row in select email, referred_by_code from public.agreements where nullif(referred_by_code, '') is not null loop
    perform public.record_affiliate_referral(lower(row.email), 'owner', row.referred_by_code);
  end loop;
end;
$$;

-- Rebuild referral history for accounts created before the referral trigger was installed.
do $$
declare
  v_row record;
begin
  for v_row in select email, referred_by_code from public.workers where nullif(trim(referred_by_code), '') is not null loop
    perform public.record_affiliate_referral(lower(v_row.email), 'worker', trim(v_row.referred_by_code));
  end loop;
  for v_row in select email, referred_by_code from public.agreements where nullif(trim(referred_by_code), '') is not null loop
    perform public.record_affiliate_referral(lower(v_row.email), 'owner', trim(v_row.referred_by_code));
  end loop;
end;
$$;

-- Repairs profiles for affiliate users created while the trigger/migration was unavailable.
create or replace function public.provision_affiliate_profile(
  p_full_name text default null,
  p_referred_by_code text default null
)
returns public.affiliate_accounts
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_email text;
  current_metadata jsonb;
  profile public.affiliate_accounts;
begin
  select email, raw_user_meta_data into current_user_email, current_metadata from auth.users where id = auth.uid();
  if current_user_email is null or coalesce(current_metadata ->> 'portal_type', '') <> 'affiliate' then return null; end if;
  insert into public.affiliate_accounts (email, full_name, referral_code, referred_by_code)
  values (lower(current_user_email), coalesce(nullif(p_full_name, ''), nullif(current_metadata ->> 'full_name', ''), split_part(current_user_email, '@', 1)), public.generate_affiliate_referral_code(), coalesce(nullif(p_referred_by_code, ''), nullif(current_metadata ->> 'referred_by_code', '')))
  on conflict (email) do update set full_name = coalesce(nullif(excluded.full_name, ''), affiliate_accounts.full_name), referred_by_code = coalesce(affiliate_accounts.referred_by_code, excluded.referred_by_code), updated_at = now()
  returning * into profile;
  return profile;
end;
$$;

grant execute on function public.provision_affiliate_profile(text, text) to authenticated;

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
  period_type text not null default 'weekly',
  gross_earnings_usd numeric(12,2) not null default 0,
  account_rate_pct numeric(5,2) not null default 100,
  allocated_amount_usd numeric(12,2) not null default 0,
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
create unique index if not exists affiliate_commissions_period_unique_idx
  on public.affiliate_commissions (referrer_email, referred_email, referred_portal_type, tier, week_start, week_end);

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
  period_type text not null default 'weekly',
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'paused')),
  created_at timestamptz not null default now()
);

create index if not exists weekly_task_assignments_email_idx on public.weekly_task_assignments (email, week_start desc);

create table if not exists public.affiliate_referrer_rules (
  id uuid primary key default gen_random_uuid(),
  referrer_email text not null,
  referrer_portal_type text not null check (referrer_portal_type in ('worker', 'owner')),
  direct_rate_pct numeric(5,2) not null default 5,
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

-- Safe upgrades for installations where the history tables already existed.
alter table public.workers add column if not exists earning_period text not null default 'weekly';
alter table public.agreements add column if not exists earning_period text not null default 'weekly';
alter table public.affiliate_earnings add column if not exists period_type text not null default 'weekly';
alter table public.affiliate_earnings add column if not exists gross_earnings_usd numeric(12,2) not null default 0;
alter table public.affiliate_earnings add column if not exists account_rate_pct numeric(5,2) not null default 100;
alter table public.affiliate_earnings add column if not exists allocated_amount_usd numeric(12,2) not null default 0;
alter table public.weekly_task_assignments add column if not exists period_type text not null default 'weekly';

alter table public.affiliate_earnings drop constraint if exists affiliate_earnings_period_type_check;
alter table public.affiliate_earnings add constraint affiliate_earnings_period_type_check check (period_type in ('weekly', 'biweekly', 'monthly'));
alter table public.weekly_task_assignments drop constraint if exists weekly_task_assignments_period_type_check;
alter table public.weekly_task_assignments add constraint weekly_task_assignments_period_type_check check (period_type in ('weekly', 'biweekly', 'monthly'));

-- Super admins allocate gross task earnings to an account using its assigned rate.
-- The same transaction creates the direct referral commission for that earning period.
create or replace function public.allocate_account_earnings(
  p_email text,
  p_portal_type text,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_gross_amount_usd numeric,
  p_account_rate_pct numeric,
  p_notes text default null
)
returns public.affiliate_earnings
language plpgsql security definer set search_path = public
as $$
declare
  earning public.affiliate_earnings;
  referral record;
  direct_rate numeric;
  allocated numeric := round(greatest(coalesce(p_gross_amount_usd, 0), 0) * greatest(coalesce(p_account_rate_pct, 0), 0) / 100, 2);
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  if lower(trim(p_portal_type)) not in ('worker', 'owner', 'affiliate') then raise exception 'Invalid portal type'; end if;
  if lower(trim(p_period_type)) not in ('weekly', 'biweekly', 'monthly') then raise exception 'Invalid earning period'; end if;
  if p_period_end < p_period_start then raise exception 'Period end must be on or after period start'; end if;

  insert into public.affiliate_earnings
    (email, portal_type, week_start, week_end, weekly_value_usd, period_type,
     gross_earnings_usd, account_rate_pct, allocated_amount_usd, status, notes)
  values
    (lower(trim(p_email)), lower(trim(p_portal_type)), p_period_start, p_period_end,
     allocated, lower(trim(p_period_type)), greatest(coalesce(p_gross_amount_usd, 0), 0),
     greatest(coalesce(p_account_rate_pct, 0), 0), allocated, 'pending', p_notes)
  returning * into earning;

  for referral in
    select ar.* from public.affiliate_referrals ar
    where ar.referred_email = lower(trim(p_email))
      and ar.referred_portal_type = lower(trim(p_portal_type))
      and ar.status <> 'inactive'
  loop
    select coalesce(r.direct_rate_pct, s.default_direct_pct, 5) into direct_rate
      from public.affiliate_settings s
      left join public.affiliate_referrer_rules r on r.referrer_email = referral.referrer_email
        and r.referrer_portal_type = referral.referrer_portal_type
      where s.id = 1;
    insert into public.affiliate_commissions
      (referrer_email, referrer_portal_type, referred_email, referred_portal_type, tier,
       rate_pct, base_amount_usd, commission_usd, week_start, week_end, second_tree_enabled, notes)
    values
      (referral.referrer_email, referral.referrer_portal_type, referral.referred_email,
       referral.referred_portal_type, 1, coalesce(direct_rate, 5), allocated,
       round(allocated * coalesce(direct_rate, 5) / 100, 2), p_period_start, p_period_end,
       false, 'Direct referral commission')
    on conflict (referrer_email, referred_email, referred_portal_type, tier, week_start, week_end)
    do update set rate_pct = excluded.rate_pct, base_amount_usd = excluded.base_amount_usd,
      commission_usd = excluded.commission_usd, notes = excluded.notes;
    update public.affiliate_referrals set status = 'eligible', onboarded_at = coalesce(onboarded_at, now()), updated_at = now()
      where id = referral.id;
  end loop;
  return earning;
end;
$$;

grant execute on function public.allocate_account_earnings(text, text, text, date, date, numeric, numeric, text) to authenticated;
alter table public.affiliate_referrer_rules drop constraint if exists affiliate_referrer_rules_referrer_portal_type_check;
alter table public.affiliate_referrer_rules add constraint affiliate_referrer_rules_referrer_portal_type_check check (referrer_portal_type in ('worker', 'owner', 'affiliate'));
alter table public.affiliate_referrer_rules add column if not exists direct_rate_pct numeric(5,2) not null default 5;

-- ===== RLS =====
alter table public.affiliate_settings enable row level security;
alter table public.affiliate_earnings enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_withdrawals enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.weekly_task_assignments enable row level security;
alter table public.affiliate_referrer_rules enable row level security;
alter table public.affiliate_referrals enable row level security;

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

drop policy if exists "users can read own referrals" on public.affiliate_referrals;
create policy "users can read own referrals" on public.affiliate_referrals
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(referrer_email) or lower(auth.jwt() ->> 'email') = lower(referred_email) or public.is_starkworth_admin());

drop policy if exists "admins can manage referrals" on public.affiliate_referrals;
create policy "admins can manage referrals" on public.affiliate_referrals
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

-- Requested assignment: connect the existing account owner to the supplied referrer.
-- This block is idempotent and can safely be run again after the migration.
do $$
declare
  v_owner_email text := 'taiye.aiyeki@gmail.com';
  v_owner_id uuid := 'fbff33fb-6aed-4597-a453-70a1a9b2faed';
  v_referrer_email text := 'kingedendgreat2017@gmail.com';
  v_referrer_code text;
  v_referrer_portal text;
begin
  select lower(email) into v_owner_email from auth.users where id = v_owner_id limit 1;
  if v_owner_email is null then v_owner_email := 'taiye.aiyeki@gmail.com'; end if;
  if not exists (select 1 from auth.users where id = v_owner_id or lower(email) = lower(v_owner_email))
    and not exists (select 1 from public.agreements where id = v_owner_id or lower(email) = lower(v_owner_email)) then
    raise exception 'Account owner was not found in Auth or agreements: %', v_owner_email;
  end if;
  select referral_code, 'affiliate' into v_referrer_code, v_referrer_portal from public.affiliate_accounts where lower(email) = lower(v_referrer_email) limit 1;
  if v_referrer_code is null then select referral_code, 'worker' into v_referrer_code, v_referrer_portal from public.workers where lower(email) = lower(v_referrer_email) limit 1; end if;
  if v_referrer_code is null then select referral_code, 'owner' into v_referrer_code, v_referrer_portal from public.agreements where lower(email) = lower(v_referrer_email) limit 1; end if;
  if v_referrer_code is null then raise exception 'Referrer account was not found: %', v_referrer_email; end if;
  update public.agreements set referred_by_code = v_referrer_code
    where id = v_owner_id or lower(email) = lower(v_owner_email);
  insert into public.affiliate_referrals
    (referrer_email, referrer_portal_type, referred_email, referred_portal_type, referral_code, status, onboarded_at, notes)
  values (lower(v_referrer_email), v_referrer_portal, lower(v_owner_email), 'owner', v_referrer_code, 'onboarded', now(), 'Requested referral assignment')
  on conflict (referrer_email, referred_email, referred_portal_type)
  do update set referrer_portal_type = excluded.referrer_portal_type, referral_code = excluded.referral_code,
    status = 'onboarded', onboarded_at = coalesce(affiliate_referrals.onboarded_at, now()), notes = excluded.notes, updated_at = now();

  insert into public.affiliate_referrer_rules
    (referrer_email, referrer_portal_type, direct_rate_pct, second_tree_enabled, second_tree_pct, notes)
  values (lower(v_referrer_email), v_referrer_portal, 10, true, 10, 'Requested 10% direct and 10% second-tree referral rates')
  on conflict (referrer_email, referrer_portal_type)
  do update set direct_rate_pct = 10, second_tree_enabled = true, second_tree_pct = 10,
    notes = excluded.notes, updated_at = now();
end;
$$;
