-- Team chat: one global room (slug team) + messages. Approved players only (RLS).
-- Enable Realtime on `chat_messages` in Supabase Dashboard → Database → Replication if inserts don’t stream.

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  created_at timestamptz not null default now(),
  constraint chat_rooms_slug_unique unique (slug)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  sender_display_name text not null default '',
  created_at timestamptz not null default now(),
  constraint chat_messages_body_len check (char_length(trim(body)) between 1 and 4000)
);

create index if not exists chat_messages_room_created_idx
  on public.chat_messages (room_id, created_at desc);

comment on table public.chat_rooms is 'Chat channels; MVP uses slug team for community team chat.';
comment on table public.chat_messages is 'Team chat messages; sender_display_name set by trigger from profiles.';

-- Denormalized display name so clients don’t need cross-profile reads for chat UI.
create or replace function public.chat_messages_set_sender_display()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fn text;
  ln text;
begin
  select p.first_name, p.last_name into fn, ln from public.profiles p where p.id = new.user_id;
  new.sender_display_name := trim(coalesce(fn, '') || ' ' || coalesce(ln, ''));
  if new.sender_display_name = '' then
    new.sender_display_name := 'Player';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_set_sender_display_trg on public.chat_messages;
create trigger chat_messages_set_sender_display_trg
  before insert on public.chat_messages
  for each row
  execute function public.chat_messages_set_sender_display();

insert into public.chat_rooms (slug, title)
values ('team', 'Team chat')
on conflict (slug) do nothing;

alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;

-- Approved or admin can see rooms
create policy "chat_rooms_select_approved"
  on public.chat_rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.approved = true or p.is_admin = true)
    )
  );

create policy "chat_messages_select_approved"
  on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.approved = true or p.is_admin = true)
    )
  );

create policy "chat_messages_insert_own_approved"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.approved = true or p.is_admin = true)
    )
  );

-- After migrate: Dashboard → Database → Replication → enable `chat_messages` for Realtime (insert),
-- or run once: alter publication supabase_realtime add table public.chat_messages;
