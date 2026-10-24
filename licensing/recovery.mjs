const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const b64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const un64 = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
export const digest = async (text) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
async function verified(payload, signature, publicKey) {
  try {
    return await crypto.subtle.verify(
      "Ed25519",
      await crypto.subtle.importKey("spki", un64(publicKey), "Ed25519", false, [
        "verify",
      ]),
      un64(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}
export async function signed(env, claims) {
  const payload = b64(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        keyId: "v1",
        product: "radefy-techmart",
        ...claims,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(env.SIGNING_PRIVATE_KEY), (c) => c.charCodeAt(0)),
    "Ed25519",
    false,
    ["sign"],
  );
  return {
    payload,
    signature: b64(
      await crypto.subtle.sign(
        "Ed25519",
        key,
        new TextEncoder().encode(payload),
      ),
    ),
  };
}
export async function recoveryRequest(request, env) {
  if (request.method !== "POST")
    return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    if (!env.DB || !env.ACTIVATION_LIMITER || !env.SIGNING_PRIVATE_KEY)
      return json({ code: "SERVICE_UNAVAILABLE" }, 503);
    if (
      !(
        await env.ACTIVATION_LIMITER.limit({
          key:
            "recovery:" +
            (request.headers.get("CF-Connecting-IP") || "unknown"),
        })
      ).success
    )
      return json({ code: "RATE_LIMITED" }, 429);
    let size = 0,
      chunks = [];
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof input.payload !== "string" ||
      input.payload.length > 6000 ||
      typeof input.signature !== "string"
    )
      throw Error();
    const data = JSON.parse(new TextDecoder().decode(un64(input.payload)));
    const path = new URL(request.url).pathname;
    if (!["/v1/recovery/register", "/v1/recovery/reset"].includes(path))
      return json({ code: "NOT_FOUND" }, 404);
    if (
      data.action !== path ||
      !/^[a-f0-9]{64}$/.test(data.installationId || "") ||
      !/^[a-f0-9]{64}$/.test(data.deviceHash || "") ||
      !Number.isSafeInteger(data.timestamp) ||
      Math.abs(Date.now() - data.timestamp) > 300000
    )
      throw Error();
    let owner = await env.DB.prepare(
      "SELECT * FROM recovery_owners WHERE installation_id=?1",
    )
      .bind(data.installationId)
      .first();
    if (path.endsWith("/register")) {
      if (
        !/^[A-Za-z0-9_-]{59}$/.test(data.publicKey || "") ||
        (await digest(data.publicKey)) !== data.installationId ||
        !(await verified(input.payload, input.signature, data.publicKey))
      )
        throw Error();
      if (
        owner &&
        (owner.public_key !== data.publicKey ||
          owner.device_hash !== data.deviceHash ||
          owner.owner_id !== data.owner?.id)
      )
        throw Error();
      let licenseId = owner?.license_id || null;
      if (!owner) {
        if (data.licenseId) {
          const license = await env.DB.prepare(
            "SELECT id FROM licenses WHERE id=?1 AND device_hash=?2 AND recovery_public_key=?3",
          )
            .bind(data.licenseId, data.deviceHash, data.publicKey)
            .first();
          licenseId = license?.id || null;
        }
        if (!licenseId) {
          const enrollment = await env.DB.prepare(
            "SELECT * FROM recovery_enrollments WHERE installation_id=?1 AND device_hash=?2 AND public_key=?3 AND code_hash=?4 AND expires_at>?5",
          )
            .bind(
              data.installationId,
              data.deviceHash,
              data.publicKey,
              await digest(
                String(data.enrollmentCode || "")
                  .toUpperCase()
                  .replace(/[\s-]/g, ""),
              ),
              Date.now(),
            )
            .first();
          if (!enrollment) return json({ code: "ENROLLMENT_REQUIRED" }, 403);
        }
      }
      const o = data.owner;
      if (
        !o ||
        ![o.id, o.name, o.username, o.storeName].every(
          (x) => typeof x === "string" && x.length > 0 && x.length <= 200,
        )
      )
        throw Error();
      // Identical key/device/owner are required on conflict; authenticated updates cannot change identity.
      await env.DB.prepare(
        `INSERT INTO recovery_owners VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
    ON CONFLICT(installation_id) DO UPDATE SET name=excluded.name,username=excluded.username,store_name=excluded.store_name,updated_at=excluded.updated_at
    WHERE recovery_owners.public_key=excluded.public_key AND recovery_owners.device_hash=excluded.device_hash AND recovery_owners.owner_id=excluded.owner_id RETURNING installation_id`,
      )
        .bind(
          data.installationId,
          data.deviceHash,
          data.publicKey,
          licenseId,
          o.id,
          o.name,
          o.username,
          o.storeName,
          new Date().toISOString(),
        )
        .first();
      return json({ registered: true });
    }
    if (
      !owner ||
      owner.device_hash !== data.deviceHash ||
      !(await verified(input.payload, input.signature, owner.public_key))
    )
      throw Error();
    if (
      !/^[a-f0-9-]{36}$/.test(data.requestId || "") ||
      !/^[a-f0-9]{64}$/.test(data.requestCommitment || "")
    )
      throw Error();
    const codeHash = await digest(
      String(data.code || "")
        .toUpperCase()
        .replace(/[\s-]/g, ""),
    );
    if (data.mode != null && data.mode !== "login") throw Error();
    const login = data.mode === "login";
    // Bind retries to one random installation-generated request; no password-derived data is sent.
    const binding =
      data.requestId + ":" + data.requestCommitment + (login ? ":login" : "");
    const code = await env.DB.prepare(
      `UPDATE recovery_codes SET request_id=COALESCE(request_id,?1),redeemed_at=COALESCE(redeemed_at,?2)
    WHERE installation_id=?3 AND code_hash=?4 AND kind='reset' AND expires_at>?2 AND (request_id IS NULL OR request_id=?1) RETURNING expires_at`,
    )
      .bind(binding, Date.now(), data.installationId, codeHash)
      .first();
    if (!code) {
      const existing = await env.DB.prepare(
        "SELECT installation_id,expires_at,request_id FROM recovery_codes WHERE code_hash=?1",
      )
        .bind(codeHash)
        .first();
      const error =
        existing?.installation_id !== data.installationId && existing
          ? "WRONG_STORE"
          : existing?.expires_at <= Date.now()
            ? "EXPIRED_CODE"
            : existing?.request_id
              ? "CODE_USED"
              : "INVALID_CODE";
      return json({ code: error }, 403);
    }
    return json(
      await signed(env, {
        purpose: login ? "owner-login" : "owner-reset",
        installationId: data.installationId,
        deviceHash: data.deviceHash,
        ownerId: owner.owner_id,
        requestId: data.requestId,
        requestCommitment: data.requestCommitment,
        expiresAt: code.expires_at,
      }),
    );
  } catch {
    return json({ code: "INVALID_REQUEST" }, 400);
  }
}
