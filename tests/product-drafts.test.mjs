import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { restoreDatabase } from "../server/restore.mjs";
const data = {
  name: "",
  brand: "HP",
  model: "",
  category: "Computers",
  currency: "AED",
  cost: "12.",
  rate: "",
  opening_quantity: "",
  RAM: "60 GB",
};
const product = () => ({
  name: "Draft laptop",
  brand: "HP",
  model: "840 G4",
  sku: randomUUID(),
  category: "Computers",
  serialized: false,
  price: 100000,
  unit_cost: 50000,
  opening_quantity: 3,
});
function fixture(t, path = ":memory:") {
  const s = new Store(path);
  t.after(() => s.close());
  const auth = s.setup({
    name: "Owner",
    username: "owner",
    password: "draft-test-password",
    storeName: "Draft shop",
  });
  return {
    s,
    token: auth.token,
    call: (cmd, args = {}) => s.dispatch(cmd, args, auth.token),
  };
}
test("incomplete drafts are persistent private data, not inventory or accounting", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "product-drafts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "shop.sqlite");
  const f = fixture(t, path);
  const d = await f.call("productDraftSave", { intent: "catalog", data });
  assert.deepEqual(d.data, data);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, 0);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM journal").n, 0);
  const reopened = new Store(path);
  try {
    assert.deepEqual(
      (await reopened.dispatch("productDraftRead", { id: d.id }, f.token)).data,
      data,
    );
  } finally {
    reopened.close();
  }
  const updated = await f.call("productDraftSave", {
    id: d.id,
    revision: d.revision,
    intent: "catalog",
    data: { ...data, name: "Updated" },
  });
  assert.equal(updated.id, d.id);
  assert.equal(updated.revision, 1);
  await assert.rejects(
    f.call("productDraftSave", {
      id: d.id,
      revision: 0,
      intent: "catalog",
      data,
    }),
    /another window/,
  );
  assert.equal(
    (await f.call("productDraftList", { intent: "catalog" })).count,
    1,
  );
  assert.equal(
    (await f.call("productDraftList", { intent: "purchase" })).count,
    0,
  );
});
test("publishing commits one product and opening stock and consumes draft atomically; retries return same id", async (t) => {
  const f = fixture(t);
  const d = await f.call("productDraftSave", { intent: "catalog", data });
  const request = {
    id: d.id,
    revision: d.revision,
    intent: "catalog",
    request_key: randomUUID(),
    product: product(),
  };
  const r = await f.call("productDraftPublish", request);
  const retry = await f.call("productDraftPublish", request);
  assert.equal(retry.id, r.id);
  assert.equal(r.product.stock, 3);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, 1);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM movements").n, 1);
  assert.equal(
    (await f.call("productDraftList", { intent: "catalog" })).count,
    0,
  );
  await f.call("productUpdate", {
    ...request.product,
    id: r.id,
    name: "Edited previous",
  });
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", r.id).stock, 3);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, 1);
});
test("validation failure retains draft; purchase publication has no opening stock", async (t) => {
  const f = fixture(t);
  const d = await f.call("productDraftSave", { intent: "purchase", data });
  const request = {
    id: d.id,
    revision: 0,
    intent: "purchase",
    request_key: randomUUID(),
    product: { ...product(), name: "" },
  };
  await assert.rejects(f.call("productDraftPublish", request));
  assert.equal(
    (await f.call("productDraftList", { intent: "purchase" })).count,
    1,
  );
  assert.equal(f.s.one("SELECT COUNT(*) n FROM product_entry_operations").n, 0);
  await assert.rejects(
    f.call("productDraftPublish", {
      ...request,
      intent: "catalog",
      product: product(),
    }),
    /context/,
  );
  const r = await f.call("productDraftPublish", {
    ...request,
    product: product(),
  });
  assert.equal(r.product.stock, 0);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM journal").n, 0);
});
test("draft photo deduplication, backup and restore include incomplete form and image", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "draft-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, join(root, "shop.sqlite"));
  const photo_data =
    "data:image/jpeg;base64," +
    readFileSync(
      new URL("../public/assets/products/apple-iphone-15.jpg", import.meta.url),
    ).toString("base64");
  const d = await f.call("productDraftSave", {
    intent: "catalog",
    data,
    photo_data,
  });
  assert.match(d.image, /^photo:/);
  assert.equal(d.photo_data, undefined);
  await f.call("productDraftSave", { intent: "catalog", data, photo_data });
  assert.equal(f.s.one("SELECT COUNT(*) n FROM product_photos").n, 1);
  const dest = join(root, "backup");
  mkdirSync(dest);
  const backup = await f.s.createBackup(f.s.auth(f.token), {
    destination: dest,
  });
  await restoreDatabase(backup.results[0].path, join(root, "restore.sqlite"));
  const restored = new Store(join(root, "restore.sqlite"));
  try {
    const r = await restored.dispatch(
      "productDraftRead",
      { id: d.id },
      f.token,
    );
    assert.deepEqual(r.data, data);
    assert.equal(
      (await restored.dispatch("productPhoto", { ref: r.image }, f.token)).src,
      photo_data,
    );
  } finally {
    restored.close();
  }
});
test("ownership, permission, pagination and safe draft deletion", async (t) => {
  const f = fixture(t);
  const own = await f.call("productDraftSave", { intent: "catalog", data });
  for (let i = 0; i < 22; i++)
    await f.call("productDraftSave", {
      intent: "catalog",
      data: { ...data, name: "Draft " + i },
    });
  const page = await f.call("productDraftList", { intent: "catalog" });
  assert.equal(page.rows.length, 20);
  assert.equal(page.count, 23);
  assert.equal(
    (await f.call("productDraftList", { intent: "catalog", offset: page.next }))
      .rows.length,
    3,
  );
  await f.call("userCreate", {
    name: "Clerk",
    username: "clerk",
    password: "clerk-draft-password",
    role: "Inventory clerk",
    permissions: ["inventory"],
  });
  const other = await f.s.dispatch("login", {
    username: "clerk",
    password: "clerk-draft-password",
  });
  assert.equal(
    (await f.s.dispatch("productDraftList", { intent: "catalog" }, other.token))
      .count,
    0,
  );
  for (const cmd of [
    "productDraftRead",
    "productDraftDelete",
    "productDraftSave",
    "productDraftPublish",
  ])
    await assert.rejects(
      f.s.dispatch(
        cmd,
        {
          id: own.id,
          revision: 0,
          intent: "catalog",
          data,
          request_key: randomUUID(),
          product: product(),
        },
        other.token,
      ),
      /not found/,
    );
  await f.call("userCreate", {
    name: "Cashier",
    username: "cashier",
    password: "cashier-draft-password",
    role: "Cashier",
    permissions: ["sales"],
  });
  const cashier = await f.s.dispatch("login", {
    username: "cashier",
    password: "cashier-draft-password",
  });
  await assert.rejects(
    f.s.dispatch("productDraftList", { intent: "catalog" }, cashier.token),
    /Permission/,
  );
  await assert.rejects(
    f.call("productDraftDelete", { id: own.id, revision: 8 }),
    /another window/,
  );
  await f.call("productDraftDelete", { id: own.id, revision: 0 });
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, 0);
  const another = fixture(t);
  await assert.rejects(
    another.call("productDraftRead", { id: own.id }),
    /not found/,
  );
});
