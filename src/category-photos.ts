import { api } from "./api";

let map: Record<string, string> = {};
let loaded = false;
let inflight: Promise<Record<string, string>> | null = null;

export function categoryPhotoFor(category?: string) {
  const name = String(category || "").trim();
  if (!name) return "";
  if (map[name]) return map[name];
  const hit = Object.entries(map).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return hit?.[1] || "";
}

export function categoryPhotoMap() {
  return map;
}

export async function ensureCategoryPhotos() {
  if (loaded) return map;
  if (!inflight) {
    inflight = api<Record<string, string>>("categoryImages")
      .then((rows) => {
        map =
          rows && typeof rows === "object" && !Array.isArray(rows) ? rows : {};
        loaded = true;
        return map;
      })
      .catch(() => {
        map = {};
        loaded = true;
        return map;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateCategoryPhotos(
  next?: Record<string, string> | null,
) {
  if (next && typeof next === "object" && !Array.isArray(next)) {
    map = next;
    loaded = true;
    return;
  }
  loaded = false;
  map = {};
}

window.addEventListener("vault-session-expired", () =>
  invalidateCategoryPhotos(),
);
