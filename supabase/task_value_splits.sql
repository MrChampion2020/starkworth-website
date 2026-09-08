-- Annotator-declared weekly task values, admin-built payout splits, and
-- partial-payment tracking for Starkworth.
--
-- Run this once in the Supabase SQL Editor, AFTER supabase/affiliate_system.sql
-- and supabase/account_operations.sql. It is idempotent and safe to re-run.
--
-- FLOW
--   1. An annotator declares the USD value of a week's task for an account
--      owner they are actively assigned to (declare_weekly_task_value).
--      The row lands as 'submitted' with no split yet.
--   2. An admin reviews it and builds the payout split - one task_value_splits
--      row per beneficiary (annotator, owner, referrer(s), admin-maintained
--      account_participants, off-platform people, and an admin_pool remainder).
--      approve_weekly_task_value() writes the split and flips status to
--      'approved'. Percentages may not total more than 100.
--   3. Admin records payments against each split line (record_split_payment);
--      partial payments are supported. A trigger keeps paid_amount_usd and
--      payment_status current, and flips the whole value to 'paid' once every
--      line is settled.
--   4. task_value_reconciliation and the pending-by-account queries surface
--      every line that is not fully paid.
--
-- Access is enforced by Row Level Security via public.is_starkworth_admin().

-- ============================================================================
-- Percentage defaults live on the existing affiliate_settings singleton.
-- ============================================================================
alter table if exists public.affiliate_settings
  add column if not exists worker_pct numeric(5,2) not null default 30,
  add column if not exists owner_pct numeric(5,2) not null default 25;

-- ============================================================================
-- 1. Admin-maintained extra beneficiaries per account owner
-- ============================================================================
create table if not exists public.account_participants (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  beneficiary_label text not null,
  beneficiary_email text,
  role text not null default 'other'
    check (role in ('worker', 'owner', 'referrer', 'second_tier', 'qa', 'team_lead', 'other')),
  default_pct numeric(5,2) not null default 0 check (default_pct >= 0 and default_pct <= 100),
  payout_destination text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_participants_owner_idx on public.account_participants (owner_email, active);

-- set_updated_at_timestamp() is defined in supabase/account_operations.sql.
drop trigger if exists account_participants_touch on public.account_participants;
create trigger account_participants_touch
  before update on public.account_participants
  for each row execute function public.set_updated_at_timestamp();

-- ============================================================================
-- 2. The annotator's weekly declaration
-- ============================================================================
create table if not exists public.weekly_task_values (
  id uuid primary key default gen_random_uuid(),
  annotator_email text not null,
  owner_email text not null,
  week_start date not null,
  week_end date not null,
  task_value_usd numeric(12,2) not null check (task_value_usd > 0),
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'paid', 'cancelled')),
  declared_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (annotator_email, owner_email, week_start)
);

create index if not exists weekly_task_values_annotator_idx on public.weekly_task_values (annotator_email, week_start desc);
create index if not exists weekly_task_values_owner_idx on public.weekly_task_values (owner_email, week_start desc);
create index if not exists weekly_task_values_status_idx on public.weekly_task_values (status);

drop trigger if exists weekly_task_values_touch on public.weekly_task_values;
create trigger weekly_task_values_touch
  before update on public.weekly_task_values
  for each row execute function public.set_updated_at_timestamp();

-- ============================================================================
-- 3. The payout split - one row per beneficiary, created on approval
-- ============================================================================
create table if not exists public.task_value_splits (
  id uuid primary key default gen_random_uuid(),
  task_value_id uuid not null references public.weekly_task_values(id) on delete cascade,
  owner_email text not null,
  beneficiary_label text not null,
  beneficiary_email text,
  role text not null default 'other',
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  amount_usd numeric(12,2) not null default 0,
  payout_destination text,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'partial', 'paid')),
  paid_amount_usd numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_value_splits_value_idx on public.task_value_splits (task_value_id);
create index if not exists task_value_splits_owner_idx on public.task_value_splits (owner_email, payment_status);
create index if not exists task_value_splits_beneficiary_idx on public.task_value_splits (beneficiary_email);

drop trigger if exists task_value_splits_touch on public.task_value_splits;
create trigger task_value_splits_touch
  before update on public.task_value_splits
  for each row execute function public.set_updated_at_timestamp();

