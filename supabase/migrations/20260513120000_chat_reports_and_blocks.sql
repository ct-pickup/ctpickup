-- Player-facing chat report + block (App Store Guideline 1.2 compliance).
-- Writes go through Next.js API (service role); RLS denies direct client writes.
-- Reports are admin-readable; blocks are owner-readable only and never exposed
-- to other players or admins in this pass.

-- ---------------------------------------------------------------------------
-- chat_reports: a player flags a specific message for moderator review.
-- ---------------------------------------------------------------------------

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint chat_reports_reason_check check (reason in ('harassment', 'spam', 'inappropriate', 'other'))
);

create index if not exists chat_reports_reporter_idx on public.chat_reports (reporter_user_id, created_at desc);
create index if not exists chat_reports_reported_idx on public.chat_reports (reported_user_id, created_at desc);
create index if not exists chat_reports_message_idx on public.chat_reports (message_id);
create index if not exists chat_reports_room_idx on public.chat_reports (room_id, created_at desc);

comment on table public.chat_reports is
  'Player-submitted chat message reports. Inserts go through Next.js API; admins review server-side.';

alter table public.chat_reports enable row level security;

-- Admins can read reports; no client writes (server uses service role).
drop policy if exists "chat_reports_select_admin_only" on public.chat_reports;
create policy "chat_reports_select_admin_only"
  on public.chat_reports
  for select
  to authenticated
  using (public.is_admin_uid(auth.uid()));

drop policy if exists "chat_reports_block_client_writes" on public.chat_reports;
create policy "chat_reports_block_client_writes"
  on public.chat_reports
  for all
  to authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- chat_blocks: a player chooses to hide another player's messages.
--   - Unique on (blocker_user_id, blocked_user_id) so a player can only block
--     a given user once.
--   - Block list is never exposed to other users or admins in this pass; only
--     the blocker themselves may read their own rows.
-- ---------------------------------------------------------------------------

create table if not exists public.chat_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_blocks_no_self_block check (blocker_user_id <> blocked_user_id),
  constraint chat_blocks_unique_pair unique (blocker_user_id, blocked_user_id)
);

create index if not exists chat_blocks_blocker_idx on public.chat_blocks (blocker_user_id);

comment on table public.chat_blocks is
  'Per-player chat block list. Inserts go through Next.js API; the owner reads their own rows only.';

alter table public.chat_blocks enable row level security;

-- Only the blocker can read their own block rows; nobody else (not even admins
-- in this pass) can see who anyone has blocked.
drop policy if exists "chat_blocks_select_own_only" on public.chat_blocks;
create policy "chat_blocks_select_own_only"
  on public.chat_blocks
  for select
  to authenticated
  using (blocker_user_id = auth.uid());

drop policy if exists "chat_blocks_block_client_writes" on public.chat_blocks;
create policy "chat_blocks_block_client_writes"
  on public.chat_blocks
  for insert
  to authenticated
  with check (false);

drop policy if exists "chat_blocks_block_client_updates" on public.chat_blocks;
create policy "chat_blocks_block_client_updates"
  on public.chat_blocks
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "chat_blocks_block_client_deletes" on public.chat_blocks;
create policy "chat_blocks_block_client_deletes"
  on public.chat_blocks
  for delete
  to authenticated
  using (false);
