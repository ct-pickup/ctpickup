-- ============================================================
-- CT Pickup — Star levels with meaning (2 of 2): seed functions
--
-- Service role only. The API authenticates the caller and passes
-- their id; players can never write player_ratings.score themselves.
--
--   * star_level_seed_score(star): midpoint of the star's band in
--     star_bands ((lower + coalesce(upper, 100)) / 2). Midpoints sit at
--     least 3 points inside each band, so the star trigger's hysteresis
--     margin (1.0) always lands the player on the chosen star.
--   * Unverified cap: verification = 'self' caps the seed at the highest
--     band without requires_verified (3.0), the same gate star_of()
--     uses. Any other verification value ('document', 'vouched',
--     'instagram', future values) counts as verified, as in star_of().
--     The reliability gate on 4.5/5.0 is left to the star trigger.
--   * Seeding only happens while player_ratings.star_provisional is
--     true (fewer than star_provisional_events() rated games), so a
--     real rating can never be reset.
--   * seed_star_level_from_signup: stores profiles.stated_level, then
--     seeds if provisional and no admin has picked a level yet (an
--     admin's verified pick wins). Logs only when it seeds.
--   * approve_verification_with_level: approves a pending document
--     request, sets 'document' on profiles and player_ratings, and
--     re-seeds to the chosen level if still provisional. Always logs
--     the admin's choice. A null level (admin builds older than the
--     level picker) only sets verification and logs nothing. Runs as the function owner with the service
--     role JWT, so profiles_guard_verification lets the write through.
--   * Instagram approval (app/api/admin/instagram-verification) proves
--     identity, not level, and does not seed.
-- ============================================================

begin;

create or replace function public.star_level_seed_score(p_star numeric)
returns numeric
language sql stable security definer set search_path = public as $body$
  select (b.lower + coalesce(b.upper, 100)) / 2
    from star_bands b
    join star_levels l on l.star = b.star
   where b.star = p_star;
$body$;

create or replace function public.star_seed_unverified_cap()
returns numeric
language sql stable security definer set search_path = public as $body$
  select max(b.star) from star_bands b where not b.requires_verified;
$body$;

-- ------------------------------------------------------------
-- Signup / onboarding.
-- ------------------------------------------------------------
create or replace function public.seed_star_level_from_signup(p_user_id uuid, p_level numeric)
returns jsonb
language plpgsql security definer set search_path = public as $body$
declare
  r         player_ratings%rowtype;
  applied   numeric;
  new_score numeric;
begin
  if p_user_id is null then
    raise exception 'seed_star_level_from_signup: user required';
  end if;
  if not exists (select 1 from star_levels where star = p_level) then
    raise exception 'seed_star_level_from_signup: unknown level %', p_level;
  end if;

  update profiles
     set stated_level = p_level, stated_level_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'seed_star_level_from_signup: no profile for %', p_user_id;
  end if;

  insert into player_ratings (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into r from player_ratings where user_id = p_user_id for update;

  if not r.star_provisional
     or exists (select 1 from rating_seed_log l where l.user_id = p_user_id and l.source = 'admin') then
    return jsonb_build_object('seeded', false);
  end if;

  applied := case when r.verification = 'self' then least(p_level, star_seed_unverified_cap()) else p_level end;
  new_score := star_level_seed_score(applied);

  update player_ratings
     set score = new_score, updated_at = now()
   where user_id = p_user_id;

  insert into rating_seed_log (user_id, actor_id, source, chosen_level, applied_level, old_score, new_score)
  values (p_user_id, p_user_id, 'signup', p_level, applied, r.score, new_score);

  return jsonb_build_object('seeded', true);
end;
$body$;

-- ------------------------------------------------------------
-- Admin document approval.
-- ------------------------------------------------------------
create or replace function public.approve_verification_with_level(
  p_request_id uuid,
  p_level      numeric,
  p_admin_id   uuid
) returns jsonb
language plpgsql security definer set search_path = public as $body$
declare
  vr        verification_requests%rowtype;
  r         player_ratings%rowtype;
  new_score numeric;
begin
  if p_level is not null and not exists (select 1 from star_levels where star = p_level) then
    raise exception 'approve_verification_with_level: unknown level %', p_level;
  end if;

  select * into vr from verification_requests where id = p_request_id for update;
  if not found then
    raise exception 'approve_verification_with_level: no request %', p_request_id;
  end if;
  if vr.status <> 'pending' then
    raise exception 'approve_verification_with_level: request already %', vr.status;
  end if;

  update verification_requests
     set status = 'approved', approved_level = p_level, reviewed_by = p_admin_id, reviewed_at = now()
   where id = p_request_id;

  update profiles set verification_level = 'document' where id = vr.user_id;

  insert into player_ratings (user_id) values (vr.user_id) on conflict (user_id) do nothing;
  select * into r from player_ratings where user_id = vr.user_id for update;

  new_score := case when r.star_provisional and p_level is not null then star_level_seed_score(p_level) else r.score end;

  update player_ratings
     set verification = 'document', score = new_score, updated_at = now()
   where user_id = vr.user_id;

  if p_level is null then
    return jsonb_build_object('seeded', false);
  end if;

  insert into rating_seed_log (
    user_id, actor_id, source, chosen_level, applied_level, old_score, new_score, verification_request_id
  ) values (
    vr.user_id, p_admin_id, 'admin', p_level,
    case when r.star_provisional then p_level end,
    r.score, new_score, p_request_id
  );

  return jsonb_build_object('seeded', r.star_provisional);
end;
$body$;

revoke execute on function public.star_level_seed_score(numeric) from public, anon, authenticated;
revoke execute on function public.star_seed_unverified_cap() from public, anon, authenticated;
revoke execute on function public.seed_star_level_from_signup(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.approve_verification_with_level(uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.seed_star_level_from_signup(uuid, numeric) to service_role;
grant execute on function public.approve_verification_with_level(uuid, numeric, uuid) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop function if exists public.approve_verification_with_level(uuid, numeric, uuid);
-- drop function if exists public.seed_star_level_from_signup(uuid, numeric);
-- drop function if exists public.star_seed_unverified_cap();
-- drop function if exists public.star_level_seed_score(numeric);
-- commit;
-- ============================================================
