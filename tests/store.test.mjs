import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store, today } from "../server/store.mjs";
import { validateRestore, restoreDatabase } from "../server/restore.mjs";
import { scheduleDefinition } from "../server/schedule.mjs";
const key = () => randomUUID();
function fixture(t, file = ":memory:") {
  const s = new Store(file);
  t.after(() => s.close());
  const session = s.setup({
    name: "Test Owner",
    username: "owner",
    password: "secure-test-password",
    storeName: "Test store",
  });
  const u = s.auth(session.token);
  const supplier = s.createParty(u, {
    kind: "supplier",
    name: "Test supplier",
  }).id;
  const customer = s.createParty(u, {
    kind: "customer",
    name: "Test customer",
  }).id;
  const product = s.createProduct(u, {
    name: "Test SSD",
    brand: "Samsung",
    model: "990",
    sku: "SSD-01",
    category: "Storage",
    price: 100000,
  }).id;
  return { s, u, token: session.token, supplier, customer, product };
}
const purchase = (f, qty = 10, cost = 80000, extra = {}) =>
  f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    request_key: key(),
    lines: [{ product_id: f.product, quantity: qty, price: cost }],
    ...extra,
  });
const sale = (f, qty = 1, paid = 60000, extra = {}) =>
  f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid,
    request_key: key(),
    lines: [{ product_id: f.product, quantity: qty, price: 100000 }],
    ...extra,
  });
