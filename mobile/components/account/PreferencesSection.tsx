import Slider from "@react-native-community/slider";
import { ActivityIndicator, Switch, Text, View } from "react-native";
import { accountStyles as styles, LIME } from "./accountStyles";

type Props = {
  pushEnabled: boolean;
  pushBusy: boolean;
  pushMsg: string | null;
  onTogglePush: (next: boolean) => void;
  pushDisabled: boolean;
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
};

export function PreferencesSection({
  pushEnabled,
  pushBusy,
  pushMsg,
  onTogglePush,
  pushDisabled,
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
}: Props) {
  return (
    <>
      <Text style={styles.sectionTitle}>Preferences</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.fieldLabelStrong}>Push Notifications</Text>
            <Text style={styles.bioHint}>Receive updates about runs, chat, and announcements</Text>
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
      </View>
    </>
  );
}
