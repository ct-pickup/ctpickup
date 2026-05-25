import Slider from "@react-native-community/slider";
import { Pressable, ActivityIndicator, Switch, Text, View } from "react-native";
import {
  RUN_RADIUS_MILES_OPTIONS,
  type RunRadiusMiles,
} from "@/lib/runRadiusPreference";
import { hapticTap } from "@/lib/haptics";
import { accountStyles as styles, LIME } from "./accountStyles";

type Props = {
  pushEnabled: boolean;
  pushBusy: boolean;
  pushMsg: string | null;
  onTogglePush: (next: boolean) => void;
  pushDisabled: boolean;
  marketingPushEnabled: boolean;
  marketingPushBusy: boolean;
  marketingPushMsg: string | null;
  onToggleMarketingPush: (next: boolean) => void;
  marketingPushDisabled: boolean;
  maxDriveMinutes: number;
  maxDriveBusy: boolean;
  maxDriveMsg: string | null;
  maxDriveLabel: (minutes: number) => string;
  minDrive: number;
  maxDrive: number;
  driveStep: number;
  onMaxDriveChange: (v: number) => void;
  onMaxDriveCommit: (v: number) => void;
  maxDriveDisabled: boolean;
  maxRunDistanceMiles: RunRadiusMiles;
  maxRunDistanceBusy: boolean;
  maxRunDistanceMsg: string | null;
  onSelectRunDistance: (miles: RunRadiusMiles) => void;
  maxRunDistanceDisabled: boolean;
};

export function PreferencesSection({
  pushEnabled,
  pushBusy,
  pushMsg,
  onTogglePush,
  pushDisabled,
  marketingPushEnabled,
  marketingPushBusy,
  marketingPushMsg,
  onToggleMarketingPush,
  marketingPushDisabled,
  maxDriveMinutes,
  maxDriveBusy,
  maxDriveMsg,
  maxDriveLabel,
  minDrive,
  maxDrive,
  driveStep,
  onMaxDriveChange,
  onMaxDriveCommit,
  maxDriveDisabled,
  maxRunDistanceMiles,
  maxRunDistanceBusy,
  maxRunDistanceMsg,
  onSelectRunDistance,
  maxRunDistanceDisabled,
}: Props) {
  return (
    <>
      <Text style={styles.sectionTitle}>Preferences</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.fieldLabelStrong}>Push notifications</Text>
            <Text style={styles.bioHint}>Run invites, RSVP confirmations, and account-related alerts</Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={onTogglePush}
            disabled={pushBusy || pushDisabled}
            trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
            thumbColor="#f4f4f5"
          />
        </View>
        {pushMsg ? <Text style={styles.msg}>{pushMsg}</Text> : null}

        <View style={[styles.rowBetween, styles.marketingPushRow]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.fieldLabelStrong}>Marketing updates</Text>
            <Text style={styles.bioHint}>Promotional updates and staff broadcast announcements</Text>
          </View>
          <Switch
            value={marketingPushEnabled}
            onValueChange={onToggleMarketingPush}
            disabled={marketingPushBusy || marketingPushDisabled || !pushEnabled}
            trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
            thumbColor="#f4f4f5"
          />
        </View>
        {marketingPushMsg ? <Text style={styles.msg}>{marketingPushMsg}</Text> : null}
        {!pushEnabled ? (
          <Text style={styles.bioHint}>Turn on push notifications above to enable marketing updates.</Text>
        ) : null}

        <View style={styles.maxDriveBlock}>
          <View style={styles.maxDriveHeader}>
            <Text style={styles.fieldLabelStrong}>Max drive time</Text>
            <Text style={styles.maxDriveValue}>{maxDriveLabel(maxDriveMinutes)}</Text>
          </View>
          <Text style={styles.bioHint}>Pickup invites and nearby run alerts use your zip and this limit.</Text>
          <Slider
            style={styles.maxDriveSlider}
            minimumValue={minDrive}
            maximumValue={maxDrive}
            step={driveStep}
            value={maxDriveMinutes}
            onValueChange={onMaxDriveChange}
            onSlidingComplete={onMaxDriveCommit}
            disabled={maxDriveBusy || maxDriveDisabled}
            minimumTrackTintColor={LIME}
            maximumTrackTintColor="rgba(255,255,255,0.18)"
            thumbTintColor="#f4f4f5"
          />
          <View style={styles.maxDriveTicks}>
            <Text style={styles.maxDriveTick}>{minDrive} min</Text>
            <Text style={styles.maxDriveTick}>{maxDrive} min</Text>
          </View>
          {maxDriveBusy ? (
            <View style={styles.maxDriveSaving}>
              <ActivityIndicator color={LIME} size="small" />
              <Text style={styles.bioHint}>Saving…</Text>
            </View>
          ) : null}
          {maxDriveMsg ? <Text style={styles.msg}>{maxDriveMsg}</Text> : null}
        </View>

        <View style={styles.maxDriveBlock}>
          <Text style={styles.fieldLabelStrong}>Show me runs within</Text>
          <Text style={styles.bioHint}>
            Uses your ZIP on the Runs tab. Without a ZIP, you see all runs in your hub region.
          </Text>
          <View style={styles.radiusChipRow}>
            {RUN_RADIUS_MILES_OPTIONS.map((mi) => {
              const active = maxRunDistanceMiles === mi;
              return (
                <Pressable
                  key={mi}
                  disabled={maxRunDistanceBusy || maxRunDistanceDisabled}
                  onPress={() => {
                    void hapticTap();
                    onSelectRunDistance(mi);
                  }}
                  style={[styles.radiusChip, active && styles.radiusChipActive]}
                >
                  <Text style={[styles.radiusChipText, active && styles.radiusChipTextActive]}>{mi}mi</Text>
                </Pressable>
              );
            })}
          </View>
          {maxRunDistanceBusy ? (
            <View style={styles.maxDriveSaving}>
              <ActivityIndicator color={LIME} size="small" />
              <Text style={styles.bioHint}>Saving…</Text>
            </View>
          ) : null}
          {maxRunDistanceMsg ? <Text style={styles.msg}>{maxRunDistanceMsg}</Text> : null}
        </View>
      </View>
    </>
  );
}
