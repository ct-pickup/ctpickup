-- Phase 3: photography-led cards.
-- Field photos on sessions (pickup_runs; fields are not their own table) and an
-- action photo on profiles, plus two public-read Storage buckets.
-- Safe to paste into the Supabase SQL editor more than once.

-- ── 1. Columns ─────────────────────────────────────────────────────────────
alter table public.pickup_runs
  add column if not exists field_photo_url text;

comment on column public.pickup_runs.field_photo_url is
  'Public URL of the field photo (Storage bucket field-photos). Set only by the host or an admin.';

alter table public.profiles
  add column if not exists action_photo_url text;

comment on column public.profiles.action_photo_url is
  'Public URL of the player action photo (Storage bucket action-photos).';

-- ── 2. Buckets ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('field-photos', 'field-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('action-photos', 'action-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 3. Storage policies ────────────────────────────────────────────────────
-- Public read comes from the buckets being public (object URLs need no policy).
-- Writes: authenticated users only, only inside a folder named with their user id.
drop policy if exists "photo_buckets_select_own" on storage.objects;
create policy "photo_buckets_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('field-photos', 'action-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photo_buckets_insert_own" on storage.objects;
create policy "photo_buckets_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('field-photos', 'action-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photo_buckets_update_own" on storage.objects;
create policy "photo_buckets_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('field-photos', 'action-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('field-photos', 'action-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photo_buckets_delete_own" on storage.objects;
create policy "photo_buckets_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('field-photos', 'action-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 4. Field photo: host or admin only ─────────────────────────────────────
-- Guard on the column itself, whatever path the update takes. Service-role
-- calls (auth.uid() is null) are trusted server code and pass through.
create or replace function public.guard_pickup_run_field_photo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.field_photo_url is distinct from old.field_photo_url
     and auth.uid() is not null
     and auth.uid() is distinct from new.created_by
     and not public.is_admin_uid(auth.uid()) then
    raise exception 'Only the session host or an admin can set the field photo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_pickup_run_field_photo on public.pickup_runs;
create trigger trg_guard_pickup_run_field_photo
  before update of field_photo_url on public.pickup_runs
  for each row execute function public.guard_pickup_run_field_photo();

-- pickup_runs UPDATE is admin-only under RLS, so hosts set the photo through
-- this function. The URL must point at the caller's own folder in field-photos.
create or replace function public.set_run_field_photo(p_run_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select created_by into v_host from public.pickup_runs where id = p_run_id;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  if v_uid is distinct from v_host and not public.is_admin_uid(v_uid) then
    raise exception 'Only the session host or an admin can set the field photo.'
      using errcode = '42501';
  end if;

  if p_url is not null
     and position('/storage/v1/object/public/field-photos/' || v_uid::text || '/' in p_url) = 0 then
    raise exception 'Field photo must be uploaded to your field-photos folder.'
      using errcode = '22023';
  end if;

  update public.pickup_runs set field_photo_url = p_url where id = p_run_id;
end;
$$;

revoke all on function public.set_run_field_photo(uuid, text) from public, anon;
grant execute on function public.set_run_field_photo(uuid, text) to authenticated;
