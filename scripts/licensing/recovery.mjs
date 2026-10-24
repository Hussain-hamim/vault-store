import { randomBytes, createHash } from "node:crypto";
import { d1Query } from "./keys.mjs";
const [command, ...args] = process.argv.slice(2);
const option = (n) => args[args.indexOf("--" + n) + 1];
const label = (n) => (args.includes("--" + n) ? option(n) : "");
const hash = (x) => createHash("sha256").update(x).digest("hex");
try {
  if (command === "owners") {
    const search = args.includes("--search") ? option("search") : "";
    console.table(
      (
        await d1Query(
          "SELECT installation_id,license_id,owner_id,name,username,store_name,updated_at FROM recovery_owners WHERE name LIKE ?1 OR store_name LIKE ?1 OR username LIKE ?1 ORDER BY updated_at DESC LIMIT 100",
          ["%" + search + "%"],
        )
      )[0].results,
    );
  } else if (command === "approve") {
    const id = option("installation"),
      device = option("device"),
      pub = option("public-key");
    if (
      !args.includes("--installation") ||
      !args.includes("--device") ||
      !args.includes("--public-key") ||
      !/^[a-f0-9]{64}$/.test(device || "") ||
      !/^[A-Za-z0-9_-]{59}$/.test(pub || "") ||
      hash(pub) !== id
    )
      throw Error(
        "Use approve --installation ID --device HASH --public-key KEY from Settings recovery details. Verify the client first.",
      );
    const expires = Date.now() + 1800000;
    await d1Query(
      "INSERT INTO recovery_enrollments(installation_id,device_hash,public_key,code_hash,expires_at,name,username,store_name) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(installation_id) DO UPDATE SET device_hash=excluded.device_hash,public_key=excluded.public_key,code_hash=excluded.code_hash,expires_at=excluded.expires_at,name=excluded.name,username=excluded.username,store_name=excluded.store_name",
      [
        id,
        device,
        pub,
        hash(""),
        expires,
        label("name"),
        label("username"),
        label("shop"),
      ],
    );
    console.log(
      JSON.stringify({
        installation: id,
        approved: true,
        expiresAt: new Date(expires).toISOString(),
      }),
    );
  } else if (command === "issue") {
    const byId = args.includes("--installation");
    const shop = args.includes("--shop") ? option("shop") : "";
    const id = byId ? option("installation") : "";
    if (byId ? !/^[a-f0-9]{64}$/.test(id || "") : !shop || shop.length > 200)
      throw Error(
        'Use issue --shop "Shop name" or issue --installation ID. Verify the client first.',
      );
    const rows = (
      await d1Query(
        byId
          ? "SELECT installation_id,username,store_name FROM recovery_owners WHERE installation_id=?1"
          : "SELECT installation_id,username,store_name FROM recovery_owners WHERE store_name=?1 COLLATE NOCASE AND (?2='' OR username=?2 COLLATE NOCASE)",
        byId ? [id] : [shop, label("username")],
      )
    )[0].results;
    if (!rows.length)
      throw Error(
        "No recovery-ready installation found. Check the shop name or installation reference.",
      );
    if (rows.length !== 1)
      throw Error(
        "More than one installation matches. Use --installation with the reference shown in the client's app.",
      );
    const selected = rows[0];
    const code = randomBytes(20).toString("hex").toUpperCase(),
      expires = Date.now() + 1800000;
    await d1Query(
      "INSERT INTO recovery_codes(installation_id,code_hash,kind,expires_at,request_id,redeemed_at) VALUES (?1,?2,'reset',?3,NULL,NULL) ON CONFLICT(installation_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,request_id=NULL,redeemed_at=NULL",
      [selected.installation_id, hash(code), expires],
    );
    console.log(
      JSON.stringify({
        installation: selected.installation_id,
        shop: selected.store_name,
        username: selected.username,
        recoveryCode: code.match(/.{5}/g).join("-"),
        expiresAt: new Date(expires).toISOString(),
      }),
    );
  } else
    throw Error(
      'Commands: owners [--search NAME] | approve --installation ID --device HASH --public-key KEY | issue --shop "Shop name" | issue --installation ID',
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
