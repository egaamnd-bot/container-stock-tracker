-- =====================================================================
-- 002 — Admin / viewer roles + in-app user management
-- Run AFTER 001_init.sql (SQL Editor → paste → Run). Idempotent.
--
-- Model:   admin  = imports, edits, deletes, approves users   (Ega)
--          viewer = search + browse only                       (coworkers)
--          editor = kept for compatibility (can edit, cannot manage users)
-- New sign-ups get NO access until an admin approves them in Settings → Users.
-- =====================================================================

-- Safer default: anyone added without an explicit role is read-only.
alter table public.authorized_users alter column role set default 'viewer';

-- Who approved whom (audit trail for access).
alter table public.authorized_users add column if not exists granted_by uuid;

-- ---------- List every signed-up account with its access (admin only) ----------
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, role text, signed_up_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, a.role, u.created_at, u.last_sign_in_at
      from auth.users u
      left join public.authorized_users a on a.user_id = u.id
     order by (a.role is null) desc, u.created_at desc;  -- pending requests first
end $$;

-- ---------- Grant / change / revoke access (admin only) ----------
-- p_role = 'viewer' | 'editor' | 'admin' to grant/change; null to revoke.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot change your own access (prevents locking out the last admin)';
  end if;
  if p_role is null then
    delete from public.authorized_users where user_id = p_user;
    return;
  end if;
  if p_role not in ('viewer', 'editor', 'admin') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'Unknown user';
  end if;
  insert into public.authorized_users (user_id, role, granted_by)
  values (p_user, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
end $$;

revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
