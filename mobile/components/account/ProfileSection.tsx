import {
  ACCOUNT_NO_HUB_NEAR_ZIP_MSG,
  ACCOUNT_ZIP_NO_NEAREST_VENUE_MSG,
} from "@/lib/playerLocationHints";
import { PROFILE_USERNAME_MAX_LEN } from "@/lib/profileIdentityFields";
import { serviceRegionName } from "@/lib/serviceRegions";
import * as Location from "expo-location";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  accountStyles as styles,
  LIME,
  POSITION_OPTIONS,
  SPECIFIC_POSITION_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  type PositionValue,
  type SpecificPositionValue,
  type ExperienceLevelValue,
} from "./accountStyles";
import { SelectModal } from "./SelectModal";

function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string | null): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

type Props = {
  editFirstName: string;
  setEditFirstName: (v: string) => void;
  editLastName: string;
  setEditLastName: (v: string) => void;
  editPlayingPosition: PositionValue | null;
  setEditPlayingPosition: (v: PositionValue) => void;
  editPrimaryPosition: SpecificPositionValue | null;
  setEditPrimaryPosition: (v: SpecificPositionValue) => void;
  editSecondaryPositions: SpecificPositionValue[];
  setEditSecondaryPositions: (v: SpecificPositionValue[]) => void;
  editExperienceLevel: ExperienceLevelValue | null;
  setEditExperienceLevel: (v: ExperienceLevelValue) => void;
  editDateOfBirth: string;
  setEditDateOfBirth: (v: string) => void;
  editClubName: string;
  setEditClubName: (v: string) => void;
  editRosterUrl: string;
  setEditRosterUrl: (v: string) => void;
  editInstagram: string;
  setEditInstagram: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editZipCode: string;
  setEditZipCode: (v: string) => void;
  editUsername: string;
  setEditUsername: (v: string) => void;
  editBusy: boolean;
  profileNearestVenue: string | null;
  profileRegionCode: string | null;
  profileZipCode: string | null;
  hubRegionResolving: boolean;
  hubVenueResolveDone: boolean;
  usernameAutoFromName: boolean;
  positionPickerOpen: boolean;
  setPositionPickerOpen: (v: boolean) => void;
  primaryPositionPickerOpen: boolean;
  setPrimaryPositionPickerOpen: (v: boolean) => void;
  experienceLevelPickerOpen: boolean;
  setExperienceLevelPickerOpen: (v: boolean) => void;
  profileSaveError: string | null;
  editMsg: string | null;
  editOk: boolean;
  onSave: () => void;
};

