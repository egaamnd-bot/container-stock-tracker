-- =====================================================================
-- Container Stock Tracker — initial schema
-- Run in Supabase: Dashboard → SQL Editor → paste → Run.
-- Idempotent where practical.
-- =====================================================================

-- ---------- Authorized users (allow-list; supports more users later) ----------
create table if not exists public.authorized_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'editor' check (role in ('viewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.has_role(min_role text default 'viewer')
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users u
    where u.user_id = auth.uid()
      and case min_role
            when 'viewer' then true
            when 'editor' then u.role in ('editor', 'admin')
            when 'admin'  then u.role = 'admin'
            else false
          end
  );
$$;

-- ---------- Inventory ----------
create table if not exists public.containers (
  container_no  text primary key
                check (container_no ~ '^[A-Z0-9]+$' and length(container_no) between 4 and 15),
  display_no    text not null,
  shipping_line text not null check (length(trim(shipping_line)) > 0),
  type          text not null check (length(trim(type)) > 0),
  grade         text not null check (length(trim(grade)) > 0),
  size          text not null check (length(trim(size)) > 0),
  condition     text not null check (length(trim(condition)) > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid(),
  last_import_id uuid
);
comment on column public.containers.container_no is 'Normalized: uppercase, no whitespace/separators. Unique.';

create index if not exists containers_updated_at_idx on public.containers (updated_at desc);

-- ---------- Import history ----------
create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  mode        text not null check (mode in ('replace', 'merge')),
  filename    text not null,
  sheet_name  text not null default '',
  total_rows  int not null default 0,
  added       int not null default 0,
  updated     int not null default 0,
  unchanged   int not null default 0,
  removed     int not null default 0,
  invalid     int not null default 0,
  duplicates  int not null default 0,
  status      text not null check (status in ('completed', 'failed')),
  error       text
);
create index if not exists import_batches_created_idx on public.import_batches (created_at desc);

-- ---------- Audit log (every insert/update/delete on containers) ----------
create table if not exists public.audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor        uuid default auth.uid(),
  action       text not null check (action in ('insert', 'update', 'delete')),
  container_no text not null,
  source       text not null default 'manual', -- 'manual' | 'import'
  import_id    uuid,
  old_data     jsonb,
  new_data     jsonb
);
create index if not exists audit_log_container_idx on public.audit_log (container_no, at desc);
create index if not exists audit_log_import_idx on public.audit_log (import_id);

-- ---------- Inventory version (cheap "is my offline copy stale?" check) ----------
create table if not exists public.inventory_state (
  id         int primary key default 1 check (id = 1),
  version    bigint not null default 0,
  changed_at timestamptz not null default now()
);
insert into public.inventory_state (id) values (1) on conflict do nothing;

-- ---------- Triggers ----------
create or replace function public.tg_containers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_at := coalesce(new.created_at, now()); end if;
  return new;
end $$;

drop trigger if exists containers_touch on public.containers;
create trigger containers_touch before insert or update on public.containers
for each row execute function public.tg_containers_touch();

