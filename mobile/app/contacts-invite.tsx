import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Contacts from "expo-contacts/legacy";
import { useRouter } from "expo-router";
import * as SMS from "expo-sms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { CONTACTS_INVITE_ENABLED, dedupeByNumber, filterInviteContacts, inviteContactsFrom, inviteOne, type InviteContact } from "@/lib/contactsInvite";
import { hapticTap } from "@/lib/haptics";
import { buildInviteMessage } from "@/lib/invite";
import { radius, themeColor, useThemedStyles } from "@/theme";

/** Pause before the next person's composer opens, so Skip or Done can be tapped. */
const NEXT_DELAY_MS = 1500;

type Stage = "intro" | "loading" | "denied" | "list";

/**
 * Pick friends from the phone's contacts and text them the invite. Contacts are read on the phone, kept in memory
 * on this screen and handed to the system message composer. Nothing about them is sent to our server.
 */
export default function ContactsInviteScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [stage, setStage] = useState<Stage>("intro");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  const [limited, setLimited] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queue, setQueue] = useState<InviteContact[] | null>(null);
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<"composing" | "next">("composing");
  const messageRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by Done and on leaving the screen: nothing further opens after that, even if a composer is still up. */
  const stoppedRef = useRef(false);
  /** True while a composer is open, so a double tap cannot open a second one. */
  const composingRef = useRef(false);

  const visible = useMemo(() => filterInviteContacts(contacts, query), [contacts, query]);

  const loadContacts = useCallback(async () => {
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers] });
    setContacts(inviteContactsFrom(data));
    setStage("list");
  }, []);

  /** Shows the system permission prompt only when the answer is not already known. Never throws. */
  const start = useCallback(async () => {
    void hapticTap();
    setNotice(null);
    setStage("loading");
    try {
      let perm = await Contacts.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Contacts.requestPermissionsAsync();
      if (!perm.granted) {
        setCanAskAgain(perm.canAskAgain);
        setStage("denied");
        return;
      }
      setLimited(perm.accessPrivileges === "limited");
      await loadContacts();
    } catch {
      setNotice("We couldn't read your contacts. Please try again.");
      setStage("intro");
    }
  }, [loadContacts]);

  const toggle = useCallback((id: string) => {
    void hapticTap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stoppedRef.current = true;
      clearTimer();
    },
    [clearTimer],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearTimer();
    router.back();
  }, [clearTimer, router]);

  /** Opens the composer for one person (never a group), then moves on whether the message was sent or cancelled. */
  async function openFor(list: InviteContact[], i: number) {
    clearTimer();
    if (stoppedRef.current || composingRef.current) return;
    composingRef.current = true;
    setPos(i);
    setPhase("composing");
    try {
      await inviteOne(list[i]!, messageRef.current, {
        isSmsAvailable: () => SMS.isAvailableAsync(),
        sendSms: (addresses, message) => SMS.sendSMSAsync(addresses, message),
        share: (message) => Share.share({ message }),
      });
    } catch {
      setNotice("Couldn't open Messages for that person.");
    } finally {
      composingRef.current = false;
    }
    queueNext(list, i + 1);
  }

  /** Shows "Next: <name>" and opens that person's composer after a short pause (Skip and Done cancel it). */
  function queueNext(list: InviteContact[], i: number) {
    if (stoppedRef.current) return;
    if (i >= list.length) {
      router.back();
      return;
    }
    setPos(i);
    setPhase("next");
    timerRef.current = setTimeout(() => void openFor(list, i), NEXT_DELAY_MS);
  }

  const invite = useCallback(async () => {
    if (sending || selected.size === 0) return;
    setSending(true);
    setNotice(null);
    try {
      const list = dedupeByNumber(contacts.filter((c) => selected.has(c.id)));
      stoppedRef.current = false;
      messageRef.current = await buildInviteMessage(session?.access_token);
      setQueue(list);
      void openFor(list, 0);
    } catch {
      setNotice("Couldn't open Messages. Please try again.");
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selected, sending, session?.access_token]);

  if (!CONTACTS_INVITE_ENABLED) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>This is not available yet.</Text>
      </View>
    );
  }

  if (queue) {
    const person = queue[pos];
    return (
      <View style={[styles.screen, styles.centerPad]}>
        <Text style={styles.count}>
          {pos + 1} of {queue.length}
        </Text>
        <Text style={styles.title}>{phase === "next" ? `Next: ${person?.name ?? ""}` : (person?.name ?? "")}</Text>
        <Text style={styles.body}>{phase === "next" ? "Opening Messages…" : "Send the invite, or cancel to move on. Tap Done to stop."}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {phase === "next" ? (
          <>
            <Pressable onPress={() => void openFor(queue, pos)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.btnText}>Open message</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                clearTimer();
                queueNext(queue, pos + 1);
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.link}>Skip</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={stop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Stop inviting">
          <Text style={styles.link}>Done</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === "list") {
    const count = selected.size;
    return (
      <View style={styles.screen}>
        <View style={styles.searchRow}>
          <FontAwesome name="search" size={15} color={themeColor().muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your contacts"
            placeholderTextColor={themeColor().muted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search your contacts"
          />
        </View>
        {limited ? (
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button">
            <Text style={styles.limited}>You shared some of your contacts. Tap to change which ones in Settings.</Text>
          </Pressable>
        ) : null}
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
          ListEmptyComponent={
            <Text style={styles.empty}>{contacts.length === 0 ? "No contacts with a phone number." : "No contacts match that search."}</Text>
          }
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                style={styles.row}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.name}
              >
                <View style={[styles.box, on && styles.boxOn]}>{on ? <FontAwesome name="check" size={12} color={themeColor().onPitch} /> : null}</View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.phone} numberOfLines={1}>
                    {item.phone}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Pressable
            onPress={() => void invite()}
            disabled={count === 0 || sending}
            style={({ pressed }) => [styles.btn, (count === 0 || sending) && styles.disabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ disabled: count === 0 || sending }}
          >
            <Text style={styles.btnText}>{sending ? "Opening…" : count === 0 ? "Invite" : `Invite ${count}`}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, styles.centerPad]}>
      {stage === "loading" ? (
        <ActivityIndicator color={themeColor().text} />
      ) : stage === "denied" ? (
        <>
          <Text style={styles.title}>Contacts access is off</Text>
          <Text style={styles.body}>
            {canAskAgain
              ? "We need access to your contacts to show you who to invite. They stay on your phone."
              : "Turn on Contacts for Competitive Together in Settings to pick friends to invite. They stay on your phone."}
          </Text>
          <Pressable
            onPress={() => (canAskAgain ? void start() : void Linking.openSettings())}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>{canAskAgain ? "Try again" : "Open Settings"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <FontAwesome name="address-book-o" size={32} color={themeColor().pitchText} />
          <Text style={styles.title}>Invite friends</Text>
          <Text style={styles.body}>Pick friends to invite. Each friend gets their own message. Contacts stay on your phone.</Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Pressable onPress={() => void start()} style={({ pressed }) => [styles.btn, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.btnText}>Choose friends</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 },
    centerPad: { alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    title: { color: c.text, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center" },
    body: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
    count: { color: c.muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    link: { color: c.pitchText, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", paddingVertical: 8 },
    notice: { color: c.muted, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    btn: { alignSelf: "stretch", backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", marginTop: 8 },
    btnText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    disabled: { opacity: 0.35 },
    pressed: { opacity: 0.85 },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 12,
      marginTop: 12,
      paddingHorizontal: 12,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: c.overlaySubtle,
    },
    searchInput: { flex: 1, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    limited: { color: c.pitchText, fontSize: 13, fontFamily: "Inter_600SemiBold", paddingHorizontal: 16, paddingTop: 10 },
    empty: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", padding: 24 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
    rowText: { flex: 1, minWidth: 0 },
    name: { color: c.text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    phone: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
    box: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.line, alignItems: "center", justifyContent: "center" },
    boxOn: { backgroundColor: c.pitch, borderColor: c.pitchText },
    footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
