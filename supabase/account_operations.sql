-- Account-owner <-> annotator assignments, the 90-minute annotator check-in
-- cadence, and admin-run project management for Starkworth.
--
-- Run this once in the Supabase SQL Editor (same as rls_policies.sql and
-- affiliate_system.sql). It is idempotent and safe to re-run.
--
-- WHAT THIS ADDS
--   1. annotator_owner_assignments  - many-to-many link between the account
--      owners (public.agreements) and the annotators (public.workers) who
--      service their Outlier accounts. Admins create and reassign them.
--   2. worker_shifts + worker_checkins - an annotator starts a shift, then
--      owes an update on their assigned client/task every 90 minutes for the
--      6-hour routine (4 slots). The worker_checkin_status view derives a
--      green / yellow / red flag per slot so every dashboard agrees.
--   3. owner_projects + project_tasks + task_feedback - admins manage an
--      account owner's projects and tasks, set status, and read the feedback
--      annotators attach. Account owners get a read-only view of their own.
--
-- All access is enforced by Row Level Security using the existing
-- public.is_starkworth_admin() helper (see supabase/rls_policies.sql).

-- ============================================================================
-- 1. Account-owner <-> annotator assignments
-- ============================================================================
create table if not exists public.annotator_owner_assignments (
  id uuid primary key default gen_random_uuid(),
  annotator_email text not null,
  owner_email text not null,
  assigned_by text not null default 'admin',
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (annotator_email, owner_email)
);

create index if not exists annotator_owner_assignments_annotator_idx
  on public.annotator_owner_assignments (annotator_email, status);
create index if not exists annotator_owner_assignments_owner_idx
  on public.annotator_owner_assignments (owner_email, status);

create or replace function public.set_updated_at_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists annotator_owner_assignments_touch on public.annotator_owner_assignments;
create trigger annotator_owner_assignments_touch
  before update on public.annotator_owner_assignments
  for each row execute function public.set_updated_at_timestamp();

-- ============================================================================
-- 2. Owner projects, project tasks, task feedback
-- ============================================================================
create table if not exists public.owner_projects (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  description text,
  status text not null default 'active'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_projects_owner_idx on public.owner_projects (owner_email, created_at desc);

drop trigger if exists owner_projects_touch on public.owner_projects;
create trigger owner_projects_touch
  before update on public.owner_projects
  for each row execute function public.set_updated_at_timestamp();

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.owner_projects(id) on delete cascade,
  title text not null,
  details text,
  assigned_annotator_email text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'blocked', 'review', 'done')),
  due_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id, created_at desc);
create index if not exists project_tasks_annotator_idx on public.project_tasks (assigned_annotator_email, status);

drop trigger if exists project_tasks_touch on public.project_tasks;
create trigger project_tasks_touch
  before update on public.project_tasks
  for each row execute function public.set_updated_at_timestamp();