create or replace function public.tg_containers_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_import uuid := nullif(current_setting('app.import_id', true), '')::uuid;
  v_source text := case when v_import is null then 'manual' else 'import' end;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (action, container_no, source, import_id, new_data)
    values ('insert', new.container_no, v_source, v_import, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (action, container_no, source, import_id, old_data, new_data)
    values ('update', new.container_no, v_source, v_import, to_jsonb(old), to_jsonb(new));
  else
    insert into public.audit_log (action, container_no, source, import_id, old_data)
    values ('delete', old.container_no, v_source, v_import, to_jsonb(old));
  end if;
  return null;
end $$;

drop trigger if exists containers_audit on public.containers;
create trigger containers_audit after insert or update or delete on public.containers
for each row execute function public.tg_containers_audit();

create or replace function public.tg_inventory_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_state set version = version + 1, changed_at = now() where id = 1;
  return null;
end $$;

drop trigger if exists containers_bump on public.containers;
create trigger containers_bump after insert or update or delete on public.containers
for each statement execute function public.tg_inventory_bump();

-- ---------- Transaction-safe import ----------
-- The whole function runs in ONE transaction: any error rolls back every change.
-- p_rows: [{container_no, display_no, shipping_line, type, grade, size, condition}, ...]
create or replace function public.apply_import(
  p_mode text,
  p_rows jsonb,
  p_filename text,
  p_sheet_name text default '',
  p_total_rows int default 0,
  p_invalid int default 0,
  p_duplicates int default 0,
  p_protected text[] default '{}'   -- replace mode: numbers whose rows were invalid → never removed
) returns public.import_batches
language plpgsql security invoker set search_path = public
as $$
declare
  v_batch public.import_batches;
  v_added int; v_updated int; v_removed int := 0; v_staged int; v_dup int;
begin
  if not public.has_role('editor') then
    raise exception 'Not authorized to import' using errcode = '42501';
  end if;
  if p_mode not in ('replace', 'merge') then
    raise exception 'Invalid import mode: %', p_mode;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Import contains no valid rows — refusing to apply (would empty the inventory in replace mode)';
  end if;

  create temp table _stage on commit drop as
  select upper(regexp_replace(r.container_no, '[[:space:]./_-]', '', 'g')) as container_no,
         trim(r.display_no) as display_no,
         upper(trim(r.shipping_line)) as shipping_line, upper(trim(r.type)) as type,
         upper(trim(r.grade)) as grade, upper(trim(r.size)) as size, upper(trim(r.condition)) as condition
  from jsonb_to_recordset(p_rows) as r(container_no text, display_no text, shipping_line text, type text,
                                       grade text, size text, condition text);

  select count(*), count(*) - count(distinct container_no) into v_staged, v_dup from _stage;
  if v_dup > 0 then
    raise exception 'Import payload contains % duplicate container number(s)', v_dup;
  end if;

  insert into public.import_batches (mode, filename, sheet_name, total_rows, invalid, duplicates, status)
  values (p_mode, p_filename, coalesce(p_sheet_name, ''), p_total_rows, p_invalid, p_duplicates, 'completed')
  returning * into v_batch;

  perform set_config('app.import_id', v_batch.id::text, true);

  update public.containers c
     set display_no = s.display_no, shipping_line = s.shipping_line, type = s.type, grade = s.grade,
         size = s.size, condition = s.condition, last_import_id = v_batch.id
    from _stage s
   where c.container_no = s.container_no
     and (c.shipping_line, c.type, c.grade, c.size, c.condition)
         is distinct from (s.shipping_line, s.type, s.grade, s.size, s.condition);
  get diagnostics v_updated = row_count;

  insert into public.containers (container_no, display_no, shipping_line, type, grade, size, condition, last_import_id)
  select s.container_no, s.display_no, s.shipping_line, s.type, s.grade, s.size, s.condition, v_batch.id
    from _stage s
   where not exists (select 1 from public.containers c where c.container_no = s.container_no);
  get diagnostics v_added = row_count;

  if p_mode = 'replace' then
    delete from public.containers c
     where not exists (select 1 from _stage s where s.container_no = c.container_no)
       and not (c.container_no = any (coalesce(p_protected, '{}')));
    get diagnostics v_removed = row_count;
  end if;

  update public.import_batches
     set added = v_added, updated = v_updated, unchanged = v_staged - v_added - v_updated, removed = v_removed
   where id = v_batch.id
  returning * into v_batch;

  perform set_config('app.import_id', '', true);
  return v_batch;
end $$;

-- ---------- Row Level Security ----------
alter table public.authorized_users enable row level security;
alter table public.containers       enable row level security;
alter table public.import_batches   enable row level security;
alter table public.audit_log        enable row level security;
alter table public.inventory_state  enable row level security;

drop policy if exists "read own authorization" on public.authorized_users;
create policy "read own authorization" on public.authorized_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "viewers read containers" on public.containers;
create policy "viewers read containers" on public.containers
  for select to authenticated using (public.has_role('viewer'));
drop policy if exists "editors insert containers" on public.containers;
create policy "editors insert containers" on public.containers
  for insert to authenticated with check (public.has_role('editor'));
drop policy if exists "editors update containers" on public.containers;
create policy "editors update containers" on public.containers
  for update to authenticated using (public.has_role('editor')) with check (public.has_role('editor'));
drop policy if exists "editors delete containers" on public.containers;
create policy "editors delete containers" on public.containers
  for delete to authenticated using (public.has_role('editor'));

drop policy if exists "viewers read imports" on public.import_batches;
create policy "viewers read imports" on public.import_batches
  for select to authenticated using (public.has_role('viewer'));
drop policy if exists "editors write imports" on public.import_batches;
create policy "editors write imports" on public.import_batches
  for insert to authenticated with check (public.has_role('editor'));
drop policy if exists "editors update imports" on public.import_batches;
create policy "editors update imports" on public.import_batches
  for update to authenticated using (public.has_role('editor'));

drop policy if exists "viewers read audit" on public.audit_log;
create policy "viewers read audit" on public.audit_log
  for select to authenticated using (public.has_role('viewer'));
-- No insert/update/delete policies on audit_log: rows are written only by the SECURITY DEFINER trigger.

drop policy if exists "viewers read version" on public.inventory_state;
create policy "viewers read version" on public.inventory_state
  for select to authenticated using (public.has_role('viewer'));

-- ---------- Grants ----------
revoke all on public.containers, public.import_batches, public.audit_log, public.inventory_state, public.authorized_users from anon;
grant select, insert, update, delete on public.containers to authenticated;
grant select, insert, update on public.import_batches to authenticated;
grant select on public.audit_log, public.inventory_state, public.authorized_users to authenticated;
revoke execute on function public.apply_import(text, jsonb, text, text, int, int, int, text[]) from public, anon;
grant execute on function public.apply_import(text, jsonb, text, text, int, int, int, text[]) to authenticated;
grant execute on function public.has_role(text) to authenticated;
