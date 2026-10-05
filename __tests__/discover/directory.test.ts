import { describe, expect, it } from "vitest";

import { driveBucketFor, pageDirectory, parseDirectoryQuery, type DirectoryEntry, type DirectoryQuery } from "@/lib/discover/directory";
import { DIRECTORY_MAX_OFFSET, DIRECTORY_PAGE_SIZE } from "@/shared/discover";

const q = (over: Partial<DirectoryQuery> = {}): DirectoryQuery => ({ position: null, minStar: null, maxStar: null, maxDriveMinutes: null, offset: 0, ...over });

function entry(id: string, over: { name?: string; star?: number | null; position?: string | null; drive?: number | null } = {}): DirectoryEntry {
  return {
    drive: over.drive === undefined ? 10 : over.drive,
    player: {
      id,
      name: over.name ?? `Player ${id}`,
      avatarUrl: "https://x/p.jpg",
      star: over.star === undefined ? 3 : over.star,
      levelName: "Competitive",
      position: over.position === undefined ? "CB" : over.position,
      town: "Westport",
      driveBucket: driveBucketFor(over.drive),
    },
  };
}

const parse = (s: string) => parseDirectoryQuery(new URLSearchParams(s));

describe("parseDirectoryQuery", () => {
  it("accepts an empty query and valid filters", () => {
    expect(parse("")).toEqual({ ok: true, query: q() });
    expect(parse("position=CB&min_star=2&max_star=3.5&max_drive=30&cursor=40")).toEqual({
      ok: true,
      query: q({ position: "CB", minStar: 2, maxStar: 3.5, maxDriveMinutes: 30, offset: 40 }),
    });
  });
  it("rejects bad values with an error instead of ignoring them", () => {
    for (const s of ["min_star=0", "min_star=2.7", "max_star=5.5", "min_star=4&max_star=2", "max_drive=20", "max_drive=60", "max_drive=0", "max_drive=14.5", "max_drive=abc", "cursor=-1", "cursor=1.5", `cursor=${DIRECTORY_MAX_OFFSET + 1}`]) {
      expect(parse(s).ok, s).toBe(false);
    }
  });
});

describe("pageDirectory", () => {
  const many = Array.from({ length: 45 }, (_, i) => entry(String(i).padStart(2, "0"), { drive: i }));

  it("pages in order, nearest range first, with a cursor until the end", () => {
    const p1 = pageDirectory(many, q());
    expect(p1.players).toHaveLength(DIRECTORY_PAGE_SIZE);
    expect(p1.players[0]?.id).toBe("00");
    expect(p1.nextCursor).toBe("20");
    const p3 = pageDirectory(many, q({ offset: 40 }));
    expect(p3.players).toHaveLength(5);
    expect(p3.nextCursor).toBeNull();
  });

  it("filters by position, including a broad group", () => {
    const list = [entry("a", { position: "CB" }), entry("b", { position: "ST" }), entry("c", { position: "CM" }), entry("d", { position: "Midfielder" })];
    expect(pageDirectory(list, q({ position: "CB" })).players.map((p) => p.id)).toEqual(["a"]);
    expect(pageDirectory(list, q({ position: "Midfielder" })).players.map((p) => p.id).sort()).toEqual(["c", "d"]);
  });

  it("filters by half-star range; unrated players are left out of a level filter", () => {
    const list = [entry("low", { star: 1 }), entry("mid", { star: 3.5 }), entry("top", { star: 5 }), entry("none", { star: null })];
    expect(pageDirectory(list, q({ minStar: 3, maxStar: 4 })).players.map((p) => p.id)).toEqual(["mid"]);
    expect(pageDirectory(list, q()).players).toHaveLength(4);
  });

  it("filters by drive time; unknown distance is left out of a distance filter", () => {
    const list = [entry("near", { drive: 10 }), entry("far", { drive: 50 }), entry("unknown", { drive: null })];
    expect(pageDirectory(list, q({ maxDriveMinutes: 30 })).players.map((p) => p.id)).toEqual(["near"]);
    expect(pageDirectory(list, q()).players.map((p) => p.id)).toEqual(["near", "far", "unknown"]);
  });

  it("returns only safe fields", () => {
    const [p] = pageDirectory([entry("a")], q()).players;
    expect(Object.keys(p!).sort()).toEqual(["avatarUrl", "driveBucket", "id", "levelName", "name", "position", "star", "town"]);
    expect(JSON.stringify(p)).not.toMatch(/driveMinutes|email|phone|instagram|zip|score/i);
  });
});

describe("driveBucketFor", () => {
  it("puts a drive time in its range", () => {
    expect(driveBucketFor(0)).toBe("under_15");
    expect(driveBucketFor(14.9)).toBe("under_15");
    expect(driveBucketFor(15)).toBe("15_30");
    expect(driveBucketFor(29.9)).toBe("15_30");
    expect(driveBucketFor(30)).toBe("30_45");
    expect(driveBucketFor(44.9)).toBe("30_45");
    expect(driveBucketFor(45)).toBe("45_plus");
    expect(driveBucketFor(300)).toBe("45_plus");
  });
  it("is null for an unknown or invalid time", () => {
    for (const v of [null, undefined, NaN, -1]) expect(driveBucketFor(v as number | null)).toBeNull();
  });
});

describe("distance never leaks as an exact number", () => {
  it("orders by range then name, so order within a range says nothing about distance", () => {
    const list = [entry("z", { name: "Zed", drive: 5 }), entry("a", { name: "Amy", drive: 12 }), entry("m", { name: "Max", drive: 20 }), entry("n", { name: "Nia", drive: null })];
    expect(pageDirectory(list, q()).players.map((p) => p.name)).toEqual(["Amy", "Zed", "Max", "Nia"]);
  });
  it("still filters on the exact value server-side", () => {
    const list = [entry("a", { drive: 14 }), entry("b", { drive: 29 }), entry("c", { drive: 31 })];
    expect(pageDirectory(list, q({ maxDriveMinutes: 30 })).players.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("only accepts 15, 30, 45 or none", () => {
    for (const v of [15, 30, 45]) expect(parse(`max_drive=${v}`).ok).toBe(true);
    expect(parse("").ok).toBe(true);
    expect(parse("max_drive=60").ok).toBe(false);
  });
});
