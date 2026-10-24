import { readAdminToken } from "./credentials.mjs";
import {
  randomBytes,
  randomUUID,
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const root = new URL("../../", import.meta.url);
export function generateLicenseKey() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0,
    value = 0,
    encoded = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
  }
  return "RADE-" + encoded.match(/.{4}/g).join("-");
}
export const keyHash = (key) =>
  createHash("sha256")
    .update(key.toUpperCase().replace(/[\s-]/g, ""))
    .digest("hex");
export async function d1Query(sql, params = []) {
  const config = JSON.parse(
    readFileSync(new URL("licensing/deployment.json", root)),
  );
  const token = readAdminToken();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success || data.result?.some((r) => !r.success))
    throw new Error(
      "Cloudflare D1 request failed. Check token permissions and deployment configuration.",
    );
  return data.result;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf("--" + name);
    return index < 0 ? fallback : args[index + 1];
  };
  if (command === "verify") {
    const response = await fetch(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      {
        headers: { Authorization: `Bearer ${readAdminToken()}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.success || data.result?.status !== "active")
      throw new Error(
        "Cloudflare could not verify this token. Check that it is active.",
      );
    await d1Query("UPDATE licenses SET client_label=client_label WHERE 0");
    console.log(
      "Cloudflare token is active. Activation database access and write permissions verified. No license records were changed.",
    );
  } else if (command === "init-signing") {
    const folder = new URL(".local/activation/", root),
      file = new URL("signing-private-key.pem", folder);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (existsSync(file))
      throw new Error(
        "Signing key already exists. Do not overwrite it; existing receipts depend on its public key.",
      );
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(
      file,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
    writeFileSync(
      new URL("signing-private-key.base64", folder),
      pair.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
      { mode: 0o600, flag: "wx" },
    );
    writeFileSync(
      new URL("signing-public-key.pem", folder),
      pair.publicKey.export({ type: "spki", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Signing files created in .local/activation/ (ignored by Git). Back them up securely. Never ship the private files.",
    );
  } else if (command === "create") {
    const client = option("client", ""),
      count = Number(option("count", "1"));
    if (
      !client ||
      client.length > 200 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100
    )
      throw new Error(
        'Use create --client "Client/store name" --count 1 (maximum 100).',
      );
    for (let i = 0; i < count; i++) {
      const key = generateLicenseKey(),
        id = randomUUID();
      await d1Query(
        "INSERT INTO licenses(id,key_hash,key_suffix,client_label,created_at,name,username,store_name) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        [
          id,
          keyHash(key),
          key.slice(-4),
          client,
          new Date().toISOString(),
          option("name", ""),
          option("username", ""),
          option("shop", client),
        ],
      );
      console.log(JSON.stringify({ id, client, key }));
    }
  } else if (command === "list") {
    const limit = Number(option("limit", "100")),
      offset = Number(option("offset", "0"));
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new Error("Use --limit 1..1000 and --offset 0 or greater.");
    const rows = await d1Query(
      "SELECT id,key_suffix,client_label,name,username,store_name,created_at,activated_at,CASE WHEN device_hash IS NULL THEN 'unused' ELSE 'activated' END AS status FROM licenses ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
      [limit, offset],
    );
    console.table(rows[0].results);
  } else if (command === "schema") {
    // Additive, restart-safe upgrade: inspect every table before adding columns.
    for (const table of [
      "licenses",
      "recovery_codes",
      "recovery_enrollments",
    ]) {
      const columns = (await d1Query(`PRAGMA table_info(${table})`))[0].results;
      if (!columns.length) continue;
      const additions = {
        name: "TEXT NOT NULL DEFAULT ''",
        username: "TEXT NOT NULL DEFAULT ''",
        store_name: "TEXT NOT NULL DEFAULT ''",
        ...(table === "licenses" ? { recovery_public_key: "TEXT" } : {}),
      };
      for (const [column, type] of Object.entries(additions))
        if (!columns.some((c) => c.name === column))
          await d1Query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    await d1Query(readFileSync(new URL("licensing/schema.sql", root), "utf8"));
    console.log("License table ready.");
  } else
    throw new Error(
      'Commands: verify | init-signing | schema | create --client "Store" --count 1 | list --limit 100 --offset 0',
    );
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
