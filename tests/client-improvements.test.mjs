import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store, today } from "../server/store.mjs";
import { notifications } from "../server/notifications.mjs";
import { normalizeGeneration } from "../shared/product-search.mjs";
import { collectList } from "../src/printing/collect-list.mjs";
import { invoiceWhen, invoicePrintModel } from "../src/printing/models.mjs";
function fixture(t, serialized = false) {
  const s = new Store(":memory:");
  t.after(() => s.close());
  const auth = s.setup({
    name: "Owner",
    username: "owner",
    password: "client-test-password",
    storeName: "Test shop",
  });
  const u = s.auth(auth.token);
  const product = s.createProduct(u, {
    name: "Latitude laptop",
    brand: "Dell",
    model: "7490",
    sku: "DEL-7490",
    category: serialized ? "Computers" : "Storage",
    serialized,
    price: 3000,
    unit_cost: 1000,
    opening_quantity: 3,
    attributes: { Generation: "8th Gen", RAM: "16 GB" },
  }).id;
  const customer = s.createParty(u, { kind: "customer", name: "Ali" }).id;
  const call = (c, a = {}) => s.dispatch(c, a, auth.token);
  const snapshot = () => s.listProducts({ id: product }, u).rows[0];
  const edit = (over = {}) => {
    const p = snapshot();
    return {
      ...p,
      serialized: Boolean(p.serialized),
      stock_target: p.stock,
      expected_stock: p.stock,
      expected_revision: p.stock_revision,
      request_key: randomUUID(),
      ...over,
    };
  };
  const sell = (extra = {}) =>
    s.postTrade(u, {
      kind: "sale",
      party_id: customer,
      date: today(),
      due_date: today(),
      paid: 0,
      request_key: randomUUID(),
      lines: [{ product_id: product, quantity: 1, price: 3000 }],
      ...extra,
    });
  return { s, u, product, customer, call, snapshot, edit, sell };
}
test("atomic edits, retry replay, stale stock and exact write-off preserve history", async (t) => {
  const f = fixture(t);
  const sale = f.sell({ paid: 3000 });
  const args = f.edit({ stock_target: 1, name: "Updated laptop" });
  const updated = await f.call("productUpdate", args);
  assert.equal(updated.product.stock, 1);
  assert.deepEqual(
    await f.call("productUpdate", args),
    JSON.parse(JSON.stringify(updated)),
  );
  assert.equal(f.s.one("SELECT SUM(debit-credit) n FROM journal").n, 0);
  await assert.rejects(
    f.call("productUpdate", f.edit({ expected_stock: 2 })),
    /STOCK_CHANGED/,
  );
  const bad = f.edit({ stock_target: 4, name: "Must roll back", unit_cost: 0 });
  f.s.saveSetting("closedThrough", today());
  await assert.rejects(f.call("productUpdate", bad), /closed/);
  assert.equal(f.snapshot().name, "Updated laptop");
  f.s.saveSetting("closedThrough", "");
  const p = f.snapshot(),
    del = {
      id: p.id,
      write_off: true,
      expected_stock: p.stock,
      expected_revision: p.stock_revision,
      request_key: randomUUID(),
    };
  await f.call("productDelete", del);
  await f.call("productDelete", del);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p.id).stock, 0);
  assert.equal(
    f.s.one("SELECT active FROM products WHERE id=?", p.id).active,
    0,
  );
  assert.equal(f.s.getDocument(sale.id).lines[0].name, "Latitude laptop");
  assert.equal(
    f.s.one("SELECT SUM(debit-credit) n FROM journal WHERE account='expenses'")
      .n,
    2000,
  );
  assert.equal(f.s.one("SELECT SUM(debit-credit) n FROM journal").n, 0);
});
test("tracked corrections automatically remove unnamed devices, require named selection, roll back and reject wrong devices", async (t) => {
  const f = fixture(t, true);
  const named = f.s.one(
    "SELECT id FROM inventory_units WHERE product_id=? ORDER BY rowid DESC",
    f.product,
  );
  f.s.run(
    "UPDATE inventory_units SET serial=? WHERE id=?",
    "SERIAL-1",
    named.id,
  );
  await f.call("productUpdate", f.edit({ stock_target: 1 }));
  assert.equal(
    f.s.one("SELECT status FROM inventory_units WHERE id=?", named.id).status,
    "available",
  );
  const args = f.edit({ stock_target: 0, name: "No partial save" });
  await assert.rejects(f.call("productUpdate", args), /SELECT_STOCK_DEVICES/);
  assert.equal(f.snapshot().name, "Latitude laptop");
  await assert.rejects(
    f.call("productUpdate", { ...args, unit_ids: ["missing"] }),
    /unavailable/,
  );
  await f.call("productUpdate", { ...args, unit_ids: [named.id] });
  assert.equal(f.snapshot().stock, 0);
  await f.call("productUpdate", f.edit({ stock_target: 2 }));
  assert.equal(
    f.s.one("SELECT COUNT(*) n FROM inventory_units WHERE status='available'")
      .n,
    2,
  );
});
test("combined catalog/global search, all-row exports, mixed-cost valuation and revision checks", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 13; i++)
    f.s.createProduct(f.u, {
      name: "Extra product",
      brand: "Dell",
      model: "7480",
      sku: "P" + String(i).padStart(3, "0"),
      category: "Storage",
      price: 2000,
      unit_cost: 500,
      opening_quantity: 1,
      attributes: { Generation: "8th Gen" },
    });
  assert.equal(
    (await f.call("catalog", { q: "Dell 8 Latitude" })).rows.length,
    1,
  );
  assert.equal(
    (await f.call("globalSearch", { q: "Dell 8 Latitude" })).results.filter(
      (r) => r.type === "product",
    ).length,
    1,
  );
  const rows = await collectList(f.call, "products", {});
  assert.equal(rows.length, 14);
  assert.equal(
    rows.reduce((n, r) => n + r.cost, 0),
    9500,
  );
  const page = await f.call("products", { limit: 10 });
  f.s.audit(f.u, "Test change", f.product);
  await assert.rejects(
    f.call("products", { after: page.next, revision: page.revision }),
    /LIST_CHANGED/,
  );
  assert.equal(normalizeGeneration("8"), "8th Gen");
  assert.equal(normalizeGeneration("۱۲"), "12th Gen");
  assert.equal(normalizeGeneration("M3"), "M3");
});
test("required due date, legacy undated editing and due reminders track payments and date edits", async (t) => {
  const f = fixture(t);
  assert.throws(() => f.sell({ due_date: null }), /SALE_DUE_REQUIRED/);
  const d = f.sell();
  assert.equal(
    notifications(f.s, f.u, { kind: "due" }).rows[0].invoices[0].id,
    d.id,
  );
  await f.call("payment", {
    kind: "receipt",
    party_id: f.customer,
    amount: 1000,
    date: today(),
    request_key: randomUUID(),
  });
  assert.equal(notifications(f.s, f.u, { kind: "due" }).rows[0].balance, 2000);
  const doc = f.s.getDocument(d.id);
  await f.call("saleDueDate", {
    id: d.id,
    revision: doc.revision,
    due_date: "2099-01-01",
  });
  assert.equal(notifications(f.s, f.u, { kind: "due" }).rows.length, 0);
  assert.equal(f.s.getDocument(d.id).paid, 1000);
  assert.equal(
    notifications(f.s, { ...f.u, permissions: [] }, { summaryOnly: true })
      .summary.dueInvoices,
    0,
  );
  const legacy = f.sell();
  f.s.run("UPDATE documents SET due_date=NULL WHERE id=?", legacy.id);
  const old = f.s.getDocument(legacy.id);
  await f.call("saleEdit", {
    id: old.id,
    revision: old.revision,
    party_id: f.customer,
    paid: 0,
    lines: [{ product_id: f.product, quantity: 1, price: 3000 }],
    request_key: randomUUID(),
  });
  assert.equal(f.s.getDocument(legacy.id).due_date, null);
});
test("debtors sorting remains stable across pagination and exports", async (t) => {
  const f = fixture(t);
  f.sell();
  for (const [name, amount] of [
    ["Zed", 5000],
    ["Bob", 2000],
    ["Amy", 5000],
  ])
    f.s.createParty(f.u, { kind: "customer", name, opening_balance: amount });
  const filters = { kind: "customer", filter: "debtors", sort: "balance" };
  const page = await f.call("parties", { ...filters, limit: 2 });
  const next = await f.call("parties", {
    ...filters,
    limit: 2,
    after: page.next,
    revision: page.revision,
  });
  assert.deepEqual(
    [...page.rows, ...next.rows].map((r) => r.balance),
    [5000, 5000, 3000, 2000],
  );
  const rows = await collectList(f.call, "parties", {
    ...filters,
    sort: "name",
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Ali", "Amy", "Bob", "Zed"],
  );
});
test("invoice clock handles noon/midnight and sale totals reconcile after returns", () => {
  assert.match(
    invoiceWhen({ kind: "sale", created_at: "2026-10-30T19:30:00Z" }),
    /12:00 AM$/,
  );
  assert.match(
    invoiceWhen({ kind: "sale", created_at: "2026-10-31T07:30:00Z" }),
    /12:00 PM$/,
  );
  assert.match(
    invoiceWhen({ kind: "purchase", created_at: "2026-10-31T07:30:00Z" }),
    /12:00$/,
  );
  const m = invoicePrintModel(
    {
      kind: "sale",
      total: 10000,
      returned: 2000,
      paid: 3000,
      due_date: "2026-11-01",
      previous_balance: 999,
      new_balance: 5999,
      lines: [],
    },
    {},
    {
      locale: "en",
      t: (k) => k,
      money: (n) => String(n),
      foreignMoney: String,
      specs: () => [],
      rate: String,
    },
  );
  assert.deepEqual(
    m.summary.map((r) => r.value),
    ["8000", "3000", "5000"],
  );
  assert.equal(m.summary.length, 3);
  assert(m.metadata.some((r) => r.value === "2026-11-01"));
});

test("mixed purchase batches include cargo in export and deletion expense, while permissions and replay keys are enforced", async (t) => {
  const f = fixture(t);
  const supplier = f.s.createParty(f.u, {
    kind: "supplier",
    name: "Supplier",
  }).id;
  f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: supplier,
    currency: "AFN",
    fx_rate: 10000,
    paid: 0,
    request_key: randomUUID(),
    lines: [
      {
        product_id: f.product,
        quantity: 2,
        cost_foreign: 2000,
        cargo_rent: 500,
        price: 2000,
      },
    ],
  });
  assert.equal(f.snapshot().cost, 8000); // 3 × 1000 + 2 × (2000 + 500)
  const sale = f.sell({ paid: 3000 });
  assert.equal(f.snapshot().cost, 7000);
  const p = f.snapshot();
  const args = {
    id: p.id,
    write_off: true,
    expected_stock: p.stock,
    expected_revision: p.stock_revision,
    request_key: randomUUID(),
  };
  await f.call("userCreate", {
    name: "Cashier",
    username: "cashier",
    password: "client-test-password",
    role: "Cashier",
  });
  const cashier = f.s.login({
    username: "cashier",
    password: "client-test-password",
  });
  await assert.rejects(
    f.s.dispatch("productDelete", args, cashier.token),
    /Permission/,
  );
  f.s.saveSetting("closedThrough", today());
  await assert.rejects(f.call("productDelete", args), /closed/);
  assert.equal(f.snapshot().stock, 4);
  f.s.saveSetting("closedThrough", "");
  await f.call("productDelete", args);
  await assert.rejects(
    f.call("productDelete", { ...args, expected_stock: 99 }),
    /Request key/,
  );
  assert.equal(
    f.s.one("SELECT SUM(debit-credit) n FROM journal WHERE account='expenses'")
      .n,
    7000,
  );
  assert.equal(f.s.getDocument(sale.id).lines[0].name, "Latitude laptop");
  assert.equal(f.s.one("SELECT SUM(debit-credit) n FROM journal").n, 0);
});

