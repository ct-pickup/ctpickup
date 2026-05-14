-- Run banter: per-finalized-pickup chat rooms (members = confirmed RSVPs).

alter table public.chat_rooms
  add column if not exists run_id uuid references public.pickup_runs (id) on delete cascade;

alter table public.chat_rooms
  add column if not exists auto_close_at timestamptz;

comment on column public.chat_rooms.run_id is 'For room_type run_banter, the pickup run this room belongs to.';
comment on column public.chat_rooms.auto_close_at is 'Non-admins may read but not post after this time (UI + insert policies).';

alter table public.chat_rooms
  drop constraint if exists chat_rooms_room_type_check;

alter table public.chat_rooms
  add constraint chat_rooms_room_type_check
    check (room_type in ('public', 'announcement', 'group', 'run_banter'));

create unique index if not exists chat_rooms_run_banter_one_per_run
  on public.chat_rooms (run_id)
  where room_type = 'run_banter'
    and run_id is not null;

-- Read history (ignores auto_close_at so members can open the thread after close).
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
          r.room_type not in ('group', 'run_banter')
          or exists (
            select 1
            from public.chat_room_members m
            where m.room_id = r.id
              and m.user_id = p_uid
          )
        )
    );
$$;

-- Post new messages (respects auto_close_at for non-admins).
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
          r.room_type not in ('group', 'run_banter')
          or exists (
            select 1
            from public.chat_room_members m
            where m.room_id = r.id
              and m.user_id = p_uid
          )
        )
    );
$$;

-- Backwards-compatible name: "open" means allowed to post.
create or replace function public.chat_room_is_open_for_uid(p_room_id uuid, p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.chat_room_can_post_messages_for_uid(p_room_id, p_uid);
$$;

drop policy if exists "chat_messages_select_open_or_admin" on public.chat_messages;
create policy "chat_messages_select_open_or_admin"
  on public.chat_messages
  for select
  to authenticated
  using (public.chat_room_can_read_messages_for_uid(room_id, auth.uid()));

drop policy if exists "chat_messages_insert_open_not_muted" on public.chat_messages;
create policy "chat_messages_insert_open_not_muted"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.chat_room_can_post_messages_for_uid(room_id, auth.uid())
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
        room_type not in ('group', 'run_banter')
        or exists (
          select 1
          from public.chat_room_members m
          where m.room_id = chat_rooms.id
            and m.user_id = auth.uid()
        )
      )
    )
  );