-- ============================================================================
-- 4. Individual payments against a split line
-- ============================================================================
create table if not exists public.task_value_payments (
  id uuid primary key default gen_random_uuid(),
  split_id uuid not null references public.task_value_splits(id) on delete cascade,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  paid_at date not null default current_date,
  method text,
  reference text,
  recorded_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists task_value_payments_split_idx on public.task_value_payments (split_id, paid_at desc);

-- ============================================================================
-- Trigger: keep the split's paid total / status and the value's status current
-- ============================================================================
create or replace function public.recompute_split_payment_state()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_split_id uuid := coalesce(new.split_id, old.split_id);
  v_paid numeric(12,2);
  v_amount numeric(12,2);
  v_value_id uuid;
  v_open integer;
begin
  select coalesce(sum(amount_usd), 0) into v_paid from public.task_value_payments where split_id = v_split_id;
  select amount_usd, task_value_id into v_amount, v_value_id from public.task_value_splits where id = v_split_id;

  update public.task_value_splits
  set paid_amount_usd = v_paid,
      payment_status = case
        when v_paid >= v_amount and v_amount > 0 then 'paid'
        when v_paid > 0 then 'partial'
        else 'pending'
      end
  where id = v_split_id;

  select count(*) into v_open from public.task_value_splits
  where task_value_id = v_value_id and payment_status <> 'paid';

  if v_open = 0 then
    update public.weekly_task_values set status = 'paid'
    where id = v_value_id and status = 'approved';
  else
    update public.weekly_task_values set status = 'approved'
    where id = v_value_id and status = 'paid';
  end if;

  return null;
end;
$$;

drop trigger if exists task_value_payments_recompute on public.task_value_payments;
create trigger task_value_payments_recompute
  after insert or update or delete on public.task_value_payments
  for each row execute function public.recompute_split_payment_state();

-- ============================================================================
-- Reconciliation view
-- ============================================================================
create or replace view public.task_value_reconciliation
with (security_invoker = on) as
select
  v.id as task_value_id,
  v.annotator_email,
  v.owner_email,
  v.week_start,
  v.week_end,
  v.task_value_usd,
  v.status,
  coalesce(sum(s.pct), 0) as total_pct,
  coalesce(sum(s.amount_usd), 0) as allocated_usd,
  100 - coalesce(sum(s.pct), 0) as unallocated_pct,
  v.task_value_usd - coalesce(sum(s.amount_usd), 0) as unallocated_usd,
  coalesce(sum(s.paid_amount_usd), 0) as paid_usd,
  coalesce(sum(s.amount_usd), 0) - coalesce(sum(s.paid_amount_usd), 0) as pending_usd,
  count(s.id) filter (where s.payment_status <> 'paid') as pending_lines,
  coalesce(sum(s.pct), 0) > 100 as overallocated
from public.weekly_task_values v
left join public.task_value_splits s on s.task_value_id = v.id
group by v.id;

-- ============================================================================
-- RPCs
-- ============================================================================

-- Annotator declares (or re-declares, while still 'submitted') a week's value.
create or replace function public.declare_weekly_task_value(
  p_owner_email text,
  p_week_start date,
  p_week_end date,
  p_task_value_usd numeric,
  p_notes text default null
)
returns public.weekly_task_values
language plpgsql security definer set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_owner text := lower(btrim(p_owner_email));
  result public.weekly_task_values;
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if coalesce(p_task_value_usd, 0) <= 0 then raise exception 'Task value must be greater than zero'; end if;
  if p_week_end < p_week_start then raise exception 'Week end must be on or after week start'; end if;
  if not exists (
    select 1 from public.annotator_owner_assignments
    where lower(annotator_email) = current_email and lower(owner_email) = v_owner and status = 'active'
  ) then
    raise exception 'You are not actively assigned to this account owner';
  end if;

  insert into public.weekly_task_values (annotator_email, owner_email, week_start, week_end, task_value_usd, declared_notes)
  values (current_email, v_owner, p_week_start, p_week_end, round(p_task_value_usd, 2), nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (annotator_email, owner_email, week_start) do update
    set week_end = excluded.week_end,
        task_value_usd = excluded.task_value_usd,
        declared_notes = excluded.declared_notes,
        updated_at = now()
    where public.weekly_task_values.status = 'submitted'
  returning * into result;

  if result.id is null then
    raise exception 'This week has already been reviewed and can no longer be edited';
  end if;

  return result;
end;
$$;
grant execute on function public.declare_weekly_task_value(text, date, date, numeric, text) to authenticated;

-- Admin builds the split and approves. p_splits is a JSON array of
-- { beneficiary_label, beneficiary_email, role, pct, payout_destination, notes }.
create or replace function public.approve_weekly_task_value(
  p_id uuid,
  p_splits jsonb,
  p_review_notes text default null
)
returns setof public.task_value_splits
language plpgsql security definer set search_path = public
as $$
declare
  v_value public.weekly_task_values;
  v_total_pct numeric := 0;
  line jsonb;
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  select * into v_value from public.weekly_task_values where id = p_id;
  if v_value.id is null then raise exception 'Declaration not found'; end if;
  if v_value.status not in ('submitted', 'approved') then
    raise exception 'Declaration is % and cannot be (re)approved', v_value.status;
  end if;
  if exists (
    select 1 from public.task_value_splits s
    join public.task_value_payments p on p.split_id = s.id
    where s.task_value_id = p_id
  ) then
    raise exception 'Payments already recorded; edit is locked';
  end if;
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'At least one split line is required';
  end if;

  for line in select * from jsonb_array_elements(p_splits) loop
    v_total_pct := v_total_pct + coalesce((line ->> 'pct')::numeric, 0);
  end loop;
  if v_total_pct > 100.0001 then
    raise exception 'Split percentages total % (over 100)', round(v_total_pct, 2);
  end if;

  delete from public.task_value_splits where task_value_id = p_id;

  insert into public.task_value_splits
    (task_value_id, owner_email, beneficiary_label, beneficiary_email, role, pct, amount_usd, payout_destination, notes)
  select
    p_id,
    v_value.owner_email,
    coalesce(nullif(btrim(line ->> 'beneficiary_label'), ''), 'Unnamed'),
    nullif(lower(btrim(line ->> 'beneficiary_email')), ''),
    coalesce(nullif(btrim(line ->> 'role'), ''), 'other'),
    coalesce((line ->> 'pct')::numeric, 0),
    round(v_value.task_value_usd * coalesce((line ->> 'pct')::numeric, 0) / 100, 2),
    nullif(btrim(line ->> 'payout_destination'), ''),
    nullif(btrim(line ->> 'notes'), '')
  from jsonb_array_elements(p_splits) as line;

  update public.weekly_task_values
  set status = 'approved', reviewed_by = lower(auth.jwt() ->> 'email'),
      reviewed_at = now(), review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''), updated_at = now()
  where id = p_id;

  return query select * from public.task_value_splits where task_value_id = p_id order by created_at;
end;
$$;
grant execute on function public.approve_weekly_task_value(uuid, jsonb, text) to authenticated;

create or replace function public.reject_weekly_task_value(p_id uuid, p_notes text default null)
returns public.weekly_task_values
language plpgsql security definer set search_path = public
as $$
declare result public.weekly_task_values;
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  update public.weekly_task_values
  set status = 'rejected', reviewed_by = lower(auth.jwt() ->> 'email'), reviewed_at = now(),
      review_notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
  where id = p_id and status in ('submitted', 'approved')
  returning * into result;
  if result.id is null then raise exception 'Declaration not found or not rejectable'; end if;
  return result;
end;
$$;
grant execute on function public.reject_weekly_task_value(uuid, text) to authenticated;

-- Admin records one payment against a split line (partial payments allowed).
create or replace function public.record_split_payment(
  p_split_id uuid,
  p_amount_usd numeric,
  p_paid_at date default null,
  p_method text default null,
  p_reference text default null,
  p_notes text default null
)
returns public.task_value_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_split public.task_value_splits;
  v_paid numeric(12,2);
  result public.task_value_payments;
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  if coalesce(p_amount_usd, 0) <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  select * into v_split from public.task_value_splits where id = p_split_id;
  if v_split.id is null then raise exception 'Split line not found'; end if;

  select coalesce(sum(amount_usd), 0) into v_paid from public.task_value_payments where split_id = p_split_id;
  if v_paid + round(p_amount_usd, 2) > v_split.amount_usd + 0.0001 then
    raise exception 'Payment would exceed the % owed on this line (already paid %)', v_split.amount_usd, v_paid;
  end if;

  insert into public.task_value_payments (split_id, amount_usd, paid_at, method, reference, recorded_by, notes)
  values (p_split_id, round(p_amount_usd, 2), coalesce(p_paid_at, current_date),
          nullif(btrim(coalesce(p_method, '')), ''), nullif(btrim(coalesce(p_reference, '')), ''),
          lower(auth.jwt() ->> 'email'), nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into result;
  return result;
end;
$$;
grant execute on function public.record_split_payment(uuid, numeric, date, text, text, text) to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.account_participants enable row level security;
alter table public.weekly_task_values enable row level security;
alter table public.task_value_splits enable row level security;
alter table public.task_value_payments enable row level security;

-- ---- account_participants ----
drop policy if exists "admins manage account participants" on public.account_participants;
create policy "admins manage account participants" on public.account_participants
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "owners read own participants" on public.account_participants;
create policy "owners read own participants" on public.account_participants
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(owner_email));

drop policy if exists "assigned annotators read participants" on public.account_participants;
create policy "assigned annotators read participants" on public.account_participants
  for select to authenticated using (
    exists (
      select 1 from public.annotator_owner_assignments a
      where a.owner_email = account_participants.owner_email
        and lower(a.annotator_email) = lower(auth.jwt() ->> 'email')
        and a.status = 'active'
    )
  );

-- ---- weekly_task_values ----
drop policy if exists "admins manage task values" on public.weekly_task_values;
create policy "admins manage task values" on public.weekly_task_values
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "annotators read own task values" on public.weekly_task_values;
create policy "annotators read own task values" on public.weekly_task_values
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(annotator_email));

