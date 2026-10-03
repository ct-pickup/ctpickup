-- Competitive Together — Inbox read state and a notifications feed
-- Additive only. Nothing here is required for the app to keep working: the
-- Notifications screen reads delivered pushes today and picks up this table
-- as soon as something writes to it.
--
-- 1. chat_room_members.last_read_at  — unread message counts per room
-- 2. profiles.notifications_read_at  — "Mark all as read" for the bell
-- 3. notifications                   — the richer feed (invites, payments,
--                                      results, ratings, announcements,
--                                      verification). No producers yet; wire
--                                      the senders to insert here.

alter table public.chat_room_members
  add column if not exists last_read_at timestamptz;

comment on column public.chat_room_members.last_read_at is
  'When this member last opened the room. Messages newer than this, from other people, are unread.';

alter table public.profiles
  add column if not exists notifications_read_at timestamptz;

comment on column public.profiles.notifications_read_at is
  'When the player last cleared the bell. Alerts newer than this are unread.';

create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null,
  title      text        not null,
  body       text        not null default '',
  -- Route target, e.g. {"run_id": "..."} or {"screen": "/settings"}.
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check check (kind in (
    'game_invite',
    'join_confirmed',
    'payment_confirmed',
    'result_posted',
    'rating_updated',
    'announcement',
    'verification_update'
  ))
);

comment on table public.notifications is
  'In-app alert feed. Read state is the per-player profiles.notifications_read_at watermark, so there is no per-row read column.';

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'notifications'
       and policyname = 'notifications_own_select'
  ) then
    create policy notifications_own_select
      on public.notifications for select
      using (auth.uid() = user_id);
  end if;
end $$;
