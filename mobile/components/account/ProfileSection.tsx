import {
  ACCOUNT_NO_HUB_NEAR_ZIP_MSG,
  ACCOUNT_ZIP_NO_NEAREST_VENUE_MSG,
} from "@/lib/playerLocationHints";
import { PROFILE_USERNAME_MAX_LEN } from "@/lib/profileIdentityFields";
import { serviceRegionName } from "@/lib/serviceRegions";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { accountStyles as styles, LIME, POSITION_OPTIONS, type PositionValue } from "./accountStyles";
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
  profileSaveError: string | null;
  editMsg: string | null;
  editOk: boolean;
  onSave: () => void;
};

export function ProfileSection({
  editFirstName,
  setEditFirstName,
  editLastName,
  setEditLastName,
  editPlayingPosition,
  setEditPlayingPosition,
  editInstagram,
  setEditInstagram,
  editPhone,
  setEditPhone,
  editZipCode,
  setEditZipCode,
  editUsername,
  setEditUsername,
  editBusy,
  profileNearestVenue,
  profileRegionCode,
  profileZipCode,
  hubRegionResolving,
  hubVenueResolveDone,
  usernameAutoFromName,
  positionPickerOpen,
  setPositionPickerOpen,
  profileSaveError,
  editMsg,
  editOk,
  onSave,
}: Props) {
  return (
    <>
      <Text style={styles.sectionTitle}>Edit profile</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput
          style={styles.input}
          value={editFirstName}
          onChangeText={setEditFirstName}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="First name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
        />
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Last name</Text>
        <TextInput
          style={styles.input}
          value={editLastName}
          onChangeText={setEditLastName}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Last name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
        />
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Playing position</Text>
        <Pressable
          onPress={() => setPositionPickerOpen(true)}
          disabled={editBusy}
          style={[styles.input, styles.selectTrigger, editBusy ? { opacity: 0.6 } : null]}
        >
          <Text style={editPlayingPosition ? styles.selectValue : styles.selectPlaceholder}>
            {editPlayingPosition ? labelFor(POSITION_OPTIONS, editPlayingPosition) : "Choose…"}
          </Text>
          <Text style={styles.selectChevron}>▾</Text>
        </Pressable>
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Instagram</Text>
        <TextInput
          style={styles.input}
          value={editInstagram}
          onChangeText={setEditInstagram}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="@handle"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
        />
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Phone</Text>
        <TextInput
          style={styles.input}
          value={editPhone}
          onChangeText={setEditPhone}
          keyboardType="phone-pad"
          autoCorrect={false}
          placeholder="Phone number"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
        />
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Zip code</Text>
        <TextInput
          style={styles.input}
          value={editZipCode}
          onChangeText={(t) => setEditZipCode(t.replace(/\D/g, "").slice(0, 5))}
          keyboardType="numeric"
          maxLength={5}
          autoCorrect={false}
          placeholder="5-digit zip"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
        />
        {editZipCode.replace(/\D/g, "").length === 5 && !String(profileNearestVenue ?? "").trim() ? (
          <Text style={styles.zipNearestHint}>{ACCOUNT_ZIP_NO_NEAREST_VENUE_MSG}</Text>
        ) : null}
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Region</Text>
        {profileRegionCode ? (
          <Text style={styles.regionValue}>
            {serviceRegionName(profileRegionCode)} ({profileRegionCode})
          </Text>
        ) : hubRegionResolving ? (
          <View style={styles.regionResolvingRow}>
            <ActivityIndicator color={LIME} size="small" />
            <Text style={styles.regionResolvingText}>Finding your hub…</Text>
          </View>
        ) : String(profileZipCode ?? "")
            .replace(/\D/g, "")
            .slice(0, 5).length === 5 && hubVenueResolveDone ? (
          <Text style={styles.zipNearestHint}>{ACCOUNT_NO_HUB_NEAR_ZIP_MSG}</Text>
        ) : (
          <Text style={styles.regionMuted}>No CT Pickup hub on file for this profile.</Text>
        )}
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Username</Text>
        {editUsername.trim() ? <Text style={styles.usernameAtPreview}>@{editUsername.trim()}</Text> : null}
        <TextInput
          style={styles.input}
          value={editUsername}
          onChangeText={setEditUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="letters and numbers"
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!editBusy}
          maxLength={PROFILE_USERNAME_MAX_LEN}
        />
        <Text style={styles.bioHint}>Your username is how other players find you</Text>
        {usernameAutoFromName ? <Text style={styles.bioHint}>Auto-generated from your name</Text> : null}
        <Pressable style={[styles.primaryBtn, editBusy && styles.disabled]} disabled={editBusy} onPress={onSave}>
          {editBusy ? (
            <View style={styles.saveBtnBusy}>
              <ActivityIndicator color="#111" />
              <Text style={styles.primaryBtnText}>Saving…</Text>
            </View>
          ) : (
            <Text style={styles.primaryBtnText}>Save profile</Text>
          )}
        </Pressable>
        {profileSaveError ? <Text style={styles.saveFailedText}>{profileSaveError}</Text> : null}
        {editMsg && !profileSaveError ? (
          <Text style={[styles.msg, editOk ? styles.msgOk : styles.msgMuted]}>{editMsg}</Text>
        ) : null}
      </View>
      <SelectModal<PositionValue>
        visible={positionPickerOpen}
        title="Playing position"
        options={POSITION_OPTIONS}
        value={editPlayingPosition}
        onSelect={setEditPlayingPosition}
        onClose={() => setPositionPickerOpen(false)}
      />
    </>
  );
}