create table if not exists public.task_feedback (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  project_id uuid references public.owner_projects(id) on delete cascade,
  author_email text not null,
  author_role text not null default 'annotator' check (author_role in ('annotator', 'owner', 'admin')),
  body text not null,
  proposed_status text check (proposed_status in ('todo', 'in_progress', 'blocked', 'review', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists task_feedback_task_idx on public.task_feedback (task_id, created_at desc);
create index if not exists task_feedback_project_idx on public.task_feedback (project_id, created_at desc);

-- ============================================================================
-- 3. Annotator shifts and 90-minute check-ins
-- ============================================================================
create table if not exists public.worker_shifts (
  id uuid primary key default gen_random_uuid(),
  worker_email text not null,
  shift_date date not null default current_date,
  started_at timestamptz not null default now(),
  interval_minutes integer not null default 90 check (interval_minutes between 15 and 240),
  scheduled_checkins integer not null default 4 check (scheduled_checkins between 1 and 12),
  ended_at timestamptz,
  unique (worker_email, shift_date)
);

create index if not exists worker_shifts_email_idx on public.worker_shifts (worker_email, shift_date desc);

create table if not exists public.worker_checkins (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.worker_shifts(id) on delete cascade,
  worker_email text not null,
  slot_index integer not null check (slot_index >= 1),
  due_at timestamptz not null,
  submitted_at timestamptz,
  owner_email text,
  project_id uuid references public.owner_projects(id) on delete set null,
  task_id uuid references public.project_tasks(id) on delete set null,
  update_text text,
  blockers text,
  created_at timestamptz not null default now(),
  unique (shift_id, slot_index)
);

create index if not exists worker_checkins_email_idx on public.worker_checkins (worker_email, due_at desc);
create index if not exists worker_checkins_owner_idx on public.worker_checkins (owner_email, due_at desc);

-- Green  : submitted 10+ minutes before due
-- Yellow : submitted from <10 min before up to 30 min after due
-- Red    : submitted more than 30 min after due, OR nothing submitted and
--          the 30-minute grace window has passed
-- Due    : not submitted, inside the -10min..+30min window right now
-- Pending: not submitted, more than 10 minutes before due
create or replace view public.worker_checkin_status
with (security_invoker = on) as
select
  c.id,
  c.shift_id,
  c.worker_email,
  c.slot_index,
  c.due_at,
  c.submitted_at,
  c.owner_email,
  c.project_id,
  c.task_id,
  c.update_text,
  c.blockers,
  c.created_at,
  s.shift_date,
  s.started_at as shift_started_at,
  case
    when c.submitted_at is not null and c.submitted_at <= c.due_at - interval '10 minutes' then 'green'
    when c.submitted_at is not null and c.submitted_at <= c.due_at + interval '30 minutes' then 'yellow'
    when c.submitted_at is not null then 'red'
    when now() >= c.due_at + interval '30 minutes' then 'red'
    when now() >= c.due_at - interval '10 minutes' then 'due'
    else 'pending'
  end as flag
from public.worker_checkins c
join public.worker_shifts s on s.id = c.shift_id;

-- ============================================================================
-- RPCs
-- ============================================================================

-- Annotator starts today's shift. Idempotent: returns the existing shift if
-- one was already started today. Also seeds the check-in slots.
create or replace function public.start_worker_shift()
returns public.worker_shifts
language plpgsql security definer set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  shift public.worker_shifts;
  i integer;
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.workers where lower(email) = current_email) then
    raise exception 'Annotator profile not found';
  end if;

  insert into public.worker_shifts (worker_email, shift_date)
  values (current_email, current_date)
  on conflict (worker_email, shift_date) do update set worker_email = excluded.worker_email
  returning * into shift;

  for i in 1..shift.scheduled_checkins loop
    insert into public.worker_checkins (shift_id, worker_email, slot_index, due_at)
    values (shift.id, current_email, i, shift.started_at + (shift.interval_minutes * i) * interval '1 minute')
    on conflict (shift_id, slot_index) do nothing;
  end loop;

  return shift;
end;
$$;
grant execute on function public.start_worker_shift() to authenticated;

-- Annotator submits one check-in for today. Fills the earliest matching slot
-- (by slot_index) that has not been submitted yet when p_slot_index is null.
create or replace function public.submit_worker_checkin(
  p_slot_index integer default null,
  p_owner_email text default null,
  p_project_id uuid default null,
  p_task_id uuid default null,
  p_update_text text default null,
  p_blockers text default null
)
returns public.worker_checkins
language plpgsql security definer set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  target public.worker_checkins;
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if coalesce(btrim(p_update_text), '') = '' then raise exception 'An update is required'; end if;

  select c.* into target
  from public.worker_checkins c
  join public.worker_shifts s on s.id = c.shift_id
  where c.worker_email = current_email
    and s.shift_date = current_date
    and c.submitted_at is null
    and (p_slot_index is null or c.slot_index = p_slot_index)
  order by c.slot_index asc
  limit 1;

  if target.id is null then
    raise exception 'No open check-in slot for today. Start your shift first.';
  end if;

  update public.worker_checkins
  set submitted_at = now(),
      owner_email = nullif(lower(btrim(coalesce(p_owner_email, ''))), ''),
      project_id = p_project_id,
      task_id = p_task_id,
      update_text = btrim(p_update_text),
      blockers = nullif(btrim(coalesce(p_blockers, '')), '')
  where id = target.id
  returning * into target;

  return target;
end;
$$;
grant execute on function public.submit_worker_checkin(integer, text, uuid, uuid, text, text) to authenticated;

-- Admin reassigns an account owner from one annotator to another in one step.
create or replace function public.reassign_owner(
  p_owner_email text,
  p_from_annotator text,
  p_to_annotator text,
  p_notes text default null
)
returns public.annotator_owner_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text := lower(btrim(p_owner_email));
  v_from text := lower(btrim(coalesce(p_from_annotator, '')));
  v_to text := lower(btrim(p_to_annotator));
  linked public.annotator_owner_assignments;
begin
  if not public.is_starkworth_admin() then raise exception 'Admin access required'; end if;
  if v_owner = '' or v_to = '' then raise exception 'Owner and target annotator are required'; end if;
  if v_to = v_from then raise exception 'Target annotator matches the current annotator'; end if;

  if v_from <> '' then
    update public.annotator_owner_assignments
    set status = 'ended', ended_at = now()
    where owner_email = v_owner and annotator_email = v_from and status <> 'ended';
  end if;

  insert into public.annotator_owner_assignments (annotator_email, owner_email, assigned_by, status, notes)
  values (v_to, v_owner, coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), 'admin'), 'active',
          coalesce(p_notes, 'Reassigned by admin'))
  on conflict (annotator_email, owner_email)
  do update set status = 'active', ended_at = null, notes = coalesce(excluded.notes, annotator_owner_assignments.notes),
    updated_at = now()
  returning * into linked;

  return linked;
