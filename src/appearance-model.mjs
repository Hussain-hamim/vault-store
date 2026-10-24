export const THEMES = [
  { id: "navy", colors: ["#203249", "#f9b09b", "#f3f6fa", "#ffffff"] },
  { id: "light", colors: ["#243c60", "#a1b5e8", "#f5f6f8", "#ffffff"] },
  { id: "dark", colors: ["#17202b", "#f9b09b", "#222d3b", "#d9e3ef"] },
  { id: "ocean", colors: ["#183d40", "#9bdedb", "#f0f8f7", "#ffffff"] },
  { id: "sand", colors: ["#403725", "#dfc596", "#faf6ed", "#ffffff"] },
];
export const themeStorageKey = (userId) => `radefy.appearance.v1.${userId}`;
export function readTheme(userId, storage) {
  if (userId == null) return "navy";
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(
      themeStorageKey(userId),
    );
    return THEMES.find((theme) => theme.id === saved)?.id || "navy";
  } catch {
    return "navy";
  }
}
