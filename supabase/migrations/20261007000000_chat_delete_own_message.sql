-- Let players delete their own chat messages (hard delete).
--
-- Today only admins can delete: 20260503193000_chat_room_controls.sql creates
-- "chat_messages_delete_admin_only" and nothing else grants DELETE. This adds a second, additive
-- policy for the sender. The admin policy is untouched.
--
-- chat_messages has no deleted_at column, so this is a real delete. chat_reports.message_id and
-- chat_reactions.message_id cascade on delete, so a reported message would take its report with it.
-- To keep that evidence, a sender cannot delete a message that has a report on it; admins still can.
-- The check is a SECURITY DEFINER function because chat_reports is readable by admins only.

begin;

create or replace function public.chat_message_has_report(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_reports r where r.message_id = p_message_id);
$$;

revoke execute on function public.chat_message_has_report(uuid) from public, anon;
grant execute on function public.chat_message_has_report(uuid) to authenticated;

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and not public.chat_message_has_report(id)
  );

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop policy if exists "chat_messages_delete_own" on public.chat_messages;
-- drop function if exists public.chat_message_has_report(uuid);
-- commit;
-- ============================================================
