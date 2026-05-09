import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const WORD_LIMIT = 50;
const SUPPORT_EMAIL = "pickupct@gmail.com";

const EXAMPLE_CHIPS = [
  "How do I join a tournament?",
  "How do I join pickup?",
  "What is my tier?",
] as const;

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function textWithMaxWords(text: string, max: number): string {
  const re = /\S+/g;
  let count = 0;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    count += 1;
    lastEnd = m.index + m[0].length;
    if (count === max) {
      return text.slice(0, lastEnd);
    }
  }
  return text;
}

type ChatMsg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "assistant"; thinking: true };

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.25)).current;
  const dot2 = useRef(new Animated.Value(0.25)).current;
  const dot3 = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const buildLoop = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.25,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
      );

    const a1 = buildLoop(dot1, 0);
    const a2 = buildLoop(dot2, 200);
    const a3 = buildLoop(dot3, 400);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantCard}>
        <View style={styles.dotsRow}>
          <Animated.Text style={[styles.dot, { opacity: dot1 }]}>•</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: dot2 }]}>•</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: dot3 }]}>•</Animated.Text>
        </View>
      </View>
    </View>
  );
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const wordsUsed = countWords(input);
  const wordsRemaining = Math.max(0, WORD_LIMIT - wordsUsed);
  const canSend =
    input.trim().length > 0 && wordsUsed <= WORD_LIMIT && !busy;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || countWords(text) > WORD_LIMIT || busy) return;

    const origin = siteOrigin();
    const userMsg: ChatMsg = { id: nextId("u"), role: "user", text };
    const thinkingId = nextId("t");
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: thinkingId, role: "assistant", thinking: true },
    ]);
    setInput("");
    setBusy(true);

    if (!origin) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                id: thinkingId,
                role: "assistant",
                text: `Help isn’t available (missing site URL). Email ${SUPPORT_EMAIL} for assistance.`,
              }
            : m,
        ),
      );
      setBusy(false);
      return;
    }

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const r = await fetch(`${origin}/api/mobile/help`, {
        method: "POST",
        headers,
        body: JSON.stringify({ question: text }),
      });

      let j: { text?: unknown; error?: unknown } | null = null;
      try {
        j = (await r.json()) as { text?: unknown; error?: unknown };
      } catch {
        j = null;
      }

      let assistantText: string;
      if (r.ok) {
        const body =
          j && typeof j.text === "string" && String(j.text).trim() ? String(j.text).trim() : "";
        assistantText = body || "I couldn’t generate a reply.";
      } else {
        assistantText = `${String(j?.error ?? "Something went wrong.")} You can also email ${SUPPORT_EMAIL}.`;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId ? { id: thinkingId, role: "assistant", text: assistantText } : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                id: thinkingId,
                role: "assistant",
                text: `Couldn’t reach help right now. Email ${SUPPORT_EMAIL} for assistance.`,
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [input, busy, accessToken]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <View style={[styles.flex, styles.screen]}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 200 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <Text style={styles.supportText}>
            Email us at {SUPPORT_EMAIL}
          </Text>

          <Text style={styles.title}>What can I help you with?</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}
          >
            {EXAMPLE_CHIPS.map((q) => (
              <Pressable
                key={q}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                onPress={() => {
                  setInput(textWithMaxWords(q, WORD_LIMIT));
                }}
              >
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.messages}>
            {messages.map((m) => {
              if (m.role === "user") {
                return (
                  <View key={m.id} style={styles.userRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.userBubbleText}>{m.text}</Text>
                    </View>
                  </View>
                );
              }
              if (m.role === "assistant") {
                if ("thinking" in m && m.thinking) {
                  return <TypingIndicator key={m.id} />;
                }
                const assistantText = "text" in m ? m.text : "";
                return (
                  <View key={m.id} style={styles.assistantRow}>
                    <View style={styles.assistantCard}>
                      <Text style={styles.assistantText}>{assistantText}</Text>
                    </View>
                  </View>
                );
              }
              return null;
            })}
          </View>
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={(t) => setInput(textWithMaxWords(t, WORD_LIMIT))}
              placeholder="Ask a question…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              multiline
              maxLength={4000}
              editable={!busy}
              accessibilityLabel="Help question"
            />
            <Pressable
              style={[styles.sendBtn, (!canSend || busy) && styles.sendBtnDisabled]}
              onPress={() => void send()}
              disabled={!canSend || busy}
            >
              <Text style={styles.sendBtnText}>Send</Text>
            </Pressable>
          </View>
          <Text style={styles.wordCount}>
            {wordsRemaining} word{wordsRemaining === 1 ? "" : "s"} remaining (max {WORD_LIMIT})
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { backgroundColor: BG },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },
  supportText: {
    alignSelf: "flex-start",
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 20,
    color: LIME,
    fontWeight: "600",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
    marginBottom: 14,
  },
  chipsScroll: { marginBottom: 20, marginHorizontal: -20 },
  chipsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 2,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
    maxWidth: 280,
  },
  chipPressed: { opacity: 0.85 },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
  },
  messages: { gap: 12 },
  userRow: { alignItems: "flex-end", width: "100%" },
  userBubble: {
    maxWidth: "85%",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderBottomRightRadius: 6,
  },
  userBubbleText: { fontSize: 15, color: "#111", lineHeight: 22 },
  assistantRow: { alignItems: "flex-start", width: "100%" },
  assistantCard: {
    maxWidth: "92%",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderBottomLeftRadius: 6,
  },
  assistantText: { fontSize: 15, color: "rgba(255,255,255,0.92)", lineHeight: 22 },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  dot: {
    fontSize: 22,
    lineHeight: 22,
    color: LIME,
    fontWeight: "900",
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    backgroundColor: BG,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.45)",
    textAlignVertical: "top",
  },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: LIME,
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.38 },
  sendBtnText: { fontSize: 16, fontWeight: "800", color: "#0a0a0a" },
  wordCount: {
    marginTop: 8,
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
  },
});
