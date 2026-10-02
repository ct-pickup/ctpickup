import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
const WORD_LIMIT = 50;
const SUPPORT_EMAIL = "pickupct@gmail.com";
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

const EXAMPLE_CHIPS = [
  "How do I join a tournament?",
  "How do I join pickup?",
  "How do I pay for a pickup spot?",
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
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              What can I help you with?
            </Text>
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>AI-powered</Text>
            </View>
          </View>

          <View style={styles.chipsColumn}>
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
          </View>

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

        <View style={[styles.composer, { paddingBottom: 16 + insets.bottom }]}>
          <Text style={styles.wordCount}>
            {wordsRemaining} word{wordsRemaining === 1 ? "" : "s"} remaining (max {WORD_LIMIT})
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={(t) => setInput(textWithMaxWords(t, WORD_LIMIT))}
              placeholder="Ask a question…"
              placeholderTextColor={themeColor().muted}
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
          <Text style={styles.aiDisclaimer}>
            Responses are generated by AI and may not always be accurate.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(SUPPORT_MAILTO)}
          >
            <Text style={styles.urgentContact}>
              For urgent issues contact {SUPPORT_EMAIL}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function make_styles() {
  return StyleSheet.create({
  flex: { flex: 1 },
  screen: { backgroundColor: themeColor().bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  title: {
    flex: 1,
    flexShrink: 1,
    fontSize: 24, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "800",
    color: themeColor().text,
  },
  aiBadge: {
    flexShrink: 0,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  aiBadgeText: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().onPitchPanel,
  },
  aiDisclaimer: {
    marginTop: 12,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 16,
    color: themeColor().muted,
  },
  urgentContact: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    lineHeight: 16,
    color: themeColor().pitchText,
    fontWeight: "600",
  },
  chipsColumn: {
    gap: 8,
    marginBottom: 28,
  },
  chip: {
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().card,
  },
  chipPressed: { opacity: 0.85 },
  chipText: {
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: themeColor().text,
  },
  messages: { gap: 12, marginTop: 4 },
  userRow: { alignItems: "flex-end", width: "100%" },
  userBubble: {
    maxWidth: "85%",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
    borderBottomRightRadius: 6,
  },
  userBubbleText: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().onPitch, lineHeight: 22 },
  assistantRow: { alignItems: "flex-start", width: "100%" },
  assistantCard: {
    maxWidth: "92%",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: themeColor().card,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderBottomLeftRadius: 6,
  },
  assistantText: { fontSize: 16, fontFamily: "Inter_400Regular", color: themeColor().text, lineHeight: 22 },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  dot: {
    fontSize: 24, fontFamily: "InstrumentSerif_400Regular",
    lineHeight: 22,
    color: themeColor().pitchText,
    fontWeight: "900",
  },
  composer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
    backgroundColor: themeColor().overlaySubtle,
    textAlignVertical: "top",
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.38 },
  sendBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().onPitch },
  wordCount: {
    marginBottom: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
    opacity: 0.35,
    color: themeColor().text,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