function balanced(s) {
  assert.equal(
    s.one("SELECT COALESCE(SUM(debit-credit),0) n FROM journal").n,
    0,
  );
  assert.equal(
    s.one(
      "SELECT COUNT(*) n FROM (SELECT document_id FROM journal GROUP BY document_id HAVING SUM(debit-credit)<>0)",
    ).n,
    0,
  );
  assert.equal(
    s.one(
      "SELECT COUNT(*) n FROM products p WHERE p.stock<>(SELECT COALESCE(SUM(remaining),0) FROM batches b WHERE b.product_id=p.id)",
    ).n,
    0,
  );
}
test("profit is accrual based; customer and supplier payments do not change profit", (t) => {
  const f = fixture(t);
  purchase(f);
  sale(f);
  f.s.expense(f.u, {
    amount: 5000,
    category: "Utilities",
    note: "Electricity",
    request_key: key(),
  });
  const totals = f.s.totals();
  assert.equal(totals.gross, 20000);
  assert.equal(totals.net, 15000);
  assert.equal(f.s.partyBalance(f.customer).balance, 40000);
  f.s.payment(f.u, { party_id: f.customer, amount: 40000, request_key: key() });
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  assert.equal(f.s.totals().net, 15000);
  f.s.payment(f.u, {
    party_id: f.supplier,
    amount: 800000,
    request_key: key(),
  });
  assert.equal(f.s.partyBalance(f.supplier).balance, 0);
  assert.equal(f.s.totals().net, 15000);
  balanced(f.s);
});
test("insufficient stock rolls back invoice, allocations, stock and ledger together", (t) => {
  const f = fixture(t);
  purchase(f, 1);
  const before = f.s.one("SELECT COUNT(*) n FROM documents").n;
  assert.throws(() => sale(f, 2, 0), /Insufficient stock/);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM documents").n, before);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    1,
  );
  balanced(f.s);
});
test("retrying the same request does not duplicate a sale", (t) => {
  const f = fixture(t);
  purchase(f);
  const request_key = key();
  const a = sale(f, 1, 100000, { request_key }),
    b = sale(f, 1, 100000, { request_key });
  assert.equal(a.id, b.id);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    9,
  );
  balanced(f.s);
});
test("FIFO uses original acquisition batches, including purchase discount remainders", (t) => {
  const f = fixture(t);
  purchase(f, 2, 60000);
  purchase(f, 2, 80000);
  const doc = sale(f, 3, 0);
  assert.equal(doc.cost, 200000);
  assert.equal(f.s.totals().gross, 100000);
  balanced(f.s);
});
test("sale returns reduce debt first, refund paid amounts, and reverse original cost", (t) => {
  const f = fixture(t);
  purchase(f);
  const doc = sale(f);
  const ret = f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Customer return",
    request_key: key(),
  });
  assert.equal(ret.total, 100000);
  assert.equal(ret.paid, 60000);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  assert.equal(f.s.totals().gross, 0);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    10,
  );
  assert.throws(
    () =>
      f.s.returnTrade(f.u, {
        original_id: doc.id,
        lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
        note: "Again",
        request_key: key(),
      }),
    /exceeds/,
  );
  balanced(f.s);
});
test("partial discounts and returns preserve exact monetary totals", (t) => {
  const f = fixture(t);
  purchase(f, 3, 500);
  const doc = sale(f, 3, 2999, {
    lines: [{ product_id: f.product, quantity: 3, price: 1000, discount: 1 }],
  });
  for (let i = 0; i < 3; i++)
    f.s.returnTrade(f.u, {
      original_id: doc.id,
      lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
      note: "Partial return",
      request_key: key(),
    });
  assert.equal(f.s.getDocument(doc.id).returned, 2999);
  assert.equal(f.s.getDocument(doc.id).paid, 0);
  assert.equal(f.s.totals().net, 0);
  balanced(f.s);
});
test("overselling the same unit is blocked after stock is consumed", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Phone",
    brand: "Apple",
    model: "15",
    sku: "PHONE",
    category: "Mobiles",
    price: 100000,
  }).id;
  f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    request_key: key(),
    lines: [{ product_id: p, quantity: 1, price: 80000 }],
  });
  f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 100000,
    request_key: key(),
    lines: [{ product_id: p, quantity: 1, price: 100000 }],
  });
  assert.throws(
    () =>
      f.s.postTrade(f.u, {
        kind: "sale",
        party_id: f.customer,
        paid: 100000,
        request_key: key(),
        lines: [{ product_id: p, quantity: 1, price: 100000 }],
      }),
    /Insufficient stock/,
  );
  balanced(f.s);
});
test("walk-in credit is blocked and opening setup creates the walk-in account", (t) => {
  const f = fixture(t);
  purchase(f);
  assert.throws(() => sale(f, 1, 0, { party_id: null }), /Walk-in/);
  balanced(f.s);
});
test("backend rejects unauthorized commands and cost information stays private", async (t) => {
  const f = fixture(t);
  purchase(f);
  await f.s.dispatch(
    "userCreate",
    {
      name: "Cashier",
      username: "cashier",
      password: "cashier-test-pass",
      role: "Cashier",
    },
    f.token,
  );
  const session = await f.s.dispatch("login", {
    username: "cashier",
    password: "cashier-test-pass",
  });
  await assert.rejects(
    f.s.dispatch("reports", {}, session.token),
    /Permission/,
  );
  await assert.rejects(
    f.s.dispatch("backupSettings", { destinations: ["/tmp"] }, session.token),
    /Permission/,
  );
  const overview = await f.s.dispatch("overview", {}, session.token);
  assert.equal(overview.inventory, undefined);
  assert.equal(overview.totals.gross, undefined);
  const products = await f.s.dispatch("catalog", {}, session.token);
  assert.equal(products.rows[0].cost, undefined);
});
test("period lock prevents backdated postings without partial records", async (t) => {
  const f = fixture(t);
  purchase(f);
  await f.s.dispatch("closePeriod", { date: today() }, f.token);
  assert.throws(() => sale(f), /period is closed/);
  balanced(f.s);
});
test("backup verifies live WAL data, tolerates failed destinations, and restores on another file", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, path.join(root, "live.sqlite"));
  purchase(f);
  sale(f);
  const dest = path.join(root, "drive");
  mkdirSync(dest);
  f.s.saveSetting("backups", {
    destinations: [dest, path.join(root, "missing-drive")],
    retentionDays: 30,
    lastSuccess: null,
  });
  const result = await f.s.createBackup(f.u);
  assert.equal(result.results[0].status, "verified");
  assert.equal(result.results[1].status, "failed");
  assert.equal(f.s.setting("backups").lastSuccess, null);
  const file = result.results[0].path;
  const valid = validateRestore(file);
  assert.equal(valid.products, 1);
  assert.equal(valid.documents, 2);
  const target = path.join(root, "restored.sqlite");
  await restoreDatabase(file, target);
  const restored = new Store(target);
  try {
    assert.equal(restored.one("SELECT stock FROM products").stock, 9);
    assert.equal(restored.totals().gross, 20000);
    balanced(restored);
  } finally {
    restored.close();
  }
  writeFileSync(file, "tampered");
  assert.throws(() => validateRestore(file), /checksum/);
});
test("retention never deletes unrelated files and keeps manual snapshots for the window", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vault-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, path.join(root, "live.sqlite"));
  const folder = path.join(root, "Vault Store Backups");
  mkdirSync(folder);
  const old = "vault-2020-01-01-owned.sqlite";
  writeFileSync(path.join(folder, old), "old");
  writeFileSync(
    path.join(folder, old + ".json"),
    JSON.stringify({
      application: "Vault Store",
      schema: 1,
      businessDate: "2020-01-01",
      automatic: true,
    }),
  );
  writeFileSync(path.join(folder, "personal.sqlite"), "keep");
  f.s.rotateBackups(folder);
  assert.equal(existsSync(path.join(folder, old)), false);
  assert.equal(
    readFileSync(path.join(folder, "personal.sqlite"), "utf8"),
    "keep",
  );
});
test("scheduler definitions quote paths safely for Windows and macOS", () => {
  const options = {
    executable: "/Applications/Vault & Store.app/Contents/MacOS/Vault",
    appPath: null,
    userData: "/Users/test/Vault Store",
  };
  const mac = scheduleDefinition(options, "darwin");
  assert.match(mac.contents, /Vault &amp; Store/);
  assert.match(mac.contents, /<integer>3600<\/integer>/);
  const win = scheduleDefinition(
    { ...options, executable: "C:\\Program Files\\Vault\\Vault.exe" },
    "win32",
  );
  assert.match(win.contents, /<StartWhenAvailable>true/);
  assert.match(win.contents, /--backup-mode/);
});
test("partial sale returns restore FIFO cost for the returned quantity", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Phone",
    brand: "Apple",
    model: "15",
    sku: "QTY-RETURN",
    category: "Mobiles",
    price: 100000,
  }).id;
  for (const cost of [60000, 80000])
    f.s.postTrade(f.u, {
      kind: "purchase",
      party_id: f.supplier,
      paid: 0,
      request_key: key(),
      lines: [{ product_id: p, quantity: 1, price: cost }],
    });
  const doc = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 200000,
    request_key: key(),
    lines: [{ product_id: p, quantity: 2, price: 100000 }],
  });
  const ret = f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Return one unit",
    request_key: key(),
  });
  assert.equal(ret.cost, 60000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 1);
  balanced(f.s);
});
test("purchase returns preserve discounted batch costs without penny loss", (t) => {
  const f = fixture(t);
  const doc = purchase(f, 3, 1000, {
    lines: [{ product_id: f.product, quantity: 3, price: 1000, discount: 1 }],
  });
  for (let i = 0; i < 3; i++)
    f.s.returnTrade(f.u, {
      original_id: doc.id,
      lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
      note: "Supplier return",
      request_key: key(),
    });
  assert.equal(f.s.getDocument(doc.id).returned, 2999);
  assert.equal(f.s.partyBalance(f.supplier).balance, 0);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    0,
  );
  balanced(f.s);
});
test("daily and party summaries reconcile to the immutable journal after returns and payments", (t) => {
  const f = fixture(t);
  purchase(f);
  const doc = sale(f, 2, 100000);
  f.s.payment(f.u, { party_id: f.customer, amount: 50000, request_key: key() });
  f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Partial return",
    request_key: key(),
  });
  for (const r of f.s.all(
    "SELECT date,account,SUM(debit) debit,SUM(credit) credit FROM journal GROUP BY date,account",
  )) {
    const summary = f.s.one(
      "SELECT debit,credit FROM daily_totals WHERE date=? AND account=?",
      r.date,
      r.account,
    );
    assert.equal(summary.debit, r.debit);
    assert.equal(summary.credit, r.credit);
  }
  for (const r of f.s.all(
    "SELECT party_id,account,SUM(debit) debit,SUM(credit) credit FROM journal WHERE party_id IS NOT NULL GROUP BY party_id,account",
  )) {
    const summary = f.s.one(
      "SELECT debit,credit FROM party_totals WHERE party_id=? AND account=?",
      r.party_id,
      r.account,
    );
    assert.equal(summary.debit, r.debit);
    assert.equal(summary.credit, r.credit);
  }
  balanced(f.s);
});
test("cursor pagination never drops documents sharing the same timestamp", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 121; i++)
    f.s.expense(f.u, {
      amount: 100,
      category: "Other",
      note: "Pagination test",
      request_key: key(),
    });
  f.s.run("UPDATE documents SET created_at='2026-10-18T00:00:00.000Z'");
  const found = [];
  let after = "";
  do {
    const page = f.s.listDocuments({ kind: "expense", after });
    found.push(...page.rows.map((r) => r.id));
    after = page.next;
  } while (after);
  assert.equal(found.length, 121);
  assert.equal(new Set(found).size, 121);
});
test("opening customer, supplier and inventory balances affect equity, never profit", async (t) => {
  const f = fixture(t);
  await f.s.dispatch(
    "openingBalance",
    { party_id: f.customer, amount: 100000, date: today(), request_key: key() },
    f.token,
  );
  await f.s.dispatch(
    "openingBalance",
    { party_id: f.supplier, amount: 50000, date: today(), request_key: key() },
    f.token,
  );
  f.s.adjust(f.u, {
    product_id: f.product,
    quantity: 2,
    cost: 80000,
    note: "Opening stock",
    request_key: key(),
    opening: true,
  });
  assert.equal(f.s.totals().net, 0);
  assert.equal(f.s.partyBalance(f.customer).balance, 100000);
  assert.equal(f.s.partyBalance(f.supplier).balance, 50000);
  f.s.payment(f.u, {
    party_id: f.customer,
    amount: 100000,
    request_key: key(),
  });
  assert.equal(f.s.totals().net, 0);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  balanced(f.s);
});
test("backdating stock before its latest movement is rejected atomically", (t) => {
  const f = fixture(t);
  purchase(f);
  const prior = new Date(Date.parse(today()) - 86400000)
    .toISOString()
    .slice(0, 10);
  assert.throws(
    () => sale(f, 1, 100000, { date: prior }),
    /most recent stock movement/,
  );
  balanced(f.s);
});
test("request keys cannot be reused across users or operation kinds", async (t) => {
  const f = fixture(t);
  const doc = purchase(f);
  assert.throws(
    () => sale(f, 1, 0, { request_key: doc.request_key }),
    /another operation/,
  );
  await f.s.dispatch(
    "userCreate",
    {
      name: "Second operator",
      username: "operator",
      password: "operator-secure-pass",
      role: "Manager",
    },
    f.token,
  );
  const second = await f.s.dispatch("login", {
    username: "operator",
    password: "operator-secure-pass",
  });
  await assert.rejects(
    f.s.dispatch(
      "purchase",
      {
        party_id: f.supplier,
        paid: 0,
        request_key: doc.request_key,
        lines: [{ product_id: f.product, quantity: 1, price: 80000 }],
      },
      second.token,
    ),
    /another operation/,
  );
  balanced(f.s);
});
test("edited access rights take effect on existing sessions and cannot remove the last owner", async (t) => {
  const f = fixture(t);
  const created = await f.s.dispatch(
    "userCreate",
    {
      name: "Test manager",
      username: "manager",
      password: "manager-secure-pass",
      role: "Manager",
    },
    f.token,
  );
  const session = await f.s.dispatch("login", {
    username: "manager",
    password: "manager-secure-pass",
  });
  await f.s.dispatch("reports", {}, session.token);
  await f.s.dispatch(
    "userPermissions",
    { id: created.id, role: "Cashier", permissions: ["sales", "people"] },
    f.token,
  );
  await assert.rejects(
    f.s.dispatch("reports", {}, session.token),
    /Permission/,
  );
  await assert.rejects(
    f.s.dispatch(
      "userPermissions",
      { id: f.u.id, role: "Cashier", permissions: ["sales"] },
      f.token,
    ),
    /active owner/,
  );
});
test("editing a catalog product never changes the name or SKU printed on posted invoices", async (t) => {
  const f = fixture(t);
  purchase(f);
  const doc = sale(f);
  await f.s.dispatch(
    "productUpdate",
    {
      id: f.product,
      name: "Renamed product",
      brand: "New brand",
      model: "New model",
      sku: "NEW-SKU",
      category: "Storage",
      price: 120000,
    },
    f.token,
  );
  const invoice = f.s.getDocument(doc.id);
  assert.equal(invoice.lines[0].name, "Test SSD");
  assert.equal(invoice.lines[0].sku, "SSD-01");
  const ret = f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Product return",
    request_key: key(),
  });
  assert.equal(ret.lines[0].name, "Test SSD");
  balanced(f.s);
});

