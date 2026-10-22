import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { siteOrigin } from "@/lib/env";
import { radius, themeColor, useThemedStyles } from "@/theme";

const OUTCOMES = [
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" },
  { key: "needs_permit", label: "Needs permit" },
  { key: "pending", label: "Pending" },
  { key: "no_answer", label: "No answer" },
] as const;
const UNITS = ["hour", "game", "season", "day"] as const;
const RESIDENCY = [
  { key: "residents_only", label: "Residents only" },
  { key: "non_resident_fee", label: "Non-resident fee" },
  { key: "open", label: "Open to all" },
] as const;

type Reply = {
  id: string;
  created_at: string;
  replied_at: string;
  replied_by_name: string | null;
  outcome: string;
  apply_mode: string;
  from_venue: boolean;
  undone_at: string | null;
  changes: { field: string; undone_at: string | null }[];
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const outcomeLabel = (k: string) => OUTCOMES.find((o) => o.key === k)?.label ?? k;

/**
 * Admin only (the server checks too). Records what a venue answered to a field request. On save the request moves to approved,
 * declined or waiting, and, if "Apply to the field page" is on, the answers are written to the field with an audit trail that
 * can be undone from this screen.
 */
export function RecordReply({ requestId, token, onSaved }: { requestId: string; token: string | null; onSaved: () => void }) {
  useThemedStyles(publish_styles);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [who, setWho] = useState("");
  const [whoContact, setWhoContact] = useState("");
  const [date, setDate] = useState(today());
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["key"]>("approved");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number] | null>("hour");
  const [permit, setPermit] = useState<"yes" | "no" | null>(null);
  const [residency, setResidency] = useState<(typeof RESIDENCY)[number]["key"] | null>(null);
  const [how, setHow] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [fromVenue, setFromVenue] = useState(true);
  const [noDay, setNoDay] = useState(false);
  const [apply, setApply] = useState(true);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const origin = siteOrigin();
      if (!origin || !token) throw new Error("Not signed in.");
      const r = await fetch(`${origin}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok) throw new Error(typeof j?.error === "string" ? j.error : "Please try again.");
      return j ?? {};
    },
    [token],
  );

  const loadReplies = useCallback(async () => {
    try {
      const j = await call(`/api/admin/field-requests/reply?request_id=${encodeURIComponent(requestId)}`);
      setReplies((j.items as Reply[] | undefined) ?? []);
    } catch {
      /* the list is a convenience; the form still works */
    }
  }, [call, requestId]);

  useEffect(() => {
    void loadReplies();
  }, [loadReplies]);

  async function save() {
    setBusy(true);
    try {
      const j = await call("/api/admin/field-requests/reply", {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          apply_to_venue: apply,
          replied_by_name: who,
          replied_by_contact: whoContact,
          replied_at: date,
          outcome,
          price_amount: price.trim() === "" ? null : price,
          price_unit: price.trim() === "" ? null : unit,
          permit_required: permit,
          residency_rule: residency,
          how_to_book: how,
          contact,
          notes,
          from_venue: fromVenue,
          no_field_that_day: noDay,
        }),
      });
      const fields = (j.fields as string[] | undefined) ?? [];
      Alert.alert("Reply saved", apply ? (fields.length ? `Updated the field page: ${fields.filter((f) => f !== "locked_fields").length} values.` : j.mode === "availability" ? "Saved as an availability note." : "Nothing on the field page changed.") : "The field page was not changed.");
      setOpen(false);
      await loadReplies();
      onSaved();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmUndo(r: Reply) {
    Alert.alert("Undo this reply?", "The field page goes back to what it said before. The request goes back to its earlier status if nobody has moved it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const j = await call("/api/admin/field-requests/reply/undo", { method: "POST", body: JSON.stringify({ reply_id: r.id }) });
              const skipped = (j.skipped as string[] | undefined) ?? [];
              Alert.alert("Undone", skipped.length ? `Left alone because they changed again: ${skipped.join(", ")}.` : "Restored.");
              await loadReplies();
              onSaved();
            } catch (e) {
              Alert.alert("Could not undo", e instanceof Error ? e.message : "Please try again.");
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  const Check = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <FontAwesome name={on ? "check-square" : "square-o"} size={22} color={on ? themeColor().pitchText : themeColor().muted} />
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
  const Chips = <T extends string>({ items, value, onChange }: { items: readonly { key: T; label: string }[]; value: T | null; onChange: (v: T | null) => void }) => (
    <View style={styles.chips}>
      {items.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(value === o.key ? null : o.key)} style={[styles.chip, value === o.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: value === o.key }}>
          <Text style={[styles.chipText, value === o.key && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.box}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.toggleText}>{open ? "Close" : "Record the reply"}</Text>
      </Pressable>

      {replies.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.label}>REPLIES RECORDED</Text>
          {replies.map((r) => {
            const fields = r.changes.filter((c) => c.field !== "locked_fields" && !c.undone_at).map((c) => c.field);
            return (
              <View key={r.id} style={styles.replyRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.replyTitle}>
                    {outcomeLabel(r.outcome)} · {r.replied_at}
                    {r.replied_by_name ? ` · ${r.replied_by_name}` : ""}
                  </Text>
                  <Text style={styles.replySub}>
                    {r.undone_at ? "Undone" : r.apply_mode === "apply" && fields.length ? `Applied: ${fields.join(", ")}` : r.apply_mode === "availability" ? "Saved as an availability note" : "Not applied to the field page"}
                    {r.from_venue ? "" : " · not directly from the venue"}
                  </Text>
                </View>
                {!r.undone_at ? (
                  <Pressable onPress={() => confirmUndo(r)} disabled={busy} style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo this reply">
                    <Text style={styles.undoText}>Undo</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {open ? (
        <View style={styles.form}>
          <Text style={styles.label}>WHO REPLIED</Text>
          <TextInput value={who} onChangeText={setWho} placeholder="Name" placeholderTextColor={themeColor().muted} style={styles.input} accessibilityLabel="Who replied" />
          <TextInput value={whoContact} onChangeText={setWhoContact} placeholder="Email or phone" placeholderTextColor={themeColor().muted} autoCapitalize="none" style={styles.input} accessibilityLabel="Their email or phone" />
          <Text style={styles.label}>DATE (YYYY-MM-DD)</Text>
          <TextInput value={date} onChangeText={setDate} placeholder="2026-10-15" placeholderTextColor={themeColor().muted} autoCapitalize="none" style={styles.input} accessibilityLabel="Reply date" />

          <Text style={styles.label}>OUTCOME</Text>
          <Chips items={OUTCOMES} value={outcome} onChange={(v) => setOutcome(v ?? "approved")} />

          <Text style={styles.label}>PRICE</Text>
          <View style={styles.priceRow}>
            <TextInput value={price} onChangeText={setPrice} placeholder="e.g. 120 (0 = free)" placeholderTextColor={themeColor().muted} keyboardType="decimal-pad" style={[styles.input, { flex: 1 }]} accessibilityLabel="Price" />
          </View>
          <Chips items={UNITS.map((u) => ({ key: u, label: `per ${u}` }))} value={unit} onChange={(v) => setUnit(v ?? "hour")} />

          <Text style={styles.label}>PERMIT REQUIRED</Text>
          <Chips items={[{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] as const} value={permit} onChange={setPermit} />

          <Text style={styles.label}>RESIDENCY</Text>
          <Chips items={RESIDENCY} value={residency} onChange={setResidency} />

          <Text style={styles.label}>HOW TO BOOK</Text>
          <TextInput value={how} onChangeText={setHow} placeholder="Steps or a link" placeholderTextColor={themeColor().muted} autoCapitalize="none" multiline style={[styles.input, styles.multi]} accessibilityLabel="How to book" />
          <Text style={styles.label}>CONTACT AT THE VENUE</Text>
          <TextInput value={contact} onChangeText={setContact} placeholder="Name, email, phone" placeholderTextColor={themeColor().muted} autoCapitalize="none" style={styles.input} accessibilityLabel="Venue contact" />
          <Text style={styles.label}>NOTES</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Anything else they said" placeholderTextColor={themeColor().muted} multiline style={[styles.input, styles.multi]} accessibilityLabel="Notes" />

          <Check on={fromVenue} label="This came directly from the venue" onPress={() => setFromVenue((v) => !v)} />
          <Check on={noDay} label="No field available on that day (availability note only)" onPress={() => setNoDay((v) => !v)} />
          <Check on={apply} label="Apply to the field page" onPress={() => setApply((v) => !v)} />
          <Text style={styles.note}>
            {noDay || outcome === "denied"
              ? "A denial or a no-field day is saved as a dated availability note, never a permanent change to the field."
              : apply
                ? fromVenue
                  ? "Price and permit will show as Verified and be locked from imports."
                  : "Values are saved but stay marked “We’re confirming”."
                : "Only the request is updated."}
          </Text>

          <Pressable onPress={() => void save()} disabled={busy} style={[styles.save, busy && styles.off]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.saveText}>Save reply</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    box: { gap: 10, marginTop: 6 },
    toggle: { alignSelf: "flex-start", borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: c.pitch, backgroundColor: c.card },
    toggleText: { color: c.pitchText, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    form: { gap: 8 },
    label: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted, marginTop: 4 },
    input: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    multi: { minHeight: 70, textAlignVertical: "top" },
    priceRow: { flexDirection: "row", gap: 8 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    chipTextOn: { color: c.onPitch },
    check: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    checkText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: c.text },
    note: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted },
    save: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 14, alignItems: "center", marginTop: 4 },
    saveText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    off: { opacity: 0.6 },
    history: { gap: 8 },
    replyRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.card, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line },
    replyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    replySub: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted },
    undo: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    undoText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.coralText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
