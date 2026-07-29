import { describe, expect, it } from "vitest";
import {
  asAwardUserId,
  resolveAwardUserIdFromBody,
  resolveSessionResultAwards,
} from "@/lib/pickup/sessionResultAwards";

describe("asAwardUserId", () => {
  it("accepts uuid strings and nested objects", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(asAwardUserId(id)).toBe(id);
    expect(asAwardUserId({ user_id: id })).toBe(id);
    expect(asAwardUserId({ id })).toBe(id);
    expect(asAwardUserId(null)).toBeNull();
    expect(asAwardUserId("")).toBeNull();
    expect(asAwardUserId("not-a-uuid")).toBeNull();
  });
});

describe("resolveSessionResultAwards", () => {
  const uid = "11111111-2222-4333-8444-555555555555";

  it("reads player_of_the_day (mobile client field)", () => {
    const awards = resolveSessionResultAwards({ player_of_the_day: uid });
    expect(awards.player_of_day).toBe(uid);
  });

  it("reads player_of_day (short field name)", () => {
    const awards = resolveSessionResultAwards({ player_of_day: uid });
    expect(awards.player_of_day).toBe(uid);
  });

  it("prefers the_day variant when both are present", () => {
    const a = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const b = "11111111-2222-4333-8444-555555555555";
    expect(resolveAwardUserIdFromBody({ player_of_the_day: a, player_of_day: b }, "player_of_the_day", "player_of_day")).toBe(
      a,
    );
  });

  it("resolves all positional award fields", () => {
    const awards = resolveSessionResultAwards({
      player_of_the_day: uid,
      defender_of_day: uid,
      midfielder_of_the_day: uid,
      attacker_of_day: uid,
      goalie_of_the_day: uid,
    });
    expect(awards).toEqual({
      player_of_day: uid,
      defender_of_day: uid,
      midfielder_of_day: uid,
      attacker_of_day: uid,
      goalie_of_the_day: uid,
    });
  });
});
