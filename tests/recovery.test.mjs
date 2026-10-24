import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import worker from "../licensing/worker.mjs";
import { createWorker } from "../server/client.mjs";
import { generateLicenseKey, keyHash } from "../scripts/licensing/keys.mjs";
const require = createRequire(import.meta.url),
  { RecoveryManager } = require("../electron/recovery.cjs"),
  { LicenseManager } = require("../electron/licensing.cjs");
const digest = (x) => createHash("sha256").update(x).digest("hex");
async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("../licensing/schema.sql", import.meta.url), "utf8"),
  );
  const directory = mkdtempSync(join(tmpdir(), "recovery-"));
  const db = createWorker(join(directory, "shop.sqlite"));
  t.after(async () => {
    await db.close();
    sql.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const pair = generateKeyPairSync("ed25519");
  const env = {
    DB: {
      prepare(query) {
        return {
          bind(...args) {
            return {
              first: async () => sql.prepare(query).get(...args) || null,
            };
          },
        };
      },
    },
    SIGNING_PRIVATE_KEY: pair.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    ACTIVATION_LIMITER: { limit: async () => ({ success: true }) },
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const config = {
    endpoint: "https://example.test/v1/activate",
    publicKeys: { v1: pair.publicKey.export({ type: "spki", format: "pem" }) },
  };
  let offline = false,
    loseResponse = false,
    failSave = false,
    requests = [];
  const fetchImpl = async (url, options) => {
    if (offline) throw Error("offline");
    requests.push(JSON.parse(options.body));
    const r = await worker.fetch(new Request(url, options), env);
    if (loseResponse) {
      loseResponse = false;
      throw Error("lost");
    }
    return r;
  };
  const license = new LicenseManager({
    enabled: true,
    directory,
    safeStorage,
    config,
    getDeviceHash: async () => "a".repeat(64),
    fetchImpl,
  });
  await license.initialize();
  const request = async (...args) => {
    if (failSave && args[0] === "_recoveryApply") {
      failSave = false;
      throw Error("disk failure");
    }
    return db.request(...args);
  };
  const recovery = new RecoveryManager({
    licensing: license,
    request,
    fetchImpl,
  });
  license.recoveryPublicKey = recovery.identity().publicKey;
  const key = generateLicenseKey();
  sql
    .prepare(
      "INSERT INTO licenses(id,key_hash,key_suffix,client_label,created_at) VALUES (?,?,?,?,?)",
    )
    .run(
      "license",
      keyHash(key),
      key.slice(-4),
      "Test",
      new Date().toISOString(),
    );
  await license.activate(key);
  const owner = await db.request("setup", {
    name: "Test Owner",
    username: "owner",
    password: "original-pass-123",
    storeName: "Test Store",
  });
  const issue = (code = "A".repeat(40)) => {
    sql
      .prepare(
        "INSERT INTO recovery_codes(installation_id,code_hash,kind,expires_at,request_id,redeemed_at) VALUES (?,?, 'reset', ?,NULL,NULL) ON CONFLICT(installation_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,request_id=NULL,redeemed_at=NULL",
      )
      .run(
        recovery.status().installationId,
        digest(code),
        Date.now() + 1800000,
      );
    return code;
  };
  return {
    sql,
    db,
    license,
    recovery,
    owner,
    issue,
    requests,
    env,
    request,
    fetchImpl,
    setOffline: (v) => (offline = v),
    lose: () => (loseResponse = true),
    fail: () => (failSave = true),
  };
}
test("fresh activation enrolls automatically; offline setup/login and later sync; no password uploaded", async (t) => {
  const f = await fixture(t);
  f.setOffline(true);
  assert.equal((await f.recovery.sync()).error, "NETWORK_ERROR");
  await f.db.request("login", {
    username: "owner",
    password: "original-pass-123",
  });
  f.setOffline(false);
  assert.equal((await f.recovery.sync()).registered, true);
  const row = f.sql.prepare("SELECT * FROM recovery_owners").get();
  assert.equal(row.username, "owner");
  assert.equal(row.license_id, "license");
  for (const request of f.requests) {
    assert.ok(!JSON.stringify(request).includes("original-pass"));
    if (request.payload) {
      const data = JSON.parse(Buffer.from(request.payload, "base64url"));
      assert.ok(!("password" in data));
      assert.ok(!("passwordHash" in data));
    }
  }
});
test("reset revokes sessions, old password fails, new password works offline; employees unchanged", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  await f.db.request(
    "userCreate",
    {
      name: "Employee",
      username: "employee",
      password: "employee-pass-123",
      role: "Cashier",
    },
    f.owner.token,
  );
  const session = await f.recovery.reset(f.issue(), "replacement-123");
  assert.equal(session.username, "owner");
  assert.equal(
    (await f.db.request("me", {}, session.token)).id,
    f.owner.user.id,
  );
  await assert.rejects(f.db.request("me", {}, f.owner.token));
  await assert.rejects(
    f.db.request("login", { username: "owner", password: "original-pass-123" }),
  );
  f.setOffline(true);
  await f.db.request("login", {
    username: "owner",
    password: "replacement-123",
  });
  await f.db.request("login", {
    username: "employee",
    password: "employee-pass-123",
  });
  assert.equal((await f.db.request("status")).setup, false);
  assert.equal(f.license.status().active, true);
  const requests = f.requests.length;
  f.setOffline(false);
  await assert.rejects(
    f.recovery.reset("A".repeat(40), "another-pass-123"),
    /INVALID_CODE|CODE_USED|EXPIRED_CODE/,
  );
  assert.ok(f.requests.length > requests);
});
test("lost response and failed local write recover using same pending request across restart", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  const code = f.issue();
  f.lose();
  await assert.rejects(
    f.recovery.reset(code, "replacement-123"),
    /NETWORK_ERROR/,
  );
  const id = f.recovery.state.pending.requestId;
  const manager = new RecoveryManager({
    licensing: f.license,
    request: f.request,
    fetchImpl: f.fetchImpl,
  });
  f.fail();
  await assert.rejects(manager.reset(code, "replacement-123"), /disk failure/);
  assert.equal(manager.state.pending.requestId, id);
  await assert.rejects(
    manager.reset(code, "different-pass-123"),
    /RETRY_PASSWORD/,
  );
  await manager.reset(code, "replacement-123");
  await f.db.request("login", {
    username: "owner",
    password: "replacement-123",
  });
});
test("expired, replaced codes and tampered/wrong-device authorizations fail", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  f.issue("B".repeat(40));
  await assert.rejects(
    f.recovery.reset("A".repeat(40), "replacement-123"),
    /INVALID_CODE|CODE_USED|EXPIRED_CODE/,
  );
  const code = f.issue();
  f.sql.prepare("UPDATE recovery_codes SET expires_at=0").run();
  await assert.rejects(
    f.recovery.reset(code, "replacement-123"),
    /INVALID_CODE|CODE_USED|EXPIRED_CODE/,
  );
  f.issue();
  f.fail();
  await assert.rejects(f.recovery.reset(code, "replacement-123"));
  const p = f.recovery.state.pending,
    original = p.authorization;
  p.authorization = { ...original, signature: "A".repeat(86) };
  await assert.rejects(
    f.recovery.reset(code, "replacement-123"),
    /INVALID_RESPONSE/,
  );
  p.authorization = original;
  f.license.hash = "b".repeat(64);
  await assert.rejects(
    f.recovery.reset(code, "replacement-123"),
    /INVALID_RESPONSE/,
  );
});
test("older installations require administrator enrollment; signed requests and exact device/public key enforced", async (t) => {
  const f = await fixture(t);
  f.sql.prepare("UPDATE licenses SET recovery_public_key=NULL").run();
  assert.equal((await f.recovery.sync()).error, "ENROLLMENT_REQUIRED");
  const s = f.recovery.status(),
    code = "C".repeat(40);
  f.sql
    .prepare(
      "INSERT INTO recovery_enrollments(installation_id,device_hash,public_key,code_hash,expires_at) VALUES (?,?,?,?,?)",
    )
    .run(
      s.installationId,
      s.deviceHash,
      s.publicKey,
      digest(code),
      Date.now() + 1800000,
    );
  assert.equal((await f.recovery.sync(code)).registered, true);
  const response = await worker.fetch(
    new Request("https://example.test/v1/recovery/register", {
      method: "POST",
      body: JSON.stringify({ ...f.requests.at(-1), signature: "broken" }),
    }),
    f.env,
  );
  assert.equal(response.status, 400);
});
test("business command dispatcher cannot call internal recovery operations", async (t) => {
  const { Store } = await import("../server/store.mjs");
  const store = new Store(":memory:");
  t.after(() => store.close());
  await assert.rejects(store.dispatch("_recoveryApply", { hash: "x" }));
});
test("simultaneous reset requests authorize exactly one request ID; same-request retries succeed", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  const code = f.issue(),
    other = new RecoveryManager({
      licensing: f.license,
      request: f.request,
      fetchImpl: f.fetchImpl,
    });
  other.identity();
  const results = await Promise.allSettled([
    f.recovery.reset(code, "replacement-123"),
    other.reset(code, "another-pass-123"),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
});
test("oversized, wrong-device and rate-limited recovery requests are rejected", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  let response = await worker.fetch(
    new Request("https://example.test/v1/recovery/register", {
      method: "POST",
      body: "x".repeat(9000),
    }),
    f.env,
  );
  assert.equal(response.status, 400);
  f.license.hash = "b".repeat(64);
  assert.equal((await f.recovery.sync()).error, "SERVICE_UNAVAILABLE");
  f.env.ACTIVATION_LIMITER.limit = async () => ({ success: false });
  response = await worker.fetch(
    new Request("https://example.test/v1/recovery/reset", {
      method: "POST",
      body: "{}",
    }),
    f.env,
  );
  assert.equal(response.status, 429);
});

