import { siteOrigin } from "@/lib/env";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { accountStyles as styles } from "./accountStyles";

type ReferralStatus = {
  referral_code: string;
  referrals_count: number;
  credits: number;
};

type Props = {
  accessToken: string | null;
};

export function ReferralSection({ accessToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [applyCode, setApplyCode] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !accessToken) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${origin}/api/referral/status`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as ReferralStatus & { error?: string };
      if (r.ok && j?.referral_code) {
        setStatus({
          referral_code: j.referral_code,
          referrals_count: Number(j.referrals_count ?? 0),
          credits: Number(j.credits ?? 0),
        });
      } else {
        setStatus(null);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onApplyCode() {
    const origin = siteOrigin();
    const code = applyCode.trim().toUpperCase();
    if (!origin || !accessToken || !code) return;
    setApplyBusy(true);
    setApplyMsg(null);
    try {
      const r = await fetch(`${origin}/api/referral/apply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ referral_code: code }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string };
      if (r.ok) {
        setApplyCode("");
        setApplyMsg("Referral code applied.");
        await load();
      } else {
        setApplyMsg(typeof j?.error === "string" ? j.error : "Could not apply code.");
      }
    } catch {
      setApplyMsg("Network error. Try again.");
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <>
      <Text style={styles.sectionTitle}>Referrals</Text>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.cardLoadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.cardLoadingText}>Loading referral info…</Text>
          </View>
        ) : status ? (
          <>
            <Text style={styles.fieldLabel}>Your code</Text>
            <Text style={styles.referralCode}>{status.referral_code}</Text>
            <Text style={styles.bioHint}>
              {status.referrals_count} referral{status.referrals_count === 1 ? "" : "s"} · {status.credits} free run
              credit{status.credits === 1 ? "" : "s"}
            </Text>
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Have a friend&apos;s code?</Text>
            <TextInput
              style={styles.input}
              value={applyCode}
              onChangeText={setApplyCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter code"
              placeholderTextColor="rgba(255,255,255,0.35)"
              editable={!applyBusy}
            />
            <Pressable
              style={[styles.primaryBtn, applyBusy && styles.disabled]}
              disabled={applyBusy || !applyCode.trim()}
              onPress={() => void onApplyCode()}
            >
              <Text style={styles.primaryBtnText}>{applyBusy ? "Applying…" : "Apply referral code"}</Text>
            </Pressable>
            {applyMsg ? (
              <Text style={[styles.msg, applyMsg.includes("applied") ? styles.msgOk : undefined]}>{applyMsg}</Text>
            ) : null}
            <Pressable
              style={styles.textBtn}
              onPress={() =>
                Alert.alert(
                  "How referrals work",
                  "Share your code with friends. When they join, you earn credits toward free pickup runs.",
                )
              }
            >
              <Text style={styles.textBtnLabel}>How it works</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.cardMuted}>Referral info isn’t available right now.</Text>
        )}
      </View>
    </>
  );
}
