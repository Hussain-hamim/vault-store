const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { profileId } = require("../electron/accounts.cjs");
const {
  isEphemeralDirectory,
  resolveStartupDirectory,
  sanitizeProfiles,
} = require("../electron/profiles.cjs");

test("Temp directories are ephemeral and never preferred over Vault Store", () => {
  // Keep the fake Roaming folder outside OS Temp so Vault Store is not ephemeral.
  const root = fs.mkdtempSync(
    path.join(process.cwd(), ".local", "profiles-test-"),
  );
  const appData = path.join(root, "AppData");
  const vault = path.join(appData, "Vault Store");
  const tempShop = fs.mkdtempSync(
    path.join(os.tmpdir(), "radefy-client-verify-"),
  );
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "vault.sqlite"), "");
  fs.writeFileSync(path.join(tempShop, "vault.sqlite"), "");
  const registry = path.join(appData, "Radefy TechMart profiles.json");
  const selected = registry + ".selected";
  const tempId = profileId(tempShop);
  fs.writeFileSync(
    registry,
    JSON.stringify([
      {
        id: profileId(vault),
        directory: vault,
        name: "Real shop",
        username: "owner",
        hidden: true,
      },
      {
        id: tempId,
        directory: tempShop,
        name: "Temp smoke",
        username: "owner",
      },
    ]),
  );
  fs.writeFileSync(selected, tempId);
  assert.equal(isEphemeralDirectory(tempShop), true);
  assert.equal(isEphemeralDirectory(vault), false);
  const chosen = resolveStartupDirectory({
    appData,
    registryFile: registry,
    lastProfileFile: selected,
  });
  assert.equal(path.resolve(chosen), path.resolve(vault));
  const cleaned = sanitizeProfiles(
    JSON.parse(fs.readFileSync(registry, "utf8")),
    {
      appData,
      currentDirectory: vault,
    },
  );
  assert.ok(
    cleaned.some(
      (p) =>
        path.resolve(p.directory) === path.resolve(vault) && p.hidden === false,
    ),
  );
  assert.ok(
    !cleaned.some(
      (p) => path.resolve(p.directory) === path.resolve(tempShop),
    ),
  );
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tempShop, { recursive: true, force: true });
});

test("missing remembered profile falls back to Vault Store", () => {
  const root = fs.mkdtempSync(
    path.join(process.cwd(), ".local", "profiles-missing-"),
  );
  const appData = path.join(root, "AppData");
  const vault = path.join(appData, "Vault Store");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "vault.sqlite"), "db");
  const registry = path.join(appData, "profiles.json");
  const selected = registry + ".selected";
  fs.writeFileSync(registry, "[]");
  fs.writeFileSync(selected, "deadbeef");
  assert.equal(
    path.resolve(
      resolveStartupDirectory({
        appData,
        registryFile: registry,
        lastProfileFile: selected,
      }),
    ),
    path.resolve(vault),
  );
  fs.rmSync(root, { recursive: true, force: true });
});
