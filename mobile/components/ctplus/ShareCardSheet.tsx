import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import type { PlayerCardData } from "@/components/profile/PlayerCard";
import PremiumShareCard from "@/components/profile/PremiumShareCard";
import { useCtPlus } from "@/context/CtPlusContext";
import { CARD_DESIGNS, CARD_SIZES, type CardDesignId, type CardSizeId } from "@/lib/cardDesigns";
import { shareStoryImage } from "@/lib/shareStory";
import { headline, playerCardColor, radius, themeColor, useThemedStyles } from "@/theme";

const THUMB_W = 76;

/**
 * Design picker for the share card (only mounted when CTPLUS_ENABLED). Classic is the free card and shares
 * through `onShareClassic`, exactly as before; it never reads the entitlement. Locked designs open the paywall.
 */
export default function ShareCardSheet({
  visible,
  onClose,
  data,
  onShareClassic,
  classicBusy,
  classicDisabled,
}: {
  visible: boolean;
  onClose: () => void;
  data: PlayerCardData;
  onShareClassic: () => Promise<void>;
  classicBusy: boolean;
  classicDisabled: boolean;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { isPlus } = useCtPlus();
  const [design, setDesign] = useState<CardDesignId>("classic");
  const [size, setSize] = useState<CardSizeId>("story");
  const [paywall, setPaywall] = useState<Exclude<CardDesignId, "classic"> | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<View>(null);

  const premium = design !== "classic";
  const unlocked = (id: CardDesignId) => id === "classic" || isPlus;

  function pick(id: CardDesignId) {
    if (!unlocked(id)) {
      setPaywall(id as Exclude<CardDesignId, "classic">);
      return;
    }
    setReady(false);
    setDesign(id);
  }

  async function share() {
    if (design === "classic") {
      await onShareClassic();
      return;
    }
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      await shareStoryImage(cardRef, "Share my card", CARD_SIZES[size]);
    } catch (e) {
      console.warn("[ctplus] share failed:", e);
      Alert.alert("Couldn't share", "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = design === "classic" ? classicDisabled || classicBusy : !ready || busy;
  const working = design === "classic" ? classicBusy : busy;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Share your card</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <FontAwesome name="times" size={18} color={themeColor().muted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <View style={styles.designs}>
            {CARD_DESIGNS.map((d) => {
              const locked = !unlocked(d.id);
              const selected = design === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => pick(d.id)}
                  style={styles.designCell}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${d.name}${locked ? ", locked, CT+" : ""}`}
                >
                  <View style={[styles.thumbWrap, selected && styles.thumbSelected]}>
                    {d.id === "classic" ? (
                      <View style={[styles.classicThumb, { width: THUMB_W, height: (THUMB_W * 16) / 9 }]}>
                        <Text style={styles.classicThumbText}>Free</Text>
                      </View>
                    ) : (
                      <PremiumShareCard design={d.id as Exclude<CardDesignId, "classic">} size="story" data={data} width={THUMB_W} />
                    )}
                    {locked ? (
                      <View style={styles.lock}>
                        <FontAwesome name="lock" size={14} color={themeColor().onPhoto} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.designName}>{d.name}</Text>
                </Pressable>
              );
            })}
          </View>

          {premium ? (
            <View style={styles.sizes}>
              {(Object.keys(CARD_SIZES) as CardSizeId[]).map((id) => (
                <Pressable
                  key={id}
                  onPress={() => {
                    setReady(false);
                    setSize(id);
                  }}
                  style={[styles.sizeChip, size === id && styles.sizeChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: size === id }}
                >
                  <Text style={[styles.sizeText, size === id && styles.sizeTextOn]}>
                    {CARD_SIZES[id].label} · {CARD_SIZES[id].width}×{CARD_SIZES[id].height}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable
            onPress={() => void share()}
            disabled={disabled}
            style={({ pressed }) => [styles.cta, (pressed || disabled) && styles.dim]}
            accessibilityRole="button"
          >
            {working ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.ctaText}>Share</Text>}
          </Pressable>
        </ScrollView>

        {premium ? (
          <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <PremiumShareCard
              key={`${design}-${size}`}
              ref={cardRef}
              design={design as Exclude<CardDesignId, "classic">}
              size={size}
              data={data}
              onReady={() => setReady(true)}
            />
          </View>
        ) : null}

        <CtPlusPaywall
          design={paywall}
          data={data}
          onClose={() => setPaywall(null)}
          onPurchased={() => {
            if (paywall) {
              setReady(false);
              setDesign(paywall);
            }
            setPaywall(null);
          }}
        />
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingTop: 24 },
    title: { color: c.text, fontSize: 22, ...headline },
    body: { paddingHorizontal: 20, gap: 20 },
    designs: { flexDirection: "row", justifyContent: "space-between" },
    designCell: { alignItems: "center", gap: 8 },
    thumbWrap: { borderRadius: radius.button, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
    thumbSelected: { borderColor: c.pitchText },
    classicThumb: { backgroundColor: playerCardColor.bg, alignItems: "center", justifyContent: "center" },
    classicThumbText: { color: playerCardColor.name, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    lock: { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: c.photoScrim, alignItems: "center", justifyContent: "center" },
    designName: { color: c.text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    sizes: { flexDirection: "row", gap: 8 },
    sizeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line },
    sizeChipOn: { backgroundColor: c.pitch, borderColor: c.pitchText },
    sizeText: { color: c.text, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    sizeTextOn: { color: c.onPitch },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    dim: { opacity: 0.5 },
    offscreen: { position: "absolute", top: 0, left: -10000 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
