import { recoveryRequest } from "./recovery.mjs";
const PRODUCT = "radefy-techmart";
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const bytes64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
async function boundedBody(request) {
  if (Number(request.headers.get("content-length")) > 1024)
    throw new Error("body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024) {
        await reader.cancel();
        throw new Error("body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ service: PRODUCT, version: 1 });
    if (url.pathname.startsWith("/v1/recovery/"))
      return recoveryRequest(request, env);
    if (url.pathname !== "/v1/activate")
      return json({ code: "NOT_FOUND" }, 404);
    if (request.method !== "POST")
      return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    try {
      if (!env.ACTIVATION_LIMITER || !env.DB || !env.SIGNING_PRIVATE_KEY)
        return json({ code: "SERVICE_UNAVAILABLE" }, 503);
      const limited = await env.ACTIVATION_LIMITER.limit({
        key: request.headers.get("CF-Connecting-IP") || "unknown",
      });
      if (!limited.success) return json({ code: "RATE_LIMITED" }, 429);
      let input;
      try {
        input = await boundedBody(request);
      } catch {
        return json({ code: "INVALID_REQUEST" }, 400);
      }
      const key =
        typeof input?.key === "string"
          ? input.key.toUpperCase().replace(/[\s-]/g, "")
          : "";
      if (
        !/^RADE[0-9A-HJKMNP-TV-Z]{32}$/.test(key) ||
        !/^[a-f0-9]{64}$/.test(input?.deviceHash || "")
      )
        return json({ code: "INVALID_KEY" }, 400);
      if (input.publicKey && !/^[A-Za-z0-9_-]{59}$/.test(input.publicKey))
        return json({ code: "INVALID_REQUEST" }, 400);
      const signingKey = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(atob(env.SIGNING_PRIVATE_KEY), (c) => c.charCodeAt(0)),
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
        ),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const row = await env.DB.prepare(
        `UPDATE licenses SET device_hash=COALESCE(device_hash,?1), recovery_public_key=CASE WHEN activated_at IS NULL THEN ?4 ELSE recovery_public_key END, activated_at=COALESCE(activated_at,?2)
        WHERE key_hash=?3 AND (device_hash IS NULL OR device_hash=?1)
        RETURNING id, device_hash, activated_at, recovery_public_key`,
      )
        .bind(
          input.deviceHash,
          new Date().toISOString(),
          hash,
          input.publicKey || null,
        )
        .first();
      if (!row) {
        const exists = await env.DB.prepare(
          "SELECT id FROM licenses WHERE key_hash=?1",
        )
          .bind(hash)
          .first();
        return json(
          { code: exists ? "KEY_IN_USE" : "INVALID_KEY" },
          exists ? 409 : 400,
        );
      }
      const payload = bytes64(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            keyId: "v1",
            product: PRODUCT,
            licenseId: row.id,
            deviceHash: row.device_hash,
            activatedAt: row.activated_at,
            ...(row.recovery_public_key
              ? { recoveryPublicKey: row.recovery_public_key }
              : {}),
          }),
        ),
      );
      const signature = bytes64(
        await crypto.subtle.sign(
          "Ed25519",
          signingKey,
          new TextEncoder().encode(payload),
        ),
      );
      return json({ payload, signature });
    } catch {
      // Never log activation keys, request bodies, device IDs, or signing material.
      console.error(JSON.stringify({ event: "activation_service_error" }));
      return json({ code: "SERVICE_UNAVAILABLE" }, 503);
    }
  },
};
