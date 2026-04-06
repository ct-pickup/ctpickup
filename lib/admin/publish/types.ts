import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishChannel = "site_status" | "pickup_global" | "pickup_run" | "tournament_active";

export type PublishTargetsInput = {
  siteStatus?: boolean;
  pickupGlobal?: boolean;
  /** Specific pickup runs (inserts one pickup_run_updates row each). */
  pickupRunIds?: string[];
  /** Writes to the currently active tournament row. */
  tournamentActive?: boolean;
};

export type DeliveryRow = {
  id: string;
  publication_id: string;
  channel: PublishChannel;
  entity_id: string | null;
  sink_table: string;
  sink_row_id: string | null;
  sync_state: "pending" | "synced" | "failed";
  last_error: string | null;
};

export type ExecutePublicationResult = {
  duplicate: boolean;
  publicationId: string;
  message: string;
  deliveries: DeliveryRow[];
  revalidateJobId: string | null;
  revalidateError: string | null;
};

export type PublishDeps = {
  admin: SupabaseClient;
  userId: string;
  message: string;
  targets: PublishTargetsInput;
  idempotencyKey?: string | null;
};
