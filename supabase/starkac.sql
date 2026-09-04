-- Separate StarkAC learner/waiting-list system.
create table if not exists public.starkac_trainees (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  phone text,
  country text,
  current_level text not null default 'beginner',
  learning_goal text,
  plan text not null default 'beginner_20' check (plan in ('beginner_20', 'top_performer')),
  plan_price_usd numeric(10,2) not null default 20,
  status text not null default 'waiting' check (status in ('waiting', 'onboarded', 'paused', 'completed')),
  job_track_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.starkac_trainee_activity (
  id uuid primary key default gen_random_uuid(),
  trainee_email text not null references public.starkac_trainees(email) on delete cascade,
  activity_type text not null check (activity_type in ('lesson', 'assignment', 'assessment', 'mentor_note', 'status_update')),
  title text not null,
  description text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'review')),
  score numeric(5,2),
  activity_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists starkac_activity_email_idx on public.starkac_trainee_activity(trainee_email, activity_date desc);

create or replace function public.starkac_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists starkac_trainees_updated_at on public.starkac_trainees;
create trigger starkac_trainees_updated_at before update on public.starkac_trainees
for each row execute function public.starkac_set_updated_at();

create or replace function public.starkac_create_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'portal_type', '') = 'starkac_trainee' then
    insert into public.starkac_trainees(email, full_name, phone, country, current_level, learning_goal, plan, plan_price_usd)
    values (lower(new.email), coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
      new.raw_user_meta_data ->> 'phone', new.raw_user_meta_data ->> 'country',
      coalesce(nullif(new.raw_user_meta_data ->> 'current_level', ''), 'beginner'),
      new.raw_user_meta_data ->> 'learning_goal', coalesce(nullif(new.raw_user_meta_data ->> 'plan', ''), 'beginner_20'),
      coalesce(nullif(new.raw_user_meta_data ->> 'plan_price_usd', ''), '20')::numeric)
    on conflict (email) do update set full_name = excluded.full_name, phone = excluded.phone,
      country = excluded.country, current_level = excluded.current_level, learning_goal = excluded.learning_goal,
      plan = excluded.plan, plan_price_usd = excluded.plan_price_usd;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_starkac on auth.users;
create trigger on_auth_user_created_starkac after insert on auth.users
for each row execute function public.starkac_create_profile();

alter table public.starkac_trainees enable row level security;
alter table public.starkac_trainee_activity enable row level security;

drop policy if exists "trainees read own profile" on public.starkac_trainees;
create policy "trainees read own profile" on public.starkac_trainees for select to authenticated
using (lower(auth.jwt() ->> 'email') = lower(email) or public.is_starkworth_admin());
drop policy if exists "admins manage trainee profiles" on public.starkac_trainees;
create policy "admins manage trainee profiles" on public.starkac_trainees for all to authenticated
using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());

drop policy if exists "trainees read own activity" on public.starkac_trainee_activity;
create policy "trainees read own activity" on public.starkac_trainee_activity for select to authenticated
using (lower(auth.jwt() ->> 'email') = lower(trainee_email) or public.is_starkworth_admin());
drop policy if exists "admins manage trainee activity" on public.starkac_trainee_activity;
create policy "admins manage trainee activity" on public.starkac_trainee_activity for all to authenticated
using (public.is_starkworth_admin()) with check (public.is_starkworth_admin());
