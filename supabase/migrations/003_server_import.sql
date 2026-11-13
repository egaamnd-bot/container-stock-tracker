-- =====================================================================
-- 003 — Allow the automated Sheet → Supabase push to import
-- The Apps Script push authenticates with the project's SECRET key, which runs as
-- the Postgres role `service_role` (no auth.uid()). apply_import previously required
-- an 'editor'/'admin' user, so the server-side push was rejected.
-- Run after 001 + 002. Idempotent.
-- =====================================================================

-- Trusts ONLY the database role PostgREST switched to after verifying the key.
-- (JWT claim settings are deliberately ignored, so they can't be spoofed.)
create or replace function public.is_service_role()
returns boolean
language sql stable
as $$ select current_user = 'service_role' $$;

-- Same function body as 001, with one change: service_role may import too.
create or replace function public.apply_import(
  p_mode text,
  p_rows jsonb,
  p_filename text,
  p_sheet_name text default '',
  p_total_rows int default 0,
  p_invalid int default 0,
  p_duplicates int default 0,
  p_protected text[] default '{}'
) returns public.import_batches
language plpgsql security invoker set search_path = public
as $$
declare
  v_batch public.import_batches;
  v_added int; v_updated int; v_removed int := 0; v_staged int; v_dup int;
begin
  if not (public.has_role('editor') or public.is_service_role()) then
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

-- Cheap count for the push script's "sudden drop" safety check.
create or replace function public.inventory_count()
returns bigint language sql stable security definer set search_path = public
as $$ select count(*) from public.containers $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.apply_import(text, jsonb, text, text, int, int, int, text[]) to service_role';
    execute 'grant execute on function public.inventory_count() to service_role';
    execute 'grant select, insert, update, delete on public.containers to service_role';
    execute 'grant select, insert, update on public.import_batches to service_role';
  end if;
end $$;
revoke execute on function public.inventory_count() from public, anon, authenticated;
