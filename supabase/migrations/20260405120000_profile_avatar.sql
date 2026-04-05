-- Profile photo URL (public Storage URL). Apply in Supabase SQL editor or via CLI.
alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is 'Public URL for profile photo (Supabase Storage avatars bucket).';

-- Optional: extend profile later (uncomment if you add these columns)
-- alter table public.profiles add column if not exists birth_date date;
-- alter table public.profiles add column if not exists age integer;
-- alter table public.profiles add column if not exists username text;
-- alter table public.profiles add column if not exists location text;

-- Storage: create bucket in Dashboard → Storage → New bucket → name "avatars", public = true
-- OR insert (may require service role):
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- Policies on storage.objects (RLS must be enabled on storage.objects — default in Supabase)
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );
