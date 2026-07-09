import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function SessionCreateScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Host a Session</Text>
      <Text style={styles.sub}>Coming soon</Text>
      <Pressable onPress={() => router.back()} style={styles.btn}>
        <Text style={styles.btnText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 8 },
  btn: { marginTop: 24, backgroundColor: "#a3e635", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 15 },
});
