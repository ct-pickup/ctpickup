/**
 * Dev-only preview data for Home and session detail.
 * Only require() this module inside a `__DEV__` branch so production bundles drop it and its images.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro image assets */
import { Image } from "react-native";

export const FIXTURE_ID_PREFIX = "fixture-";

export type FixturePerson = {
  user_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  star: number | null;
  playing_position: string | null;
};

export type FixtureRun = {
  id: string;
  title: string;
  start_at: string;
  location_text: string;
  latitude: number;
  longitude: number;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  format: string;
  run_type: string;
  status: string;
  min_star: number | null;
  photo: string;
  host: FixturePerson;
  going: FixturePerson[];
};

const PHOTOS = {
  hartford: require("./images/field-hartford.jpg") as number,
  westHartford: require("./images/field-west-hartford.jpg") as number,
  glastonbury: require("./images/field-glastonbury.jpg") as number,
  newHaven: require("./images/field-new-haven.jpg") as number,
};

function photoUri(asset: number): string {
  return Image.resolveAssetSource(asset).uri;
}

function person(
  id: string,
  first_name: string,
  last_name: string,
  star: number | null,
  playing_position: string | null,
): FixturePerson {
  return { user_id: `${FIXTURE_ID_PREFIX}user-${id}`, first_name, last_name, avatar_url: null, star, playing_position };
}

const PEOPLE = {
  marcus: person("marcus", "Marcus", "Bell", 4.5, "Midfielder"),
  diego: person("diego", "Diego", "Alvarez", 4, "Attacker"),
  priya: person("priya", "Priya", "Shah", 3.5, "Defender"),
  kofi: person("kofi", "Kofi", "Mensah", 4.5, "Midfielder"),
  liam: person("liam", "Liam", "O'Connor", 3, "Goalkeeper"),
  sam: person("sam", "Sam", "Rivera", 3.5, "Attacker"),
  ava: person("ava", "Ava", "Kowalski", 4, "Defender"),
  noah: person("noah", "Noah", "Brennan", null, "Midfielder"),
  chris: person("chris", "Chris", "DeLuca", 4, "Defender"),
  elena: person("elena", "Elena", "Russo", 3.5, "Midfielder"),
};

