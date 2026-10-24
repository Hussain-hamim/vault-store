const fs = require("node:fs");
const path = require("node:path");
const {
  createHash,
  verify,
  createPublicKey,
  randomBytes,
} = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const PRODUCT = "radefy-techmart";
const fail = (code) => Object.assign(new Error(code), { code });
async function deviceHash(
  platform = process.platform,
  run = promisify(execFile),
) {
  let raw;
  if (platform === "darwin") {
    const { stdout } = await run(
      "/usr/sbin/ioreg",
      ["-rd1", "-c", "IOPlatformExpertDevice"],
      { timeout: 5000, maxBuffer: 262144 },
    );
    raw = stdout.match(/"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"/i)?.[1];
  } else if (platform === "win32") {
    const reg = path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "reg.exe",
    );
    const { stdout } = await run(
      reg,
      [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid",
        "/reg:64",
      ],
      { timeout: 5000, maxBuffer: 16384, windowsHide: true },
    );
    raw = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i)?.[1];
  }
  if (!raw || !/^[0-9a-f-]{16,80}$/i.test(raw))
    throw fail("DEVICE_UNAVAILABLE");
  return createHash("sha256")
    .update(`${PRODUCT}:device:v1:${raw.toLowerCase()}`)
    .digest("hex");
}
function verifyReceipt(receipt, hash, config) {
  if (
    !receipt ||
    typeof receipt.payload !== "string" ||
    typeof receipt.signature !== "string" ||
    receipt.payload.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(receipt.payload) ||
    !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)
  )
    throw fail("INVALID_RECEIPT");
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(receipt.payload, "base64url").toString("utf8"),
    );
  } catch {
    throw fail("INVALID_RECEIPT");
  }
  const key = config.publicKeys?.[claims.keyId];
  if (
    !key ||
    claims.version !== 1 ||
    claims.product !== PRODUCT ||
    claims.deviceHash !== hash ||
    typeof claims.licenseId !== "string" ||
    !claims.licenseId ||
    !Number.isFinite(Date.parse(claims.activatedAt))
  )
    throw fail("INVALID_RECEIPT");
  try {
    if (
      !verify(
        null,
        Buffer.from(receipt.payload),
        createPublicKey(key),
        Buffer.from(receipt.signature, "base64url"),
      )
    )
      throw fail("INVALID_RECEIPT");
  } catch {
    throw fail("INVALID_RECEIPT");
  }
  return claims;
}
function validateConfig(config) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/v1/activate"
  )
    throw fail("SERVICE_UNAVAILABLE");
  if (
    !config.publicKeys?.v1 ||
    Object.keys(config).some((key) => !["endpoint", "publicKeys"].includes(key))
  )
    throw fail("SERVICE_UNAVAILABLE");
  for (const pem of Object.values(config.publicKeys)) {
    if (
      typeof pem !== "string" ||
      !pem.startsWith("-----BEGIN PUBLIC KEY-----") ||
      createPublicKey(pem).asymmetricKeyType !== "ed25519"
    )
      throw fail("SERVICE_UNAVAILABLE");
  }
}
class LicenseManager {
  constructor({
    enabled,
    directory,
    safeStorage,
    config,
    getDeviceHash = deviceHash,
    fetchImpl = fetch,
  }) {
    Object.assign(this, {
      enabled,
      directory,
      safeStorage,
      config,
      getDeviceHash,
      fetchImpl,
    });
    this.file = path.join(directory, "activation-v1.dat");
    this.guardFile = path.join(directory, "installation-v1.dat");
    this.state = {
      required: !!enabled,
      active: !enabled,
      mode: enabled ? "required" : "development",
      error: "",
    };
  }
  async initialize({ legacyInitialized = false } = {}) {
    if (!this.enabled) return this.status();
    try {
      validateConfig(this.config);
      this.hash = await this.identify();
      if (!this.safeStorage.isEncryptionAvailable())
        throw fail("STORAGE_UNAVAILABLE");
      if (!fs.existsSync(this.guardFile)) {
        // A receipt without a guard is never evidence of a legacy installation.
        this.save(
          {
            mode:
              legacyInitialized && !fs.existsSync(this.file)
                ? "legacy"
                : "required",
          },
          this.guardFile,
        );
      }
      const guard = this.readProtected(this.guardFile);
      if (!["required", "legacy"].includes(guard.mode))
        throw fail("INVALID_RECEIPT");
      if (guard.mode === "legacy") {
        this.state = {
          required: false,
          active: true,
          mode: "legacy",
          error: "",
        };
      } else if (fs.existsSync(this.file)) {
        const saved = this.readProtected(this.file);
        if (saved.mode !== "activated") throw fail("INVALID_RECEIPT");
        const claims = verifyReceipt(saved.receipt, this.hash, this.config);
        this.state = {
          required: false,
          active: true,
          mode: "activated",
          licenseId: claims.licenseId,
          error: "",
        };
      } else {
        this.state = {
          required: true,
          active: false,
          mode: "required",
          error: "",
        };
      }
    } catch (error) {
      this.state = {
        required: true,
        active: false,
        mode: "required",
        error:
          error.code &&
          typeof error.code === "string" &&
          [
            "INVALID_RECEIPT",
            "DEVICE_UNAVAILABLE",
            "STORAGE_UNAVAILABLE",
            "SERVICE_UNAVAILABLE",
          ].includes(error.code)
            ? error.code
            : "STORAGE_UNAVAILABLE",
      };
    }
    return this.status();
  }
  async identify() {
    try {
      const hash = await this.getDeviceHash();
      if (!/^[a-f0-9]{64}$/.test(hash)) throw fail("DEVICE_UNAVAILABLE");
      return hash;
    } catch {
      throw fail("DEVICE_UNAVAILABLE");
    }
  }
  readProtected(file) {
    try {
      const bytes = fs.readFileSync(file);
      if (bytes.length > 16384) throw fail("INVALID_RECEIPT");
      const saved = JSON.parse(this.safeStorage.decryptString(bytes));
      if (saved.version !== 1 || saved.deviceHash !== this.hash)
        throw fail("INVALID_RECEIPT");
      return saved;
    } catch {
      throw fail("INVALID_RECEIPT");
    }
  }
  status() {
    return { ...this.state };
  }
  assertActive() {
    if (!this.state.active) throw fail("ACTIVATION_REQUIRED");
  }
  save(data, file = this.file) {
    if (!this.safeStorage.isEncryptionAvailable())
      throw fail("STORAGE_UNAVAILABLE");
    fs.mkdirSync(this.directory, { recursive: true });
    const bytes = this.safeStorage.encryptString(
      JSON.stringify({ version: 1, deviceHash: this.hash, ...data }),
    );
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
  }
  async activate(key) {
    if (this.state.active) return this.status();
    if (this.busy) throw fail("ACTIVATION_BUSY");
    if (
      typeof key !== "string" ||
      key.length > 100 ||
      !/^RADE[0-9A-HJKMNP-TV-Z]{32}$/.test(
        key.toUpperCase().replace(/[\s-]/g, ""),
      )
    )
      throw fail("INVALID_KEY");
    this.busy = true;
    try {
      validateConfig(this.config);
      this.hash = await this.identify();
      if (!this.safeStorage.isEncryptionAvailable())
        throw fail("STORAGE_UNAVAILABLE");
      let response;
      try {
        response = await this.fetchImpl(this.config.endpoint, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: key.toUpperCase().replace(/\s/g, ""),
            deviceHash: this.hash,
            ...(this.recoveryPublicKey
              ? { publicKey: this.recoveryPublicKey }
              : {}),
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw fail("NETWORK_ERROR");
      }
      const reader = response.body?.getReader();
      if (!reader) throw fail("SERVICE_UNAVAILABLE");
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8192) {
            await reader.cancel();
            throw fail("INVALID_RECEIPT");
          }
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        if (error.code === "INVALID_RECEIPT") throw error;
        throw fail("NETWORK_ERROR");
      } finally {
        reader.releaseLock();
      }
      let receipt;
      try {
        receipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw fail("SERVICE_UNAVAILABLE");
      }
      if (!response.ok)
        throw fail(
          ["INVALID_KEY", "KEY_IN_USE", "RATE_LIMITED"].includes(receipt.code)
            ? receipt.code
            : "SERVICE_UNAVAILABLE",
        );
      const claims = verifyReceipt(receipt, this.hash, this.config);
      try {
        this.save({ mode: "required" }, this.guardFile);
        this.save({ mode: "activated", receipt });
      } catch {
        throw fail("STORAGE_UNAVAILABLE");
      }
      this.state = {
        required: false,
        active: true,
        mode: "activated",
        licenseId: claims.licenseId,
        error: "",
      };
      return this.status();
    } finally {
      this.busy = false;
    }
  }
}
module.exports = { LicenseManager, deviceHash, verifyReceipt, validateConfig };
