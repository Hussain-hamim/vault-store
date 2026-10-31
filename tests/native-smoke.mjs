import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const service = process.argv[2];
if (!service) throw new Error("Pass the packaged server directory.");
const { createWorker } = await import(
  pathToFileURL(path.join(service, "client.mjs"))
);
const root = mkdtempSync(path.join(os.tmpdir(), "vault-native-smoke-"));
const db = createWorker(path.join(root, "smoke.sqlite"));
try {
  assert.equal((await db.request("status")).setup, true);
  const login = await db.request("setup", {
    name: "Native smoke owner",
    username: "native-test",
    password: randomUUID(),
    storeName: "Isolated native smoke test",
  });
  const send = (command, args = {}) => db.request(command, args, login.token);
  const supplier = await send("partyCreate", {
    kind: "supplier",
    name: "Smoke supplier",
  });
  const customer = await send("partyCreate", {
    kind: "customer",
    name: "Smoke customer",
  });
  const product = await send("productCreate", {
    name: "Smoke SSD",
    brand: "Test",
    model: "NVMe",
    category: "Storage",
    sku: "SMOKE-1",
    price: 100000,
  });
  await send("purchase", {
    party_id: supplier.id,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: product.id, quantity: 2, price: 80000 }],
  });
  await send("sale", {
    due_date: "2099-12-31",
    party_id: customer.id,
    paid: 60000,
    request_key: randomUUID(),
    lines: [{ product_id: product.id, quantity: 1, price: 100000 }],
  });
  const report = await send("reports");
  assert.equal(report.totals.gross, 20000);
  assert.equal((await send("products")).rows[0].stock, 1);
  await send("userPermissions", {
    id: login.user.id,
    role: "Owner",
    permissions: login.user.permissions,
  });
  console.log(
    JSON.stringify({
      packagedWorker: "passed",
      node: process.versions.node,
      sqlite: process.versions.sqlite,
      grossProfit_AF: report.totals.gross / 100,
      stockRemaining: 1,
    }),
  );
} finally {
  await db.close();
  rmSync(root, { recursive: true, force: true });
}
