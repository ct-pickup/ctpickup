import {
  isValidPinFormat,
  normalizePasscode,
  PASSCODE_MAX_LEN,
  PASSCODE_REQUIREMENTS,
} from "@/lib/appLock";
import { ActivityIndicator, Alert, Pressable, Switch, Text, TextInput, View } from "react-native";
import { accountStyles as styles, LIME } from "./accountStyles";

type Props = {
  hasPin: boolean;
  lockEnabled: boolean;
  onEnableAppLock: () => void;
  lockUi: "idle" | "change" | "remove";
  setLockUi: (v: "idle" | "change" | "remove") => void;
  changeOld: string;
  setChangeOld: (v: string) => void;
  changeNewA: string;
  setChangeNewA: (v: string) => void;
  changeNewB: string;
  setChangeNewB: (v: string) => void;
  removeCurrent: string;
  setRemoveCurrent: (v: string) => void;
  lockBusy: boolean;
  setLockBusy: (v: boolean) => void;
  lockMsg: string | null;
  setLockMsg: (v: string | null) => void;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  onToggleBiometrics: (next: boolean) => void;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  removePin: (current: string) => Promise<boolean>;
  lockNow: () => void;
};

export function AppLockSection({
  hasPin,
  lockEnabled,
  onEnableAppLock,
  lockUi,
  setLockUi,
  changeOld,
  setChangeOld,
  changeNewA,
  setChangeNewA,
  changeNewB,
  setChangeNewB,
  removeCurrent,
  setRemoveCurrent,
  lockBusy,
  setLockBusy,
  lockMsg,
  setLockMsg,
  biometricsEnabled,
  biometricsAvailable,
  onToggleBiometrics,
  changePin,
  removePin,
  lockNow,
}: Props) {
  if (!hasPin) {
    return (
      <>
        <Text style={styles.sectionTitle}>App lock</Text>
        <Text style={styles.sectionSub}>
          Optional passcode when you leave the app. {PASSCODE_REQUIREMENTS} Face ID or Touch ID can unlock instead.
        </Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.fieldLabelStrong}>Require passcode</Text>
              <Text style={styles.bioHint}>Lock the app after you&apos;ve been away for a few minutes.</Text>
            </View>
            <Switch
              value={false}
              onValueChange={(next) => {
                if (next) onEnableAppLock();
              }}
              trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
              thumbColor="#f4f4f5"
            />
          </View>
        </View>
      </>
    );
  }

  if (!lockEnabled) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>App passcode</Text>
      <Text style={styles.sectionSub}>
        A passcode is required on this device when you’re signed in. {PASSCODE_REQUIREMENTS} It locks the app when you
        leave. Face ID or Touch ID can unlock instead.
      </Text>
      {lockUi === "idle" ? (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.fieldLabelStrong}>Face ID / Touch ID</Text>
              <Text style={styles.bioHint}>Unlock without typing your passcode.</Text>
            </View>
            <Switch
              value={biometricsEnabled}
              onValueChange={onToggleBiometrics}
              disabled={!biometricsAvailable && !biometricsEnabled}
              trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
              thumbColor="#f4f4f5"
            />
          </View>
          {!biometricsAvailable ? (
            <Text style={styles.warn}>Set up Face ID or Touch ID in iOS Settings to use this.</Text>
          ) : null}
          <Pressable style={styles.secondaryBtn} onPress={() => { setLockUi("change"); setLockMsg(null); }}>
            <Text style={styles.secondaryBtnText}>Change passcode</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => {
              setLockUi("remove");
              setLockMsg(null);
              setRemoveCurrent("");
            }}
          >
            <Text style={styles.secondaryBtnText}>Remove passcode</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={lockNow}>
            <Text style={styles.textBtnLabel}>Lock app now</Text>
          </Pressable>
        </View>
      ) : lockUi === "remove" ? (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Current passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            value={removeCurrent}
            onChangeText={(t) => setRemoveCurrent(t.slice(0, PASSCODE_MAX_LEN))}
            placeholder="Confirm to remove"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Pressable
            style={[styles.deleteAccountBtn, lockBusy && styles.disabled]}
            disabled={lockBusy}
            onPress={() => {
              void (async () => {
                setLockMsg(null);
                if (!normalizePasscode(removeCurrent)) {
                  setLockMsg("Enter your current passcode.");
                  return;
                }
                setLockBusy(true);
                const ok = await removePin(removeCurrent);
                setLockBusy(false);
                if (!ok) {
                  setLockMsg("Current passcode incorrect.");
                  return;
                }
                setRemoveCurrent("");
                setLockUi("idle");
                Alert.alert("Passcode removed", "Your device passcode has been removed.");
              })();
            }}
          >
            <Text style={styles.deleteAccountBtnText}>Remove passcode</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => { setLockUi("idle"); setLockMsg(null); setRemoveCurrent(""); }}>
            <Text style={styles.textBtnLabel}>Cancel</Text>
          </Pressable>
          {lockMsg ? <Text style={styles.msg}>{lockMsg}</Text> : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Current passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            value={changeOld}
            onChangeText={(t) => setChangeOld(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>New passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            value={changeNewA}
            onChangeText={(t) => setChangeNewA(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Confirm new</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            value={changeNewB}
            onChangeText={(t) => setChangeNewB(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Pressable
            style={[styles.primaryBtn, lockBusy && styles.disabled]}
            disabled={lockBusy}
            onPress={() => {
              void (async () => {
                setLockMsg(null);
                if (!normalizePasscode(changeOld)) {
                  setLockMsg("Enter your current passcode.");
                  return;
                }
                if (!isValidPinFormat(changeNewA) || !isValidPinFormat(changeNewB)) {
                  setLockMsg(PASSCODE_REQUIREMENTS);
                  return;
                }
                if (normalizePasscode(changeNewA) !== normalizePasscode(changeNewB)) {
                  setLockMsg("New passcodes don’t match.");
                  return;
                }
                setLockBusy(true);
                const ok = await changePin(changeOld, changeNewA);
                setLockBusy(false);
                if (!ok) {
                  setLockMsg("Current passcode incorrect.");
                  return;
                }
                setChangeOld("");
                setChangeNewA("");
                setChangeNewB("");
                setLockUi("idle");
              })();
            }}
          >
            <Text style={styles.primaryBtnText}>Update passcode</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => { setLockUi("idle"); setLockMsg(null); }}>
            <Text style={styles.textBtnLabel}>Cancel</Text>
          </Pressable>
          {lockMsg ? <Text style={styles.msg}>{lockMsg}</Text> : null}
        </View>
      )}
    </>
  );
}