drop policy if exists "annotators declare own task values" on public.weekly_task_values;
create policy "annotators declare own task values" on public.weekly_task_values
  for insert to authenticated with check (lower(auth.jwt() ->> 'email') = lower(annotator_email) and status = 'submitted');

drop policy if exists "annotators edit own submitted task values" on public.weekly_task_values;
create policy "annotators edit own submitted task values" on public.weekly_task_values
  for update to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(annotator_email) and status = 'submitted')
  with check (lower(auth.jwt() ->> 'email') = lower(annotator_email) and status = 'submitted');

drop policy if exists "owners read task values for their account" on public.weekly_task_values;
create policy "owners read task values for their account" on public.weekly_task_values
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(owner_email));

-- ---- task_value_splits ----
drop policy if exists "admins manage task value splits" on public.task_value_splits;
create policy "admins manage task value splits" on public.task_value_splits
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "related parties read task value splits" on public.task_value_splits;
create policy "related parties read task value splits" on public.task_value_splits
  for select to authenticated using (
    lower(coalesce(beneficiary_email, '')) = lower(auth.jwt() ->> 'email')
    or lower(owner_email) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1 from public.weekly_task_values v
      where v.id = task_value_splits.task_value_id
        and lower(v.annotator_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---- task_value_payments ----
drop policy if exists "admins manage task value payments" on public.task_value_payments;
create policy "admins manage task value payments" on public.task_value_payments
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "beneficiaries read own payments" on public.task_value_payments;
create policy "beneficiaries read own payments" on public.task_value_payments
  for select to authenticated using (
    exists (
      select 1 from public.task_value_splits s
      where s.id = task_value_payments.split_id
        and (
          lower(coalesce(s.beneficiary_email, '')) = lower(auth.jwt() ->> 'email')
          or lower(s.owner_email) = lower(auth.jwt() ->> 'email')
        )
    )
  );

-- ============================================================================
-- Grants (views are easy to miss under default privileges)
-- ============================================================================
grant select, insert, update, delete on
  public.account_participants,
  public.weekly_task_values,
  public.task_value_splits,
  public.task_value_payments
to authenticated;

grant select on public.task_value_reconciliation to authenticated;

-- ============================================================================
-- Cleanup: remove this feature's rows when a worker or owner is deleted.
-- ============================================================================
create or replace function public.purge_task_values_for_worker()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.weekly_task_values where lower(annotator_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists workers_purge_task_values on public.workers;
create trigger workers_purge_task_values after delete on public.workers
  for each row execute function public.purge_task_values_for_worker();

create or replace function public.purge_task_values_for_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.weekly_task_values where lower(owner_email) = lower(old.email);
  delete from public.account_participants where lower(owner_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists agreements_purge_task_values on public.agreements;
create trigger agreements_purge_task_values after delete on public.agreements
  for each row execute function public.purge_task_values_for_owner();
