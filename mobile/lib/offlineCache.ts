import AsyncStorage from "@react-native-async-storage/async-storage";

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

function storageKey(key: string): string {
  return `cache_${key}`;
}

export async function cacheData(key: string, data: unknown): Promise<void> {
  const payload = JSON.stringify({ data, cachedAt: Date.now() });
  await AsyncStorage.setItem(storageKey(key), payload);
}

export async function getCachedData<T>(key: string): Promise<{
  data: T;
  cachedAt: number;
  ageMs: number;
} | null> {
  const raw = await AsyncStorage.getItem(storageKey(key));
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as { data?: unknown; cachedAt?: unknown };
    const cachedAt =
      typeof parsed.cachedAt === "number" && Number.isFinite(parsed.cachedAt) ? parsed.cachedAt : null;
    if (cachedAt == null) return null;
    return {
      data: parsed.data as T,
      cachedAt,
      ageMs: Date.now() - cachedAt,
    };
  } catch {
    return null;
  }
}

export async function clearCache(key: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(key));
}

export function formatCacheAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "just now";
  if (ageMs < MS_MINUTE) return "just now";
  if (ageMs < MS_HOUR) {
    const m = Math.floor(ageMs / MS_MINUTE);
    return `${m} min ago`;
  }
  if (ageMs < MS_DAY) {
    const h = Math.floor(ageMs / MS_HOUR);
    return `${h}h ago`;
  }
  const d = Math.floor(ageMs / MS_DAY);
  return `${d}d ago`;
}
