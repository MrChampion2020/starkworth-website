-- StarkAC learning-management layer: community links, per-plan classes
-- (live class link + weekly video links), assignments, and admin-only
-- trainer accounts.
--
-- Run this in the Supabase SQL Editor AFTER supabase/starkac.sql. Idempotent.
--
-- ROLES
--   Trainee   - existing public.starkac_trainees. Reads their plan's class
--               info, videos and community links; submits assignments; reads
--               their own assessment results (public.starkac_trainee_activity,
--               already defined in starkac.sql).
--   Trainer   - public.starkac_trainers, a row an admin creates. A trainer
--               manages exactly the plan(s) where public.starkac_classes
--               names them as trainer_email: posting the live class link,
--               weekly videos, assignments, grading submissions, and adding
--               assessment activity for trainees on that plan. Trainers
--               cannot create themselves or other trainers - see
--               supabase/functions/starkac-create-trainer.
--   Admin     - public.is_starkworth_admin(), unchanged. Full access to all
--               of the above, plus the only role that can create a trainer.

-- ============================================================================
-- 1. Trainers - admin-provisioned only
-- ============================================================================
create table if not exists public.starkac_trainers (
  email text primary key,
  full_name text not null,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists starkac_trainers_touch on public.starkac_trainers;
create trigger starkac_trainers_touch
  before update on public.starkac_trainers
  for each row execute function public.starkac_set_updated_at();

create or replace function public.is_starkac_trainer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.starkac_trainers
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  );
$$;
grant execute on function public.is_starkac_trainer() to authenticated;

-- ============================================================================
-- 2. One "class" per plan: the live-class link/schedule and its trainer.
-- Created here, before starkac_trainer_plans() below, because a LANGUAGE SQL
-- function's body is validated against the catalog at CREATE FUNCTION time -
-- unlike plpgsql, it can't forward-reference a table defined later in this
-- same file.
-- ============================================================================
create table if not exists public.starkac_classes (
  plan text primary key check (plan in ('beginner_20', 'intermediate_35', 'senior_50')),
  trainer_email text references public.starkac_trainers(email) on delete set null,
  live_class_link text,
  live_class_schedule text,
  updated_at timestamptz not null default now()
);

insert into public.starkac_classes (plan) values ('beginner_20'), ('intermediate_35'), ('senior_50')
on conflict (plan) do nothing;

drop trigger if exists starkac_classes_touch on public.starkac_classes;
create trigger starkac_classes_touch
  before update on public.starkac_classes
  for each row execute function public.starkac_set_updated_at();

-- The plan(s) the signed-in trainer is assigned to teach, '{}' for anyone else.
create or replace function public.starkac_trainer_plans()
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(plan), '{}'::text[])
  from public.starkac_classes
  where lower(trainer_email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
grant execute on function public.starkac_trainer_plans() to authenticated;

-- ============================================================================
-- 3. Weekly video links per plan
-- ============================================================================
create table if not exists public.starkac_weekly_videos (
  id uuid primary key default gen_random_uuid(),
  plan text not null references public.starkac_classes(plan) on delete cascade,
  week_number integer not null check (week_number > 0),
  title text not null,
  video_url text not null,
  notes text,
  posted_by text,
  created_at timestamptz not null default now(),
  unique (plan, week_number)
);

create index if not exists starkac_weekly_videos_plan_idx on public.starkac_weekly_videos (plan, week_number);

-- ============================================================================
-- 4. Assignments per plan, and each trainee's submission
-- ============================================================================
create table if not exists public.starkac_assignments (
  id uuid primary key default gen_random_uuid(),
  plan text not null references public.starkac_classes(plan) on delete cascade,
  title text not null,
  instructions text,
  due_date date,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists starkac_assignments_plan_idx on public.starkac_assignments (plan, due_date);

create table if not exists public.starkac_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.starkac_assignments(id) on delete cascade,
  trainee_email text not null references public.starkac_trainees(email) on delete cascade,
  submission_text text,
  submission_url text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'needs_revision')),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  feedback text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  unique (assignment_id, trainee_email)
);

create index if not exists starkac_submissions_trainee_idx on public.starkac_assignment_submissions (trainee_email, submitted_at desc);
create index if not exists starkac_submissions_assignment_idx on public.starkac_assignment_submissions (assignment_id);