end;
$$;
grant execute on function public.reassign_owner(text, text, text, text) to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.annotator_owner_assignments enable row level security;
alter table public.owner_projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.task_feedback enable row level security;
alter table public.worker_shifts enable row level security;
alter table public.worker_checkins enable row level security;

-- ---- annotator_owner_assignments ----
drop policy if exists "admins manage assignments" on public.annotator_owner_assignments;
create policy "admins manage assignments" on public.annotator_owner_assignments
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "parties read own assignments" on public.annotator_owner_assignments;
create policy "parties read own assignments" on public.annotator_owner_assignments
  for select to authenticated using (
    lower(auth.jwt() ->> 'email') = lower(annotator_email)
    or lower(auth.jwt() ->> 'email') = lower(owner_email)
    or public.is_starkworth_admin()
  );

-- ---- owner_projects ----
drop policy if exists "admins manage owner projects" on public.owner_projects;
create policy "admins manage owner projects" on public.owner_projects
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "owners read own projects" on public.owner_projects;
create policy "owners read own projects" on public.owner_projects
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(owner_email));

drop policy if exists "assigned annotators read projects" on public.owner_projects;
create policy "assigned annotators read projects" on public.owner_projects
  for select to authenticated using (
    exists (
      select 1 from public.annotator_owner_assignments a
      where a.owner_email = owner_projects.owner_email
        and lower(a.annotator_email) = lower(auth.jwt() ->> 'email')
        and a.status = 'active'
    )
  );

