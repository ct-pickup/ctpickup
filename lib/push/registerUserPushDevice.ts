import type { SupabaseClient } from "@supabase/supabase-js";

export const PRODUCTION_PUSH_INSTALLATION_CONTEXTS = ["standalone", "bare"] as const;
export type ProductionPushInstallationContext = (typeof PRODUCTION_PUSH_INSTALLATION_CONTEXTS)[number];
export type PushInstallationContext = ProductionPushInstallationContext | "storeClient";

export function parseInstallationContext(raw: unknown): PushInstallationContext | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v === "storeClient" || v === "standalone" || v === "bare") return v;
  return null;
}

export function canPersistPushToken(ctx: PushInstallationContext | null): ctx is ProductionPushInstallationContext {
  return ctx === "standalone" || ctx === "bare";
}

export async function registerUserPushDevice(
  admin: SupabaseClient,
  args: {
    userId: string;
    expoPushToken: string;
    platform: "ios" | "android";
    pushEnabled: boolean;
    installationContext: ProductionPushInstallationContext;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();

  const clearOtherUsers = await admin
    .from("user_push_devices")
    .delete()
    .eq("expo_push_token", args.expoPushToken)
    .neq("user_id", args.userId);
  if (clearOtherUsers.error) {
    return { ok: false, error: clearOtherUsers.error.message };
  }

  const profRes = await admin
    .from("profiles")
    .select("marketing_push_enabled")
    .eq("id", args.userId)
    .maybeSingle();
  const marketingEnabled = profRes.data?.marketing_push_enabled === true;

  const { error } = await admin.from("user_push_devices").upsert(
    {
      user_id: args.userId,
      expo_push_token: args.expoPushToken,
      platform: args.platform,
      push_notifications_enabled: args.pushEnabled,
      marketing_push_enabled: marketingEnabled,
      installation_context: args.installationContext,
      updated_at: now,
    },
    { onConflict: "user_id,expo_push_token" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
