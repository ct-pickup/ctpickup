import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { accountStyles as styles, publish_accountStyles } from "@/components/account/accountStyles";
import { useAnalyticsPreference } from "@/context/AnalyticsContext";
import { themeColor, useThemedStyles } from "@/theme";

/**
 * "Share usage data". Shown only while the 'analytics_client' flag is on. Off stops the app from sending which screens you open;
 * what happens to your games (joining, playing) is still recorded because the game needs it to run.
 */
export function UsageDataSetting() {
  useThemedStyles(publish_accountStyles);
  const { available, sharing, setSharing } = useAnalyticsPreference();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!available) return null;

  const change = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    const ok = await setSharing(next);
    setBusy(false);
    if (!ok) setMessage("We couldn’t save that. Try again.");
  };

  return (
    <View style={styles.card}>
      <View style={[styles.rowBetween, styles.marketingPushRow]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.fieldLabelStrong}>Share usage data</Text>
          <Text style={styles.bioHint}>Which screens you open and which games you tap, so we can make the app better. Never your name, contacts or exact location. Games you join are still recorded.</Text>
        </View>
        <Switch
          value={sharing}
          onValueChange={(v) => void change(v)}
          disabled={busy}
          trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
          thumbColor={themeColor().text}
          accessibilityLabel="Share usage data"
        />
      </View>
      {message ? <Text style={styles.msg}>{message}</Text> : null}
    </View>
  );
}