-- ============================================================================
-- 5. StarkAC community links (WhatsApp/Telegram/Discord/etc.) - admin-set,
-- same list shown to every trainee.
-- ============================================================================
create table if not exists public.starkac_community_links (
  id text primary key,
  label text not null,
  url text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists starkac_community_links_touch on public.starkac_community_links;
create trigger starkac_community_links_touch
  before update on public.starkac_community_links
  for each row execute function public.starkac_set_updated_at();

-- ============================================================================
-- RPCs for assignment submissions. Writes go through these rather than direct
-- table grants so a trainee can never set their own score/feedback/status -
-- RLS alone can't stop that on a shared "own row" policy since it's row-level,
-- not column-level. Both functions are security definer, so they bypass RLS
-- internally once the caller passes the checks below (same pattern as
-- declare_weekly_task_value / approve_weekly_task_value in task_value_splits.sql).
-- ============================================================================
create or replace function public.submit_starkac_assignment(
  p_assignment_id uuid,
  p_submission_text text default null,
  p_submission_url text default null
)
returns public.starkac_assignment_submissions
language plpgsql security definer set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  result public.starkac_assignment_submissions;
begin
  if current_email = '' then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.starkac_trainees where lower(email) = current_email) then
    raise exception 'StarkAC learner profile required';
  end if;
  if coalesce(btrim(p_submission_text), '') = '' and coalesce(btrim(p_submission_url), '') = '' then
    raise exception 'Add your submission text or a link';
  end if;

  insert into public.starkac_assignment_submissions (assignment_id, trainee_email, submission_text, submission_url)
  values (p_assignment_id, current_email, nullif(btrim(coalesce(p_submission_text, '')), ''), nullif(btrim(coalesce(p_submission_url, '')), ''))
  on conflict (assignment_id, trainee_email) do update
    set submission_text = excluded.submission_text,
        submission_url = excluded.submission_url,
        submitted_at = now(),
        status = 'submitted'
    where public.starkac_assignment_submissions.status <> 'reviewed'
  returning * into result;

  if result.id is null then
    raise exception 'This submission has already been reviewed and can no longer be edited';
  end if;
  return result;
end;
$$;
grant execute on function public.submit_starkac_assignment(uuid, text, text) to authenticated;

create or replace function public.grade_starkac_submission(
  p_submission_id uuid,
  p_score numeric,
  p_feedback text default null,
  p_status text default 'reviewed'
)
returns public.starkac_assignment_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_plan text;
  result public.starkac_assignment_submissions;
begin
  if p_status not in ('reviewed', 'needs_revision') then raise exception 'Invalid status'; end if;
  select a.plan into v_plan
  from public.starkac_assignment_submissions s
  join public.starkac_assignments a on a.id = s.assignment_id
  where s.id = p_submission_id;
  if v_plan is null then raise exception 'Submission not found'; end if;
  if not (public.is_starkworth_admin() or v_plan = any (public.starkac_trainer_plans())) then
    raise exception 'You are not the trainer for this plan';
  end if;

  update public.starkac_assignment_submissions
  set score = p_score,
      feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      status = p_status,
      reviewed_at = now(),
      reviewed_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_submission_id
  returning * into result;
  return result;
end;
$$;
grant execute on function public.grade_starkac_submission(uuid, numeric, text, text) to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.starkac_trainers enable row level security;
alter table public.starkac_classes enable row level security;
alter table public.starkac_weekly_videos enable row level security;
alter table public.starkac_assignments enable row level security;
alter table public.starkac_assignment_submissions enable row level security;
alter table public.starkac_community_links enable row level security;

-- ---- starkac_trainers ----
drop policy if exists "admins manage trainers" on public.starkac_trainers;
create policy "admins manage trainers" on public.starkac_trainers
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainers read own row" on public.starkac_trainers;
create policy "trainers read own row" on public.starkac_trainers
  for select to authenticated using (lower(auth.jwt() ->> 'email') = lower(email));

