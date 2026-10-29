import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { restoreDatabase, validateRestore } from "../server/restore.mjs";
import { discoverBackupTargets, backupDue } from "../server/backup-targets.mjs";
import { scheduleDefinition } from "../server/schedule.mjs";
import { createWorker } from "../server/client.mjs";
test("24-hour destination timing, retries, new drives and restorable safety copies", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-backup-flow-"));
  const store = new Store(path.join(root, "live.sqlite"));
  t.after(() => {
    store.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "Backup test",
  });
  const owner = store.auth(session.token);
  store.createProduct(owner, {
    name: "SSD",
    brand: "Samsung",
    model: "990",
    sku: "BACKUP-1",
    category: "Storage",
    price: 20000,
  });
  const a = path.join(root, "drive-a"),
    b = path.join(root, "drive-b");
  mkdirSync(a);
  store.discoveredBackupTargets = () => [];
  store.saveSetting("backups", { destinations: [a, b] });
  const first = await store.automaticBackup();
  assert.deepEqual(
    first.results.map((r) => r.status),
    ["verified", "failed"],
  );
  assert.equal((await store.automaticBackup()).skipped, true);
  mkdirSync(b);
  store.saveSetting("backups", {
    ...store.setting("backups"),
    retryAfter: null,
  });
  const retry = await store.automaticBackup();
  assert.equal(retry.results.length, 1);
  assert.ok(retry.results[0].path.startsWith(b));
  assert.equal((await store.automaticBackup()).skipped, true);
  const restored = path.join(root, "restored.sqlite");
  await restoreDatabase(first.results[0].path, restored);
  await restoreDatabase(retry.results[0].path, restored);
  const safety = path.join(
    root,
    "restore-safety",
    readdirSync(path.join(root, "restore-safety")).find((n) =>
      n.endsWith(".sqlite"),
    ),
  );
  assert.equal(validateRestore(safety).products, 1);
  const reopened = new Store(restored);
  assert.equal(reopened.one("SELECT COUNT(*) n FROM products").n, 1);
  reopened.close();
  assert.equal(backupDue(new Date(Date.now() - 86400000).toISOString()), true);
  assert.equal(backupDue(new Date().toISOString()), false);
  assert.equal(backupDue("invalid"), true);
});
test("automatic backups always copy to discovered drives without an opt-in", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-backup-always-"));
  const store = new Store(path.join(root, "live.sqlite"));
  t.after(() => {
    store.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "Always backup",
  });
  const usb = path.join(root, "usb");
  mkdirSync(usb);
  store.discoveredBackupTargets = () => [usb];
  store.saveSetting("backups", { destinations: [], allDrives: false });
  const result = await store.automaticBackup();
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, "verified");
  assert.ok(result.results[0].path.startsWith(usb));
  await store.dispatch(
    "backupSettings",
    { destinations: [], allDrives: false },
    session.token,
  );
  assert.equal(store.setting("backups").allDrives, true);
});
test("worker Backup now includes commits made on the live shop connection", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-worker-backup-"));
  const file = path.join(root, "live.sqlite");
  const dest = path.join(root, "drive");
  mkdirSync(dest);
  const worker = createWorker(file);
  t.after(async () => {
    await worker.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  const session = await worker.request("setup", {
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "Worker backup",
  });
  await worker.request(
    "backupSettings",
    { destinations: [dest] },
    session.token,
  );
  await worker.request(
    "productCreate",
    {
      name: "First",
      brand: "Dell",
      model: "A",
      sku: "W-1",
      category: "Accessories",
      price: 1000,
      serialized: false,
    },
    session.token,
  );
  await worker.request(
    "productCreate",
    {
      name: "Second latest",
      brand: "Dell",
      model: "B",
      sku: "W-2",
      category: "Accessories",
      price: 3000,
      serialized: false,
    },
    session.token,
  );
  const manual = await worker.request("backupCreate", {}, session.token);
  assert.equal(manual.results[0].status, "verified");
  assert.equal(validateRestore(manual.results[0].path).products, 2);
  const restored = path.join(root, "restored.sqlite");
  await restoreDatabase(manual.results[0].path, restored);
  const check = new Store(restored);
  try {
    assert.equal(
      check.one("SELECT name FROM products WHERE sku=?", "W-2").name,
      "Second latest",
    );
  } finally {
    check.close();
  }
});
test("manual Backup now on a live open store restores the latest commits", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-manual-live-"));
  const store = new Store(path.join(root, "live.sqlite"));
  t.after(() => {
    store.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "Manual live",
  });
  const owner = store.auth(session.token);
  store.createProduct(owner, {
    name: "Old stock",
    brand: "Dell",
    model: "A",
    sku: "OLD-1",
    category: "Accessories",
    price: 1000,
    serialized: false,
  });
  const dest = path.join(root, "drive");
  mkdirSync(dest);
  store.saveSetting("backups", { destinations: [dest] });
  // Keep writing on the same open connection, then take a manual backup.
  store.createProduct(owner, {
    name: "Latest change",
    brand: "Dell",
    model: "B",
    sku: "NEW-2",
    category: "Accessories",
    price: 2500,
    serialized: false,
  });
  store.run(
    "UPDATE products SET name=? WHERE sku=?",
    "Latest renamed",
    "NEW-2",
  );
  const manual = await store.createBackup(owner);
  assert.equal(manual.results[0].status, "verified");
  const restored = path.join(root, "from-manual.sqlite");
  await restoreDatabase(manual.results[0].path, restored);
  const check = new Store(restored);
  try {
    assert.equal(check.one("SELECT COUNT(*) n FROM products").n, 2);
    assert.equal(
      check.one("SELECT name FROM products WHERE sku=?", "NEW-2").name,
      "Latest renamed",
    );
  } finally {
    check.close();
  }
});
test("drive discovery includes local disk and mounted volumes; Windows excludes optical disks and pins scheduled profile", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-drives-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "USB"));
  assert.deepEqual(
    discoverBackupTargets("/shop/live.sqlite", {
      platform: "darwin",
      volumes: root,
    }),
    [path.dirname(path.resolve("/shop/live.sqlite")), path.join(root, "USB")],
  );
  let script = "";
  const targets = discoverBackupTargets("C:\\Shop\\vault.sqlite", {
    platform: "win32",
    run: (exe, args) => {
      script = args.at(-1);
      return "C:\r\nD:\r\nE:\r\n";
    },
  });
  assert.ok(targets.includes("D:\\"));
  assert.ok(targets.includes("E:\\"));
  assert.ok(!targets.includes("C:\\"));
  assert.match(script, /DriveType -in 2,3,4/);
  for (const platform of ["darwin", "win32"])
    assert.ok(
      scheduleDefinition(
        { executable: "/app", userData: "/shop A" },
        platform,
      ).contents.includes("--backup-user-data=/shop A"),
    );
});

