import { StyleSheet, Text, View } from "react-native";

import { trackerSteps } from "@/lib/fields/requestTracker";
import { radius, themeColor, useThemedStyles } from "@/theme";
import type { RequestStatus } from "@shared/fields/requestEmail";

/** The four-step "where is my request" list, shared by the request-sent screen and My requests. */
export function RequestTracker({ status }: { status: RequestStatus }) {
  useThemedStyles(publish_styles);
  return (
    <View style={styles.steps}>
      {trackerSteps(status).map((s) => (
        <View key={s.title} style={styles.step}>
          <View style={[styles.dot, s.state === "done" && styles.dotDone, s.state === "declined" && styles.dotDeclined]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, s.state === "todo" && styles.titleTodo]}>{s.title}</Text>
            <Text style={styles.sub}>{s.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    steps: { gap: 18, padding: 16, backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line },
    step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    dot: { width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 2, borderColor: c.line },
    dotDone: { backgroundColor: c.pitch, borderColor: c.pitch },
    dotDeclined: { backgroundColor: c.coral, borderColor: c.coral },
    title: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: c.text },
    titleTodo: { color: c.muted },
    sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
