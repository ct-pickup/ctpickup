-- Per paid captain: private tournament team chat (membership via chat_room_members).
-- FK uses public.tournaments (outdoor captain hub); captain rows reference the same table.

alter table public.chat_rooms
  add column if not exists tournament_id uuid references public.tournaments (id) on delete cascade;

comment on column public.chat_rooms.tournament_id is
  'For room_type tournament_team, the outdoor/captain tournament this room belongs to.';

alter table public.chat_rooms
  drop constraint if exists chat_rooms_room_type_check;

alter table public.chat_rooms
  add constraint chat_rooms_room_type_check
    check (room_type in ('public', 'announcement', 'group', 'run_banter', 'tournament_team'));

-- Member-gated read (same as group / run_banter).
create or replace function public.chat_room_can_read_messages_for_uid(p_room_id uuid, p_uid uuid)
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
          r.room_type not in ('group', 'run_banter', 'tournament_team')
          or exists (
            select 1
            from public.chat_room_members m
            where m.room_id = r.id
              and m.user_id = p_uid
          )
        )
    );
$$;

-- Member-gated post (same as group / run_banter).
create or replace function public.chat_room_can_post_messages_for_uid(p_room_id uuid, p_uid uuid)
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
        and (r.auto_close_at is null or r.auto_close_at > now())
        and public.is_approved_or_admin_uid(p_uid)
        and (
          r.room_type not in ('group', 'run_banter', 'tournament_team')
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
        room_type not in ('group', 'run_banter', 'tournament_team')
        or exists (
          select 1
          from public.chat_room_members m
          where m.room_id = chat_rooms.id
            and m.user_id = auth.uid()
        )
      )
    )
  );
