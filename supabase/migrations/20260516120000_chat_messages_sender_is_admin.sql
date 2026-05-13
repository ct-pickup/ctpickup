-- Denormalize sender admin flag on chat_messages (same insert trigger as display name).

alter table public.chat_messages
  add column if not exists sender_is_admin boolean not null default false;

comment on column public.chat_messages.sender_is_admin is 'Mirrors profiles.is_admin at insert time; used by clients for staff avatar initial.';

update public.chat_messages cm
set sender_is_admin = coalesce(p.is_admin, false)
from public.profiles p
where p.id = cm.user_id;

create or replace function public.chat_messages_set_sender_display()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fn text;
  ln text;
  adm boolean;
begin
  select p.first_name, p.last_name, coalesce(p.is_admin, false)
    into fn, ln, adm
  from public.profiles p
  where p.id = new.user_id;

  new.sender_display_name := trim(coalesce(fn, '') || ' ' || coalesce(ln, ''));
  if new.sender_display_name = '' then
    new.sender_display_name := 'Player';
  end if;

  new.sender_is_admin := coalesce(adm, false);
  return new;
end;
$$;