test("manual customer backup survives restoring old then new snapshots", async (t) => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "radefy-customer-roundtrip-"),
  );
  let store;
  t.after(() => {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, "live.sqlite"),
    destination = path.join(root, "copies");
  mkdirSync(destination);
  store = new Store(file);
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "Roundtrip",
  });
  const owner = store.auth(session.token);
  const before = store
    .all("SELECT id FROM parties WHERE kind='customer'")
    .map((r) => r.id);
  const old = (await store.createBackup(owner, { destination })).results[0];
  const added = Array.from(
    { length: 10 },
    (_, i) =>
      store.createParty(owner, { kind: "customer", name: "New customer " + i })
        .id,
  );
  const recent = (await store.createBackup(owner, { destination })).results[0];
  assert.equal(recent.status, "verified");
  store.close();
  store = null;
  await restoreDatabase(old.path, file);
  store = new Store(file);
  assert.equal(
    store.one("SELECT COUNT(*) n FROM parties WHERE kind='customer'").n,
    before.length,
  );
  store.close();
  store = null;
  await restoreDatabase(recent.path, file);
  store = new Store(file);
  for (const id of added)
    assert.ok(store.one("SELECT id FROM parties WHERE id=?", id));
  assert.equal(
    store.one("SELECT COUNT(*) n FROM parties WHERE kind='customer'").n,
    before.length + 10,
  );
});

test("restore includes customer commits in the backup WAL", async (t) => {
  const { writeFileSync } = await import("node:fs");
  const { fileChecksum } = await import("../server/files.mjs");
  const { DatabaseSync } = await import("../server/sqlite.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-restore-wal-"));
  let live;
  t.after(() => {
    live?.close();
    rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, "source.sqlite");
  const seed = new Store(source);
  const session = seed.setup({
    name: "Owner",
    username: "owner",
    password: "test-password-long",
    storeName: "WAL test",
  });
  seed.close();
  writeFileSync(
    source + ".json",
    JSON.stringify({
      application: "Vault Store",
      schema: 1,
      checksum: fileChecksum(source),
    }),
  );
  live = new Store(source);
  live.db.exec("PRAGMA wal_autocheckpoint=0");
  const owner = live.auth(session.token);
  const ids = Array.from(
    { length: 10 },
    (_, i) =>
      live.createParty(owner, { kind: "customer", name: "WAL customer " + i })
        .id,
  );
  const info = validateRestore(source);
  assert.ok(info.walChecksum);
  const target = path.join(root, "restored.sqlite");
  await restoreDatabase(source, target, { validated: info });
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    for (const id of ids)
      assert.ok(copy.prepare("SELECT id FROM parties WHERE id=?").get(id));
    assert.equal(
      copy
        .prepare(
          "SELECT COUNT(*) n FROM parties WHERE kind='customer' AND active=1",
        )
        .get().n,
      info.customers,
    );
  } finally {
    copy.close();
  }
  live.createParty(owner, {
    kind: "customer",
    name: "Changed after confirmation",
  });
  await assert.rejects(
    restoreDatabase(source, target, { validated: info }),
    /changed after validation/,
  );
  const unchanged = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      unchanged
        .prepare(
          "SELECT COUNT(*) n FROM parties WHERE kind='customer' AND active=1",
        )
        .get().n,
      info.customers,
    );
  } finally {
    unchanged.close();
  }
});