function summariesMatch(s) {
  for (const r of s.all(
    "SELECT date,account,SUM(debit) debit,SUM(credit) credit FROM journal GROUP BY date,account",
  )) {
    const summary = s.one(
      "SELECT debit,credit FROM daily_totals WHERE date=? AND account=?",
      r.date,
      r.account,
    );
    assert.deepEqual({ ...summary }, { debit: r.debit, credit: r.credit });
  }
  for (const r of s.all(
    "SELECT party_id,account,SUM(debit) debit,SUM(credit) credit FROM journal WHERE party_id IS NOT NULL GROUP BY party_id,account",
  )) {
    const summary = s.one(
      "SELECT debit,credit FROM party_totals WHERE party_id=? AND account=?",
      r.party_id,
      r.account,
    );
    assert.deepEqual({ ...summary }, { debit: r.debit, credit: r.credit });
  }
  assert.equal(s.one("SELECT SUM(debit-credit) n FROM daily_totals").n, 0);
  balanced(s);
}
test("creating a product with opening quantity posts inventory and equity at the entered cost atomically", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Opening laptop",
    brand: "Dell",
    model: "Precision",
    sku: "OPEN-PC",
    category: "Computers",
    price: 150000,
    unit_cost: 90000,
    opening_quantity: 3,
  });
  const row = f.s.listProducts({ q: "OPEN-PC" }, f.u).rows[0];
  assert.equal(row.stock, 3);
  assert.equal(row.cost, 270000);
  assert.equal(row.unit_cost, 90000);
  assert.equal(f.s.totals().gross, 0);
  assert.equal(f.s.totals().net, 0);
  const before = f.s.one("SELECT COUNT(*) n FROM products").n;
  assert.throws(
    () =>
      f.s.createProduct(
        { ...f.u, role: "Inventory clerk" },
        {
          name: "Blocked opening",
          brand: "Dell",
          model: "X",
          sku: "BLOCK-OPEN",
          category: "Computers",
          price: 200,
          unit_cost: 100,
          opening_quantity: 2,
        },
      ),
    /Opening inventory requires an owner/,
  );
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, before);
  summariesMatch(f.s);
});
test("one purchase accepts multiple products without losing cost or return tracking", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Second phone",
    brand: "Samsung",
    model: "S",
    sku: "OPT-QTY",
    category: "Mobiles",
    price: 200000,
  }).id;
  const doc = purchase(f, 2, 80000, {
    lines: [
      { product_id: f.product, quantity: 2, price: 80000 },
      {
        product_id: p,
        quantity: 3,
        price: 150000,
        discount: 1,
      },
    ],
  });
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.total, 609999);
  const sold = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 0,
    request_key: key(),
    lines: [{ product_id: p, quantity: 2, price: 200000 }],
  });
  assert.equal(sold.cost, 299999);
  f.s.returnTrade(f.u, {
    original_id: sold.id,
    lines: [{ line_id: sold.lines[0].id, quantity: 1 }],
    note: "Test return",
    request_key: key(),
  });
  summariesMatch(f.s);
});
test("editing a multi-product invoice preserves its identity and recalculates cost, cash, debt and summary reports", (t) => {
  const f = fixture(t);
  purchase(f, 10, 80000);
  const other = f.s.createProduct(f.u, {
    name: "Opening adapter",
    brand: "Anker",
    model: "USB",
    sku: "ADAPTER-EDIT",
    category: "Accessories",
    price: 30000,
    unit_cost: 15000,
    opening_quantity: 4,
  }).id;
  const old = sale(f, 2, 50000);
  const edit = {
    id: old.id,
    revision: old.revision,
    request_key: key(),
    party_id: f.customer,
    paid: 100000,
    date: old.date,
    lines: [
      { product_id: f.product, quantity: 1, price: 120000 },
      { product_id: other, quantity: 2, price: 30000 },
    ],
  };
  const result = f.s.mutateSale(f.u, edit, "edit");
  assert.equal(result.id, old.id);
  assert.equal(result.number, old.number);
  const updated = f.s.getDocument(old.id);
  assert.equal(updated.total, 180000);
  assert.equal(updated.cost, 110000);
  assert.equal(updated.revision, 1);
  assert.equal(f.s.totals().gross, 70000);
  assert.equal(f.s.partyBalance(f.customer).balance, 80000);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    9,
  );
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", other).stock,
    2,
  );
  assert.deepEqual(f.s.mutateSale(f.u, edit, "edit"), result);
  assert.throws(
    () => f.s.mutateSale(f.u, { ...edit, request_key: key() }, "edit"),
    /changed/,
  );
  const before = f.s.getDocument(old.id);
  assert.throws(
    () =>
      f.s.mutateSale(
        f.u,
        {
          ...edit,
          revision: 1,
          request_key: key(),
          lines: [{ product_id: f.product, quantity: 20, price: 120000 }],
        },
        "edit",
      ),
    /Insufficient stock/,
  );
  assert.deepEqual(f.s.getDocument(old.id), before);
  summariesMatch(f.s);
});
test("hard delete removes an invoice and restores stock and financial totals, with confirmation and retry protection", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Delete test phone",
    brand: "Apple",
    model: "Phone",
    sku: "DEL-PHONE",
    category: "Mobiles",
    price: 200000,
    unit_cost: 100000,
    opening_quantity: 2,
  }).id;
  const doc = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 100000,
    request_key: key(),
    lines: [{ product_id: p, quantity: 1, price: 200000 }],
  });
  const args = {
    id: doc.id,
    revision: doc.revision,
    confirmation: doc.number,
    request_key: key(),
  };
  assert.throws(
    () => f.s.mutateSale(f.u, { ...args, confirmation: "wrong" }, "delete"),
    /exact invoice number/,
  );
  const result = f.s.mutateSale(f.u, args, "delete");
  assert.equal(result.deleted, true);
  assert.throws(() => f.s.getDocument(doc.id), /not found/);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 2);
  assert.equal(f.s.totals().gross, 0);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  assert.equal(
    f.s.one(
      "SELECT COALESCE(SUM(debit-credit),0) n FROM journal WHERE account='cash'",
    ).n,
    0,
  );
  assert.deepEqual(f.s.mutateSale(f.u, args, "delete"), result);
  assert.equal(f.s.one("PRAGMA foreign_key_check"), undefined);
  summariesMatch(f.s);
});
test("sale edits and deletes enforce manager permissions, accounting locks and linked payment/return dependencies", (t) => {
  const f = fixture(t);
  purchase(f);
  const doc = sale(f, 2, 0);
  const args = {
    id: doc.id,
    revision: 0,
    confirmation: doc.number,
    request_key: key(),
  };
  assert.throws(
    () => f.s.mutateSale({ ...f.u, role: "Cashier" }, args, "delete"),
    /owner or manager/,
  );
  f.s.payment(f.u, { party_id: f.customer, amount: 1000, request_key: key() });
  assert.throws(
    () => f.s.mutateSale(f.u, args, "delete"),
    /later payment receipts/,
  );
  const withReturn = sale(f, 1, 0);
  f.s.returnTrade(f.u, {
    original_id: withReturn.id,
    request_key: key(),
    note: "Return",
    lines: [{ line_id: withReturn.lines[0].id, quantity: 1 }],
  });
  assert.throws(
    () =>
      f.s.mutateSale(
        f.u,
        { ...args, id: withReturn.id, confirmation: withReturn.number },
        "delete",
      ),
    /linked returns/,
  );
  const locked = sale(f, 1, 0);
  f.s.saveSetting("closedThrough", locked.date);
  assert.throws(
    () =>
      f.s.mutateSale(
        f.u,
        { ...args, id: locked.id, confirmation: locked.number },
        "delete",
      ),
    /closed/,
  );
  summariesMatch(f.s);
});

