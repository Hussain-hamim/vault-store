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
    !cleaned.some((p) => path.resolve(p.directory) === path.resolve(tempShop)),
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

test("imported shops isolate data and require activation; switching and backup paths remain independent", async (t) => {
  const {
    importShopProfile,
    readProfileRows,
  } = require("../electron/profiles.cjs");
  const { LicenseManager } = require("../electron/licensing.cjs");
  const { Store } = await import("../server/store.mjs");
  const { validateRestore, restoreDatabase } =
    await import("../server/restore.mjs");
  const { fileChecksum } = await import("../server/files.mjs");
  const root = fs.mkdtempSync(
    path.join(process.cwd(), ".local", "profiles-import-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "Vault Store");
  fs.mkdirSync(vault);
  const source = path.join(root, "source.sqlite");
  for (const [file, name] of [
    [path.join(vault, "vault.sqlite"), "Rahmat"],
    [source, "Samsoor"],
  ]) {
    const store = new Store(file);
    store.setup({
      name,
      username: name.toLowerCase(),
      password: "test-password-long",
      storeName: name + " shop",
    });
    store.close();
  }
  const originalHash = fileChecksum(path.join(vault, "vault.sqlite"));
  fs.writeFileSync(
    source + ".json",
    JSON.stringify({
      application: "Vault Store",
      schema: 1,
      checksum: fileChecksum(source),
    }),
  );
  const registryFile = path.join(root, "profiles.json");
  fs.writeFileSync(
    registryFile,
    JSON.stringify([
      { id: profileId(vault), directory: vault, name: "Rahmat shop" },
    ]),
  );
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const makeLicense = (directory) =>
    new LicenseManager({
      enabled: true,
      directory,
      safeStorage,
      config: require("../shared/licensing.json"),
      getDeviceHash: async () => "a".repeat(64),
    });
  const info = validateRestore(source);
  const entry = await importShopProfile({
    appData: root,
    registryFile,
    file: source,
    info,
    restoreDatabase,
    prepare: async (directory) => {
      await makeLicense(directory).initialize();
    },
  });
  assert.equal(entry.username, "samsoor");
  assert.equal(fileChecksum(path.join(vault, "vault.sqlite")), originalHash);
  const { DatabaseSync } = require("node:sqlite");
  const imported = new DatabaseSync(
    path.join(entry.directory, "vault.sqlite"),
    { readOnly: true },
  );
  assert.equal(
    imported.prepare("SELECT id FROM users WHERE username='samsoor'").get().id,
    info.owner.id,
  );
  assert.equal(
    imported.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  imported.close();
  assert.equal(
    fs.existsSync(path.join(entry.directory, "owner-recovery-v1.dat")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(entry.directory, "remembered-accounts-v1.dat")),
    false,
  );
  assert.equal(
    (await makeLicense(entry.directory).initialize({ legacyInitialized: true }))
      .active,
    false,
  );
  assert.equal(readProfileRows(registryFile).length, 2);
  const lastProfileFile = registryFile + ".selected";
  fs.writeFileSync(lastProfileFile, entry.id);
  const options = { appData: root, registryFile, lastProfileFile };
  assert.equal(resolveStartupDirectory(options), entry.directory);
  assert.equal(
    resolveStartupDirectory({
      ...options,
      selectedProfileId: profileId(vault),
    }),
    vault,
  );
  assert.equal(
    resolveStartupDirectory({
      ...options,
      selectedProfileId: entry.id,
      envDirectory: vault,
    }),
    entry.directory,
  );
  assert.equal(
    resolveStartupDirectory({ ...options, backupDirectory: vault }),
    vault,
  );
  const before = fs.readFileSync(registryFile, "utf8");
  await assert.rejects(
    importShopProfile({
      appData: root,
      registryFile,
      file: source,
      info,
      restoreDatabase,
      prepare: () => {
        throw Error("keychain unavailable");
      },
    }),
    /keychain/,
  );
  assert.equal(fs.readFileSync(registryFile, "utf8"), before);
  assert.equal(fs.readdirSync(path.dirname(entry.directory)).length, 1);
});
