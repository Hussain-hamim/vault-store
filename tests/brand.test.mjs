import test from "node:test";
import ts from "typescript";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  SHORTCUTS,
  availableActions,
  shortcutAction,
  shortcutLabel,
} from "../src/shortcuts.mjs";
import { supportLinks } from "../server/support.mjs";
const require = createRequire(import.meta.url);
const { brand, userDataPath } = require("../electron/brand.cjs");
const event = (key, props = {}) => ({ key, ctrlKey: true, ...props });
const options = {
  permissions: [
    "inventory",
    "sales",
    "purchases",
    "people",
    "reports",
    "finance",
    "settings",
  ],
};
test("app display name changes without moving the established store profile", () => {
  assert.equal(brand.name, "Radefy TechMart");
  assert.equal(brand.company, "Radefy Systems");
  assert.match(userDataPath("/profiles"), /profiles[/\\]Vault Store$/);
  assert.equal(userDataPath("/profiles", "/isolated-store"), "/isolated-store");
  const pkg = require("../package.json");
  assert.equal(pkg.build.productName, brand.name);
  assert.equal(pkg.version, brand.version);
  assert.equal(pkg.build.appId, "com.vault.store");
  assert.ok(pkg.build.files.includes("shared/**/*"));
});
test("shortcuts use only Ctrl/Cmd and one key on Windows, Mac and non-Latin keyboards", () => {
  assert.equal(shortcutAction(event("n"), options), "product");
  assert.equal(
    shortcutAction(event("s", { ctrlKey: false, metaKey: true }), options),
    "sale",
  );
  assert.equal(
    shortcutAction(event("ب", { code: "KeyB" }), options),
    "purchase",
  );
  assert.equal(shortcutAction(event("k"), options), "palette");
  assert.equal(
    shortcutAction(event("F1", { ctrlKey: false }), options),
    "support",
  );
  assert.equal(shortcutLabel("Ctrl + S", true), "⌘ + S");
  const combos = SHORTCUTS.filter((a) => a.combo).map((a) => a.combo);
  assert.equal(new Set(combos).size, combos.length);
  assert.ok(combos.every((combo) => combo.split(" + ").length <= 2));
});
test("shortcuts and palette actions respect permissions and leave native editing and printing keys alone", () => {
  assert.equal(shortcutAction(event("n"), { permissions: ["sales"] }), null);
  assert.equal(shortcutAction(event("s"), { permissions: ["sales"] }), "sale");
  assert.ok(!availableActions(["sales"]).some((a) => a.id === "reports"));
  assert.ok(availableActions([]).some((a) => a.id === "support"));
  for (const key of ["c", "v", "x", "z", "a", "p", "r", "+", "=", "-", "0"])
    assert.equal(shortcutAction(event(key), options), null);
});
test("shortcuts protect typing, overlays, IME, AltGr and reject three-key combinations", () => {
  for (const props of [{ overlay: true }, { editable: true }])
    assert.equal(shortcutAction(event("s"), { ...options, ...props }), null);
  for (const props of [
    { repeat: true },
    { isComposing: true },
    { defaultPrevented: true },
    { getModifierState: () => true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true },
  ])
    assert.equal(shortcutAction(event("s", props), options), null);
  assert.equal(
    shortcutAction(event("f"), { ...options, editable: true }),
    "search",
  );
  assert.equal(shortcutAction(event("k"), { ...options, overlay: true }), null);
});
test("support links accept configured contacts and reject unsafe destinations", () => {
  assert.deepEqual(supportLinks(brand.support), []);
  assert.deepEqual(
    supportLinks({
      website: "https://example.com/support",
      email: "help@example.com",
      whatsapp: "+93 700 123 456",
    }).map((a) => a.url),
    [
      "https://example.com/support",
      "mailto:help@example.com",
      "https://wa.me/93700123456",
    ],
  );
  for (const website of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://example.com",
  ])
    assert.deepEqual(supportLinks({ website }), []);
  assert.deepEqual(
    supportLinks({
      email: "x@example.com\r\nBcc:other@example.com",
      whatsapp: "javascript:123",
    }),
    [],
  );
});
test("desktop icons and web favicon use the new generated artwork", () => {
  const png = readFileSync(new URL("../build/icon.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1024);
  const ico = readFileSync(new URL("../build/icon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 6);
  assert.equal(
    readFileSync(new URL("../build/icon.icns", import.meta.url))
      .subarray(0, 4)
      .toString(),
    "icns",
  );
  assert.match(
    readFileSync(new URL("../index.html", import.meta.url), "utf8"),
    /brand\/favicon.png/,
  );
});

test("branding, company pages and shortcut labels exist in all three languages", async () => {
  const catalogs = {};
  for (const locale of ["en", "ps", "prs"]) {
    const source = readFileSync(
      new URL("../src/i18n/" + locale + ".ts", import.meta.url),
      "utf8",
    );
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    catalogs[locale] = (
      await import(
        "data:text/javascript;base64," + Buffer.from(output).toString("base64")
      )
    )[locale];
    assert.match(catalogs[locale].app.title, /Radefy TechMart/);
    assert.equal(catalogs[locale].app.brand, brand.name);
  }
  for (const locale of ["ps", "prs"]) {
    for (const group of ["company", "shortcuts", "notifications", "photos"]) {
      assert.deepEqual(
        Object.keys(catalogs[locale][group]).sort(),
        Object.keys(catalogs.en[group]).sort(),
      );
      for (const value of Object.values(catalogs[locale][group]))
        assert.ok(typeof value === "string" && value.length > 0);
    }
    assert.ok(catalogs[locale].nav.about && catalogs[locale].nav.support);
  }
});
