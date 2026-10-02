import { StyleSheet, Text, View } from "react-native";

import { INSTAGRAM_HANDLE, TAGLINE } from "@/lib/brand";
import { shareCardColor as C } from "@/theme";

import { Monogram } from "./Monogram";
import { Wordmark } from "./Wordmark";

type Scale = (v: number) => number;

/** Top-corner mark on the always-dark story cards. */
export function ShareCardCorner({ n }: { n: Scale }) {
  return <Monogram size={n(36)} tile={false} color={C.text} />;
}

/** Wordmark, tagline and Instagram handle at the foot of the story cards. */
export function ShareCardSignoff({ n }: { n: Scale }) {
  return (
    <View style={{ marginTop: n(22) }}>
      <Wordmark size={n(18)} color={C.text} allowFontScaling={false} />
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.tagline, { fontSize: n(13), marginTop: n(4) }]}>
        {TAGLINE}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.handle, { fontSize: n(12), marginTop: n(2) }]}>
        @{INSTAGRAM_HANDLE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tagline: { fontFamily: "Inter_600SemiBold", color: C.muted },
  handle: { fontFamily: "Inter_400Regular", color: C.muted },
});
