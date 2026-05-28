import { useAuth } from "@/context/AuthContext";
import {
  ADMIN_DB_GROUP_LABELS,
  ADMIN_DB_SECTIONS,
  fetchAdminDatabaseOverview,
  fetchAdminDatabaseTable,
  formatAdminDbCount,
  formatAdminDbRecordSummary,
  formatAdminDbRelativeTime,
  recordMatchesSearch,
  statusBadgeStyle,
  type AdminDbOverviewResponse,
  type AdminDbSectionDef,
  type AdminDbTableKey,
  type AdminDbTableResponse,
} from "@/lib/adminDatabase";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type ViewMode = "grid" | "table";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const st = statusBadgeStyle(status);
  return (
    <View style={[styles.badge, { backgroundColor: st.bg, borderColor: st.border }]}>
      <Text style={[styles.badgeText, { color: st.text }]}>{status.replace(/_/g, " ")}</Text>
    </View>
  );
}

function SectionCard({
  section,
  summary,
  cardWidth,
  onPress,
}: {
  section: AdminDbSectionDef;
  summary: { total_count: number; last_updated: string | null } | undefined;
  cardWidth: number;
  onPress: () => void;
}) {
  const count = summary?.total_count ?? 0;
  const updated = formatAdminDbRelativeTime(summary?.last_updated);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionCard,
        { width: cardWidth },
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={styles.sectionEmoji}>{section.emoji}</Text>
      <Text style={styles.sectionTitle} numberOfLines={2}>
        {section.title}
      </Text>
      <Text style={styles.sectionCount}>{formatAdminDbCount(count)}</Text>
      <Text style={styles.sectionUpdated}>Updated {updated}</Text>
    </Pressable>
  );
}

