import { describe, expect, it } from "vitest";

import { pageDirectory, parseDirectoryQuery, type DirectoryEntry, type DirectoryQuery } from "@/lib/discover/directory";
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
      driveMinutes: over.drive ?? null,
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
    for (const s of ["min_star=0", "min_star=2.7", "max_star=5.5", "min_star=4&max_star=2", "max_drive=20", "max_drive=abc", "cursor=-1", "cursor=1.5", `cursor=${DIRECTORY_MAX_OFFSET + 1}`]) {
      expect(parse(s).ok, s).toBe(false);
    }
  });
});

describe("pageDirectory", () => {
  const many = Array.from({ length: 45 }, (_, i) => entry(String(i).padStart(2, "0"), { drive: i }));

  it("pages in order, nearest first, with a cursor until the end", () => {
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
    expect(Object.keys(p!).sort()).toEqual(["avatarUrl", "driveMinutes", "id", "levelName", "name", "position", "star", "town"]);
  });
});
