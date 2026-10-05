-- Per-user notification mutes for a chat. A muted chat sends the player no push; messages still arrive in the app.
--
-- Not the same as chat_room_mutes (20260503193000_chat_room_controls.sql): that table is an admin moderation
-- mute that stops a player from POSTING in a room. This one is the player's own choice and only silences push.
--
--   * muted_until null means "until I turn it back on".
--   * RLS: a user can select, insert, update and delete only their own rows.
--   * The server (service role) reads it when sending chat pushes and skips muted recipients.
-- Additive: safe to run before or after the app and server code ships.

begin;

create table if not exists public.chat_notification_mutes (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  room_id     uuid        not null references public.chat_rooms (id) on delete cascade,
  muted_until timestamptz,
  created_at  timestamptz not null default now(),
  primary key (user_id, room_id)
);

comment on table public.chat_notification_mutes is
  'A player''s own push mute for a chat. muted_until null = until turned back on. Distinct from chat_room_mutes (admin moderation).';

create index if not exists chat_notification_mutes_room_idx
  on public.chat_notification_mutes (room_id);

alter table public.chat_notification_mutes enable row level security;

revoke all on public.chat_notification_mutes from anon, authenticated;
grant select, insert, update, delete on public.chat_notification_mutes to authenticated;

drop policy if exists chat_notification_mutes_select_own on public.chat_notification_mutes;
create policy chat_notification_mutes_select_own on public.chat_notification_mutes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists chat_notification_mutes_insert_own on public.chat_notification_mutes;
create policy chat_notification_mutes_insert_own on public.chat_notification_mutes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists chat_notification_mutes_update_own on public.chat_notification_mutes;
create policy chat_notification_mutes_update_own on public.chat_notification_mutes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists chat_notification_mutes_delete_own on public.chat_notification_mutes;
create policy chat_notification_mutes_delete_own on public.chat_notification_mutes
  for delete to authenticated using (user_id = auth.uid());

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.chat_notification_mutes;
-- commit;
-- ============================================================
