-- Oversell prevention test for trg_sync_pickup_run_spots
-- Run in Supabase SQL editor. Wrap in BEGIN/ROLLBACK to leave schema clean.
-- Expected RAISE NOTICE output:
--   PASS insert 1: spots_taken=1 after first booking
--   PASS insert 2: second booking rejected with session_full
--   PASS insert 2: spots_taken held at 1 (no oversell)
--   PASS cancel:   spots_taken=0 after cancellation
--   PASS re-book:  spots_taken=1 after re-activation
--   PASS delete:   spots_taken=0 after hard delete

begin;

do $$
declare
  v_run_id    uuid := gen_random_uuid();
  v_user_a    uuid := gen_random_uuid();
  v_user_b    uuid := gen_random_uuid();
  v_rsvp_id   uuid;
  v_spots     integer;
  v_raised    boolean;
begin
  -- ── Setup: one-spot run ──────────────────────────────────────────────────
  insert into public.pickup_runs (
    id, title, status, start_at, capacity, spots_taken,
    run_type, service_region, fee_cents
  ) values (
    v_run_id, 'Test Run', 'active', now() + interval '1 day', 1, 0,
    '7v7', 'CT', 1500
  );

  -- ── Test 1: first RSVP succeeds ─────────────────────────────────────────
  insert into public.pickup_run_rsvps (run_id, user_id, status)
  values (v_run_id, v_user_a, 'confirmed')
  returning id into v_rsvp_id;

  select spots_taken into v_spots from public.pickup_runs where id = v_run_id;
  if v_spots = 1 then
    raise notice 'PASS insert 1: spots_taken=1 after first booking';
  else
    raise notice 'FAIL insert 1: expected spots_taken=1, got %', v_spots;
  end if;

  -- ── Test 2: second RSVP rejected (oversell) ─────────────────────────────
  v_raised := false;
  begin
    insert into public.pickup_run_rsvps (run_id, user_id, status)
    values (v_run_id, v_user_b, 'confirmed');
  exception when others then
    v_raised := true;
    if sqlerrm like '%session_full%' then
      raise notice 'PASS insert 2: second booking rejected with session_full';
    else
      raise notice 'FAIL insert 2: wrong error: %', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise notice 'FAIL insert 2: expected exception, none raised';
  end if;

  select spots_taken into v_spots from public.pickup_runs where id = v_run_id;
  if v_spots = 1 then
    raise notice 'PASS insert 2: spots_taken held at 1 (no oversell)';
  else
    raise notice 'FAIL insert 2: spots_taken leaked to %', v_spots;
  end if;

  -- ── Test 3: cancellation frees the spot ─────────────────────────────────
  update public.pickup_run_rsvps set status = 'canceled' where id = v_rsvp_id;

  select spots_taken into v_spots from public.pickup_runs where id = v_run_id;
  if v_spots = 0 then
    raise notice 'PASS cancel:   spots_taken=0 after cancellation';
  else
    raise notice 'FAIL cancel:   expected 0, got %', v_spots;
  end if;

  -- ── Test 4: re-confirming reclaims the spot ──────────────────────────────
  update public.pickup_run_rsvps set status = 'confirmed' where id = v_rsvp_id;

  select spots_taken into v_spots from public.pickup_runs where id = v_run_id;
  if v_spots = 1 then
    raise notice 'PASS re-book:  spots_taken=1 after re-activation';
  else
    raise notice 'FAIL re-book:  expected 1, got %', v_spots;
  end if;

  -- ── Test 5: hard delete decrements ──────────────────────────────────────
  delete from public.pickup_run_rsvps where id = v_rsvp_id;

  select spots_taken into v_spots from public.pickup_runs where id = v_run_id;
  if v_spots = 0 then
    raise notice 'PASS delete:   spots_taken=0 after hard delete';
  else
    raise notice 'FAIL delete:   expected 0, got %', v_spots;
  end if;

exception when others then
  raise notice 'UNEXPECTED ERROR: %', sqlerrm;
end;
$$;

rollback;
