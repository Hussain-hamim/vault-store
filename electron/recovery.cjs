const fs = require("node:fs");
const path = require("node:path");
const {
  generateKeyPairSync,
  createHash,
  randomBytes,
  randomUUID,
  sign,
  verify,
  scryptSync,
} = require("node:crypto");
const hash = (x) => createHash("sha256").update(x).digest("hex");
class RecoveryManager {
  constructor({ licensing, request, fetchImpl = fetch }) {
    Object.assign(this, { licensing, request, fetchImpl });
    this.file = path.join(licensing.directory, "owner-recovery-v1.dat");
    this.busy = false;
    this.error = "";
  }
  identity() {
    if (this.state) return this.state;
    const l = this.licensing;
    if (!l.enabled) throw Error("DESKTOP_ONLY");
    if (fs.existsSync(this.file)) this.state = l.readProtected(this.file);
    else {
      const p = generateKeyPairSync("ed25519");
      this.state = {
        publicKey: p.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64url"),
        privateKey: p.privateKey.export({ type: "pkcs8", format: "pem" }),
        lastSync: null,
      };
      this.save();
    }
    return this.state;
  }
  save() {
    this.licensing.save(this.state, this.file);
  }
  status() {
    try {
      const s = this.identity();
      return {
        installationId: hash(s.publicKey),
        deviceHash: this.licensing.hash,
        publicKey: s.publicKey,
        registered: !!s.lastSync,
        lastSync: s.lastSync,
        error: this.error,
        storeName: this.owner?.storeName || "",
        username: this.owner?.username || "",
      };
    } catch {
      return { registered: false, error: "STORAGE_UNAVAILABLE" };
    }
  }
  async remote(action, data) {
    const s = this.identity();
    const payload = Buffer.from(
      JSON.stringify({
        action,
        installationId: hash(s.publicKey),
        deviceHash: this.licensing.hash,
        timestamp: Date.now(),
        ...data,
      }),
    ).toString("base64url");
    let response;
    try {
      response = await this.fetchImpl(
        new URL(action, this.licensing.config.endpoint),
        {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload,
            signature: sign(null, Buffer.from(payload), s.privateKey).toString(
              "base64url",
            ),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw Error("NETWORK_ERROR");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("SERVICE_UNAVAILABLE");
    let bytes = 0,
      chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 8192) {
          await reader.cancel();
          throw Error("INVALID_RESPONSE");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok)
      throw Error(
        [
          "ENROLLMENT_REQUIRED",
          "INVALID_CODE",
          "RATE_LIMITED",
          "WRONG_STORE",
          "EXPIRED_CODE",
          "CODE_USED",
        ].includes(result.code)
          ? result.code
          : "SERVICE_UNAVAILABLE",
      );
    return result;
  }
  async sync(enrollmentCode) {
    if (this.busy) return this.status();
    this.busy = true;
    try {
      const s = this.identity(),
        owner = await this.request("_recoveryOwner");
      if (!owner) return this.status();
      this.owner = owner;
      await this.remote("/v1/recovery/register", {
        publicKey: s.publicKey,
        licenseId: this.licensing.state.licenseId,
        owner,
        enrollmentCode,
      });
      s.lastSync = new Date().toISOString();
      this.save();
      this.error = "";
    } catch (e) {
      this.error = [
        "ENROLLMENT_REQUIRED",
        "NETWORK_ERROR",
        "RATE_LIMITED",
      ].includes(e.message)
        ? e.message
        : "SERVICE_UNAVAILABLE";
    } finally {
      this.busy = false;
    }
    return this.status();
  }
  async recover(code) {
    if (this.busy) throw Error("BUSY");
    if (
      typeof code !== "string" ||
      code.length > 120 ||
      !/^[A-F0-9]{40}$/i.test(code.replace(/[\s-]/g, ""))
    )
      throw Error("INVALID_CODE");
    this.busy = true;
    try {
      const s = this.identity(),
        normalized = code.toUpperCase().replace(/[\s-]/g, "");
      if (!s.loginPending || s.loginPending.codeHash !== hash(normalized)) {
        s.loginPending = {
          requestId: randomUUID(),
          commitment: randomBytes(32).toString("hex"),
          codeHash: hash(normalized),
        };
        this.save();
      }
      const p = s.loginPending;
      if (!p.authorization) {
        p.authorization = await this.remote("/v1/recovery/reset", {
          mode: "login",
          code: normalized,
          requestId: p.requestId,
          requestCommitment: p.commitment,
        });
        this.check(p.authorization, p, "owner-login");
        this.save();
      }
      const claims = this.check(p.authorization, p, "owner-login");
      const result = await this.request("_recoverySignIn", {
        ownerId: claims.ownerId,
        requestId: p.requestId,
      });
      delete s.loginPending;
      try {
        this.save();
      } catch (e) {
        s.loginPending = p;
        throw e;
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
  async reset(code, password) {
    if (this.busy) throw Error("BUSY");
    if (
      typeof password !== "string" ||
      password.length < 10 ||
      password.length > 128 ||
      typeof code !== "string" ||
      code.length > 120
    )
      throw Error("INVALID_INPUT");
    this.busy = true;
    try {
      const s = this.identity();
      const normalized = code.toUpperCase().replace(/[\s-]/g, "");
      if (!s.pending || s.pending.codeHash !== hash(normalized)) {
        const salt = randomBytes(16).toString("hex");
        s.pending = {
          requestId: randomUUID(),
          commitment: randomBytes(32).toString("hex"),
          codeHash: hash(normalized),
          passwordHash:
            salt + ":" + scryptSync(password, salt, 64).toString("hex"),
        };
        this.save();
      } else {
        const [salt, expected] = s.pending.passwordHash.split(":");
        if (scryptSync(password, salt, 64).toString("hex") !== expected)
          throw Error("RETRY_PASSWORD");
      }
      const p = s.pending;
      const commitment = p.commitment;
      if (!p.authorization) {
        p.authorization = await this.remote("/v1/recovery/reset", {
          code: normalized,
          requestId: p.requestId,
          requestCommitment: commitment,
        });
        this.check(p.authorization, p);
        this.save();
      }
      const claims = this.check(p.authorization, p);
      const result = await this.request("_recoveryApply", {
        ownerId: claims.ownerId,
        requestId: p.requestId,
        hash: p.passwordHash,
        verifyPassword: password,
      });
      delete s.pending;
      this.save();
      return result;
    } finally {
      this.busy = false;
    }
  }
  check(receipt, p, purpose = "owner-reset") {
    try {
      if (
        typeof receipt.payload !== "string" ||
        receipt.payload.length > 6000 ||
        typeof receipt.signature !== "string"
      )
        throw Error();
      const c = JSON.parse(Buffer.from(receipt.payload, "base64url"));
      if (
        c.version !== 1 ||
        c.product !== "radefy-techmart" ||
        c.purpose !== purpose ||
        c.installationId !== hash(this.identity().publicKey) ||
        c.deviceHash !== this.licensing.hash ||
        c.requestId !== p.requestId ||
        c.requestCommitment !== p.commitment ||
        typeof c.ownerId !== "string" ||
        !Number.isSafeInteger(c.expiresAt) ||
        c.expiresAt < Date.now() ||
        !verify(
          null,
          Buffer.from(receipt.payload),
          this.licensing.config.publicKeys[c.keyId],
          Buffer.from(receipt.signature, "base64url"),
        )
      )
        throw Error();
      return c;
    } catch {
      throw Error("INVALID_RESPONSE");
    }
  }
}
module.exports = { RecoveryManager };
