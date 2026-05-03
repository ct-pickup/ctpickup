-- Chat room controls: on/off, announcements-only, expiry, per-room mutes, admin moderation.
-- RLS is the source of truth; clients can only do what policies allow.

-- Room settings
alter table public.chat_rooms
  add column if not exists is_active boolean not null default true,
  add column if not exists announcements_only boolean not null default false,
  add column if not exists closes_at timestamptz null,
  add column if not exists created_by uuid null references auth.users (id) on delete set null;

comment on column public.chat_rooms.is_active is 'If false, room is disabled for non-admins.';
comment on column public.chat_rooms.announcements_only is 'If true, only admins may post; everyone else can read (when open).';
comment on column public.chat_rooms.closes_at is 'If set, room is treated as closed after this timestamp (non-admins cannot read or post).';

-- Per-room mutes (admin-controlled)
create table if not exists public.chat_room_mutes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  muted_by uuid null references auth.users (id) on delete set null,
  muted_until timestamptz null,
  reason text null,
  created_at timestamptz not null default now(),
  constraint chat_room_mutes_unique unique (room_id, user_id)
);

comment on table public.chat_room_mutes is 'Per-room mutes. If muted_until is null, mute is indefinite.';
comment on column public.chat_room_mutes.muted_until is 'If set, mute expires at this time.';

alter table public.chat_room_mutes enable row level security;

-- Helpers used by RLS policies
create or replace function public.is_admin_uid(p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_uid
      and p.is_admin = true
  );
$$;

create or replace function public.is_approved_or_admin_uid(p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_uid
      and (p.approved = true or p.is_admin = true)
  );
$$;

create or replace function public.chat_room_is_open_for_uid(p_room_id uuid, p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.is_admin_uid(p_uid)
    or exists (
      select 1
      from public.chat_rooms r
      where r.id = p_room_id
        and r.is_active = true
        and (r.closes_at is null or r.closes_at > now())
        and public.is_approved_or_admin_uid(p_uid)
    );
$$;

create or replace function public.chat_user_is_muted(p_room_id uuid, p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_room_mutes m
    where m.room_id = p_room_id
      and m.user_id = p_uid
      and (m.muted_until is null or m.muted_until > now())
  );
$$;

-- (Re)define chat_rooms policies to respect controls.
drop policy if exists "chat_rooms_select_approved" on public.chat_rooms;
create policy "chat_rooms_select_open_or_admin"
  on public.chat_rooms
  for select
  to authenticated
  using (
    public.is_admin_uid(auth.uid())
    or (
      public.is_approved_or_admin_uid(auth.uid())
      and is_active = true
      and (closes_at is null or closes_at > now())
    )
  );

drop policy if exists "chat_rooms_insert_admin_only" on public.chat_rooms;
create policy "chat_rooms_insert_admin_only"
  on public.chat_rooms
  for insert
  to authenticated
  with check (public.is_admin_uid(auth.uid()));

drop policy if exists "chat_rooms_update_admin_only" on public.chat_rooms;
create policy "chat_rooms_update_admin_only"
  on public.chat_rooms
  for update
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- chat_messages: read if room open (or admin), insert if room open AND not muted AND announcements-only rules
drop policy if exists "chat_messages_select_approved" on public.chat_messages;
create policy "chat_messages_select_open_or_admin"
  on public.chat_messages
  for select
  to authenticated
  using (public.chat_room_is_open_for_uid(room_id, auth.uid()));

drop policy if exists "chat_messages_insert_own_approved" on public.chat_messages;
create policy "chat_messages_insert_open_not_muted"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.chat_room_is_open_for_uid(room_id, auth.uid())
    and public.chat_user_is_muted(room_id, auth.uid()) = false
    and (
      public.is_admin_uid(auth.uid())
      or exists (
        select 1
        from public.chat_rooms r
        where r.id = room_id
          and r.announcements_only = false
      )
    )
  );

drop policy if exists "chat_messages_delete_admin_only" on public.chat_messages;
create policy "chat_messages_delete_admin_only"
  on public.chat_messages
  for delete
  to authenticated
  using (public.is_admin_uid(auth.uid()));

-- chat_room_mutes: admin-only read/write
drop policy if exists "chat_room_mutes_select_admin_only" on public.chat_room_mutes;
create policy "chat_room_mutes_select_admin_only"
  on public.chat_room_mutes
  for select
  to authenticated
  using (public.is_admin_uid(auth.uid()));

drop policy if exists "chat_room_mutes_write_admin_only" on public.chat_room_mutes;
create policy "chat_room_mutes_write_admin_only"
  on public.chat_room_mutes
  for all
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