test("public sale mutation commands apply backend rights and revisions", async (t) => {
  const f = fixture(t);
  purchase(f);
  const doc = sale(f, 1, 0);
  await f.s.dispatch(
    "userCreate",
    {
      name: "Cashier",
      username: "mutation-cashier",
      password: "secure-test-password",
      role: "Cashier",
    },
    f.token,
  );
  const session = await f.s.dispatch("login", {
    username: "mutation-cashier",
    password: "secure-test-password",
  });
  const input = {
    id: doc.id,
    revision: 0,
    request_key: key(),
    party_id: f.customer,
    paid: 100000,
    lines: [{ product_id: f.product, quantity: 1, price: 100000 }],
  };
  await assert.rejects(
    f.s.dispatch("saleEdit", input, session.token),
    /owner or manager/,
  );
  const result = await f.s.dispatch("saleEdit", input, f.token);
  assert.equal(result.revision, 1);
  await f.s.dispatch(
    "saleDelete",
    { id: doc.id, revision: 1, confirmation: doc.number, request_key: key() },
    f.token,
  );
  summariesMatch(f.s);
});

test("editing an older invoice keeps its date and never consumes stock acquired later", (t) => {
  const f = fixture(t);
  const yesterday = new Date(Date.parse(today()) - 86400000)
    .toISOString()
    .slice(0, 10);
  purchase(f, 2, 80000, { date: yesterday });
  const old = sale(f, 1, 0, { date: yesterday });
  sale(f, 1, 0);
  purchase(f, 3, 40000);
  const edit = {
    id: old.id,
    revision: 0,
    request_key: key(),
    date: yesterday,
    party_id: f.customer,
    paid: 0,
    lines: [{ product_id: f.product, quantity: 1, price: 120000 }],
  };
  f.s.mutateSale(f.u, edit, "edit");
  assert.equal(f.s.getDocument(old.id).cost, 80000);
  assert.equal(f.s.getDocument(old.id).date, yesterday);
  assert.throws(
    () =>
      f.s.mutateSale(
        f.u,
        {
          ...edit,
          revision: 1,
          request_key: key(),
          lines: [{ product_id: f.product, quantity: 2, price: 120000 }],
        },
        "edit",
      ),
    /Insufficient stock/,
  );
  assert.equal(f.s.getDocument(old.id).total, 120000);
  summariesMatch(f.s);
});
test("invoice editing preserves cost after a catalog SKU change", async (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Tracked laptop",
    brand: "Dell",
    model: "QA",
    sku: "TRACK-OLD",
    category: "Computers",
    price: 200000,
    unit_cost: 120000,
    opening_quantity: 2,
  }).id;
  const old = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 0,
    request_key: key(),
    lines: [{ product_id: p, quantity: 1, price: 200000 }],
  });
  f.s.run("UPDATE products SET sku=? WHERE id=?", "TRACK-NEW", p);
  assert.equal(
    (await f.s.dispatch("catalog", { id: p }, f.token)).rows[0].sku,
    "TRACK-NEW",
  );
  await f.s.dispatch(
    "saleEdit",
    {
      id: old.id,
      revision: 0,
      request_key: key(),
      party_id: f.customer,
      paid: 50000,
      lines: [{ product_id: p, quantity: 1, price: 210000 }],
    },
    f.token,
  );
  const updated = f.s.getDocument(old.id);
  assert.equal(updated.cost, 120000);
  assert.equal(updated.total, 210000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 1);
  summariesMatch(f.s);
});

