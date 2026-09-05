create table if not exists public.worker_daily_reports (
  id uuid primary key default gen_random_uuid(),
  worker_email text not null,
  report_date date not null default current_date,
  scheduled_hours numeric(4,2) not null default 6 check (scheduled_hours = 6),
  actual_hours numeric(4,2) not null check (actual_hours >= 0 and actual_hours <= 24),
  tasks_completed integer not null default 0 check (tasks_completed >= 0),
  task_summary text not null,
  blockers text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'escalated')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (worker_email, report_date)
);

create table if not exists public.worker_emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  worker_email text not null,
  severity text not null default 'danger' check (severity in ('danger', 'warning', 'info')),
  alert_type text not null default 'missed_report',
  message text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists worker_daily_reports_email_idx on public.worker_daily_reports(worker_email, report_date desc);
create index if not exists worker_emergency_alerts_email_idx on public.worker_emergency_alerts(worker_email, created_at desc);

create or replace function public.check_worker_daily_routine()
returns public.worker_emergency_alerts language plpgsql security definer set search_path = public
as $$
declare result public.worker_emergency_alerts;
declare current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.workers where lower(email) = current_email) then raise exception 'Worker profile not found'; end if;
  if not exists (select 1 from public.worker_daily_reports where lower(worker_email) = current_email and report_date = current_date and actual_hours >= 6) then
    insert into public.worker_emergency_alerts(worker_email, alert_type, message)
    select current_email, 'six_hour_routine', 'Daily six-hour routine has not been completed or reported for today.'
    where not exists (select 1 from public.worker_emergency_alerts where lower(worker_email) = current_email and alert_type = 'six_hour_routine' and created_at::date = current_date and status <> 'resolved')
    returning * into result;
  end if;
  return result;
end;
$$;
grant execute on function public.check_worker_daily_routine() to authenticated;

create or replace function public.sync_worker_routine_alert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.actual_hours < 6 then
    if not exists (select 1 from public.worker_emergency_alerts where lower(worker_email) = lower(new.worker_email) and alert_type = 'under_six_hours' and created_at::date = new.report_date and status <> 'resolved') then
      insert into public.worker_emergency_alerts(worker_email, alert_type, message)
      values (lower(new.worker_email), 'under_six_hours', 'The daily report records fewer than six completed hours.');
    end if;
  else
    update public.worker_emergency_alerts set status = 'resolved', resolved_at = now()
    where lower(worker_email) = lower(new.worker_email) and alert_type in ('six_hour_routine', 'under_six_hours') and created_at::date = new.report_date and status <> 'resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists worker_daily_report_alert on public.worker_daily_reports;
create trigger worker_daily_report_alert after insert or update on public.worker_daily_reports
for each row execute function public.sync_worker_routine_alert();

alter table public.worker_daily_reports enable row level security;
alter table public.worker_emergency_alerts enable row level security;

drop policy if exists "workers manage own daily reports" on public.worker_daily_reports;
create policy "workers manage own daily reports" on public.worker_daily_reports for all to authenticated
using (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin())
with check (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin());

drop policy if exists "workers read own emergency alerts" on public.worker_emergency_alerts;
create policy "workers read own emergency alerts" on public.worker_emergency_alerts for select to authenticated
using (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin());
drop policy if exists "admins manage emergency alerts" on public.worker_emergency_alerts;
create policy "admins manage emergency alerts" on public.worker_emergency_alerts for all to authenticated
using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

create or replace function public.purge_worker_operations()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.affiliate_referrals
  set status = 'inactive', notes = coalesce(notes || ' ', '') || 'Referred account is no longer with Starkworth.', updated_at = now()
  where lower(referred_email) = lower(old.email);
  delete from public.worker_daily_reports where lower(worker_email) = lower(old.email);
  delete from public.worker_emergency_alerts where lower(worker_email) = lower(old.email);
  delete from public.weekly_task_assignments where lower(email) = lower(old.email) and portal_type = 'worker';
  delete from public.affiliate_commissions where lower(referred_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists workers_purge_operations on public.workers;
create trigger workers_purge_operations after delete on public.workers
for each row execute function public.purge_worker_operations();

create or replace function public.mark_deleted_owner_referrals()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.affiliate_referrals
  set status = 'inactive', notes = coalesce(notes || ' ', '') || 'Referred account is no longer with Starkworth.', updated_at = now()
  where lower(referred_email) = lower(old.email);
  delete from public.weekly_task_assignments where lower(email) = lower(old.email) and portal_type = 'owner';
  return old;
end;
$$;

drop trigger if exists agreements_mark_referrals_inactive on public.agreements;
create trigger agreements_mark_referrals_inactive after delete on public.agreements
for each row execute function public.mark_deleted_owner_referrals();

create or replace function public.purge_deleted_auth_account()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.workers where lower(email) = lower(old.email);
  delete from public.agreements where lower(email) = lower(old.email);
  update public.affiliate_referrals
  set status = 'inactive', notes = coalesce(notes || ' ', '') || 'Referred account is no longer with Starkworth.', updated_at = now()
  where lower(referred_email) = lower(old.email);
  delete from public.affiliate_accounts where lower(email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists auth_user_purge_starkworth_records on auth.users;
create trigger auth_user_purge_starkworth_records after delete on auth.users
for each row execute function public.purge_deleted_auth_account();

create or replace function public.mark_deleted_affiliate_referrals()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.affiliate_referrals
  set status = 'inactive', notes = coalesce(notes || ' ', '') || 'Referrer account is no longer with Starkworth.', updated_at = now()
  where lower(referrer_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists affiliate_accounts_mark_referrals_inactive on public.affiliate_accounts;
create trigger affiliate_accounts_mark_referrals_inactive after delete on public.affiliate_accounts
for each row execute function public.mark_deleted_affiliate_referrals();
