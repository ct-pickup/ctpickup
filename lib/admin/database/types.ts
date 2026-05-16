/** Query param values for GET /api/admin/database?table= */
export const ADMIN_DATABASE_TABLE_KEYS = [
  "runs",
  "invites",
  "rsvps",
  "results",
  "attendance",
  "tournaments",
  "roster",
  "tournament_payments",
  "matches",
  "mvp_votes",
  "profiles",
  "reports",
  "blocks",
  "follows",
  "push_devices",
  "rooms",
  "messages",
  "reactions",
  "chat_reports",
  "platform_payments",
] as const;

export type AdminDatabaseTableKey = (typeof ADMIN_DATABASE_TABLE_KEYS)[number];

export function isAdminDatabaseTableKey(v: string): v is AdminDatabaseTableKey {
  return (ADMIN_DATABASE_TABLE_KEYS as readonly string[]).includes(v);
}

export type AdminDatabaseSectionSummary = {
  total_count: number;
  last_updated: string | null;
};

export type AdminDatabaseOverviewResponse = {
  sections: Record<AdminDatabaseTableKey, AdminDatabaseSectionSummary>;
};

export type AdminDatabaseTableResponse = {
  table: AdminDatabaseTableKey;
  total_count: number;
  last_updated: string | null;
  records: Record<string, unknown>[];
};