test("purchase invoices can be edited while unsold stock is still on hand", (t) => {
  const f = fixture(t);
  const doc = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    fx_rate: 180000,
    request_key: key(),
    lines: [
      {
        product_id: f.product,
        quantity: 4,
        cost_aed: 1000,
        fx_rate: 180000,
        price: 18000,
        discount: 0,
      },
    ],
  });
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock, 4);
  assert.equal(doc.total, 72000);
  const edited = f.s.mutatePurchase(
    f.u,
    {
      id: doc.id,
      revision: 0,
      request_key: key(),
      party_id: f.supplier,
      paid: 20000,
      fx_rate: 200000,
      date: doc.date,
      lines: [
        {
          product_id: f.product,
          quantity: 3,
          cost_aed: 1000,
          fx_rate: 200000,
          price: 20000,
          discount: 0,
        },
      ],
    },
    "edit",
  );
  const updated = f.s.getDocument(edited.id);
  assert.equal(updated.revision, 1);
  assert.equal(updated.total, 60000);
  assert.equal(updated.paid, 20000);
  assert.equal(updated.fx_rate, 200000);
  assert.equal(updated.lines[0].quantity, 3);
  assert.equal(updated.lines[0].cost_aed, 1000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock, 3);
  assert.equal(
    f.s.one(
      "SELECT unit_cost FROM batches WHERE product_id=? AND remaining>0",
      f.product,
    ).unit_cost,
    20000,
  );
  assert.equal(f.s.partyBalance(f.supplier).balance, 40000);
  // After selling any of the purchase, editing is blocked.
  f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 100000,
    request_key: key(),
    lines: [{ product_id: f.product, quantity: 1, price: 100000 }],
  });
  assert.throws(
    () =>
      f.s.mutatePurchase(
        f.u,
        {
          id: doc.id,
          revision: 1,
          request_key: key(),
          party_id: f.supplier,
          paid: 0,
          fx_rate: 200000,
          lines: [
            {
              product_id: f.product,
              quantity: 2,
              cost_aed: 1000,
              fx_rate: 200000,
              price: 20000,
              discount: 0,
            },
          ],
        },
        "edit",
      ),
    /already been sold/,
  );
  balanced(f.s);
});

