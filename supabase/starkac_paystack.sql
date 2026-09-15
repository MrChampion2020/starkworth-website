-- Paystack payments for StarkAC (replaces the Monnify integration).
--
-- Run this in the Supabase SQL Editor AFTER supabase/starkac.sql. Idempotent.
--
-- CURRENCY: chosen automatically from the trainee's country at checkout time
-- (Nigeria -> NGN, everything else -> USD) by the starkac-paystack-payment
-- edge function - there is no visible currency picker, and no Naira amount is
-- ever stored, computed ahead of time, or shown anywhere in the site's own
-- UI. For a Nigerian trainee, the edge function looks up a live USD->NGN rate
-- and converts price_usd to NGN at the moment checkout is opened - the only
-- place that number exists is the Paystack checkout screen itself, which is
-- Paystack's page, not ours.
--
-- SETUP YOU STILL NEED TO DO (cannot be done from this migration):
--   1. Create/own a Paystack account and set these Edge Function secrets
--      (Supabase Dashboard -> Edge Functions -> Manage secrets, or
--      `supabase secrets set NAME=value` - never paste real keys into chat
--      or commit them to this repo):
--        PAYSTACK_SECRET_KEY   - starts with sk_live_ or sk_test_
--      SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
--      already available to every edge function automatically.
--   2. In the Paystack Dashboard -> Settings -> API Keys & Webhooks, set the
--      webhook URL to:
--        https://<your-project-ref>.functions.supabase.co/starkac-paystack-webhook
--   3. If you want USD charges (non-Nigerian trainees), enable multi-currency
--      / USD settlement on your Paystack account - it is off by default for
--      new Nigerian merchants.

-- ============================================================================
-- 1. Per-plan pricing - USD only. There is deliberately no Naira column: the
-- NGN charge amount is computed inside the edge function at checkout time,
-- never stored or displayed.
-- ============================================================================
create table if not exists public.starkac_plan_pricing (
  plan text primary key check (plan in ('beginner_20', 'intermediate_35', 'senior_50')),
  price_usd numeric(10,2) not null check (price_usd > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Migrating from an earlier version of this file that stored a Naira price.
alter table public.starkac_plan_pricing drop column if exists price_ngn;

insert into public.starkac_plan_pricing (plan, price_usd) values
  ('beginner_20', 20),
  ('intermediate_35', 35),
  ('senior_50', 50)
on conflict (plan) do nothing;

drop trigger if exists starkac_plan_pricing_touch on public.starkac_plan_pricing;
create trigger starkac_plan_pricing_touch
  before update on public.starkac_plan_pricing
  for each row execute function public.starkac_set_updated_at();

-- ============================================================================
-- 2. Extend starkac_payments with currency/provider detail, retire Monnify.
-- amount_charged is what Paystack actually charged, in `currency`; amount_usd
-- stays the nominal USD plan price for consistent USD-denominated reporting.
-- ============================================================================
alter table public.starkac_payments
  add column if not exists currency text not null default 'USD' check (currency in ('USD', 'NGN')),
  add column if not exists amount_charged numeric(12,2),
  add column if not exists channel text,
  add column if not exists paystack_authorization_url text;

alter table public.starkac_payments alter column provider set default 'paystack';

update public.starkac_payments set amount_charged = amount_usd, currency = 'USD'
where amount_charged is null;

-- ============================================================================
-- Row Level Security (plan pricing: everyone signed in can read; only admins edit)
-- ============================================================================
alter table public.starkac_plan_pricing enable row level security;

drop policy if exists "signed in users read plan pricing" on public.starkac_plan_pricing;
create policy "signed in users read plan pricing" on public.starkac_plan_pricing
  for select to authenticated using (true);

drop policy if exists "admins write plan pricing" on public.starkac_plan_pricing;
create policy "admins write plan pricing" on public.starkac_plan_pricing
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

grant select, update on public.starkac_plan_pricing to authenticated;
