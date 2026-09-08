-- Staff members and admin-configurable role access for the Starkworth admin
-- dashboard (pages/admin.html).
--
-- Run this in the Supabase SQL Editor AFTER affiliate_system.sql (which creates
-- public.starkworth_admins) and account_operations.sql. Idempotent.
--
-- WHAT THIS ADDS
--   1. Any Starkworth staff member lives in public.starkworth_admins with a
--      free-text role (super_admin, ceo, coo, admin, secretary, manager, ...).
--      public.is_starkworth_admin() is unchanged - any active row still gets
--      full data access, so every existing RLS policy keeps working.
--   2. staff_role_permissions maps a role to the admin-dashboard areas it may
--      open. Admins with the 'manage_staff' permission edit this from the
--      Staff tab; the dashboard hides tabs a signed-in staff member's role is
--      not granted.
--   3. RLS is finally enabled on starkworth_admins (it had none - any
--      authenticated user could edit it). Only 'manage_staff' can write it now.
--
-- SCOPE: per-role limits are enforced in the dashboard UI for the data tabs;
-- only the staff tables themselves are enforced here in the database.

-- ============================================================================
-- 1. Allow any role string on staff rows
-- ============================================================================
alter table public.starkworth_admins drop constraint if exists starkworth_admins_role_check;
alter table public.starkworth_admins alter column role set default 'admin';

-- ============================================================================
-- 2. Role -> permission map. A row means "this role may open this area".
-- ============================================================================
create table if not exists public.staff_role_permissions (
  role text not null,
  permission_key text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

-- Seed sensible defaults. Admins edit these afterward from the Staff tab.
-- Permission keys mirror the admin dashboard tab ids, plus 'manage_staff'.
do $$
declare
  all_keys text[] := array[
    'overview','agreements','workers','assignments','projects','reports',
    'payments','affiliate','contacts','livechat','staff','manage_staff'
  ];
  k text;
begin
  foreach k in array all_keys loop
    insert into public.staff_role_permissions (role, permission_key) values ('super_admin', k) on conflict do nothing;
    insert into public.staff_role_permissions (role, permission_key) values ('ceo', k) on conflict do nothing;
    insert into public.staff_role_permissions (role, permission_key) values ('coo', k) on conflict do nothing;
    if k <> 'manage_staff' then
      insert into public.staff_role_permissions (role, permission_key) values ('admin', k) on conflict do nothing;
    end if;
  end loop;
  foreach k in array array['overview','contacts','livechat','reports'] loop
    insert into public.staff_role_permissions (role, permission_key) values ('secretary', k) on conflict do nothing;
  end loop;
end;
$$;

-- ============================================================================
-- 3. Permission helpers
-- ============================================================================

-- True when the caller is an active staff member whose role grants p_key.
-- super_admin and ceo always pass.
create or replace function public.has_staff_permission(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.starkworth_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and a.active
      and (
        a.role in ('super_admin', 'ceo')
        or exists (
          select 1 from public.staff_role_permissions p
          where p.role = a.role and p.permission_key = p_key
        )
      )
  );
$$;
grant execute on function public.has_staff_permission(text) to authenticated;

-- The caller's granted dashboard areas: ["*"] for super_admin/ceo, otherwise
-- the list of permission keys for their role. [] when the caller is not staff.
create or replace function public.my_staff_permissions()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.starkworth_admins
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  limit 1;

  if v_role is null then return '[]'::jsonb; end if;
  if v_role in ('super_admin', 'ceo') then return '["*"]'::jsonb; end if;

  return coalesce(
    (select jsonb_agg(permission_key) from public.staff_role_permissions where role = v_role),
    '[]'::jsonb
  );
end;
$$;
grant execute on function public.my_staff_permissions() to authenticated;

-- ============================================================================
-- 4. Management RPCs (gated by the 'manage_staff' permission)
-- ============================================================================
create or replace function public.upsert_staff_member(
  p_email text,
  p_display_name text default null,
  p_role text default 'admin',
  p_active boolean default true
)
returns public.starkworth_admins
language plpgsql security definer set search_path = public
as $$
declare result public.starkworth_admins;
begin
  if not public.has_staff_permission('manage_staff') then raise exception 'Staff management access required'; end if;
  if coalesce(btrim(p_email), '') = '' then raise exception 'Email is required'; end if;

  insert into public.starkworth_admins (email, display_name, role, active)
  values (lower(btrim(p_email)), nullif(btrim(coalesce(p_display_name, '')), ''), coalesce(nullif(btrim(p_role), ''), 'admin'), coalesce(p_active, true))
  on conflict (email) do update
    set display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), starkworth_admins.display_name),
        role = coalesce(nullif(btrim(p_role), ''), starkworth_admins.role),
        active = coalesce(p_active, starkworth_admins.active)
  returning * into result;
  return result;
end;
$$;
grant execute on function public.upsert_staff_member(text, text, text, boolean) to authenticated;

create or replace function public.delete_staff_member(p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_staff_permission('manage_staff') then raise exception 'Staff management access required'; end if;
  if lower(btrim(p_email)) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You cannot remove your own staff access';
  end if;
  delete from public.starkworth_admins where lower(email) = lower(btrim(p_email));
end;
$$;
grant execute on function public.delete_staff_member(text) to authenticated;

-- Replace the whole permission set for one role.
create or replace function public.set_role_permissions(p_role text, p_keys jsonb)
returns setof public.staff_role_permissions
language plpgsql security definer set search_path = public
as $$
declare v_role text := nullif(btrim(p_role), '');
begin
  if not public.has_staff_permission('manage_staff') then raise exception 'Staff management access required'; end if;
  if v_role is null then raise exception 'Role is required'; end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then raise exception 'Permission keys must be a JSON array'; end if;

  delete from public.staff_role_permissions where role = v_role;
  insert into public.staff_role_permissions (role, permission_key)
  select v_role, value::text
  from jsonb_array_elements_text(p_keys) as value
  on conflict do nothing;

  return query select * from public.staff_role_permissions where role = v_role order by permission_key;
end;
$$;
grant execute on function public.set_role_permissions(text, jsonb) to authenticated;

-- ============================================================================
-- 5. RLS - close the hole on starkworth_admins
-- ============================================================================
alter table public.starkworth_admins enable row level security;
alter table public.staff_role_permissions enable row level security;

drop policy if exists "staff read staff list" on public.starkworth_admins;
create policy "staff read staff list" on public.starkworth_admins
  for select to authenticated using (public.is_starkworth_admin());

drop policy if exists "manage_staff writes staff list" on public.starkworth_admins;
create policy "manage_staff writes staff list" on public.starkworth_admins
  for all to authenticated
  using (public.has_staff_permission('manage_staff'))
  with check (public.has_staff_permission('manage_staff'));

drop policy if exists "staff read role permissions" on public.staff_role_permissions;
create policy "staff read role permissions" on public.staff_role_permissions
  for select to authenticated using (public.is_starkworth_admin());

drop policy if exists "manage_staff writes role permissions" on public.staff_role_permissions;
create policy "manage_staff writes role permissions" on public.staff_role_permissions
  for all to authenticated
  using (public.has_staff_permission('manage_staff'))
  with check (public.has_staff_permission('manage_staff'));

grant select, insert, update, delete on public.starkworth_admins, public.staff_role_permissions to authenticated;