test("all Cloudflare application tables display owner/shop names, backfill existing rows and track changes", async (t) => {
  const f = await fixture(t);
  const s = f.recovery.status();
  f.sql
    .prepare(
      "INSERT INTO recovery_enrollments(installation_id,device_hash,public_key,code_hash,expires_at) VALUES (?,?,?,?,?)",
    )
    .run(
      s.installationId,
      s.deviceHash,
      s.publicKey,
      digest("enrollment"),
      Date.now() + 1800000,
    );
  f.issue();
  await f.recovery.sync();
  const check = (name, username, shop) => {
    for (const table of [
      "licenses",
      "recovery_owners",
      "recovery_codes",
      "recovery_enrollments",
    ]) {
      const row = f.sql
        .prepare(`SELECT name,username,store_name FROM ${table}`)
        .get();
      assert.deepEqual({ ...row }, { name, username, store_name: shop }, table);
    }
  };
  check("Test Owner", "owner", "Test Store");
  f.sql
    .prepare("UPDATE recovery_owners SET name=?,username=?,store_name=?")
    .run("Renamed Owner", "renamed", "Renamed Shop");
  check("Renamed Owner", "renamed", "Renamed Shop");
  f.sql.prepare("DELETE FROM recovery_codes").run();
  f.issue();
  check("Renamed Owner", "renamed", "Renamed Shop");
  f.sql.prepare("UPDATE licenses SET name='',username='',store_name=''").run();
  f.sql.exec(
    readFileSync(new URL("../licensing/schema.sql", import.meta.url), "utf8"),
  );
  check("Renamed Owner", "renamed", "Renamed Shop");
});