-- ---- project_tasks ----
drop policy if exists "admins manage project tasks" on public.project_tasks;
create policy "admins manage project tasks" on public.project_tasks
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "owners read own project tasks" on public.project_tasks;
create policy "owners read own project tasks" on public.project_tasks
  for select to authenticated using (
    exists (
      select 1 from public.owner_projects p
      where p.id = project_tasks.project_id
        and lower(p.owner_email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "assigned annotators read project tasks" on public.project_tasks;
create policy "assigned annotators read project tasks" on public.project_tasks
  for select to authenticated using (
    lower(coalesce(assigned_annotator_email, '')) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1 from public.owner_projects p
      join public.annotator_owner_assignments a on a.owner_email = p.owner_email
      where p.id = project_tasks.project_id
        and lower(a.annotator_email) = lower(auth.jwt() ->> 'email')
        and a.status = 'active'
    )
  );

-- ---- task_feedback ----
drop policy if exists "admins manage task feedback" on public.task_feedback;
create policy "admins manage task feedback" on public.task_feedback
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "authors add task feedback" on public.task_feedback;
create policy "authors add task feedback" on public.task_feedback
  for insert to authenticated with check (lower(auth.jwt() ->> 'email') = lower(author_email));

drop policy if exists "related parties read task feedback" on public.task_feedback;
create policy "related parties read task feedback" on public.task_feedback
  for select to authenticated using (
    lower(auth.jwt() ->> 'email') = lower(author_email)
    or exists (
      select 1 from public.owner_projects p
      where p.id = task_feedback.project_id
        and lower(p.owner_email) = lower(auth.jwt() ->> 'email')
    )
    or exists (
      select 1 from public.project_tasks t
      where t.id = task_feedback.task_id
        and lower(coalesce(t.assigned_annotator_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---- worker_shifts ----
drop policy if exists "workers manage own shifts" on public.worker_shifts;
create policy "workers manage own shifts" on public.worker_shifts
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin())
  with check (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin());

-- Owners need to read the shift row behind their annotators' check-ins so the
-- worker_checkin_status view (security_invoker) resolves its join for them.
drop policy if exists "owners read shifts feeding their checkins" on public.worker_shifts;
create policy "owners read shifts feeding their checkins" on public.worker_shifts
  for select to authenticated using (
    exists (
      select 1 from public.worker_checkins c
      where c.shift_id = worker_shifts.id
        and lower(coalesce(c.owner_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---- worker_checkins ----
drop policy if exists "workers manage own checkins" on public.worker_checkins;
create policy "workers manage own checkins" on public.worker_checkins
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin())
  with check (lower(auth.jwt() ->> 'email') = lower(worker_email) or public.is_starkworth_admin());

drop policy if exists "owners read checkins for their accounts" on public.worker_checkins;
create policy "owners read checkins for their accounts" on public.worker_checkins
  for select to authenticated using (lower(coalesce(owner_email, '')) = lower(auth.jwt() ->> 'email'));

-- ============================================================================
-- Grants. Supabase applies default privileges to new tables, but views are
-- easy to miss, so grant every object this migration adds explicitly.
-- ============================================================================
grant select, insert, update, delete on
  public.annotator_owner_assignments,
  public.owner_projects,
  public.project_tasks,
  public.task_feedback,
  public.worker_shifts,
  public.worker_checkins
to authenticated;

grant select on public.worker_checkin_status to authenticated;

-- ============================================================================
-- Cleanup: drop this feature's rows when a worker or owner account is removed.
-- Mirrors public.purge_worker_operations() in supabase/worker_operations.sql.
-- ============================================================================
create or replace function public.purge_account_operations_for_worker()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.worker_shifts where lower(worker_email) = lower(old.email);
  update public.annotator_owner_assignments set status = 'ended', ended_at = now()
    where lower(annotator_email) = lower(old.email) and status <> 'ended';
  update public.project_tasks set assigned_annotator_email = null
    where lower(coalesce(assigned_annotator_email, '')) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists workers_purge_account_operations on public.workers;
create trigger workers_purge_account_operations after delete on public.workers
  for each row execute function public.purge_account_operations_for_worker();

create or replace function public.purge_account_operations_for_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.annotator_owner_assignments set status = 'ended', ended_at = now()
    where lower(owner_email) = lower(old.email) and status <> 'ended';
  delete from public.owner_projects where lower(owner_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists agreements_purge_account_operations on public.agreements;
create trigger agreements_purge_account_operations after delete on public.agreements
  for each row execute function public.purge_account_operations_for_owner();
