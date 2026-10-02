import { useAuth } from "@/context/AuthContext";
import { appAsyncStorage } from "@/lib/appAsyncStorage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const STORAGE_KEY_PREFIX = "ctpickup_cancellation_policy_notice_v1:";
const SEEN_COLUMN = "cancellation_policy_notice_seen_at";
/** Accounts created after this signed up under the new policy and never need the notice. */
const POLICY_EFFECTIVE_AT_MS = Date.parse("2026-10-03T04:00:00Z");

type LocalSeen = "seen" | "unseen" | "unknown";

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

async function readLocalSeen(userId: string): Promise<LocalSeen> {
  try {
    return (await appAsyncStorage.getItem(storageKey(userId))) === "1" ? "seen" : "unseen";
  } catch {
    return "unknown";
  }
}

async function writeLocalSeen(userId: string): Promise<void> {
  try {
    await appAsyncStorage.setItem(storageKey(userId), "1");
  } catch {
    /* ignore */
  }
}

async function markSeenRemote(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    await supabase
      .from("profiles")
      .update({ [SEEN_COLUMN]: new Date().toISOString() })
      .eq("id", userId)
      .is(SEEN_COLUMN, null);
  } catch {
    /* column may not exist yet; the local flag covers it */
  }
}

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || (error.message ?? "").includes(SEEN_COLUMN);
}

function createdAfterPolicy(createdAt: unknown): boolean {
  if (typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= POLICY_EFFECTIVE_AT_MS;
}

async function shouldShowNotice(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const local = await readLocalSeen(userId);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(`${SEEN_COLUMN}, created_at`)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (!isMissingColumnError(error) || local !== "unseen") return false;
      const fallback = await supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle();
      if (fallback.error || !fallback.data) return false;
      if (createdAfterPolicy((fallback.data as { created_at?: unknown }).created_at)) {
        await writeLocalSeen(userId);
        return false;
      }
      return true;
    }
    if (!data) return false;

    const row = data as Record<string, unknown>;
    if (row[SEEN_COLUMN]) {
      if (local === "unseen") await writeLocalSeen(userId);
      return false;
    }
    if (local === "seen" || createdAfterPolicy(row.created_at)) {
      await writeLocalSeen(userId);
      await markSeenRemote(supabase, userId);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** One-time notice about the October 2026 cancellation policy change, shown on launch to signed-in users. */
export function CancellationPolicyNotice() {
  useThemedStyles(publish_styles);

  const { supabase, session, isReady } = useAuth();
  const userId = session?.user?.id ?? null;
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  const checkedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady || !supabase || !userId || checkedForRef.current === userId) return;
    checkedForRef.current = userId;
    void shouldShowNotice(supabase, userId).then((show) => {
      if (show) setVisibleFor(userId);
    });
  }, [isReady, supabase, userId]);

  const dismiss = useCallback(
    (openTerms: boolean) => {
      const id = visibleFor;
      setVisibleFor(null);
      if (id) {
        void writeLocalSeen(id);
        if (supabase) void markSeenRemote(supabase, id);
      }
      if (openTerms) router.push("/terms");
    },
    [supabase, visibleFor],
  );

  if (!visibleFor || visibleFor !== userId) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>Cancellation policy</Text>
        <Text style={styles.body}>
          We updated our cancellation policy. Leaving 24+ hours before kickoff now gives you a credit instead of a
          refund.
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => dismiss(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>View terms</Text>
          </Pressable>
          <Pressable
            onPress={() => dismiss(false)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: themeColor().scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 900,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
    padding: 20,
  },
  title: { color: themeColor().text, fontSize: 20, ...headline },
  body: {
    marginTop: 8,
    color: themeColor().text,
    fontSize: 15, fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  secondaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  secondaryText: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  primaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: radius.button,
    backgroundColor: themeColor().pitch,
  },
  primaryText: { color: themeColor().onPitch, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  pressed: { opacity: 0.85 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
