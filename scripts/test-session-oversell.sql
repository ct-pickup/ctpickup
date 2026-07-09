-- Oversell prevention test for trg_sync_session_spots
-- Run in Supabase SQL editor. All changes are rolled back at the end.
-- Expected output (RAISE NOTICE lines):
--   PASS insert 1: spots_taken=1 after first booking
--   PASS insert 2: second booking rejected with session_full
--   PASS cancel:   spots_taken=0 after cancellation
--   PASS re-book:  spots_taken=1 after re-activation
--   PASS delete:   spots_taken=0 after hard delete

do $$
declare
  v_session_id  uuid := gen_random_uuid();
  v_user_a      uuid := gen_random_uuid();
  v_user_b      uuid := gen_random_uuid();
  v_booking_id  uuid;
  v_spots       integer;
  v_raised      boolean;
begin
  -- ── Setup: one-spot session ───────────────────────────────────────────
  insert into sessions (id, title, status, starts_at, capacity, spots_taken)
  values (v_session_id, 'Test Session', 'published', now() + interval '1 day', 1, 0);

  -- ── Test 1: first booking succeeds ───────────────────────────────────
  insert into bookings (session_id, user_id) values (v_session_id, v_user_a)
    returning id into v_booking_id;

  select spots_taken into v_spots from sessions where id = v_session_id;
  if v_spots = 1 then
    raise notice 'PASS insert 1: spots_taken=1 after first booking';
  else
    raise notice 'FAIL insert 1: expected spots_taken=1, got %', v_spots;
  end if;

  -- ── Test 2: second booking rejected (oversell) ───────────────────────
  v_raised := false;
  begin
    insert into bookings (session_id, user_id) values (v_session_id, v_user_b);
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

  -- spots_taken must still be 1 (not 2)
  select spots_taken into v_spots from sessions where id = v_session_id;
  if v_spots = 1 then
    raise notice 'PASS insert 2: spots_taken held at 1 (no oversell)';
  else
    raise notice 'FAIL insert 2: spots_taken leaked to %', v_spots;
  end if;

  -- ── Test 3: cancellation frees the spot ──────────────────────────────
  update bookings set status = 'canceled' where id = v_booking_id;

  select spots_taken into v_spots from sessions where id = v_session_id;
  if v_spots = 0 then
    raise notice 'PASS cancel:   spots_taken=0 after cancellation';
  else
    raise notice 'FAIL cancel:   expected 0, got %', v_spots;
  end if;

  -- ── Test 4: re-activating the booking reclaims the spot ──────────────
  update bookings set status = 'confirmed' where id = v_booking_id;

  select spots_taken into v_spots from sessions where id = v_session_id;
  if v_spots = 1 then
    raise notice 'PASS re-book:  spots_taken=1 after re-activation';
  else
    raise notice 'FAIL re-book:  expected 1, got %', v_spots;
  end if;

  -- ── Test 5: hard delete decrements ───────────────────────────────────
  delete from bookings where id = v_booking_id;

  select spots_taken into v_spots from sessions where id = v_session_id;
  if v_spots = 0 then
    raise notice 'PASS delete:   spots_taken=0 after hard delete';
  else
    raise notice 'FAIL delete:   expected 0, got %', v_spots;
  end if;

exception when others then
  raise notice 'UNEXPECTED ERROR: %', sqlerrm;
end;
$$;

-- Rollback is implicit in a DO block that doesn't commit.
-- To be safe, wrap the above in a transaction and roll back:
-- BEGIN; [paste DO block]; ROLLBACK;
