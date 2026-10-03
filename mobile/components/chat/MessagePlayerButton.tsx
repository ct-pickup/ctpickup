import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { useStartDm, type DmTarget } from "@/components/chat/StartDmSheet";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { radius, themeColor, useThemedStyles } from "@/theme";

/** "Message" button for staff: opens or starts the 1:1 thread. Renders nothing for players, who cannot start DMs. */
export default function MessagePlayerButton({ target }: { target: DmTarget }) {
  useThemedStyles(publish_styles);
  const { isAdmin } = useProfileAdmin();
  const { open, checking, sheet } = useStartDm();
  if (!isAdmin) return null;
  return (
    <>
      <Pressable
        onPress={() => void open(target)}
        disabled={checking}
        style={({ pressed }) => [styles.btn, (pressed || checking) && styles.dim]}
        accessibilityRole="button"
        accessibilityLabel={`Message ${target.name}`}
      >
        {checking ? <ActivityIndicator color={themeColor().accent} size="small" /> : <FontAwesome name="comment-o" size={15} color={themeColor().accent} />}
        <Text style={styles.text}>Message</Text>
      </Pressable>
      {sheet}
    </>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    btn: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderColor: c.accent,
    },
    dim: { opacity: 0.6 },
    text: { color: c.accent, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
