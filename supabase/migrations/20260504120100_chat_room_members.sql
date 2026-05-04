-- Tier / member group chat rooms.
-- Adds room_type to chat_rooms (public / announcement / group) and a chat_room_members
-- table that gates visibility of `group` rooms via RLS. Existing helpers
-- (chat_room_is_open_for_uid, chat_rooms select policy) are updated so group rooms
-- are invisible to non-members and non-admins.

-- ---------------------------------------------------------------------------
-- 1. room_type column
-- ---------------------------------------------------------------------------

alter table public.chat_rooms
  add column if not exists room_type text not null default 'public';

alter table public.chat_rooms
  drop constraint if exists chat_rooms_room_type_check;

alter table public.chat_rooms
  add constraint chat_rooms_room_type_check
    check (room_type in ('public', 'announcement', 'group'));

-- Backfill: rooms previously flagged announcements_only become 'announcement'.
update public.chat_rooms
set room_type = 'announcement'
where announcements_only = true
  and room_type = 'public';

comment on column public.chat_rooms.room_type is
  'Room visibility class: public (open to approved users), announcement (open read, admin write), group (members only).';

-- ---------------------------------------------------------------------------
-- 2. chat_room_members table
-- ---------------------------------------------------------------------------

create table if not exists public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chat_room_members_room_user_unique unique (room_id, user_id)
);

create index if not exists chat_room_members_user_idx
  on public.chat_room_members (user_id);

create index if not exists chat_room_members_room_idx
  on public.chat_room_members (room_id);

comment on table public.chat_room_members is
  'Membership for group chat rooms. RLS uses this to gate which rooms / messages a user can see.';

-- ---------------------------------------------------------------------------
-- 3. RLS on chat_room_members
-- ---------------------------------------------------------------------------

alter table public.chat_room_members enable row level security;

drop policy if exists "chat_room_members_select_own_or_admin" on public.chat_room_members;
create policy "chat_room_members_select_own_or_admin"
  on public.chat_room_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_uid(auth.uid())
  );

drop policy if exists "chat_room_members_admin_write" on public.chat_room_members;
create policy "chat_room_members_admin_write"
  on public.chat_room_members
  for all
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Tighten chat_rooms / chat_messages RLS so group rooms are members-only.
--    Re-define the helper used by chat_messages policies, then re-issue the
--    chat_rooms select policy with the same membership gate.
-- ---------------------------------------------------------------------------

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
        and (
          r.room_type <> 'group'
          or exists (
            select 1
            from public.chat_room_members m
            where m.room_id = r.id
              and m.user_id = p_uid
          )
        )
    );
$$;

drop policy if exists "chat_rooms_select_open_or_admin" on public.chat_rooms;
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
      and (
        room_type <> 'group'
        or exists (
          select 1
          from public.chat_room_members m
          where m.room_id = chat_rooms.id
            and m.user_id = auth.uid()
        )
      )
    )
  );