export function ProfileSection({
  editFirstName, setEditFirstName,
  editLastName, setEditLastName,
  editPlayingPosition, setEditPlayingPosition,
  editPrimaryPosition, setEditPrimaryPosition,
  editSecondaryPositions, setEditSecondaryPositions,
  editExperienceLevel, setEditExperienceLevel,
  editDateOfBirth, setEditDateOfBirth,
  editClubName, setEditClubName,
  editRosterUrl, setEditRosterUrl,
  editInstagram, setEditInstagram,
  editPhone, setEditPhone,
  editZipCode, setEditZipCode,
  editUsername, setEditUsername,
  editBusy,
  profileNearestVenue,
  profileRegionCode,
  profileZipCode,
  hubRegionResolving,
  hubVenueResolveDone,
  usernameAutoFromName,
  positionPickerOpen, setPositionPickerOpen,
  primaryPositionPickerOpen, setPrimaryPositionPickerOpen,
  experienceLevelPickerOpen, setExperienceLevelPickerOpen,
  profileSaveError,
  editMsg,
  editOk,
  onSave,
}: Props) {
  const [zipLocationBusy, setZipLocationBusy] = useState(false);
  const [zipLocationError, setZipLocationError] = useState<string | null>(null);

  const onUseMyLocation = useCallback(async () => {
    if (zipLocationBusy || editBusy) return;
    setZipLocationError(null);
    setZipLocationBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setZipLocationError("Could not detect location"); return; }
      const position = await Location.getCurrentPositionAsync({});
      const results = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      const postal = results[0]?.postalCode?.replace(/\D/g, "").slice(0, 5) ?? "";
      if (postal.length !== 5) { setZipLocationError("Could not detect location"); return; }
      setEditZipCode(postal);
    } catch {
      setZipLocationError("Could not detect location");
    } finally {
      setZipLocationBusy(false);
    }
  }, [editBusy, setEditZipCode, zipLocationBusy]);

  function toggleSecondary(pos: SpecificPositionValue) {
    if (pos === editPrimaryPosition) return;
    if (editSecondaryPositions.includes(pos)) {
      setEditSecondaryPositions(editSecondaryPositions.filter((p) => p !== pos));
    } else if (editSecondaryPositions.length < 2) {
      setEditSecondaryPositions([...editSecondaryPositions, pos]);
    }
  }

  return (
    <>
      <Text style={styles.sectionTitle}>Edit profile</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput style={styles.input} value={editFirstName} onChangeText={setEditFirstName}
          autoCapitalize="words" autoCorrect={false} placeholder="First name"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy} />

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Last name</Text>
        <TextInput style={styles.input} value={editLastName} onChangeText={setEditLastName}
          autoCapitalize="words" autoCorrect={false} placeholder="Last name"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy} />

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Playing position</Text>
        <Pressable onPress={() => setPositionPickerOpen(true)} disabled={editBusy}
          style={[styles.input, styles.selectTrigger, editBusy ? { opacity: 0.6 } : null]}>
          <Text style={editPlayingPosition ? styles.selectValue : styles.selectPlaceholder}>
            {editPlayingPosition ? labelFor(POSITION_OPTIONS, editPlayingPosition) : "Choose…"}
          </Text>
          <Text style={styles.selectChevron}>▾</Text>
        </Pressable>

        {/* Soccer Background Section */}
        <Text style={[styles.fieldLabel, { marginTop: 20, marginBottom: 4, fontSize: 11, letterSpacing: 1.2, color: LIME }]}>
          SOCCER BACKGROUND
        </Text>

        <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Primary position</Text>
        <Pressable onPress={() => setPrimaryPositionPickerOpen(true)} disabled={editBusy}
          style={[styles.input, styles.selectTrigger, editBusy ? { opacity: 0.6 } : null]}>
          <Text style={editPrimaryPosition ? styles.selectValue : styles.selectPlaceholder}>
            {editPrimaryPosition ? labelFor(SPECIFIC_POSITION_OPTIONS, editPrimaryPosition) : "Choose…"}
          </Text>
          <Text style={styles.selectChevron}>▾</Text>
        </Pressable>

        {editPrimaryPosition ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Secondary positions (up to 2)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {SPECIFIC_POSITION_OPTIONS.filter((o) => o.value !== editPrimaryPosition).map((o) => {
                const selected = editSecondaryPositions.includes(o.value);
                const disabled = !selected && editSecondaryPositions.length >= 2;
                return (
                  <Pressable key={o.value} onPress={() => toggleSecondary(o.value)}
                    disabled={editBusy || disabled}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                      borderWidth: 1,
                      borderColor: selected ? LIME : "rgba(255,255,255,0.18)",
                      backgroundColor: selected ? "rgba(163,230,53,0.12)" : "rgba(255,255,255,0.04)",
                      opacity: disabled ? 0.35 : 1,
                    }}>
                    <Text style={{ fontSize: 13, color: selected ? LIME : "rgba(255,255,255,0.65)", fontWeight: "600" }}>
                      {o.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Experience level</Text>
        <Pressable onPress={() => setExperienceLevelPickerOpen(true)} disabled={editBusy}
          style={[styles.input, styles.selectTrigger, editBusy ? { opacity: 0.6 } : null]}>
          <Text style={editExperienceLevel ? styles.selectValue : styles.selectPlaceholder}>
            {editExperienceLevel ? labelFor(EXPERIENCE_LEVEL_OPTIONS, editExperienceLevel) : "Choose…"}
          </Text>
          <Text style={styles.selectChevron}>▾</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Date of birth</Text>
        <TextInput style={styles.input} value={editDateOfBirth} onChangeText={setEditDateOfBirth}
          placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="numeric" autoCorrect={false} editable={!editBusy} />
        <Text style={styles.bioHint}>Used to display your age on your profile. Never shown as a full date.</Text>

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Club / team</Text>
        <TextInput style={styles.input} value={editClubName} onChangeText={setEditClubName}
          placeholder="e.g. Westport FC, ECNL Academy" placeholderTextColor="rgba(255,255,255,0.35)"
          autoCorrect={false} editable={!editBusy} />

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Roster URL</Text>
        <TextInput style={styles.input} value={editRosterUrl} onChangeText={setEditRosterUrl}
          placeholder="TopDrawer, MaxPreps, team site…" placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!editBusy} />
        <Text style={styles.bioHint}>Paste a link to your roster page for verification.</Text>

        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Instagram</Text>
        <TextInput style={styles.input} value={editInstagram} onChangeText={setEditInstagram}
          autoCapitalize="none" autoCorrect={false} placeholder="@handle"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy} />

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Phone</Text>
        <TextInput style={styles.input} value={editPhone} onChangeText={setEditPhone}
          keyboardType="phone-pad" autoCorrect={false} placeholder="Phone number"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy} />

        <View style={styles.zipLabelRow}>
          <Text style={styles.fieldLabel}>ZIP CODE</Text>
          <Pressable onPress={() => void onUseMyLocation()} disabled={editBusy || zipLocationBusy}
            style={editBusy || zipLocationBusy ? styles.zipLocationBtnDisabled : undefined} hitSlop={8}>
            {zipLocationBusy ? <ActivityIndicator size="small" color={LIME} /> :
              <Text style={styles.zipLocationBtn}>Use my location</Text>}
          </Pressable>
        </View>
        <TextInput style={styles.input} value={editZipCode}
          onChangeText={(t) => { setZipLocationError(null); setEditZipCode(t.replace(/\D/g, "").slice(0, 5)); }}
          keyboardType="numeric" maxLength={5} autoCorrect={false} placeholder="5-digit zip"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy} />
        <Text style={styles.zipHelper}>Your ZIP determines which runs appear on your Pickup tab.</Text>
        {zipLocationError ? <Text style={styles.zipLocationError}>{zipLocationError}</Text> : null}
        {editZipCode.replace(/\D/g, "").length === 5 && !String(profileNearestVenue ?? "").trim() ?
          <Text style={styles.zipNearestHint}>{ACCOUNT_ZIP_NO_NEAREST_VENUE_MSG}</Text> : null}

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Region</Text>
        {profileRegionCode ? (
          <Text style={styles.regionValue}>{serviceRegionName(profileRegionCode)} ({profileRegionCode})</Text>
        ) : hubRegionResolving ? (
          <View style={styles.regionResolvingRow}>
            <ActivityIndicator color={LIME} size="small" />
            <Text style={styles.regionResolvingText}>Finding your hub…</Text>
          </View>
        ) : String(profileZipCode ?? "").replace(/\D/g, "").slice(0, 5).length === 5 && hubVenueResolveDone ? (
          <Text style={styles.zipNearestHint}>{ACCOUNT_NO_HUB_NEAR_ZIP_MSG}</Text>
        ) : (
          <Text style={styles.regionMuted}>No CT Pickup hub on file for this profile.</Text>
        )}

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Username</Text>
        {editUsername.trim() ? <Text style={styles.usernameAtPreview}>@{editUsername.trim()}</Text> : null}
        <TextInput style={styles.input} value={editUsername} onChangeText={setEditUsername}
          autoCapitalize="none" autoCorrect={false} placeholder="letters and numbers"
          placeholderTextColor="rgba(255,255,255,0.35)" editable={!editBusy}
          maxLength={PROFILE_USERNAME_MAX_LEN} />
        <Text style={styles.bioHint}>Your username is how other players find you</Text>
        {usernameAutoFromName ? <Text style={styles.bioHint}>Auto-generated from your name</Text> : null}

        <Pressable style={[styles.primaryBtn, editBusy && styles.disabled]} disabled={editBusy} onPress={onSave}>
          {editBusy ? (
            <View style={styles.saveBtnBusy}>
              <ActivityIndicator color="#111" />
              <Text style={styles.primaryBtnText}>Saving…</Text>
            </View>
          ) : <Text style={styles.primaryBtnText}>Save profile</Text>}
        </Pressable>
        {profileSaveError ? <Text style={styles.saveFailedText}>{profileSaveError}</Text> : null}
        {editMsg && !profileSaveError ?
          <Text style={[styles.msg, editOk ? styles.msgOk : styles.msgMuted]}>{editMsg}</Text> : null}
      </View>

      <SelectModal<PositionValue>
        visible={positionPickerOpen} title="Playing position"
        options={POSITION_OPTIONS} value={editPlayingPosition}
        onSelect={setEditPlayingPosition} onClose={() => setPositionPickerOpen(false)} />

      <SelectModal<SpecificPositionValue>
        visible={primaryPositionPickerOpen} title="Primary position"
        options={SPECIFIC_POSITION_OPTIONS} value={editPrimaryPosition}
        onSelect={setEditPrimaryPosition} onClose={() => setPrimaryPositionPickerOpen(false)} />

      <SelectModal<ExperienceLevelValue>
        visible={experienceLevelPickerOpen} title="Experience level"
        options={EXPERIENCE_LEVEL_OPTIONS} value={editExperienceLevel}
        onSelect={setEditExperienceLevel} onClose={() => setExperienceLevelPickerOpen(false)} />
    </>
  );
}
