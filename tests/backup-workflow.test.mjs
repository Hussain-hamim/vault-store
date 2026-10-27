import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { restoreDatabase, validateRestore } from "../server/restore.mjs";
import { discoverBackupTargets, backupDue } from "../server/backup-targets.mjs";
import { scheduleDefinition } from "../server/schedule.mjs";
test("24-hour destination timing, retries, new drives and restorable safety copies", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-backup-flow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, "live.sqlite"));
  t.after(() => store.close());
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
test("drive discovery includes local disk and mounted volumes; Windows excludes optical disks and pins scheduled profile", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-drives-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "USB"));
  assert.deepEqual(
    discoverBackupTargets("/shop/live.sqlite", {
      platform: "darwin",
      volumes: root,
    }),
    ["/shop", path.join(root, "USB")],
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
