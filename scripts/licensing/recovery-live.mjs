import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { d1Query, generateLicenseKey, keyHash } from "./keys.mjs";
import { createWorker } from "../../server/client.mjs";
import config from "../../shared/licensing.json" with { type: "json" };
const require = createRequire(import.meta.url),
  { LicenseManager } = require("../../electron/licensing.cjs"),
  { RecoveryManager } = require("../../electron/recovery.cjs");
const directory = mkdtempSync(join(tmpdir(), "radefy-live-recovery-")),
  db = createWorker(join(directory, "test.sqlite"));
const licenseId = randomUUID(),
  key = generateLicenseKey(),
  device = createHash("sha256").update(randomBytes(32)).digest("hex");
let offline = false,
  lose = false;
const fetchImpl = async (...args) => {
  if (offline) throw Error("offline");
  const r = await fetch(...args);
  if (lose) {
    lose = false;
    throw Error("lost response");
  }
  return r;
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
try {
  await d1Query(
    "INSERT INTO licenses(id,key_hash,key_suffix,client_label,created_at) VALUES (?1,?2,?3,?4,?5)",
    [
      licenseId,
      keyHash(key),
      key.slice(-4),
      "DISPOSABLE owner recovery verification",
      new Date().toISOString(),
    ],
  );
  const licensing = new LicenseManager({
    enabled: true,
    directory,
    safeStorage,
    config,
    getDeviceHash: async () => device,
    fetchImpl,
  });
  await licensing.initialize();
  const recovery = new RecoveryManager({
    licensing,
    request: (...a) => db.request(...a),
    fetchImpl,
  });
  licensing.recoveryPublicKey = recovery.identity().publicKey;
  await licensing.activate(key);
  const password = randomBytes(20).toString("hex"),
    newPassword = randomBytes(20).toString("hex");
  await db.request("setup", {
    name: "Disposable Recovery Owner",
    username: "recovery-test",
    password,
    storeName: "DISPOSABLE recovery test",
  });
  offline = true;
  assert.equal((await recovery.sync()).error, "NETWORK_ERROR");
  await db.request("login", { username: "recovery-test", password });
  offline = false;
  assert.equal((await recovery.sync()).registered, true);
  const id = recovery.status().installationId,
    code = randomBytes(20).toString("hex").toUpperCase();
  await d1Query(
    "INSERT INTO recovery_codes(installation_id,code_hash,kind,expires_at,request_id,redeemed_at) VALUES (?1,?2,'reset',?3,NULL,NULL)",
    [id, createHash("sha256").update(code).digest("hex"), Date.now() + 1800000],
  );
  lose = true;
  await assert.rejects(recovery.reset(code, newPassword), /NETWORK_ERROR/);
  const session = await recovery.reset(code, newPassword);
  assert.equal(session.username, "recovery-test");
  assert.equal(
    (await db.request("me", {}, session.token)).username,
    "recovery-test",
  );
  offline = true;
  await assert.rejects(
    db.request("login", { username: "recovery-test", password }),
  );
  await db.request("login", {
    username: "recovery-test",
    password: newPassword,
  });
  offline = false;
  const codeOnly=randomBytes(20).toString("hex").toUpperCase();
  await d1Query("UPDATE recovery_codes SET code_hash=?1,request_id=NULL,redeemed_at=NULL,expires_at=?2 WHERE installation_id=?3",[createHash("sha256").update(codeOnly).digest("hex"),Date.now()+1800000,id]);
  const recovered=await recovery.recover(codeOnly);
  assert.equal((await db.request("me",{},recovered.token)).username,"recovery-test");
  await assert.rejects(recovery.recover(codeOnly),/CODE_USED/);
  const record = (
    await d1Query(
      "SELECT request_id,redeemed_at FROM recovery_codes WHERE installation_id=?1",
      [id],
    )
  )[0].results[0];
  assert.ok(record.redeemed_at);
  assert.ok(record.request_id);
  console.log(
    "PASS: live activation, D1 owner registration, offline login, one-time reset, code-only sign-in, lost-response retry, old-password rejection and new offline login. Disposable records retained with an explicit test label.",
  );
} finally {
  await db.close();
  rmSync(directory, { recursive: true, force: true });
}
