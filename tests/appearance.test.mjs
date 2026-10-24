import test from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  readTheme,
  themeStorageKey,
} from "../src/appearance-model.mjs";

test("five built-ins, default for new users and signed-out screens", () => {
  assert.deepEqual(
    THEMES.map((t) => t.id),
    ["navy", "light", "dark", "ocean", "sand"],
  );
  const storage = { getItem: () => null };
  assert.equal(readTheme("new-user", storage), "navy");
  assert.equal(readTheme(undefined, storage), "navy");
});
test("preferences are isolated per user and survive reads", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) };
  data.set(themeStorageKey("one"), "dark");
  data.set(themeStorageKey("two"), "ocean");
  for (let i = 0; i < 2; i++) {
    assert.equal(readTheme("one", storage), "dark");
    assert.equal(readTheme("two", storage), "ocean");
    assert.equal(readTheme("three", storage), "navy");
    assert.equal(readTheme(undefined, storage), "navy");
  }
});
test("invalid saved values and unavailable storage fall back safely", () => {
  assert.equal(readTheme("one", { getItem: () => "not-a-theme" }), "navy");
  assert.equal(
    readTheme("one", {
      getItem: () => {
        throw Error("blocked");
      },
    }),
    "navy",
  );
});
