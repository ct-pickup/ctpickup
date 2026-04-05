-- Snapshot + admin access for guidance_requests (mentorship-ready)
alter table public.guidance_requests
  add column if not exists submitter_name text,
  add column if not exists submitter_email text,
  add column if not exists profile_tier_snapshot text,
  add column if not exists sport_focus text;

comment on column public.guidance_requests.submitter_name is 'Denormalized at submit for admin inbox';
comment on column public.guidance_requests.submitter_email is 'Denormalized at submit for admin inbox';
comment on column public.guidance_requests.profile_tier_snapshot is 'profiles.tier at submit time';
comment on column public.guidance_requests.sport_focus is 'Optional user-entered sport/focus';

-- Admins can read all requests (OR with existing "select own" policy)
create policy "guidance_requests_select_admin"
  on public.guidance_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin is true
    )
  );

-- Admins can update status (assignment workflow later)
create policy "guidance_requests_update_admin"
  on public.guidance_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin is true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin is true
    )
  );
