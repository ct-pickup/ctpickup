-- ============================================================
-- Competitive Together — Instagram approval picks a starting level
--
-- Approving an Instagram request used to set player_ratings.verification
-- = 'instagram', which lifts the unverified 3.0 cap at once (see
-- 20261005000000_verification_level_instagram.sql). The admin now chooses a
-- starting level on the star scale and this function applies it:
--
--   * Seeding follows approve_verification_with_level: only while
--     star_provisional is true, score = star_level_seed_score(level), logged
--     in rating_seed_log (source 'admin').
--   * The cap is lifted only when the chosen level is above the unverified
--     cap (star_seed_unverified_cap(), 3.0). At or below it,
--     player_ratings.verification is left as it is, so the player stays
--     capped. The profile still shows as Instagram-verified; that is identity,
--     handled by the API (profiles.verification_level).
--   * star_of(), star_bands, settle_session and every gate are unchanged.
--   * Service role only.
-- ============================================================

begin;

create or replace function public.approve_instagram_with_level(
  p_user_id  uuid,
  p_level    numeric,
  p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $body$
declare
  r         player_ratings%rowtype;
  lift      boolean;
  new_score numeric;
  new_ver   verification_level;
begin
  if p_user_id is null then
    raise exception 'approve_instagram_with_level: user required';
  end if;
  if p_level is null or not exists (select 1 from star_levels where star = p_level) then
    raise exception 'approve_instagram_with_level: unknown level %', p_level;
  end if;

  insert into player_ratings (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into r from player_ratings where user_id = p_user_id for update;

  lift    := p_level > star_seed_unverified_cap();
  new_ver := case when lift then 'instagram'::verification_level else r.verification end;
  new_score := case when r.star_provisional then star_level_seed_score(p_level) else r.score end;

  update player_ratings
     set verification = new_ver, score = new_score, updated_at = now()
   where user_id = p_user_id;

  insert into rating_seed_log (user_id, actor_id, source, chosen_level, applied_level, old_score, new_score)
  values (
    p_user_id, p_admin_id, 'admin', p_level,
    case when r.star_provisional then p_level end,
    r.score, new_score
  );

  return jsonb_build_object('seeded', r.star_provisional, 'cap_lifted', lift);
end;
$body$;

revoke execute on function public.approve_instagram_with_level(uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.approve_instagram_with_level(uuid, numeric, uuid) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop function if exists public.approve_instagram_with_level(uuid, numeric, uuid);
-- commit;
-- ============================================================
