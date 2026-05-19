import { Modal, Pressable, Text, View } from "react-native";
import { accountStyles as styles } from "./accountStyles";

type SelectModalProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onSelect: (v: T) => void;
  onClose: () => void;
};

export function SelectModal<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: SelectModalProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close picker" />
        <View style={styles.modalCardWrap} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            {options.map((opt) => {
              const selected = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    onSelect(opt.value);
                    onClose();
                  }}
                  style={[styles.modalRow, selected && styles.modalRowSelected]}
                >
                  <Text style={[styles.modalRowText, selected && styles.modalRowTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
