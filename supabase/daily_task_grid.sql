-- Daily Task Grid: replaces the 90-minute check-in / progress-report system.
--
-- Run this in the Supabase SQL Editor AFTER account_operations.sql,
-- worker_operations.sql and staff_roles.sql. Idempotent.
--
-- MODEL
--   At resumption (the start of their working day) each annotator spends about
--   30 minutes filling in one row of a spreadsheet-style grid: one cell per
--   hour of the working day, each cell holding the task planned for that hour.
--   Through the day they update a cell's status as they work it (pending ->
--   in progress -> done), which recolors the cell (pink/red = not done yet,
--   green = done). Admins, and any staff role with the 'reports' permission,
--   see every annotator's row for a chosen date in the same grid shape.
--
-- WHAT THIS ADDS
--   1. daily_task_grid_settings - one global row holding the grid's prefilled
--      hour columns (start_hour..end_hour), editable from the admin Reports tab.
--   2. worker_daily_tasks - one row per (worker, date, hour) cell.
--   3. Repoints check_worker_daily_routine() (see worker_operations.sql) at
--      this table instead of the retired worker_checkins-based routine.

-- ============================================================================
-- 1. Grid hours (prefilled time columns), a single admin-editable row
-- ============================================================================
create table if not exists public.daily_task_grid_settings (
  id integer primary key default 1 check (id = 1),
  start_hour integer not null default 9 check (start_hour between 0 and 23),
  end_hour integer not null default 19 check (end_hour between 0 and 23),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint daily_task_grid_settings_range check (end_hour >= start_hour)
);
insert into public.daily_task_grid_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.set_updated_at_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_task_grid_settings_touch on public.daily_task_grid_settings;
create trigger daily_task_grid_settings_touch
  before update on public.daily_task_grid_settings
  for each row execute function public.set_updated_at_timestamp();

-- ============================================================================
-- 2. One row per (worker, date, hour) cell
-- ============================================================================
create table if not exists public.worker_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  worker_email text not null,
  task_date date not null default current_date,
  slot_hour integer not null check (slot_hour between 0 and 23),
  owner_email text,
  project_id uuid references public.owner_projects(id) on delete set null,
  task_id uuid references public.project_tasks(id) on delete set null,
  task_text text not null default '',
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'blocked')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_email, task_date, slot_hour)
);

create index if not exists worker_daily_tasks_email_idx on public.worker_daily_tasks (worker_email, task_date desc);
create index if not exists worker_daily_tasks_date_idx on public.worker_daily_tasks (task_date desc);
create index if not exists worker_daily_tasks_owner_idx on public.worker_daily_tasks (owner_email, task_date desc);

drop trigger if exists worker_daily_tasks_touch on public.worker_daily_tasks;
create trigger worker_daily_tasks_touch
  before update on public.worker_daily_tasks
  for each row execute function public.set_updated_at_timestamp();

-- Keep completed_at in sync with status.
create or replace function public.sync_daily_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists worker_daily_tasks_completed on public.worker_daily_tasks;
create trigger worker_daily_tasks_completed
  before insert or update on public.worker_daily_tasks
  for each row execute function public.sync_daily_task_completed_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.daily_task_grid_settings enable row level security;
alter table public.worker_daily_tasks enable row level security;

drop policy if exists "staff read grid settings" on public.daily_task_grid_settings;
create policy "staff read grid settings" on public.daily_task_grid_settings
  for select to authenticated using (true);

drop policy if exists "admins write grid settings" on public.daily_task_grid_settings;
create policy "admins write grid settings" on public.daily_task_grid_settings
  for update to authenticated
  using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "workers manage own daily tasks" on public.worker_daily_tasks;
create policy "workers manage own daily tasks" on public.worker_daily_tasks for all to authenticated
using (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin())
with check (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin());

drop policy if exists "owners read daily tasks for their account" on public.worker_daily_tasks;
create policy "owners read daily tasks for their account" on public.worker_daily_tasks
  for select to authenticated using (lower(coalesce(owner_email, '')) = lower(auth.jwt() ->> 'email'));

grant select on public.daily_task_grid_settings to authenticated;
grant update on public.daily_task_grid_settings to authenticated;
grant select, insert, update, delete on public.worker_daily_tasks to authenticated;

-- ============================================================================
-- 3. Repoint the daily-routine alert at the grid instead of check-ins.
-- Fires "missing_daily_plan" once a worker is 2+ hours into the grid's start
-- hour today with no cells filled in yet, and clears it once they file one.
-- ============================================================================
create or replace function public.check_worker_daily_routine()
returns public.worker_emergency_alerts language plpgsql security definer set search_path = public
as $$
declare
  result public.worker_emergency_alerts;
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_start_hour integer;
  v_filled integer;
  v_cutoff timestamptz;
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.workers where lower(email) = current_email) then raise exception 'Worker profile not found'; end if;

  select count(*) into v_filled
  from public.worker_daily_tasks
  where lower(worker_email) = current_email and task_date = current_date;

  if v_filled > 0 then
    update public.worker_emergency_alerts set status = 'resolved', resolved_at = now()
    where lower(worker_email) = current_email
      and alert_type in ('missing_daily_plan', 'missed_checkins', 'missing_daily_report', 'six_hour_routine', 'under_six_hours')
      and created_at::date = current_date and status <> 'resolved';
    return result;
  end if;

  select start_hour into v_start_hour from public.daily_task_grid_settings where id = 1;
  v_cutoff := date_trunc('day', now()) + (coalesce(v_start_hour, 9) + 2) * interval '1 hour';

  if now() >= v_cutoff and not exists (
    select 1 from public.worker_emergency_alerts
    where lower(worker_email) = current_email and alert_type = 'missing_daily_plan'
      and created_at::date = current_date and status <> 'resolved'
  ) then
    insert into public.worker_emergency_alerts(worker_email, severity, alert_type, message)
    values (current_email, 'warning', 'missing_daily_plan',
            'Today''s task grid has not been filled in yet.')
    returning * into result;
  end if;

  return result;
end;
$$;
grant execute on function public.check_worker_daily_routine() to authenticated;

-- ============================================================================
-- 4. Full access parity: COO, Secretary and Admin all get every dashboard
-- permission key (matching what super_admin/ceo/coo already had), including
-- manage_staff. Run after supabase/staff_roles.sql.
-- ============================================================================
do $$
declare
  all_keys text[] := array[
    'overview','agreements','workers','assignments','projects','reports',
    'payments','affiliate','contacts','livechat','staff','manage_staff'
  ];
  k text;
  r text;
begin
  foreach r in array array['coo', 'secretary', 'admin'] loop
    foreach k in array all_keys loop
      insert into public.staff_role_permissions (role, permission_key) values (r, k) on conflict do nothing;
    end loop;
  end loop;
end;
$$;