/** Local time `days` from today at `hour:minute`, as ISO. */
function at(days: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function buildRuns(): { upNext: FixtureRun; nearby: FixtureRun[] } {
  const upNext: FixtureRun = {
    id: `${FIXTURE_ID_PREFIX}colt-park`,
    title: "Thursday night 7v7",
    start_at: at(1, 18, 30),
    location_text: "Colt Park, Hartford",
    latitude: 41.7524,
    longitude: -72.6676,
    capacity: 14,
    spots_taken: 11,
    fee_cents: 800,
    format: "7v7",
    run_type: "public",
    status: "likely_on",
    min_star: 3,
    photo: photoUri(PHOTOS.hartford),
    host: PEOPLE.chris,
    going: [PEOPLE.marcus, PEOPLE.diego, PEOPLE.priya, PEOPLE.sam, PEOPLE.ava, PEOPLE.noah, PEOPLE.elena],
  };
  const nearby: FixtureRun[] = [
    {
      id: `${FIXTURE_ID_PREFIX}fernridge-park`,
      title: "After work 6v6",
      start_at: at(2, 18, 0),
      location_text: "Fernridge Park, West Hartford",
      latitude: 41.7712,
      longitude: -72.7645,
      capacity: 12,
      spots_taken: 6,
      fee_cents: 600,
      format: "6v6",
      run_type: "public",
      status: "planning",
      min_star: null,
      photo: photoUri(PHOTOS.westHartford),
      host: PEOPLE.ava,
      going: [PEOPLE.ava, PEOPLE.kofi, PEOPLE.liam, PEOPLE.sam],
    },
    {
      id: `${FIXTURE_ID_PREFIX}addison-park`,
      title: "Saturday morning run",
      start_at: at(3, 9, 0),
      location_text: "Addison Park, Glastonbury",
      latitude: 41.7179,
      longitude: -72.5803,
      capacity: 16,
      spots_taken: 14,
      fee_cents: 0,
      format: "8v8",
      run_type: "public",
      status: "likely_on",
      min_star: null,
      photo: photoUri(PHOTOS.glastonbury),
      host: PEOPLE.kofi,
      going: [PEOPLE.kofi, PEOPLE.marcus, PEOPLE.elena, PEOPLE.noah, PEOPLE.priya],
    },
    {
      id: `${FIXTURE_ID_PREFIX}edgewood-park`,
      title: "Sunday 7v7",
      start_at: at(4, 10, 30),
      location_text: "Edgewood Park, New Haven",
      latitude: 41.3117,
      longitude: -72.9529,
      capacity: 14,
      spots_taken: 5,
      fee_cents: 1000,
      format: "7v7",
      run_type: "public",
      status: "planning",
      min_star: 3.5,
      photo: photoUri(PHOTOS.newHaven),
      host: PEOPLE.diego,
      going: [PEOPLE.diego, PEOPLE.liam, PEOPLE.chris],
    },
  ];
  return { upNext, nearby };
}

function playedWith(people: FixturePerson[]) {
  return { count: people.length, people: people.slice(0, 3).map((p) => ({ first_name: p.first_name, avatar_url: p.avatar_url })) };
}

/** Played-with summaries per fixture run (viewer "Jordan" has played with these people). */
function playedWithByRun(): Record<string, ReturnType<typeof playedWith>> {
  return {
    [`${FIXTURE_ID_PREFIX}colt-park`]: playedWith([PEOPLE.marcus, PEOPLE.diego, PEOPLE.priya, PEOPLE.sam]),
    [`${FIXTURE_ID_PREFIX}fernridge-park`]: playedWith([PEOPLE.kofi, PEOPLE.liam]),
    [`${FIXTURE_ID_PREFIX}addison-park`]: playedWith([PEOPLE.elena]),
  };
}

const REASONS: Record<string, string[]> = {
  [`${FIXTURE_ID_PREFIX}fernridge-park`]: ["At your level", "2 you've played with"],
  [`${FIXTURE_ID_PREFIX}addison-park`]: ["Needs a CB", "Your usual morning"],
  [`${FIXTURE_ID_PREFIX}edgewood-park`]: ["At your level", "38 min away"],
};

function home() {
  const { upNext, nearby } = buildRuns();
  const pw = playedWithByRun();
  return {
    firstName: "Jordan",
    homeZip: "06107",
    maxDriveMinutes: 50,
    upNext,
    nearby,
    playedWith: pw,
    bestGames: nearby
      .filter((r) => REASONS[r.id])
      .map((r) => ({ ...r, reasons: REASONS[r.id]!, played_with: pw[r.id] ?? { count: 0, people: [] } })),
  };
}

function fillCandidates() {
  const c = (first_name: string, last_initial: string, stars: number | null, position: string, town: string, invited = false) => ({
    invite_token: `${FIXTURE_ID_PREFIX}invite-${first_name.toLowerCase()}`,
    first_name,
    last_initial,
    stars,
    position,
    town,
    invited,
  });
  return {
    candidates: [
      c("Jude", "P", 3.5, "CB", "West Hartford"),
      c("Dylan", "M", 3, "CM", "Hartford", true),
      c("Rosa", "T", null, "ST", "Wethersfield"),
      c("Omar", "K", 4, "GK", "Newington"),
    ],
    invites_available: true,
    invites_sent: 1,
    invite_limit: 20,
  };
}

function session(id: string) {
  if (!id.startsWith(FIXTURE_ID_PREFIX)) return null;
  const { upNext, nearby } = buildRuns();
  const run = [upNext, ...nearby].find((r) => r.id === id);
  if (!run) return null;
  return {
    run: {
      id: run.id,
      title: run.title,
      location_text: run.location_text,
      latitude: run.latitude,
      longitude: run.longitude,
      start_at: run.start_at,
      capacity: run.capacity,
      spots_taken: run.spots_taken,
      fee_cents: run.fee_cents,
      level: null,
      open_tier_rank: null,
      run_type: run.run_type,
      format: run.format,
      status: run.status,
      created_by: run.host.user_id,
      service_region: "CT",
      tier_session_id: null,
      tiered_pricing: false,
    },
    attendees: run.going.map((p) => ({
      user_id: p.user_id,
      status: "confirmed",
      profiles: {
        first_name: p.first_name,
        last_name: p.last_name,
        username: null,
        playing_position: p.playing_position,
        avatar_url: p.avatar_url,
      },
    })),
    host: {
      id: run.host.user_id,
      first_name: run.host.first_name,
      last_name: run.host.last_name,
      username: null,
      avatar_url: run.host.avatar_url,
    },
    hostScore: 92,
    stars: new Map(run.going.filter((p) => p.star != null).map((p) => [p.user_id, p.star as number])),
    minStar: run.min_star,
    photo: run.photo,
    playedWith: playedWithByRun()[run.id] ?? null,
    /** Previews the host-only card on one run; the fixture viewer is not really the host. */
    fill: run.id === `${FIXTURE_ID_PREFIX}fernridge-park` ? fillCandidates() : null,
  };
}

const devFixtures = { home, session };

export type DevFixtures = typeof devFixtures;

export default devFixtures;