-- ---- starkac_classes ----
drop policy if exists "admins manage classes" on public.starkac_classes;
create policy "admins manage classes" on public.starkac_classes
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainers manage own class" on public.starkac_classes;
create policy "trainers manage own class" on public.starkac_classes
  for update to authenticated
  using (lower(trainer_email) = lower(auth.jwt() ->> 'email'))
  with check (lower(trainer_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "signed in users read classes" on public.starkac_classes;
create policy "signed in users read classes" on public.starkac_classes
  for select to authenticated using (true);

-- ---- starkac_weekly_videos ----
drop policy if exists "admins manage weekly videos" on public.starkac_weekly_videos;
create policy "admins manage weekly videos" on public.starkac_weekly_videos
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainers manage own plan videos" on public.starkac_weekly_videos;
create policy "trainers manage own plan videos" on public.starkac_weekly_videos
  for all to authenticated
  using (plan = any (public.starkac_trainer_plans()))
  with check (plan = any (public.starkac_trainer_plans()));

drop policy if exists "signed in users read weekly videos" on public.starkac_weekly_videos;
create policy "signed in users read weekly videos" on public.starkac_weekly_videos
  for select to authenticated using (true);

-- ---- starkac_assignments ----
drop policy if exists "admins manage assignments" on public.starkac_assignments;
create policy "admins manage assignments" on public.starkac_assignments
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainers manage own plan assignments" on public.starkac_assignments;
create policy "trainers manage own plan assignments" on public.starkac_assignments
  for all to authenticated
  using (plan = any (public.starkac_trainer_plans()))
  with check (plan = any (public.starkac_trainer_plans()));

drop policy if exists "signed in users read assignments" on public.starkac_assignments;
create policy "signed in users read assignments" on public.starkac_assignments
  for select to authenticated using (true);

-- ---- starkac_assignment_submissions ----
drop policy if exists "admins manage submissions" on public.starkac_assignment_submissions;
create policy "admins manage submissions" on public.starkac_assignment_submissions
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainers manage submissions for own plan" on public.starkac_assignment_submissions;
create policy "trainers manage submissions for own plan" on public.starkac_assignment_submissions
  for all to authenticated
  using (exists (
    select 1 from public.starkac_assignments a
    where a.id = starkac_assignment_submissions.assignment_id
      and a.plan = any (public.starkac_trainer_plans())
  ))
  with check (exists (
    select 1 from public.starkac_assignments a
    where a.id = starkac_assignment_submissions.assignment_id
      and a.plan = any (public.starkac_trainer_plans())
  ));

drop policy if exists "trainees manage own submissions" on public.starkac_assignment_submissions;
drop policy if exists "trainees read own submissions" on public.starkac_assignment_submissions;
create policy "trainees read own submissions" on public.starkac_assignment_submissions
  for select to authenticated using (lower(trainee_email) = lower(auth.jwt() ->> 'email'));
-- Trainees write via submit_starkac_assignment() only, never a direct table
-- write - that RPC is the only thing that can insert/update their own
-- submission row, and it never touches score/feedback/status/reviewed_*.

-- ---- starkac_community_links ----
drop policy if exists "admins manage community links" on public.starkac_community_links;
create policy "admins manage community links" on public.starkac_community_links
  for all to authenticated using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "signed in users read community links" on public.starkac_community_links;
create policy "signed in users read community links" on public.starkac_community_links
  for select to authenticated using (true);

-- ---- extend starkac_trainees / starkac_trainee_activity (from starkac.sql)
-- so a trainer can see their roster and post assessments/mentor notes ----
drop policy if exists "trainers read trainees on own plan" on public.starkac_trainees;
create policy "trainers read trainees on own plan" on public.starkac_trainees
  for select to authenticated using (plan = any (public.starkac_trainer_plans()));

drop policy if exists "trainers manage activity for own plan" on public.starkac_trainee_activity;
create policy "trainers manage activity for own plan" on public.starkac_trainee_activity
  for all to authenticated
  using (exists (
    select 1 from public.starkac_trainees t
    where t.email = starkac_trainee_activity.trainee_email and t.plan = any (public.starkac_trainer_plans())
  ))
  with check (exists (
    select 1 from public.starkac_trainees t
    where t.email = starkac_trainee_activity.trainee_email and t.plan = any (public.starkac_trainer_plans())
  ));

grant select on public.starkac_trainees to authenticated;
grant select, insert on public.starkac_trainee_activity to authenticated;

-- ============================================================================
-- Grants
-- ============================================================================
grant select on public.starkac_trainers to authenticated;
grant select, update on public.starkac_classes to authenticated;
grant select, insert, update, delete on public.starkac_weekly_videos to authenticated;
grant select, insert, update, delete on public.starkac_assignments to authenticated;
grant select, insert, update, delete on public.starkac_assignment_submissions to authenticated;
grant select, insert, update, delete on public.starkac_community_links to authenticated;

-- ============================================================================
-- Cleanup: drop dependent rows when a trainee is removed.
-- ============================================================================
create or replace function public.purge_starkac_lms_for_trainee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.starkac_assignment_submissions where lower(trainee_email) = lower(old.email);
  return old;
end;
$$;

drop trigger if exists starkac_trainees_purge_lms on public.starkac_trainees;
create trigger starkac_trainees_purge_lms after delete on public.starkac_trainees
  for each row execute function public.purge_starkac_lms_for_trainee();
