import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

const PRIVACY_URL = "https://ctpickup.net/privacy";
const BG = "#0a0a0a";
const LIME = "#a3e635";

export default function PrivacyPolicyScreen() {
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: PRIVACY_URL }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setLoading(false)}
        backgroundColor={BG}
      />
      {loading ? (
        <View style={styles.loaderWrap} pointerEvents="none">
          <ActivityIndicator size="large" color={LIME} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  webview: { flex: 1, backgroundColor: BG },
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
  },
});