test("one-time code signs in without changing password; reused, expired and wrong-store codes have clear errors", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  const code = f.issue();
  const session = await f.recovery.recover(code);
  assert.equal((await f.db.request("me", {}, session.token)).username, "owner");
  await f.db.request("login", {
    username: "owner",
    password: "original-pass-123",
  });
  await assert.rejects(f.recovery.recover(code), /CODE_USED/);
  const other = "D".repeat(40);
  f.sql
    .prepare(
      "INSERT INTO recovery_codes(installation_id,code_hash,kind,expires_at) VALUES (?,?,'reset',?)",
    )
    .run("another-installation", digest(other), Date.now() + 1800000);
  await assert.rejects(f.recovery.recover(other), /WRONG_STORE/);
  f.issue("E".repeat(40));
  f.sql
    .prepare("UPDATE recovery_codes SET expires_at=0 WHERE installation_id=?")
    .run(f.recovery.status().installationId);
  await assert.rejects(f.recovery.recover("E".repeat(40)), /EXPIRED_CODE/);
});
test("owner can optionally change password after code sign-in; new password survives reopening SQLite", async (t) => {
  const f = await fixture(t);
  await f.recovery.sync();
  const recovered = await f.recovery.recover(f.issue());
  const session = await f.db.request(
    "ownerPasswordChange",
    { password: "new-owner-password" },
    recovered.token,
  );
  assert.equal((await f.db.request("me", {}, session.token)).username, "owner");
  await assert.rejects(f.db.request("me", {}, recovered.token));
  await assert.rejects(
    f.db.request("login", { username: "owner", password: "original-pass-123" }),
  );
  const { Store } = await import("../server/store.mjs");
  const store = new Store(join(f.license.directory, "shop.sqlite"));
  try {
    const login = store.login({
      username: "owner",
      password: "new-owner-password",
    });
    assert.equal(login.user.username, "owner");
    assert.equal((await store.dispatch("status")).ownerUsername, "owner");
  } finally {
    store.close();
  }
});
