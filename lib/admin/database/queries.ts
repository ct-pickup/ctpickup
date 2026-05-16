import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminDatabaseSectionSummary, AdminDatabaseTableKey } from "@/lib/admin/database/types";

const DEFAULT_LIMIT = 50;
const MESSAGES_LIMIT = 100;

type TableQueryConfig = {
  supabaseTable: string;
  select: string;
  orderBy: string;
  ascending?: boolean;
  limit?: number;
  /** Narrow rows (e.g. profile reports only). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilter?: (q: any) => any;
};

export const ADMIN_DATABASE_TABLE_CONFIG: Record<AdminDatabaseTableKey, TableQueryConfig> = {
  runs: {
    supabaseTable: "pickup_runs",
    select:
      "id,title,status,run_type,start_at,capacity,fee_cents,admin_fee_cents,service_region,is_current,created_at,updated_at",
    orderBy: "created_at",
  },
  invites: {
    supabaseTable: "pickup_run_invites",
    select: "run_id,user_id,wave,invited_tier_rank,invited_at",
    orderBy: "invited_at",
  },
  rsvps: {
    supabaseTable: "pickup_run_rsvps",
    select: "id,run_id,user_id,status,waitlist_position,created_at,updated_at",
    orderBy: "updated_at",
  },
  results: {
    supabaseTable: "pickup_run_results",
    select: "run_id,total_teams,winning_team,player_of_day,created_at,created_by",
    orderBy: "created_at",
  },
  attendance: {
    supabaseTable: "pickup_run_attendance",
    select: "run_id,user_id,attended,updated_at",
    orderBy: "updated_at",
  },
  tournaments: {
    supabaseTable: "tournaments",
    select:
      "id,title,slug,is_active,service_region,start_at,venue,target_teams,max_teams,canceled_at,created_at,updated_at",
    orderBy: "created_at",
  },
  roster: {
    supabaseTable: "tournament_roster",
    select: "id,tournament_id,captain_id,user_id,status,invited_at,responded_at",
    orderBy: "invited_at",
  },
  tournament_payments: {
    supabaseTable: "tournament_payments",
    select:
      "id,tournament_id,captain_id,method,amount_cents,players_count,status,stripe_session_id,refund_id,created_at",
    orderBy: "created_at",
  },
  matches: {
    supabaseTable: "tournament_matches",
    select:
      "id,tournament_id,stage,match_number,group_name,team_a_id,team_b_id,score_a,score_b,winner_id,completed_at",
    orderBy: "match_number",
  },
  mvp_votes: {
    supabaseTable: "tournament_mvp_votes",
    select: "id,match_id,voter_user_id,voted_for_name,created_at",
    orderBy: "created_at",
  },
  profiles: {
    supabaseTable: "profiles",
    select:
      "id,first_name,last_name,username,instagram,tier,tier_rank,approved,is_banned,nearest_venue,created_at,updated_at",
    orderBy: "created_at",
    applyFilter: (q) => q.eq("approved", true),
  },
  reports: {
    supabaseTable: "chat_reports",
    select: "id,reporter_user_id,reported_user_id,reason,message_id,room_id,created_at",
    orderBy: "created_at",
    applyFilter: (q) => q.is("message_id", null),
  },
  blocks: {
    supabaseTable: "chat_blocks",
    select: "id,blocker_user_id,blocked_user_id,created_at",
    orderBy: "created_at",
  },
  follows: {
    supabaseTable: "player_follows",
    select: "id,follower_id,following_id,created_at",
    orderBy: "created_at",
  },
  push_devices: {
    supabaseTable: "user_push_devices",
    select: "id,user_id,expo_push_token,platform,updated_at",
    orderBy: "updated_at",
  },
  rooms: {
    supabaseTable: "chat_rooms",
    select: "id,slug,room_type,title,is_active,run_id,tournament_id,created_at",
    orderBy: "created_at",
  },
  messages: {
    supabaseTable: "chat_messages",
    select: "id,room_id,user_id,body,sender_is_admin,created_at",
    orderBy: "created_at",
    limit: MESSAGES_LIMIT,
  },
  reactions: {
    supabaseTable: "chat_reactions",
    select: "id,message_id,user_id,emoji,created_at",
    orderBy: "created_at",
  },
  chat_reports: {
    supabaseTable: "chat_reports",
    select: "id,reporter_user_id,reported_user_id,reason,message_id,room_id,created_at",
    orderBy: "created_at",
    applyFilter: (q) => q.not("message_id", "is", null),
  },
  platform_payments: {
    supabaseTable: "platform_payments",
    select:
      "id,product_type,product_entity_id,user_id,title,amount_cents,currency,lifecycle_status,fulfillment_status,created_at,updated_at",
    orderBy: "created_at",
  },
};

const TIMESTAMP_FIELDS = [
  "updated_at",
  "created_at",
  "invited_at",
  "responded_at",
  "start_at",
  "completed_at",
] as const;

function rowLatestMs(row: Record<string, unknown>, orderBy: string): number {
  let best = 0;
  const fields = orderBy ? [orderBy, ...TIMESTAMP_FIELDS] : [...TIMESTAMP_FIELDS];
  const seen = new Set<string>();
  for (const col of fields) {
    if (seen.has(col)) continue;
    seen.add(col);
    const raw = row[col];
    if (raw == null) continue;
    const ms = Date.parse(String(raw));
    if (Number.isFinite(ms) && ms > best) best = ms;
  }
  return best;
}

function latestTimestampFromRows(rows: Record<string, unknown>[], config: TableQueryConfig): string | null {
  if (!rows.length) return null;
  let best = 0;
  for (const row of rows) {
    const t = rowLatestMs(row, config.orderBy);
    if (t > best) best = t;
  }
  return best > 0 ? new Date(best).toISOString() : null;
}

async function fetchTableSummary(
  admin: SupabaseClient,
  key: AdminDatabaseTableKey,
): Promise<AdminDatabaseSectionSummary> {
  const config = ADMIN_DATABASE_TABLE_CONFIG[key];
  let countQ = admin.from(config.supabaseTable).select("id", { count: "exact", head: true });
  if (config.applyFilter) countQ = config.applyFilter(countQ) as typeof countQ;

  const countRes = await countQ;
  if (countRes.error) {
    throw new Error(countRes.error.message);
  }

  let latestQ = admin.from(config.supabaseTable).select(config.select.split(",")[0] ?? "id");
  if (config.applyFilter) latestQ = config.applyFilter(latestQ) as typeof latestQ;
  latestQ = latestQ.order(config.orderBy, { ascending: false }).limit(1);

  const latestRes = await latestQ;
  if (latestRes.error) {
    throw new Error(latestRes.error.message);
  }

  const row = (latestRes.data?.[0] ?? null) as unknown as Record<string, unknown> | null;
  const last_updated = row ? latestTimestampFromRows([row], config) : null;

  return {
    total_count: countRes.count ?? 0,
    last_updated,
  };
}

export async function fetchAdminDatabaseOverview(
  admin: SupabaseClient,
  keys: AdminDatabaseTableKey[],
): Promise<Record<AdminDatabaseTableKey, AdminDatabaseSectionSummary>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        const summary = await fetchTableSummary(admin, key);
        return [key, summary] as const;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[admin/database] overview ${key}:`, msg);
        return [key, { total_count: 0, last_updated: null }] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<AdminDatabaseTableKey, AdminDatabaseSectionSummary>;
}

export async function fetchAdminDatabaseTable(
  admin: SupabaseClient,
  key: AdminDatabaseTableKey,
): Promise<{ summary: AdminDatabaseSectionSummary; records: Record<string, unknown>[] }> {
  const config = ADMIN_DATABASE_TABLE_CONFIG[key];
  const limit = config.limit ?? DEFAULT_LIMIT;

  let dataQ = admin.from(config.supabaseTable).select(config.select);
  if (config.applyFilter) dataQ = config.applyFilter(dataQ) as typeof dataQ;
  dataQ = dataQ.order(config.orderBy, { ascending: config.ascending ?? false }).limit(limit);

  const dataRes = await dataQ;
  if (dataRes.error) {
    throw new Error(dataRes.error.message);
  }

  const records = (dataRes.data ?? []) as unknown as Record<string, unknown>[];
  const summary = await fetchTableSummary(admin, key);
  const rowLatest = latestTimestampFromRows(records, config);
  if (rowLatest && (!summary.last_updated || Date.parse(rowLatest) > Date.parse(summary.last_updated))) {
    summary.last_updated = rowLatest;
  }

  return { summary, records };
}
