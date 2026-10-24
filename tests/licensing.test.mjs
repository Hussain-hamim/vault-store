import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../licensing/worker.mjs";
import { generateLicenseKey, keyHash } from "../scripts/licensing/keys.mjs";
const require = createRequire(import.meta.url);
const {
  LicenseManager,
  verifyReceipt,
  deviceHash,
  validateConfig,
} = require("../electron/licensing.cjs");
const hash = "a".repeat(64),
  otherHash = "b".repeat(64);
const keypair = generateKeyPairSync("ed25519");
const config = {
  endpoint: "https://activation.example/v1/activate",
  publicKeys: { v1: keypair.publicKey.export({ type: "spki", format: "pem" }) },
};
function receipt(device = hash) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      keyId: "v1",
      product: "radefy-techmart",
      licenseId: "test-license",
      deviceHash: device,
      activatedAt: new Date().toISOString(),
    }),
  ).toString("base64url");
  return {
    payload,
    signature: sign(null, Buffer.from(payload), keypair.privateKey).toString(
      "base64url",
    ),
  };
}
function service(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("../licensing/schema.sql", import.meta.url), "utf8"),
  );
  t.after(() => sql.close());
  const env = {
    DB: {
      prepare(query) {
        return {
          bind(...params) {
            return {
              first: async () => sql.prepare(query).get(...params) || null,
            };
          },
        };
      },
    },
    SIGNING_PRIVATE_KEY: keypair.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    ACTIVATION_LIMITER: { limit: async () => ({ success: true }) },
  };
  const key = generateLicenseKey();
  sql
    .prepare(
      "INSERT INTO licenses(id,key_hash,key_suffix,client_label,created_at) VALUES (?,?,?,?,?)",
    )
    .run(
      "test-license",
      keyHash(key),
      key.slice(-4),
      "Test client",
      new Date().toISOString(),
    );
  const activate = (deviceHash = hash, licenseKey = key) =>
    worker.fetch(
      new Request(config.endpoint, {
        method: "POST",
        body: JSON.stringify({ key: licenseKey, deviceHash }),
      }),
      env,
    );
  return { sql, env, key, activate };
}
function manager(t, { directory, safeStorage, fetchImpl, ...options } = {}) {
  const dir = directory || mkdtempSync(join(tmpdir(), "radefy-license-"));
  if (!directory) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const safe = safeStorage || {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from("protected:" + text),
    decryptString: (bytes) => {
      if (!bytes.toString().startsWith("protected:")) throw Error("corrupt");
      return bytes.toString().slice(10);
    },
  };
  return new LicenseManager({
    enabled: true,
    directory: dir,
    safeStorage: safe,
    config,
    getDeviceHash: async () => hash,
    fetchImpl: fetchImpl || (async () => Response.json(receipt())),
    ...options,
  });
}
test("keys contain 160 random bits, format safely and never require stored plaintext", () => {
  const keys = new Set(Array.from({ length: 100 }, generateLicenseKey));
  assert.equal(keys.size, 100);
  for (const key of keys) {
    assert.match(key, /^RADE(?:-[0-9A-HJKMNP-TV-Z]{4}){8}$/);
    assert.match(keyHash(key), /^[a-f0-9]{64}$/);
    assert.equal(keyHash(key), keyHash(key.toLowerCase().replaceAll("-", " ")));
  }
});
test("one atomic claim wins between two computers; same-device retries preserve signed claims", async (t) => {
  const s = service(t);
  const results = await Promise.all([s.activate(hash), s.activate(otherHash)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const good = results[0].status === 200 ? hash : otherHash,
    first = await results.find((r) => r.status === 200).json();
  verifyReceipt(first, good, config);
  const retry = await (await s.activate(good)).json();
  assert.deepEqual(retry, first);
  assert.equal(
    s.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM licenses WHERE activated_at IS NOT NULL",
      )
      .get().n,
    1,
  );
  assert.equal(
    s.sql.prepare("SELECT key_hash FROM licenses").get().key_hash,
    keyHash(s.key),
  );
});
test("service rejects bad input, large bodies and rate limits without claiming keys", async (t) => {
  const s = service(t);
  assert.equal((await s.activate(hash, generateLicenseKey())).status, 400);
  assert.equal(
    (
      await worker.fetch(
        new Request(config.endpoint, {
          method: "POST",
          body: "x".repeat(2048),
        }),
        s.env,
      )
    ).status,
    400,
  );
  assert.equal(
    (await worker.fetch(new Request(config.endpoint, { method: "GET" }), s.env))
      .status,
    405,
  );
  s.env.ACTIVATION_LIMITER.limit = async () => ({ success: false });
  assert.equal((await s.activate()).status, 429);
  assert.equal(
    s.sql.prepare("SELECT device_hash FROM licenses").get().device_hash,
    null,
  );
});
test("fresh installation locks, activates then reopens forever offline before or after setup", async (t) => {
  const s = service(t);
  let calls = 0;
  const m = manager(t, {
    fetchImpl: async (url, init) => {
      calls++;
      return worker.fetch(new Request(url, init), s.env);
    },
  });
  assert.equal((await m.initialize()).active, false);
  assert.throws(() => m.assertActive(), /ACTIVATION_REQUIRED/);
  await m.activate(s.key);
  m.assertActive();
  assert.equal(calls, 1);
  const reopened = manager(t, {
    directory: m.directory,
    fetchImpl: async () => {
      throw Error("offline");
    },
  });
  assert.equal((await reopened.initialize()).active, true);
  reopened.assertActive();
  assert.equal(calls, 1);
});
test("response loss and save failure are recoverable on the same PC", async (t) => {
  const s = service(t);
  let lost = true;
  const fetchImpl = async (url, init) => {
    const response = await worker.fetch(new Request(url, init), s.env);
    if (lost) {
      lost = false;
      throw Error("connection lost");
    }
    return response;
  };
  const m = manager(t, { fetchImpl });
  await m.initialize();
  await assert.rejects(m.activate(s.key), /NETWORK_ERROR/);
  assert.equal(m.status().active, false);
  const save = m.save.bind(m);
  m.save = () => {
    throw Error("disk full");
  };
  await assert.rejects(m.activate(s.key), /STORAGE_UNAVAILABLE/);
  assert.equal(m.status().active, false);
  m.save = save;
  await m.activate(s.key);
  assert.equal(m.status().active, true);
});
test("invalid signatures, copied receipts and corrupt local state cannot unlock", async (t) => {
  const good = receipt();
  assert.throws(
    () => verifyReceipt({ ...good, signature: "A".repeat(86) }, hash, config),
    /INVALID_RECEIPT/,
  );
  assert.throws(
    () => verifyReceipt(good, otherHash, config),
    /INVALID_RECEIPT/,
  );
  const m = manager(t);
  await m.initialize();
  await m.activate(generateLicenseKey());
  const copied = manager(t, {
    directory: m.directory,
    getDeviceHash: async () => otherHash,
  });
  assert.equal(
    (await copied.initialize({ legacyInitialized: true })).active,
    false,
  );
  writeFileSync(m.file, "corrupt");
  const corrupt = manager(t, { directory: m.directory });
  assert.equal(
    (await corrupt.initialize({ legacyInitialized: true })).active,
    false,
  );
});
test("legacy exemption is device-bound and a fresh guard prevents backup/DB exemption", async (t) => {
  const legacy = manager(t);
  assert.equal(
    (await legacy.initialize({ legacyInitialized: true })).mode,
    "legacy",
  );
  assert.equal(
    (await manager(t, { directory: legacy.directory }).initialize()).active,
    true,
  );
  const other = manager(t, {
    directory: legacy.directory,
    getDeviceHash: async () => otherHash,
  });
  assert.equal(
    (await other.initialize({ legacyInitialized: true })).active,
    false,
  );
  const fresh = manager(t);
  await fresh.initialize();
  const restore = manager(t, { directory: fresh.directory });
  assert.equal(
    (await restore.initialize({ legacyInitialized: true })).active,
    false,
  );
});
test("unavailable storage, failed identification, redirects and malformed responses fail closed", async (t) => {
  const unavailable = manager(t, {
    safeStorage: { isEncryptionAvailable: () => false },
  });
  assert.equal(
    (await unavailable.initialize({ legacyInitialized: true })).active,
    false,
  );
  const unknown = manager(t, {
    getDeviceHash: async () => {
      throw Error("no device");
    },
  });
  assert.equal((await unknown.initialize()).active, false);
  for (const fetchImpl of [
    async () => {
      throw Error("offline");
    },
    async () => Response.json({ payload: "fake", signature: "fake" }),
    async () => new Response("bad json"),
    async () => new Response("x".repeat(9000)),
    async () => Response.json({ code: "KEY_IN_USE" }, { status: 409 }),
    async () => Response.json({ code: "RATE_LIMITED" }, { status: 429 }),
  ]) {
    const m = manager(t, { fetchImpl });
    await m.initialize();
    await assert.rejects(m.activate(generateLicenseKey()));
    assert.equal(m.status().active, false);
  }
  assert.throws(() =>
    validateConfig({
      ...config,
      endpoint: "http://activation.example/v1/activate",
    }),
  );
});
test("development bypass does not create an exemption or receipt", async (t) => {
  const m = manager(t, { enabled: false });
  assert.equal((await m.initialize()).mode, "development");
  assert.equal(existsSync(m.file), false);
});
test("Mac and Windows identifiers are normalized and unsupported identities fail", async () => {
  const id = "01234567-89AB-CDEF-0123-456789ABCDEF";
  let command, args;
  const run = async (c, a) => {
    command = c;
    args = a;
    return { stdout: `"IOPlatformUUID" = "${id}"` };
  };
  const mac = await deviceHash("darwin", run);
  assert.equal(command, "/usr/sbin/ioreg");
  const win = await deviceHash("win32", async (c, a) => {
    command = c;
    args = a;
    return { stdout: `MachineGuid    REG_SZ    ${id.toLowerCase()}` };
  });
  assert.equal(mac, win);
  assert.ok(command.endsWith("reg.exe"));
  assert.ok(args.includes("/reg:64"));
  await assert.rejects(deviceHash("linux"), /DEVICE_UNAVAILABLE/);
  await assert.rejects(
    deviceHash("darwin", async () => ({ stdout: "" })),
    /DEVICE_UNAVAILABLE/,
  );
});

test("losing a receipt does not turn a fresh installation into an exempt legacy store", async (t) => {
  const m = manager(t);
  await m.initialize();
  await m.activate(generateLicenseKey());
  unlinkSync(m.file);
  const retry = manager(t, { directory: m.directory });
  assert.equal(
    (await retry.initialize({ legacyInitialized: true })).active,
    false,
  );
  assert.equal(retry.status().mode, "required");
  await retry.activate(generateLicenseKey());
  assert.equal(retry.status().active, true);
});

test("release configuration must never accept private signing material", () => {
  assert.throws(() =>
    validateConfig({
      ...config,
      publicKeys: {
        v1: keypair.privateKey.export({ type: "pkcs8", format: "pem" }),
      },
    }),
  );
  assert.throws(() =>
    validateConfig({ ...config, adminToken: "not-for-clients" }),
  );
});
