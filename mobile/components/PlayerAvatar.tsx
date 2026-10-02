import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";

export type AvatarPerson = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export function personInitials(p: Pick<AvatarPerson, "first_name" | "last_name">): string {
  const first = p.first_name?.trim()?.[0] ?? "";
  const last = p.last_name?.trim()?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

/** Round photo avatar with an initials fallback on pitchPanel. */
export default function PlayerAvatar({
  person,
  size = 32,
  ringColor,
  style,
}: {
  person: Pick<AvatarPerson, "first_name" | "last_name" | "avatar_url">;
  size?: number;
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  useThemedStyles(publish_styles);
  const box = { width: size, height: size, borderRadius: size / 2 };
  const ring = ringColor ? { borderWidth: 2, borderColor: ringColor } : null;
  return (
    <View style={[styles.base, box, ring, style]}>
      {person.avatar_url ? (
        <Image source={{ uri: person.avatar_url }} alt="" style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <Text style={[styles.initials, { fontSize: size >= 44 ? 16 : size >= 32 ? 13 : 11 }]}>{personInitials(person)}</Text>
      )}
    </View>
  );
}

/** Overlapping avatars with a "+N" bubble when more people than `max`. */
export function AvatarStack({
  people,
  total,
  max = 4,
  size = 28,
}: {
  people: AvatarPerson[];
  total?: number;
  max?: number;
  size?: number;
}) {
  useThemedStyles(publish_styles);
  const shown = people.slice(0, max);
  const extra = Math.max(0, (total ?? people.length) - shown.length);
  if (shown.length === 0 && extra === 0) return null;
  return (
    <View style={styles.stack}>
      {shown.map((p, i) => (
        <PlayerAvatar
          key={p.user_id}
          person={p}
          size={size}
          ringColor={themeColor().card}
          style={i > 0 ? { marginLeft: -size / 3 } : undefined}
        />
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.base,
            styles.more,
            { width: size, height: size, borderRadius: size / 2 },
            shown.length > 0 ? { marginLeft: -size / 3 } : null,
          ]}
        >
          <Text style={styles.moreText}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    base: {
      backgroundColor: themeColor().pitchPanel,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    initials: { color: themeColor().onPitchPanel, fontFamily: "Inter_700Bold" },
    stack: { flexDirection: "row", alignItems: "center" },
    more: { backgroundColor: themeColor().line, borderWidth: 2, borderColor: themeColor().card },
    moreText: { color: themeColor().text, fontSize: 11, fontFamily: "Inter_700Bold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