test("returns remove settled invoices from due lists, preserve undated debt and reject date rollover cursors", async (t) => {
  const f = fixture(t);
  const d = f.sell({ paid: 1000 });
  const yesterday = new Date(Date.parse(today() + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  f.s.run(
    "UPDATE documents SET date=?,due_date=? WHERE id=?",
    yesterday,
    yesterday,
    d.id,
  );
  assert.equal(
    notifications(f.s, f.u, { kind: "overdue" }).rows[0].balance,
    2000,
  );
  f.s.returnTrade(f.u, {
    original_id: d.id,
    lines: [{ line_id: d.lines[0].id, quantity: 1 }],
    note: "Return",
    request_key: randomUUID(),
  });
  assert.equal(
    notifications(f.s, f.u, { summaryOnly: true }).summary.dueInvoices,
    0,
  );
  const doc = f.s.getDocument(d.id);
  assert.equal(doc.total - doc.returned - doc.paid, 0);
  const undated = f.sell();
  f.s.run("UPDATE documents SET due_date=NULL WHERE id=?", undated.id);
  assert.equal(
    notifications(f.s, f.u, { summaryOnly: true }).summary.dueInvoices,
    0,
  );
  assert.equal(
    notifications(f.s, f.u, { summaryOnly: true }).summary.customers,
    1,
  );
  assert.throws(
    () => notifications(f.s, f.u, { asOf: yesterday }),
    /NOTIFICATIONS_CHANGED/,
  );
  await assert.rejects(
    f.call("saleDueDate", { id: undated.id, revision: 0, due_date: yesterday }),
    /before/,
  );
});

test("stock revisions remain monotonic across reversal and replacement with unchanged quantity", async (t) => {
  const f = fixture(t);
  const sold = f.sell({ paid: 3000 });
  const edit = f.edit({ name: "Stale update" });
  await f.call("saleDelete", {
    id: sold.id,
    revision: 0,
    request_key: randomUUID(),
  });
  f.sell({ paid: 3000 });
  assert.equal(f.snapshot().stock, edit.expected_stock);
  await assert.rejects(f.call("productUpdate", edit), /STOCK_CHANGED/);
  assert.equal(f.snapshot().name, "Latitude laptop");
});

test("product write-offs cannot consume customer-owned custody stock", async (t) => {
  const f = fixture(t);
  f.s.run(
    "UPDATE batches SET owner_id=? WHERE product_id=?",
    f.customer,
    f.product,
  );
  await assert.rejects(
    f.call("productDelete", { ...f.edit(), write_off: true }),
    /Customer resale/,
  );
  assert.equal(f.snapshot().stock, 3);
  assert.equal(
    f.s.one("SELECT active FROM products WHERE id=?", f.product).active,
    1,
  );
});