function JsonDetailModal({
  visible,
  record,
  onClose,
}: {
  visible: boolean;
  record: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const json = useMemo(() => {
    if (!record) return "";
    try {
      return JSON.stringify(record, null, 2);
    } catch {
      return String(record);
    }
  }, [record]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.jsonModal} edges={["top", "bottom"]}>
        <View style={styles.jsonHeader}>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
            <FontAwesome name="close" size={18} color="#fff" />
            <Text style={styles.backBtnText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.jsonScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.jsonText} selectable>
            {json}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export default function AdminDatabaseScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<AdminDbSectionDef | null>(null);

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminDbOverviewResponse["sections"] | null>(null);

  const [tableLoading, setTableLoading] = useState(false);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableData, setTableData] = useState<AdminDbTableResponse | null>(null);

  const [search, setSearch] = useState("");
  const [jsonRecord, setJsonRecord] = useState<Record<string, unknown> | null>(null);

  const horizontalPad = 16;
  const gap = 10;
  const cardWidth = Math.floor((width - horizontalPad * 2 - gap * 2) / 3);

  const loadOverview = useCallback(async () => {
    if (!token) {
      setOverviewError("Not signed in.");
      setOverviewLoading(false);
      return;
    }
    setOverviewError(null);
    setOverviewLoading(true);
    const r = await fetchAdminDatabaseOverview(token);
    setOverviewLoading(false);
    if (!r.ok) {
      setOverviewError(r.error);
      setOverview(null);
      return;
    }
    setOverview(r.data.sections);
  }, [token]);

  const loadTable = useCallback(
    async (table: AdminDbTableKey, opts?: { background?: boolean }) => {
      if (!token) {
        setTableError("Not signed in.");
        return;
      }
      const bg = opts?.background === true;
      if (!bg) setTableLoading(true);
      else setTableRefreshing(true);
      setTableError(null);
      const r = await fetchAdminDatabaseTable(token, table);
      if (!bg) setTableLoading(false);
      else setTableRefreshing(false);
      if (!r.ok) {
        setTableError(r.error);
        setTableData(null);
        return;
      }
      setTableData(r.data);
    },
    [token],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const openSection = useCallback(
    (section: AdminDbSectionDef) => {
      void hapticTap();
      setSelected(section);
      setViewMode("table");
      setSearch("");
      setTableData(null);
      void loadTable(section.key);
    },
    [loadTable],
  );

  const closeTable = useCallback(() => {
    void hapticTap();
    setViewMode("grid");
    setSelected(null);
    setTableData(null);
    setSearch("");
    setTableError(null);
  }, []);

  const filteredRecords = useMemo(() => {
    if (!selected || !tableData?.records) return [];
    return tableData.records.filter((row) => recordMatchesSearch(selected.key, row, search));
  }, [selected, tableData?.records, search]);

  const groupedSections = useMemo(() => {
    const groups: { label: string; items: AdminDbSectionDef[] }[] = [];
    const order: AdminDbSectionDef["group"][] = ["pickup", "tournaments", "players", "chat", "payments"];
    for (const g of order) {
      const items = ADMIN_DB_SECTIONS.filter((s) => s.group === g);
      if (items.length) groups.push({ label: ADMIN_DB_GROUP_LABELS[g], items });
    }
    return groups;
  }, []);

  if (viewMode === "table" && selected) {
    const total = tableData?.total_count ?? overview?.[selected.key]?.total_count ?? 0;
    const showing = filteredRecords.length;

    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.tableHeader}>
          <Pressable onPress={closeTable} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
            <FontAwesome name="chevron-left" size={14} color={LIME} />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
          <View style={styles.tableHeaderCenter}>
            <Text style={styles.tableHeaderEmoji}>{selected.emoji}</Text>
            <Text style={styles.tableHeaderTitle}>{selected.title}</Text>
            <Text style={styles.tableHeaderCount}>
              {formatAdminDbCount(total)}
              {search.trim() ? ` · showing ${showing}` : ""}
            </Text>
          </View>
          <View style={styles.backBtnPlaceholder} />
        </View>

        <View style={styles.searchRow}>
          <FontAwesome name="search" size={14} color="rgba(255,255,255,0.4)" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search records…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        {tableLoading && !tableData ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={LIME} />
          </View>
        ) : tableError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{tableError}</Text>
            <Pressable onPress={() => void loadTable(selected.key)} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.tableList}
            refreshControl={
              <RefreshControl
                refreshing={tableRefreshing}
                onRefresh={() => void loadTable(selected.key, { background: true })}
                tintColor={LIME}
              />
            }
            keyboardShouldPersistTaps="handled"
          >
            {filteredRecords.length === 0 ? (
              <Text style={styles.emptyText}>
                {search.trim() ? "No records match your search." : "No records yet."}
              </Text>
            ) : (
              filteredRecords.map((row, idx) => {
                const { title, subtitle, status, playerName } = formatAdminDbRecordSummary(selected.key, row);
                const key =
                  typeof row.id === "string"
                    ? row.id
                    : typeof row.run_id === "string"
                      ? `${row.run_id}-${idx}`
                      : `row-${idx}`;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      void hapticTap();
                      setJsonRecord(row);
                    }}
                    style={({ pressed }) => [styles.recordRow, pressed && { opacity: 0.9 }]}
                  >
                    <View style={styles.recordTop}>
                      <Text style={styles.recordTitle} numberOfLines={2}>
                        {title}
                      </Text>
                      <StatusBadge status={status} />
                    </View>
                    {playerName ? (
                      <Text style={styles.recordPlayerName} numberOfLines={1}>
                        {playerName}
                      </Text>
                    ) : null}
                    {subtitle ? (
                      <Text style={styles.recordSubtitle} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}
                    <Text style={styles.recordHint}>Tap for full JSON</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}

        <JsonDetailModal visible={jsonRecord != null} record={jsonRecord} onClose={() => setJsonRecord(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.gridScroll}
        refreshControl={<RefreshControl refreshing={overviewLoading} onRefresh={() => void loadOverview()} tintColor={LIME} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
            <FontAwesome name="chevron-left" size={14} color={LIME} />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </View>

        <Text style={styles.h1}>Database</Text>
        <Text style={styles.lead}>Browse live tables — tap a section for recent records.</Text>

        {overviewError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{overviewError}</Text>
            <Pressable onPress={() => void loadOverview()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {overviewLoading && !overview ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={LIME} />
          </View>
        ) : (
          groupedSections.map((group) => (
            <View key={group.label} style={styles.groupBlock}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.cardGrid}>
                {group.items.map((section) => (
                  <SectionCard
                    key={section.key}
                    section={section}
                    summary={overview?.[section.key]}
                    cardWidth={cardWidth}
                    onPress={() => openSection(section)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  gridScroll: { paddingHorizontal: 16, paddingBottom: 48 },
  topRow: { marginTop: 4, marginBottom: 8 },
  h1: { color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  lead: { color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  groupBlock: { marginBottom: 22 },
  groupLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sectionCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    padding: 12,
    minHeight: 118,
  },
  sectionEmoji: { fontSize: 22, marginBottom: 6 },
  sectionTitle: { color: "#fff", fontSize: 13, fontWeight: "800", lineHeight: 17, marginBottom: 6 },
  sectionCount: { color: LIME, fontSize: 12, fontWeight: "700" },
  sectionUpdated: { color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 4 },
  centered: { paddingVertical: 48, alignItems: "center", justifyContent: "center" },
  errorBanner: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  errorText: { color: "#f87171", fontSize: 14, textAlign: "center" },
  retryBtn: {
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  tableHeaderCenter: { flex: 1, alignItems: "center" },
  tableHeaderEmoji: { fontSize: 20 },
  tableHeaderTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginTop: 2 },
  tableHeaderCount: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, minWidth: 72 },
  backBtnPlaceholder: { minWidth: 72 },
  backBtnText: { color: LIME, fontSize: 14, fontWeight: "700" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  searchIcon: { marginLeft: 12 },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  tableList: { paddingHorizontal: 16, paddingBottom: 40 },
  emptyText: { color: "rgba(255,255,255,0.45)", textAlign: "center", marginTop: 32, fontSize: 14 },
  recordRow: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  recordTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  recordTitle: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "800", lineHeight: 20 },
  recordPlayerName: { color: "rgba(255,255,255,0.75)", fontSize: 14, marginTop: 6, fontWeight: "500" },
  recordSubtitle: { color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 4, lineHeight: 18 },
  recordHint: { color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "capitalize" },
  jsonModal: { flex: 1, backgroundColor: BG },
  jsonHeader: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  jsonScroll: { padding: 16, paddingBottom: 40 },
  jsonText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
});
