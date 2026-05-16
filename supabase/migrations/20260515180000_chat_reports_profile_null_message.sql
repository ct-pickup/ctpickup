-- Profile reports (App Store Guideline 1.2): allow reports without a chat message.

alter table public.chat_reports alter column message_id drop not null;
alter table public.chat_reports alter column room_id drop not null;

alter table public.chat_reports drop constraint if exists chat_reports_reason_check;
alter table public.chat_reports add constraint chat_reports_reason_check check (
  reason in ('harassment', 'spam', 'inappropriate', 'other', 'impersonation')
);

comment on table public.chat_reports is
  'Player-submitted chat or profile reports. Inserts go through Next.js API; admins review server-side.';