test("FIFO keeps separate purchase costs and profit uses batches sold, not catalog cost", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "Dubai Keyboard",
    brand: "Logitech",
    model: "K380",
    sku: "FIFO-KB",
    category: "Accessories",
    price: 250000,
    attributes: { Type: "Keyboard" },
  }).id;
  // Older cheap lot: 10 AED × 18.00 AFN/AED = 180 AFN
  f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    fx_rate: 180000,
    request_key: key(),
    lines: [
      {
        product_id: p,
        quantity: 3,
        cost_aed: 1000,
        fx_rate: 180000,
        price: 18000,
        discount: 0,
      },
    ],
  });
  // Newer expensive lot: 10 AED × 20.00 = 200 AFN
  f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    fx_rate: 200000,
    request_key: key(),
    lines: [
      {
        product_id: p,
        quantity: 2,
        cost_aed: 1000,
        fx_rate: 200000,
        price: 20000,
        discount: 0,
      },
    ],
  });
  const batches = f.s.all(
    "SELECT remaining,unit_cost,cost_aed,fx_rate FROM batches WHERE product_id=? AND remaining>0 ORDER BY received_at,rowid",
    p,
  );
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((b) => [b.remaining, b.unit_cost, b.cost_aed, b.fx_rate]),
    [
      [3, 18000, 1000, 180000],
      [2, 20000, 1000, 200000],
    ],
  );
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 5);
  // Catalog shows latest purchase, but COGS must still use FIFO batches.
  assert.equal(f.s.one("SELECT unit_cost FROM products WHERE id=?", p).unit_cost, 20000);
  // Sell 4: 3×18000 + 1×20000 = 74000; revenue 4×250000; gross 1000000-74000
  const doc = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 1_000_000,
    request_key: key(),
    lines: [{ product_id: p, quantity: 4, price: 250000 }],
  });
  assert.equal(doc.cost, 74000);
  assert.equal(f.s.totals().gross, 1_000_000 - 74000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 1);
  assert.equal(
    f.s.one(
      "SELECT remaining,unit_cost FROM batches WHERE product_id=? AND remaining>0",
      p,
    ).unit_cost,
    20000,
  );
  // Return one sold unit → restores oldest consumed cost (18000)
  const ret = f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Return one keyboard",
    request_key: key(),
  });
  assert.equal(ret.cost, 18000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 2);
  // Next sale takes restored cheap unit first, then remaining expensive unit
  const next = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 500000,
    request_key: key(),
    lines: [{ product_id: p, quantity: 2, price: 250000 }],
  });
  assert.equal(next.cost, 18000 + 20000);
  assert.equal(f.s.one("SELECT stock FROM products WHERE id=?", p).stock, 0);
  assert.equal(
    f.s.one(
      "SELECT COUNT(*) n FROM products p WHERE p.stock<>(SELECT COALESCE(SUM(remaining),0) FROM batches b WHERE b.product_id=p.id)",
    ).n,
    0,
  );
  balanced(f.s);
});
test("capital report tracks invested capital and monthly net worth", async (t) => {
  const f = fixture(t);
  purchase(f, 5, 50000);
  sale(f, 2, 200000);
  await f.s.dispatch(
    "ownerMovement",
    {
      direction: "deposit",
      amount: 250000,
      note: "Extra cash from home",
      request_key: key(),
    },
    f.token,
  );
  const report = await f.s.dispatch("capitalReport", {}, f.token);
  assert.ok(report.current.net_worth > 0);
  assert.ok(report.current.capital >= 250000);
  assert.ok(report.months.length >= 1);
  assert.ok(report.months.some((m) => m.invested >= 250000));
  assert.ok(report.movements.some((m) => m.invested >= 250000));
  const before = report.current.cash;
  await f.s.dispatch(
    "ownerMovement",
    {
      direction: "withdrawal",
      amount: 50000,
      note: "Owner draw",
      request_key: key(),
    },
    f.token,
  );
  const after = await f.s.dispatch("capitalReport", {}, f.token);
  assert.equal(after.current.cash, before - 50000);
  balanced(f.s);
});
test("global search finds products, customers and suppliers", async (t) => {
  const f = fixture(t);
  const empty = await f.s.dispatch("globalSearch", { q: "" }, f.token);
  assert.equal(empty.results.length, 0);
  const hits = await f.s.dispatch("globalSearch", { q: "Test" }, f.token);
  const types = new Set(hits.results.map((r) => r.type));
  assert.ok(types.has("product"));
  assert.ok(types.has("customer"));
  assert.ok(types.has("supplier"));
  assert.ok(hits.results.some((r) => r.id === f.product && r.product));
  assert.ok(hits.results.some((r) => r.id === f.customer && r.party));
  const skuHit = await f.s.dispatch(
    "globalSearch",
    { q: "SSD-01" },
    f.token,
  );
  assert.equal(skuHit.results[0]?.type, "product");
  assert.equal(skuHit.results[0]?.id, f.product);
});
