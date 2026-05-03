import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Drop-in replacement for AsyncStorage when the native module is unavailable
 * (e.g. AsyncStorage v3 + Expo Go / refresh tick: "Native module is null").
 * After the first failure, falls back to an in-memory map for the session.
 */
const mem = new Map<string, string>();
let preferMemory = false;

export const appAsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    if (preferMemory) return mem.has(key) ? (mem.get(key) as string) : null;
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      preferMemory = true;
      return mem.has(key) ? (mem.get(key) as string) : null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (preferMemory) {
      mem.set(key, value);
      return;
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      preferMemory = true;
      mem.set(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (preferMemory) {
      mem.delete(key);
      return;
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      preferMemory = true;
      mem.delete(key);
    }
  },
};
