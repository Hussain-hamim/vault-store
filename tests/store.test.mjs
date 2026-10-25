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
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    4,
  );
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
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    3,
  );
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
  assert.equal(
    f.s.one("SELECT unit_cost FROM products WHERE id=?", p).unit_cost,
    20000,
  );
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
      amount: 100000,
      note: "First investment",
      request_key: key(),
    },
    f.token,
  );
  await f.s.dispatch(
    "ownerMovement",
    {
      direction: "deposit",
      amount: 200000,
      note: "Second investment",
      request_key: key(),
    },
    f.token,
  );
  const report = await f.s.dispatch("capitalReport", {}, f.token);
  assert.ok(report.current.net_worth > 0);
  assert.ok(report.current.capital >= 300000);
  assert.ok(report.months.length >= 1);
  assert.ok(report.months.some((m) => m.invested >= 300000));
  const deposits = report.movements.filter((m) => m.direction === "deposit");
  assert.ok(deposits.some((m) => m.amount === 100000));
  assert.ok(deposits.some((m) => m.amount === 200000));
  assert.equal(
    deposits.filter((m) => [100000, 200000].includes(m.amount)).length,
    2,
  );
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
  const after = await f.s.dispatch("capitalReport", { limit: 1 }, f.token);
  assert.equal(after.current.cash, before - 50000);
  assert.equal(after.movements.length, 1);
  assert.ok(after.next);
  const page2 = await f.s.dispatch(
    "capitalReport",
    { after: after.next, limit: 1 },
    f.token,
  );
  assert.equal(page2.movements.length, 1);
  assert.notEqual(page2.movements[0].id, after.movements[0].id);
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
  const skuHit = await f.s.dispatch("globalSearch", { q: "SSD-01" }, f.token);
  assert.equal(skuHit.results[0]?.type, "product");
  assert.equal(skuHit.results[0]?.id, f.product);
});

test("reorder report includes zero-stock and threshold items, orders urgency first, and pages every item", async (t) => {
  const f = fixture(t);
  const make = (sku, level, stock, cost = 1250) =>
    f.s.createProduct(f.u, {
      name: `Product ${sku}`,
      brand: "Dell",
      model: sku,
      sku,
      category: "Computers",
      price: 10000,
      unit_cost: cost,
      reorder_level: level,
      opening_quantity: stock,
    }).id;
  // Bulk data crosses the old highest-value inventory report's 100-row cap.
  for (let i = 0; i < 105; i++)
    make(`EMPTY-${String(i).padStart(3, "0")}`, 0, 0);
  make("LOW-A", 5, 2);
  make("LOW-B", 5, 5);
  make("ENOUGH", 5, 6);
  const inactive = make("INACTIVE", 5, 0);
  f.s.run("UPDATE products SET active=0 WHERE id=?", inactive);
  const first = await f.s.dispatch("reorderReport", { limit: 10 }, f.token);
  assert.equal(first.summary.products, 108); // 105 empty + fixture SSD + two low products
  assert.equal(first.summary.out_of_stock, 106);
  assert.equal(first.summary.low_stock, 2);
  assert.equal(first.summary.suggested_quantity, 128); // 105 + SSD 10 + 8 + 5
  assert.equal(first.summary.estimated_cost, (105 + 8 + 5) * 1250);
  assert.equal(first.summary.unpriced, 1);
  const all = [...first.rows];
  let page = first;
  while (page.next) {
    page = await f.s.dispatch(
      "reorderReport",
      { limit: 10, cursor: page.next, revision: first.revision },
      f.token,
    );
    all.push(...page.rows);
  }
  assert.equal(all.length, 108);
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  assert.ok(all.slice(0, 106).every((p) => p.stock === 0));
  assert.deepEqual(
    all.slice(-2).map((p) => p.sku),
    ["LOW-A", "LOW-B"],
  );
  assert.equal(all.find((p) => p.sku === "EMPTY-000").suggested_quantity, 1);
  assert.equal(all.find((p) => p.sku === "LOW-B").suggested_quantity, 5);
  assert.ok(!all.some((p) => ["INACTIVE", "ENOUGH"].includes(p.sku)));
  const plan = f.s.all(
    "EXPLAIN QUERY PLAN SELECT id,sku FROM products WHERE active=1 AND stock<=reorder_level ORDER BY (stock=0) DESC,sku,id LIMIT 10",
  );
  assert.ok(plan.some((row) => row.detail.includes("idx_products_reorder")));
  balanced(f.s);
});

test("reorder snapshots reject changes, refresh after sales/returns, and enforce report/cost permissions", async (t) => {
  const f = fixture(t);
  const empty = f.s.reorderReport();
  assert.equal(empty.rows[0].stock, 0);
  assert.equal(empty.rows[0].suggested_quantity, 10);
  purchase(f, 6, 80000);
  assert.throws(
    () => f.s.reorderReport({ revision: empty.revision }),
    /REPORT_CHANGED/,
  );
  assert.equal(f.s.reorderReport().rows.length, 0);
  const doc = sale(f, 2, 0);
  const afterSale = f.s.reorderReport();
  assert.equal(afterSale.rows[0].stock, 4);
  assert.equal(afterSale.rows[0].reference_unit_cost, 80000);
  assert.equal(afterSale.rows[0].estimated_cost, 6 * 80000);
  f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 2 }],
    note: "Returned stock",
    request_key: key(),
  });
  assert.equal(f.s.reorderReport().rows.length, 0);
  assert.throws(() => f.s.reorderReport({ limit: 1001 }), /1000/);
  assert.throws(() => f.s.reorderReport({ cursor: '[2,"sku","id"]' }));
  for (const permissions of [["reports"], ["view_costs"]]) {
    const username = permissions[0];
    await f.s.dispatch(
      "userCreate",
      {
        name: username,
        username,
        password: "report-test-password",
        role: "Accountant",
        permissions,
      },
      f.token,
    );
    const session = await f.s.dispatch("login", {
      username,
      password: "report-test-password",
    });
    await assert.rejects(
      f.s.dispatch("reorderReport", {}, session.token),
      /Permission/,
    );
  }
  balanced(f.s);
});

test("report figures and expense categories reconcile to posted journal after FIFO sales, returns, and stock losses", (t) => {
  const f = fixture(t);
  purchase(f, 2, 60000);
  purchase(f, 3, 80000);
  const doc = sale(f, 3, 0);
  f.s.returnTrade(f.u, {
    original_id: doc.id,
    lines: [{ line_id: doc.lines[0].id, quantity: 1 }],
    note: "Return original cost",
    request_key: key(),
  });
  f.s.expense(f.u, {
    amount: 5000,
    category: "Utilities",
    note: "Electricity",
    request_key: key(),
  });
  f.s.adjust(f.u, {
    product_id: f.product,
    quantity: -1,
    note: "Damaged stock",
    request_key: key(),
  });
  const report = f.s.reports();
  const sum = (account) =>
    f.s.one(
      "SELECT COALESCE(SUM(debit-credit),0) n FROM journal WHERE account=?",
      account,
    ).n;
  assert.equal(report.totals.sales, -sum("sales"));
  assert.equal(report.totals.cogs, sum("cost_of_goods"));
  assert.equal(
    report.totals.net,
    -sum("sales") -
      sum("cost_of_goods") -
      sum("expenses") -
      sum("other_income"),
  );
  assert.equal(
    report.expenses.reduce((s, r) => s + r.amount, 0),
    report.totals.expenses,
  );
  assert.equal(
    report.expenses.find((r) => r.category === "adjustment").amount,
    60000,
  );
  assert.equal(
    report.days.reduce(
      (s, r) => s + r.sales - r.cogs - r.expenses + r.other,
      0,
    ),
    report.totals.net,
  );
  assert.equal(
    report.best.reduce((s, r) => s + r.cost, 0),
    report.totals.cogs,
  );
  assert.equal(
    report.trial.reduce((s, r) => s + r.balance, 0),
    0,
  );
  balanced(f.s);
});

const ownerClaim = (f, owner) =>
  f.s.one(
    "SELECT COALESCE(SUM(credit-debit),0) n FROM party_totals WHERE party_id=? AND account='consignment_payables'",
    owner,
  ).n;
async function intake(f, owner, quantity = 2, amount = 60000, extra = {}) {
  return f.s.dispatch(
    "consignmentReceive",
    {
      owner_id: owner,
      product_id: f.product,
      quantity,
      owner_unit_amount: amount,
      request_key: key(),
      ...extra,
    },
    f.token,
  );
}
function assetReconciled(f) {
  balanced(f.s);
  assert.equal(
    f.s.one(
      "SELECT COALESCE(SUM(debit-credit),0) n FROM journal WHERE account='inventory'",
    ).n,
    f.s.one("SELECT COALESCE(SUM(remaining*unit_cost),0) n FROM batches").n,
  );
  const wealth = f.s.wealthSnapshot(today());
  assert.equal(wealth.net_worth, wealth.capital + wealth.earnings || 0);
}
test("custom expense accounts track period and lifetime spending and persist historical categories", async (t) => {
  const f = fixture(t);
  const list = await f.s.dispatch("expenseAccounts", {}, f.token);
  for (const name of ["Rent", "Utilities", "Food", "Other"])
    assert.ok(list.rows.some((row) => row.name === name));
  const custom = await f.s.dispatch(
    "expenseAccountCreate",
    { name: "Internet" },
    f.token,
  );
  const input = {
    account_id: custom.id,
    amount: 12345,
    note: "Monthly internet",
    request_key: key(),
  };
  const first = await f.s.dispatch("expense", input, f.token);
  assert.equal(first.category, "Internet");
  assert.equal((await f.s.dispatch("expense", input, f.token)).id, first.id);
  const report = await f.s.dispatch("expenseAccounts", {}, f.token);
  assert.equal(
    report.rows.find((row) => row.id === custom.id).period_total,
    12345,
  );
  assert.equal(
    report.rows.find((row) => row.id === custom.id).lifetime_total,
    12345,
  );
  assert.equal(
    f.s.reports().expenses.find((row) => row.category === "Internet").amount,
    12345,
  );
  await assert.rejects(
    f.s.dispatch("expenseAccountCreate", { name: "internet" }, f.token),
    /already exists/,
  );
  await assert.rejects(
    f.s.dispatch(
      "expense",
      { ...input, account_id: "missing", request_key: key() },
      f.token,
    ),
    /expense account/,
  );
  assert.equal(f.s.totals().expenses, 12345);
  assetReconciled(f);
});
test("existing expense documents migrate to named accounts without changing the journal", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vault-expense-upgrade-"));
  let s = new Store(path.join(root, "store.sqlite"));
  t.after(() => {
    s.close();
    rmSync(root, { recursive: true, force: true });
  });
  const { token } = s.setup({
    name: "Upgrade owner",
    username: "owner",
    password: "upgrade-password",
    storeName: "Upgrade store",
  });
  const user = s.auth(token);
  const doc = s.document("expense", user, {
    category: "Legacy food",
    total: 7654,
    paid: 7654,
    note: "Legacy meal",
  });
  s.ledger(doc, [
    ["expenses", 7654, 0],
    ["cash", 0, 7654],
  ]);
  const before = s.totals().net;
  s.run("DELETE FROM settings WHERE key='expenseAccountsReady'");
  s.close();
  s = new Store(path.join(root, "store.sqlite"));
  const rows = s.expenseAccounts().rows;
  assert.equal(
    rows.find((row) => row.name === "Legacy food").lifetime_total,
    7654,
  );
  assert.ok(s.getDocument(doc.id).expense_account_id);
  assert.equal(s.totals().net, before);
});
test("zero-stock report contains only active empty products and its counts exclude low stock", async (t) => {
  const f = fixture(t);
  const empty = f.s.createProduct(f.u, {
    name: "Empty computer",
    brand: "Dell",
    model: "E",
    sku: "EMPTY",
    category: "Computers",
    price: 100000,
    reorder_level: 0,
  }).id;
  const inactive = f.s.createProduct(f.u, {
    name: "Inactive computer",
    brand: "Dell",
    model: "I",
    sku: "INACTIVE",
    category: "Computers",
    price: 100000,
  }).id;
  f.s.run("UPDATE products SET active=0 WHERE id=?", inactive);
  purchase(f, 2);
  const all = await f.s.dispatch("reorderReport", { zeroOnly: true }, f.token);
  assert.equal(all.summary.products, 1);
  assert.equal(all.summary.low_stock, 0);
  assert.equal(all.rows[0].id, empty);
  assert.equal(all.rows[0].suggested_quantity, 1);
  assert.ok(f.s.reorderReport().rows.some((row) => row.id === f.product));
});
test("customer resale recognises only the retained margin; payout and recovery do not count profit twice", async (t) => {
  const f = fixture(t),
    owner = f.s.createParty(f.u, {
      kind: "customer",
      name: "Product owner",
    }).id;
  const received = await intake(f, owner);
  assert.equal(received.total, 0);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    2,
  );
  assert.equal(f.s.totals().net, 0);
  assert.equal(ownerClaim(f, owner), 0);
  assert.equal(f.s.wealthSnapshot(today()).inventory, 0);
  const invoice = sale(f, 1, 100000);
  assert.equal(invoice.cost, 60000);
  assert.equal(f.s.totals().net, 40000);
  assert.equal(ownerClaim(f, owner), 60000);
  assert.equal(f.s.partyBalance(owner).balance, 0);
  assetReconciled(f);
  const pay = { owner_id: owner, amount: 60000, request_key: key() };
  const settled = await f.s.dispatch("consignmentPay", pay, f.token);
  assert.equal(
    (await f.s.dispatch("consignmentPay", pay, f.token)).id,
    settled.id,
  );
  assert.equal(ownerClaim(f, owner), 0);
  assert.equal(f.s.totals().net, 40000);
  const returned = f.s.returnTrade(f.u, {
    original_id: invoice.id,
    lines: [{ line_id: invoice.lines[0].id, quantity: 1 }],
    note: "Buyer returned computer",
    request_key: key(),
  });
  assert.equal(returned.cost, 60000);
  assert.equal(returned.paid, 100000);
  assert.equal(f.s.totals().net, 0);
  assert.equal(ownerClaim(f, owner), -60000);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    2,
  );
  assert.equal(f.s.wealthSnapshot(today()).consignment_recoverable, 60000);
  assetReconciled(f);
  await f.s.dispatch(
    "consignmentPay",
    {
      owner_id: owner,
      amount: 60000,
      direction: "recover",
      request_key: key(),
    },
    f.token,
  );
  assert.equal(ownerClaim(f, owner), 0);
  assert.equal(f.s.totals().net, 0);
  const stock = await f.s.dispatch("consignments", {}, f.token);
  await f.s.dispatch(
    "consignmentReturn",
    { batch_id: stock.rows[0].id, quantity: 2, request_key: key() },
    f.token,
  );
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    0,
  );
  assert.equal(f.s.totals().net, 0);
  assetReconciled(f);
});
test("mixed owned and customer-owned FIFO batches restore exact costs and distinct owners on partial returns", async (t) => {
  const f = fixture(t),
    owner = f.s.createParty(f.u, { kind: "customer", name: "First owner" }).id,
    second = f.s.createParty(f.u, {
      kind: "customer",
      name: "Second owner",
    }).id;
  purchase(f, 1, 80000);
  const a = await intake(f, owner, 1, 60000),
    b = await intake(f, second, 1, 70000);
  const ownedBatch = f.s.one(
    "SELECT id FROM batches WHERE owner_id IS NULL",
  ).id;
  f.s.run(
    "UPDATE batches SET received_at=? WHERE id=?",
    today() + "T01:00:00.000Z",
    ownedBatch,
  );
  f.s.run(
    "UPDATE batches SET received_at=? WHERE line_id=?",
    today() + "T02:00:00.000Z",
    a.lines[0].id,
  );
  f.s.run(
    "UPDATE batches SET received_at=? WHERE line_id=?",
    today() + "T03:00:00.000Z",
    b.lines[0].id,
  );
  const invoice = sale(f, 3, 0);
  assert.equal(invoice.cost, 210000);
  assert.equal(f.s.totals().gross, 90000);
  assert.equal(ownerClaim(f, owner), 60000);
  assert.equal(ownerClaim(f, second), 70000);
  const ret = () =>
    f.s.returnTrade(f.u, {
      original_id: invoice.id,
      lines: [{ line_id: invoice.lines[0].id, quantity: 1 }],
      note: "One returned unit",
      request_key: key(),
    });
  assert.equal(ret().cost, 80000);
  assert.equal(ownerClaim(f, owner), 60000);
  assert.equal(ret().cost, 60000);
  assert.equal(ownerClaim(f, owner), 0);
  assert.equal(ret().cost, 70000);
  assert.equal(ownerClaim(f, second), 0);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  assert.equal(f.s.totals().net, 0);
  assetReconciled(f);
});
test("unsettled resale invoice edits stay atomic; settled invoices are protected; returns remain allowed", async (t) => {
  const f = fixture(t);
  await intake(f, f.customer, 2);
  let invoice = sale(f, 1, 0);
  const editResult = await f.s.dispatch(
    "saleEdit",
    {
      id: invoice.id,
      revision: invoice.revision,
      party_id: f.customer,
      paid: 0,
      request_key: key(),
      lines: [{ product_id: f.product, quantity: 2, price: 100000 }],
    },
    f.token,
  );
  const edited = f.s.getDocument(editResult.id);
  assert.equal(edited.cost, 120000);
  assert.equal(ownerClaim(f, f.customer), 120000);
  assert.equal(f.s.totals().net, 80000);
  assetReconciled(f);
  await f.s.dispatch(
    "consignmentPay",
    { owner_id: f.customer, amount: 50000, request_key: key() },
    f.token,
  );
  await assert.rejects(
    f.s.dispatch(
      "saleDelete",
      {
        id: edited.id,
        revision: edited.revision,
        confirmation: edited.number,
        request_key: key(),
      },
      f.token,
    ),
    /settled/,
  );
  assert.equal(f.s.getDocument(edited.id).total, 200000);
  assert.equal(ownerClaim(f, f.customer), 70000);
  f.s.returnTrade(f.u, {
    original_id: edited.id,
    lines: [{ line_id: edited.lines[0].id, quantity: 2 }],
    note: "Returned both units",
    request_key: key(),
  });
  assert.equal(f.s.totals().net, 0);
  assert.equal(ownerClaim(f, f.customer), -50000);
  assetReconciled(f);
});
test("customer resale enforces stock, agreements, owner balances, closed periods and permissions", async (t) => {
  const f = fixture(t);
  const receive = {
    owner_id: f.customer,
    product_id: f.product,
    quantity: 2,
    owner_unit_amount: 60000,
    request_key: key(),
  };
  const first = await f.s.dispatch("consignmentReceive", receive, f.token);
  assert.equal(
    (await f.s.dispatch("consignmentReceive", receive, f.token)).id,
    first.id,
  );
  await assert.rejects(intake(f, f.supplier), /saved customer/);
  assert.throws(
    () =>
      f.s.adjust(f.u, {
        product_id: f.product,
        quantity: -1,
        note: "Do not lose owner stock",
        request_key: key(),
      }),
    /Customer resale/,
  );
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    2,
  );
  await assert.rejects(
    f.s.dispatch(
      "consignmentPay",
      { owner_id: f.customer, amount: 1, request_key: key() },
      f.token,
    ),
    /exceeds/,
  );
  const batch = (await f.s.dispatch("consignments", {}, f.token)).rows[0];
  await assert.rejects(
    f.s.dispatch(
      "consignmentReturn",
      { batch_id: batch.id, quantity: 3, request_key: key() },
      f.token,
    ),
    /exceeds/,
  );
  await f.s.dispatch(
    "userCreate",
    {
      name: "Sales cashier",
      username: "resale-cashier",
      password: "resale-password",
      role: "Cashier",
    },
    f.token,
  );
  const cashier = await f.s.dispatch("login", {
    username: "resale-cashier",
    password: "resale-password",
  });
  for (const command of [
    "consignments",
    "consignmentReceive",
    "consignmentPay",
    "expenseAccounts",
    "expenseAccountCreate",
  ])
    await assert.rejects(
      f.s.dispatch(command, {}, cashier.token),
      /Permission/,
    );
  await assert.rejects(
    f.s.dispatch(
      "partyDetail",
      { id: f.customer, view: "resale" },
      cashier.token,
    ),
    /Permission/,
  );
  await f.s.dispatch("closePeriod", { date: today() }, f.token);
  await assert.rejects(intake(f, f.customer, 1), /closed/);
  await assert.rejects(
    f.s.dispatch(
      "consignmentReturn",
      { batch_id: batch.id, quantity: 1, request_key: key() },
      f.token,
    ),
    /closed/,
  );
  assetReconciled(f);
});
test("owner liabilities and owner recoveries stay separate in balance sheets, capital and paginated owner ledgers", async (t) => {
  const f = fixture(t),
    a = f.s.createParty(f.u, { kind: "customer", name: "Owner A" }).id,
    b = f.s.createParty(f.u, { kind: "customer", name: "Owner B" }).id;
  await intake(f, a, 1, 60000);
  const saleA = sale(f, 1, 0);
  await f.s.dispatch(
    "consignmentPay",
    { owner_id: a, amount: 60000, request_key: key() },
    f.token,
  );
  f.s.returnTrade(f.u, {
    original_id: saleA.id,
    lines: [{ line_id: saleA.lines[0].id, quantity: 1 }],
    note: "Return A",
    request_key: key(),
  });
  // Remove the restored A unit from custody before receiving and selling B.
  const batchA = (await f.s.dispatch("consignments", {}, f.token)).rows[0];
  await f.s.dispatch(
    "consignmentReturn",
    { batch_id: batchA.id, quantity: 1, request_key: key() },
    f.token,
  );
  await intake(f, b, 1, 60000);
  sale(f, 1, 0);
  const report = f.s.reports();
  assert.equal(report.consignment.due, 60000);
  assert.equal(report.consignment.recoverable, 60000);
  const snapshot = f.s.wealthSnapshot(today());
  assert.equal(snapshot.consignment_payables, 60000);
  assert.equal(snapshot.consignment_recoverable, 60000);
  assert.equal(
    snapshot.assets - snapshot.liabilities,
    snapshot.capital + snapshot.earnings,
  );
  const first = await f.s.dispatch(
    "partyDetail",
    { id: a, view: "resale", limit: 1 },
    f.token,
  );
  const second = await f.s.dispatch(
    "partyDetail",
    { id: a, view: "resale", limit: 1, after: first.next },
    f.token,
  );
  assert.equal(first.party.balance, 0);
  assert.equal(first.party.consignment_balance, -60000);
  const signed = first.entries.reduce(
    (sum, row) => sum + row.credit - row.debit,
    0,
  );
  assert.equal(second.page_start_balance, first.page_start_balance - signed);
  assetReconciled(f);
});

test("historical owner reports use their as-of date and customer resale survives backup/restore", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vault-resale-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, path.join(root, "store.sqlite"));
  const yesterday = new Date(Date.parse(today() + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  await intake(f, f.customer, 1, 60000, { date: yesterday });
  const invoice = sale(f, 1, 100000, { date: yesterday });
  await f.s.dispatch(
    "consignmentPay",
    { owner_id: f.customer, amount: 60000, request_key: key() },
    f.token,
  );
  assert.equal(f.s.wealthSnapshot(yesterday).consignment_payables, 60000);
  assert.equal(f.s.wealthSnapshot(today()).consignment_payables, 0);
  assert.equal(
    f.s.reports({ from: yesterday, to: yesterday }).consignment.due,
    60000,
  );
  assert.equal(f.s.one("PRAGMA user_version").user_version, 2);
  const backupFolder = path.join(root, "drive");
  mkdirSync(backupFolder);
  const saved = await f.s.createBackup(f.u, { destination: backupFolder });
  assert.equal(saved.results[0].status, "verified");
  const file = saved.results[0].path;
  assert.ok(validateRestore(file));
  const target = path.join(root, "restored.sqlite");
  await restoreDatabase(file, target);
  const restored = new Store(target);
  try {
    assert.equal(restored.getDocument(invoice.id).cost, 60000);
    assert.equal(
      restored.one(
        "SELECT owner_unit_amount FROM batches WHERE owner_id=?",
        f.customer,
      ).owner_unit_amount,
      60000,
    );
    assert.equal(
      restored.totals({ from: yesterday, to: today() }).gross,
      40000,
    );
    assert.equal(
      restored.one(
        "SELECT SUM(amount) amount FROM consignment_payout_allocations",
      ).amount,
      60000,
    );
    balanced(restored);
  } finally {
    restored.close();
  }
});

test("custom expense names do not merge with the automatic stock-loss category", async (t) => {
  const f = fixture(t);
  purchase(f, 2, 80000);
  const account = await f.s.dispatch(
    "expenseAccountCreate",
    { name: "adjustment" },
    f.token,
  );
  await f.s.dispatch(
    "expense",
    {
      account_id: account.id,
      amount: 1000,
      note: "Custom account spend",
      request_key: key(),
    },
    f.token,
  );
  f.s.adjust(f.u, {
    product_id: f.product,
    quantity: -1,
    note: "Damaged unit",
    request_key: key(),
  });
  const expenses = f.s.reports().expenses;
  assert.equal(
    expenses.find((row) => row.source_kind === "expense").amount,
    1000,
  );
  assert.equal(
    expenses.find((row) => row.source_kind === "adjustment").amount,
    80000,
  );
  assert.equal(
    expenses.reduce((sum, row) => sum + row.amount, 0),
    f.s.totals().expenses,
  );
  assetReconciled(f);
});

test("notifications follow stock, unpaid sales, returns, receipts and restocking exactly", async (t) => {
  const f = fixture(t);
  const notify = (args) => f.s.dispatch("notifications", args, f.token);
  assert.equal((await notify({ summaryOnly: true })).summary.stock, 1);
  purchase(f, 6);
  assert.equal((await notify({ summaryOnly: true })).summary.stock, 0);
  const invoice = sale(f, 2, 60000);
  let n = await notify({ kind: "customers" });
  assert.equal(n.summary.stock, 1);
  assert.equal(n.summary.customers, 1);
  assert.equal(n.summary.amount, 140000);
  assert.equal(n.rows[0].id, f.customer);
  assert.equal(n.rows[0].balance, f.s.partyBalance(f.customer).balance);
  f.s.returnTrade(f.u, {
    original_id: invoice.id,
    note: "Customer returned product",
    lines: [{ line_id: invoice.lines[0].id, quantity: 1 }],
    request_key: key(),
  });
  n = await notify({ kind: "customers" });
  assert.equal(n.summary.amount, 40000);
  f.s.payment(f.u, { party_id: f.customer, amount: 40000, request_key: key() });
  assert.equal((await notify({ kind: "customers" })).rows.length, 0);
  purchase(f, 1);
  assert.equal((await notify({ kind: "stock" })).summary.total, 0);
  balanced(f.s);
});
test("notification pagination includes every current debtor and rejects mixed snapshots", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 13; i++)
    f.s.createParty(f.u, {
      kind: "customer",
      name: "Debtor " + i,
      opening_balance: 1000 + i,
    });
  f.s.createParty(f.u, {
    kind: "supplier",
    name: "Supplier opening",
    opening_balance: 99999,
  });
  const first = await f.s.dispatch(
    "notifications",
    { kind: "customers", limit: 5 },
    f.token,
  );
  assert.equal(first.summary.customers, 13);
  assert.equal(first.summary.amount, 13078);
  const rows = [...first.rows];
  let page = first;
  while (page.next) {
    page = await f.s.dispatch(
      "notifications",
      {
        kind: "customers",
        limit: 5,
        cursor: page.next,
        revision: first.revision,
      },
      f.token,
    );
    rows.push(...page.rows);
  }
  assert.equal(new Set(rows.map((r) => r.id)).size, 13);
  assert.equal(rows[0].balance, 1012);
  f.s.payment(f.u, { party_id: rows[0].id, amount: 12, request_key: key() });
  await assert.rejects(
    f.s.dispatch(
      "notifications",
      { kind: "customers", cursor: first.next, revision: first.revision },
      f.token,
    ),
    /NOTIFICATIONS_CHANGED/,
  );
});
test("notification data obeys staff permissions and never exposes costs or other account balances", async (t) => {
  const f = fixture(t);
  await f.s.dispatch(
    "userCreate",
    {
      name: "Stock staff",
      username: "stock-only",
      password: "test-password-2026",
      role: "Inventory clerk",
      permissions: ["inventory"],
    },
    f.token,
  );
  const login = await f.s.dispatch("login", {
    username: "stock-only",
    password: "test-password-2026",
  });
  f.s.createParty(f.u, {
    kind: "customer",
    name: "Debtor",
    opening_balance: 5000,
  });
  const n = await f.s.dispatch("notifications", { kind: "stock" }, login.token);
  assert.equal(n.summary.customers, 0);
  assert.equal(n.summary.amount, 0);
  assert.equal(n.rows[0].unit_cost, undefined);
  assert.equal(n.rows[0].cost, undefined);
  await assert.rejects(
    f.s.dispatch("notifications", { kind: "customers" }, login.token),
    /Permission/,
  );
  await assert.rejects(
    f.s.dispatch("notifications", {}, "invalid-token"),
    /Sign in|Session|session/i,
  );
});
test("unlisted customer resale creates owner and product atomically, then records 3000 revenue, 2000 owner share and 1000 profit days later", async (t) => {
  const f = fixture(t);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const data = {
    new_owner: { name: "New laptop owner", phone: "0700001111" },
    new_product: {
      name: "Customer Dell laptop",
      brand: "Dell",
      model: "Latitude 7400",
      category: "Computers",
      attributes: { CPU: "Core i7", RAM: "16 GB", Storage: "512 GB" },
      price: 0,
    },
    quantity: 1,
    owner_unit_amount: 200000,
    date: yesterday,
    request_key: key(),
  };
  const received = await f.s.dispatch("consignmentReceive", data, f.token);
  const replay = await f.s.dispatch("consignmentReceive", data, f.token);
  assert.equal(received.id, replay.id);
  const ownerId = received.party_id,
    productId = received.lines[0].product_id;
  assert.equal(
    f.s.one("SELECT COUNT(*) n FROM parties WHERE name=?", "New laptop owner")
      .n,
    1,
  );
  const p = f.s.one("SELECT * FROM products WHERE id=?", productId);
  assert.equal(p.stock, 1);
  assert.equal(p.unit_cost, 0);
  assert.equal(p.consignment_only, 1);
  assert.ok(p.sku.startsWith("RES-"));
  assert.equal(f.s.wealthSnapshot(today()).inventory, 0);
  assert.equal(f.s.totals().net, 0);
  const invoice = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    date: today(),
    paid: 300000,
    lines: [{ product_id: productId, quantity: 1, price: 300000 }],
    request_key: key(),
  });
  assert.equal(invoice.total, 300000);
  assert.equal(invoice.cost, 200000);
  assert.equal(f.s.totals().gross, 100000);
  assert.equal(f.s.totals().net, 100000);
  assert.equal(
    f.s.one(
      "SELECT credit-debit n FROM party_totals WHERE party_id=? AND account='consignment_payables'",
      ownerId,
    ).n,
    200000,
  );
  const alerts = await f.s.dispatch(
    "notifications",
    { kind: "stock" },
    f.token,
  );
  assert.ok(!alerts.rows.some((r) => r.id === productId));
  assert.ok(!f.s.reorderReport().rows.some((r) => r.id === productId));
  f.s.returnTrade(f.u, {
    original_id: invoice.id,
    note: "Customer returned product",
    lines: [{ line_id: invoice.lines[0].id, quantity: 1 }],
    request_key: key(),
  });
  assert.equal(f.s.totals().gross, 0);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", productId).stock,
    1,
  );
  assert.equal(
    f.s.one(
      "SELECT credit-debit n FROM party_totals WHERE party_id=? AND account='consignment_payables'",
      ownerId,
    ).n,
    0,
  );
  balanced(f.s);
});
test("inline resale creation rolls back on invalid products, closed periods or missing customer rights", async (t) => {
  const f = fixture(t);
  const input = {
    new_owner: { name: "Must roll back" },
    new_product: {
      name: "Laptop",
      brand: "Dell",
      model: "Used",
      category: "Computers",
      sku: "SSD-01",
    },
    quantity: 1,
    owner_unit_amount: 200000,
    request_key: key(),
  };
  const counts = () =>
    f.s.one(
      "SELECT (SELECT COUNT(*) FROM parties) people,(SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM documents) documents",
    );
  const before = counts();
  await assert.rejects(
    f.s.dispatch("consignmentReceive", input, f.token),
    /UNIQUE/,
  );
  assert.deepEqual(counts(), before);
  await f.s.dispatch(
    "userCreate",
    {
      name: "Custody staff",
      username: "custody",
      password: "test-password-2026",
      role: "Manager",
      permissions: ["finance", "inventory", "view_costs"],
    },
    f.token,
  );
  const login = await f.s.dispatch("login", {
    username: "custody",
    password: "test-password-2026",
  });
  await assert.rejects(
    f.s.dispatch(
      "consignmentReceive",
      { ...input, new_product: { ...input.new_product, sku: "NEW" } },
      login.token,
    ),
    /people/,
  );
  assert.deepEqual(counts(), before);
  await f.s.dispatch("closePeriod", { date: today() }, f.token);
  await assert.rejects(
    f.s.dispatch(
      "consignmentReceive",
      {
        ...input,
        new_product: { ...input.new_product, sku: "NEW" },
        request_key: key(),
      },
      f.token,
    ),
    /closed|Closed/,
  );
  assert.deepEqual(counts(), before);
});

test("purchase currencies persist foreign quotes, edit safely and keep FIFO in AFN", async (t) => {
  const f = fixture(t);
  const usd = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    currency: "USD",
    fx_rate: 700000,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 3, cost_foreign: 1000, price: 70000 },
    ],
  });
  assert.equal(usd.currency, "USD");
  assert.equal(usd.lines[0].currency, "USD");
  assert.equal(usd.lines[0].cost_foreign, 1000);
  assert.equal(usd.lines[0].cost_aed, 0);
  assert.equal(usd.total, 210000);
  const batch = f.s.one(
    "SELECT * FROM batches WHERE line_id=?",
    usd.lines[0].id,
  );
  assert.equal(batch.currency, "USD");
  assert.equal(batch.cost_foreign, 1000);
  assert.equal(batch.unit_cost, 70000);
  const edit = await f.s.dispatch(
    "purchaseEdit",
    {
      id: usd.id,
      revision: usd.revision,
      currency: "EUR",
      fx_rate: 800000,
      party_id: f.supplier,
      paid: 0,
      request_key: key(),
      lines: [
        {
          product_id: f.product,
          quantity: 3,
          cost_foreign: 1000,
          price: 80000,
        },
      ],
    },
    f.token,
  );
  assert.equal(f.s.getDocument(edit.id).currency, "EUR");
  const second = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    paid: 0,
    currency: "USD",
    fx_rate: 700000,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 2, cost_foreign: 2000, price: 140000 },
    ],
  });
  const sold = sale(f, 4, 0);
  assert.equal(sold.cost, 380000); // 3 EUR units at AF 800 + 1 USD unit at AF 1400
  const ret = f.s.returnTrade(f.u, {
    original_id: sold.id,
    lines: [{ line_id: sold.lines[0].id, quantity: 1 }],
    note: "Return one unit",
    request_key: key(),
  });
  assert.equal(ret.cost, 80000);
  const returnedPurchase = f.s.returnTrade(f.u, {
    original_id: second.id,
    lines: [{ line_id: second.lines[0].id, quantity: 1 }],
    note: "Supplier return",
    request_key: key(),
  });
  assert.equal(returnedPurchase.currency, "USD");
  assert.equal(returnedPurchase.lines[0].cost_foreign, 2000);
  balanced(f.s);
});

test("custom currencies are shared, persisted, permission checked and validated", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "store-currency-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "store.sqlite");
  const f = fixture(t, file);
  const saved = await f.s.dispatch(
    "currencyCreate",
    { code: "cad", name: "Canadian dollar", country: "ca" },
    f.token,
  );
  assert.equal(saved.code, "CAD");
  assert.deepEqual(await f.s.dispatch("currencyCreate", saved, f.token), saved);
  await assert.rejects(
    f.s.dispatch(
      "currencyCreate",
      { code: "CAD", name: "Other dollar", country: "us" },
      f.token,
    ),
    /already exists/,
  );
  const doc = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    currency: "CAD",
    fx_rate: 500000,
    paid: 0,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 1, cost_foreign: 1234, price: 61700 },
    ],
  });
  assert.equal(doc.currency_country, "ca");
  const reopened = new Store(file);
  t.after(() => reopened.close());
  assert.ok(reopened.currencies().some((c) => c.code === "CAD"));
  assert.equal(reopened.getDocument(doc.id).lines[0].cost_foreign, 1234);
  for (const extra of [
    { currency: "ZZZ", fx_rate: 10000 },
    { currency: "AFN", fx_rate: 20000 },
    { currency: "USD", fx_rate: 0 },
  ])
    assert.throws(() =>
      f.s.postTrade(f.u, {
        kind: "purchase",
        party_id: f.supplier,
        paid: 0,
        request_key: key(),
        ...extra,
        lines: [
          {
            product_id: f.product,
            quantity: 1,
            cost_foreign: 1000,
            price: 2000,
          },
        ],
      }),
    );
  const owner = f.u;
  const restricted = {
    ...owner,
    role: "Cashier",
    permissions: ["sales", "people"],
  };
  const originalAuth = f.s.auth;
  f.s.auth = () => restricted;
  await assert.rejects(
    f.s.dispatch(
      "currencyCreate",
      { code: "AUD", name: "Australian dollar", country: "au" },
      f.token,
    ),
    /Permission/,
  );
  f.s.auth = originalAuth;
  balanced(f.s);
});

test("product opening costs support selected currency without changing historical batches", (t) => {
  const f = fixture(t);
  const p = f.s.createProduct(f.u, {
    name: "USD laptop",
    brand: "Dell",
    model: "Test",
    category: "Computers",
    sku: "USD-1",
    price: 100000,
    currency: "USD",
    cost_foreign: 1000,
    fx_rate: 700000,
    opening_quantity: 2,
  });
  const product = f.s.one("SELECT * FROM products WHERE id=?", p.id);
  const batch = f.s.one("SELECT * FROM batches WHERE product_id=?", p.id);
  assert.equal(product.unit_cost, 70000);
  assert.equal(product.cost_aed, 0);
  assert.equal(product.currency, "USD");
  assert.equal(batch.currency, "USD");
  assert.equal(batch.cost_foreign, 1000);
  assert.equal(batch.unit_cost, 70000);
  balanced(f.s);
});

test("accountants can read and post valid sale and purchase returns through dispatch", async (t) => {
  const f = fixture(t);
  const purchased = purchase(f, 3);
  const sold = sale(f, 1, 0);
  await f.s.dispatch(
    "userCreate",
    {
      name: "Return accountant",
      username: "returns",
      password: "return-test-password",
      role: "Accountant",
    },
    f.token,
  );
  const login = await f.s.dispatch("login", {
    username: "returns",
    password: "return-test-password",
  });
  const original = await f.s.dispatch("document", { id: sold.id }, login.token);
  const args = {
    original_id: original.id,
    lines: [{ line_id: original.lines[0].id, quantity: 1 }],
    note: "Customer return",
    request_key: key(),
  };
  const returned = await f.s.dispatch("return", args, login.token);
  assert.equal(returned.kind, "sale_return");
  assert.equal(
    (await f.s.dispatch("return", args, login.token)).id,
    returned.id,
  );
  await assert.rejects(
    f.s.dispatch("return", { ...args, request_key: key() }, login.token),
    /remaining quantity/,
  );
  const supplierReturn = await f.s.dispatch(
    "return",
    {
      original_id: purchased.id,
      lines: [{ line_id: purchased.lines[0].id, quantity: 1 }],
      note: "Supplier return",
      request_key: key(),
    },
    login.token,
  );
  assert.equal(supplierReturn.kind, "purchase_return");
  balanced(f.s);
});

test("purchase foreign payments post converted AFN and preserve the original quote after later payments", async (t) => {
  const f = fixture(t);
  const args = {
    kind: "purchase",
    party_id: f.supplier,
    currency: "USD",
    fx_rate: 700000,
    paid_foreign: 1250,
    paid: 87500,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 3, cost_foreign: 1000, price: 70000 },
    ],
  };
  const doc = f.s.postTrade(f.u, args);
  assert.equal(doc.paid_foreign, 1250);
  assert.equal(doc.paid, 87500);
  assert.equal(
    f.s.one(
      "SELECT SUM(credit-debit) n FROM journal WHERE document_id=? AND account='cash'",
      doc.id,
    ).n,
    87500,
  );
  assert.equal(f.s.partyBalance(f.supplier).balance, 122500);
  assert.equal(f.s.postTrade(f.u, args).id, doc.id);
  f.s.payment(f.u, { party_id: f.supplier, amount: 10000, request_key: key() });
  const after = f.s.getDocument(doc.id);
  assert.equal(after.paid, 97500);
  assert.equal(after.paid_foreign, 1250);
  assert.equal(after.fx_rate, 700000);
  balanced(f.s);
});

test("foreign payment validation rolls back mismatches and overpayments; edits retain source amount", async (t) => {
  const f = fixture(t);
  const args = {
    kind: "purchase",
    party_id: f.supplier,
    currency: "USD",
    fx_rate: 700000,
    paid_foreign: 123,
    paid: 8610,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 1, cost_foreign: 1000, price: 70000 },
    ],
  };
  const count = f.s.one("SELECT COUNT(*) n FROM documents").n;
  for (const change of [
    { paid: 8609 },
    { paid_foreign: 2000, paid: 140000 },
    { fx_rate: 0 },
    { paid_foreign: -1 },
  ]) {
    assert.throws(() =>
      f.s.postTrade(f.u, { ...args, ...change, request_key: key() }),
    );
    assert.equal(f.s.one("SELECT COUNT(*) n FROM documents").n, count);
    assert.equal(
      f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
      0,
    );
  }
  const doc = f.s.postTrade(f.u, args);
  await f.s.dispatch(
    "purchaseEdit",
    {
      ...args,
      id: doc.id,
      revision: doc.revision,
      paid_foreign: 200,
      paid: 16000,
      fx_rate: 800000,
      lines: [
        {
          product_id: f.product,
          quantity: 1,
          cost_foreign: 1000,
          price: 80000,
        },
      ],
    },
    f.token,
  );
  const edited = f.s.getDocument(doc.id);
  assert.equal(edited.paid_foreign, 200);
  assert.equal(edited.paid, 16000);
  assert.equal(edited.currency, "USD");
  const legacy = purchase(f, 1, 80000, { paid: 1234 });
  assert.equal(legacy.paid_foreign, null);
  assert.equal(legacy.paid, 1234);
  const afn = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    currency: "AFN",
    fx_rate: 10000,
    paid_foreign: 1234,
    paid: 1234,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 1, cost_foreign: 2000, price: 2000 },
    ],
  });
  assert.equal(afn.paid, 1234);
  assert.equal(afn.paid_foreign, 1234);
  balanced(f.s);
});

test("foreign supplier settlements allocate AFN and retain currency evidence in the ledger", async (t) => {
  const f = fixture(t);
  const original = purchase(f, 2, 80000);
  const args = {
    party_id: f.supplier,
    currency: "USD",
    fx_rate: 700000,
    amount_foreign: 1000,
    amount: 70000,
    request_key: key(),
  };
  const paid = await f.s.dispatch("payment", args, f.token);
  assert.equal(paid.paid_foreign, 1000);
  assert.equal(paid.currency, "USD");
  assert.equal(paid.fx_rate, 700000);
  assert.equal(paid.total, 70000);
  assert.equal(f.s.partyBalance(f.supplier).balance, 90000);
  assert.equal(f.s.getDocument(original.id).paid, 70000);
  assert.equal(
    f.s.one(
      "SELECT amount FROM payment_allocations WHERE payment_id=?",
      paid.id,
    ).amount,
    70000,
  );
  const ledger = await f.s.dispatch("partyDetail", { id: f.supplier }, f.token);
  const entry = ledger.entries.find((e) => e.document_id === paid.id);
  assert.equal(entry.debit, 70000);
  assert.equal(entry.paid_foreign, 1000);
  assert.equal(entry.currency, "USD");
  assert.equal(entry.fx_rate, 700000);
  assert.equal((await f.s.dispatch("payment", args, f.token)).id, paid.id);
  assert.equal(f.s.partyBalance(f.supplier).balance, 90000);
  balanced(f.s);
});

test("foreign supplier payments reject mismatches, invalid rates, overpayment and closed dates atomically", (t) => {
  const f = fixture(t);
  purchase(f, 1, 80000);
  const base = {
    party_id: f.supplier,
    currency: "USD",
    fx_rate: 700000,
    amount_foreign: 1000,
    amount: 70000,
  };
  const before = f.s.one("SELECT COUNT(*) n FROM documents").n;
  for (const extra of [
    { amount: 69999 },
    { fx_rate: 0 },
    { currency: "ZZZ" },
    { amount_foreign: 2000, amount: 140000 },
    { currency: "AFN", fx_rate: 700000 },
  ]) {
    assert.throws(() =>
      f.s.payment(f.u, { ...base, ...extra, request_key: key() }),
    );
    assert.equal(f.s.partyBalance(f.supplier).balance, 80000);
    assert.equal(f.s.one("SELECT COUNT(*) n FROM documents").n, before);
  }
  f.s.saveSetting("closedThrough", today());
  assert.throws(
    () => f.s.payment(f.u, { ...base, request_key: key() }),
    /closed/,
  );
  assert.equal(f.s.partyBalance(f.supplier).balance, 80000);
  balanced(f.s);
});

test("customer receipts accept AFN and foreign currency while allocating AFN balances", async (t) => {
  const f = fixture(t);
  const customer = f.s.createParty(f.u, {
    kind: "customer",
    name: "Currency customer",
    opening_balance: 100000,
  }).id;
  const afn = await f.s.dispatch(
    "payment",
    {
      party_id: customer,
      currency: "AFN",
      fx_rate: 10000,
      amount_foreign: 10000,
      amount: 10000,
      request_key: key(),
    },
    f.token,
  );
  assert.equal(afn.kind, "receipt");
  assert.equal(afn.currency, "AFN");
  assert.equal(afn.paid_foreign, 10000);
  const args = {
    party_id: customer,
    currency: "USD",
    fx_rate: 700000,
    amount_foreign: 500,
    amount: 35000,
    request_key: key(),
  };
  const receipt = await f.s.dispatch("payment", args, f.token);
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.currency, "USD");
  assert.equal(receipt.paid_foreign, 500);
  assert.equal(receipt.paid, 35000);
  assert.equal(f.s.partyBalance(customer).balance, 55000);
  assert.equal(
    f.s.one(
      "SELECT SUM(debit-credit) n FROM journal WHERE document_id=? AND account='cash'",
      receipt.id,
    ).n,
    35000,
  );
  const ledger = await f.s.dispatch("partyDetail", { id: customer }, f.token);
  const entry = ledger.entries.find((e) => e.document_id === receipt.id);
  assert.equal(entry.credit, 35000);
  assert.equal(entry.paid_foreign, 500);
  assert.equal(entry.fx_rate, 700000);
  assert.equal((await f.s.dispatch("payment", args, f.token)).id, receipt.id);
  for (const change of [
    { amount: 34999 },
    { fx_rate: 0 },
    { currency: "AFN", fx_rate: 700000 },
    { amount_foreign: 1000, amount: 70000 },
  ])
    await assert.rejects(
      f.s.dispatch(
        "payment",
        { ...args, ...change, request_key: key() },
        f.token,
      ),
    );
  assert.equal(f.s.partyBalance(customer).balance, 55000);
  balanced(f.s);
});

test("sale payment currency converts cash and debt without changing AF prices or FIFO profit", async (t) => {
  const f = fixture(t);
  purchase(f, 2, 80000);
  const args = {
    kind: "sale",
    party_id: f.customer,
    currency: "USD",
    fx_rate: 700000,
    paid_foreign: 1000,
    paid: 70000,
    request_key: key(),
    lines: [{ product_id: f.product, quantity: 1, price: 100000 }],
  };
  const doc = f.s.postTrade(f.u, args);
  assert.equal(doc.currency, "USD");
  assert.equal(doc.paid_foreign, 1000);
  assert.equal(doc.fx_rate, 700000);
  assert.equal(doc.total, 100000);
  assert.equal(doc.paid, 70000);
  assert.equal(doc.cost, 80000);
  assert.equal(f.s.partyBalance(f.customer).balance, 30000);
  assert.equal(
    f.s.one(
      "SELECT SUM(debit-credit) n FROM journal WHERE document_id=? AND account='cash'",
      doc.id,
    ).n,
    70000,
  );
  assert.equal(f.s.postTrade(f.u, args).id, doc.id);
  await f.s.dispatch(
    "saleEdit",
    {
      ...args,
      id: doc.id,
      revision: doc.revision,
      paid_foreign: 200,
      paid: 16000,
      fx_rate: 800000,
    },
    f.token,
  );
  const edited = f.s.getDocument(doc.id);
  assert.equal(edited.paid_foreign, 200);
  assert.equal(edited.paid, 16000);
  assert.equal(edited.total, 100000);
  assert.equal(edited.cost, 80000);
  balanced(f.s);
});

test("sale foreign payments reject mismatches and overpayments and accept AFN at rate one", (t) => {
  const f = fixture(t);
  purchase(f, 3, 80000);
  const args = {
    kind: "sale",
    party_id: f.customer,
    currency: "USD",
    fx_rate: 700000,
    paid_foreign: 1000,
    paid: 70000,
    lines: [{ product_id: f.product, quantity: 1, price: 100000 }],
  };
  for (const change of [
    { paid: 69999 },
    { paid_foreign: 2000, paid: 140000 },
    { currency: "AFN", fx_rate: 700000 },
    { fx_rate: 0 },
    { currency: "ZZZ" },
  ])
    assert.throws(() =>
      f.s.postTrade(f.u, { ...args, ...change, request_key: key() }),
    );
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    3,
  );
  const afn = f.s.postTrade(f.u, {
    ...args,
    currency: "AFN",
    fx_rate: 10000,
    paid_foreign: 50000,
    paid: 50000,
    request_key: key(),
  });
  assert.equal(afn.paid, 50000);
  assert.equal(afn.paid_foreign, 50000);
  assert.equal(afn.currency, "AFN");
  const legacy = sale(f, 1, 1234);
  assert.equal(legacy.paid_foreign, null);
  assert.equal(legacy.paid, 1234);
  balanced(f.s);
});

test("sale returns save foreign cash refunds after debt reduction and reverse original FIFO cost", (t) => {
  const f = fixture(t);
  purchase(f, 3);
  const original = sale(f, 1, 60000);
  const args = {
    original_id: original.id,
    lines: [{ line_id: original.lines[0].id, quantity: 1 }],
    note: "Foreign refund",
    request_key: key(),
    refund_currency: "USD",
    refund_rate: 600000,
    refund_foreign: 1000,
  };
  const returned = f.s.returnTrade(f.u, args);
  assert.equal(returned.total, 100000);
  assert.equal(returned.paid, 60000);
  assert.equal(returned.currency, "USD");
  assert.equal(returned.fx_rate, 600000);
  assert.equal(returned.paid_foreign, 1000);
  assert.equal(returned.cost, 80000);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  assert.equal(
    f.s.one(
      "SELECT SUM(credit) n FROM journal WHERE document_id=? AND account='cash'",
      returned.id,
    ).n,
    60000,
  );
  assert.equal(f.s.returnTrade(f.u, args).id, returned.id);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    3,
  );
  balanced(f.s);
});

test("foreign refunds reject mismatches and rounding differences atomically; debt-only returns pay no cash", (t) => {
  const f = fixture(t);
  purchase(f, 2);
  const original = sale(f, 1, 10000);
  const base = {
    original_id: original.id,
    lines: [{ line_id: original.lines[0].id, quantity: 1 }],
    note: "Refund validation",
    refund_currency: "USD",
    refund_rate: 700000,
    refund_foreign: 143,
  };
  for (const extra of [
    {},
    { refund_foreign: 200 },
    { refund_rate: 0 },
    { refund_currency: "ZZZ" },
    { refund_currency: "AFN", refund_rate: 700000 },
  ]) {
    assert.throws(() =>
      f.s.returnTrade(f.u, { ...base, ...extra, request_key: key() }),
    );
    assert.equal(f.s.getDocument(original.id).returned, 0);
    assert.equal(
      f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
      1,
    );
  }
  const exact = f.s.returnTrade(f.u, {
    ...base,
    refund_currency: "AFN",
    refund_rate: 10000,
    refund_foreign: 10000,
    request_key: key(),
  });
  assert.equal(exact.paid, 10000);
  assert.equal(exact.paid_foreign, 10000);
  const unpaid = sale(f, 1, 0);
  const credit = f.s.returnTrade(f.u, {
    original_id: unpaid.id,
    lines: [{ line_id: unpaid.lines[0].id, quantity: 1 }],
    note: "Unpaid return",
    refund_currency: "AFN",
    refund_rate: 10000,
    refund_foreign: 0,
    request_key: key(),
  });
  assert.equal(credit.paid, 0);
  assert.equal(credit.paid_foreign, 0);
  assert.equal(f.s.partyBalance(f.customer).balance, 0);
  balanced(f.s);
});

test("purchase returns receive foreign supplier refunds after reducing debt, preserving original quotes", (t) => {
  const f = fixture(t);
  const original = f.s.postTrade(f.u, {
    kind: "purchase",
    party_id: f.supplier,
    currency: "USD",
    fx_rate: 700000,
    paid: 100000,
    request_key: key(),
    lines: [
      { product_id: f.product, quantity: 2, cost_foreign: 1000, price: 70000 },
    ],
  });
  const args = {
    original_id: original.id,
    lines: [{ line_id: original.lines[0].id, quantity: 1 }],
    note: "Supplier EUR refund",
    refund_currency: "EUR",
    refund_rate: 600000,
    refund_foreign: 500,
    request_key: key(),
  };
  const returned = f.s.returnTrade(f.u, args);
  assert.equal(returned.kind, "purchase_return");
  assert.equal(returned.total, 70000);
  assert.equal(returned.paid, 30000);
  assert.equal(returned.paid_foreign, 500);
  assert.equal(returned.currency, "EUR");
  assert.equal(returned.fx_rate, 600000);
  assert.equal(returned.lines[0].currency, "USD");
  assert.equal(returned.lines[0].cost_foreign, 1000);
  assert.equal(f.s.partyBalance(f.supplier).balance, 0);
  assert.equal(
    f.s.one(
      "SELECT SUM(debit) n FROM journal WHERE document_id=? AND account='cash'",
      returned.id,
    ).n,
    30000,
  );
  assert.equal(f.s.returnTrade(f.u, args).id, returned.id);
  assert.equal(
    f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
    1,
  );
  balanced(f.s);
});

test("purchase refund validation is atomic and preview batches reflect sold discounted stock", (t) => {
  const f = fixture(t);
  const original = purchase(f, 2, 1000, {
    paid: 1999,
    lines: [{ product_id: f.product, quantity: 2, price: 1000, discount: 1 }],
  });
  sale(f, 1, 0);
  const current = f.s.getDocument(original.id);
  assert.deepEqual(
    current.lines[0].return_batches.map((b) => [b.remaining, b.unit_cost]),
    [[1, 1000]],
  );
  const base = {
    original_id: original.id,
    lines: [{ line_id: original.lines[0].id, quantity: 1 }],
    note: "Refund validation",
    refund_currency: "USD",
    refund_rate: 700000,
    refund_foreign: 14,
  };
  for (const extra of [
    {},
    { refund_rate: 0 },
    { refund_currency: "ZZZ" },
    { refund_foreign: 100 },
  ]) {
    assert.throws(() =>
      f.s.returnTrade(f.u, { ...base, ...extra, request_key: key() }),
    );
    assert.equal(f.s.getDocument(original.id).returned, 0);
    assert.equal(
      f.s.one("SELECT stock FROM products WHERE id=?", f.product).stock,
      1,
    );
  }
  const returned = f.s.returnTrade(f.u, {
    ...base,
    refund_currency: "AFN",
    refund_rate: 10000,
    refund_foreign: 1000,
    request_key: key(),
  });
  assert.equal(returned.paid, 1000);
  assert.equal(returned.paid_foreign, 1000);
  assert.equal(returned.total, 1000);
  balanced(f.s);
});

test("local login permits immediate retries after repeated incorrect passwords", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++)
    assert.throws(
      () => f.s.login({ username: "owner", password: "incorrect-password" }),
      /Incorrect username or password/,
    );
  const session = f.s.login({
    username: "owner",
    password: "secure-test-password",
  });
  assert.equal(f.s.auth(session.token).username, "owner");
});

test("remembered login survives multiple days and database reopen; signout revokes it", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "persistent-session-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "store.sqlite");
  let store = new Store(file);
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "secure-password",
    storeName: "Shop",
  });
  store.close();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 30 * 86400000;
    store = new Store(file);
    assert.equal(store.auth(session.token).username, "owner");
    await store.dispatch("logout", {}, session.token);
    assert.throws(() => store.auth(session.token), /SESSION_EXPIRED/);
    store.close();
  } finally {
    Date.now = realNow;
  }
});

test("product deletion requires zero stock and preserves invoices; returns restore visibility", async (t) => {
  const f = fixture(t);
  purchase(f, 2);
  await assert.rejects(f.s.dispatch("productDelete", {id:f.product}, f.token), /Stock remains/);
  assert.equal(f.s.one("SELECT active FROM products WHERE id=?",f.product).active,1);
  const doc = sale(f, 2, 0);
  const before = f.s.totals();
  await f.s.dispatch("productDelete", {id:f.product}, f.token);
  await f.s.dispatch("productDelete", {id:f.product}, f.token);
  assert.equal((await f.s.dispatch("catalog", {q:"SSD-01"}, f.token)).rows.length,0);
  assert.equal(f.s.getDocument(doc.id).lines.length,1);
  assert.deepEqual(f.s.totals().gross,before.gross);
  f.s.returnTrade(f.u, {original_id:doc.id,lines:[{line_id:doc.lines[0].id,quantity:1}],note:"Returned",request_key:key()});
  assert.equal(f.s.one("SELECT active FROM products WHERE id=?",f.product).active,1);
  assert.equal((await f.s.dispatch("catalog", {q:"SSD-01"}, f.token)).rows[0].stock,1);
  await assert.rejects(f.s.dispatch("productDelete", {id:f.product}, f.token), /Stock remains/);
  balanced(f.s);
});
test("product deletion is authenticated and requires inventory permission", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.s.dispatch("productDelete", {id:f.product}));
  await f.s.dispatch("userCreate",{name:"Cashier",username:"cashier",password:"cashier-test-pass",role:"Cashier"},f.token);
  const session = await f.s.dispatch("login",{username:"cashier",password:"cashier-test-pass"});
  await assert.rejects(f.s.dispatch("productDelete", {id:f.product}, session.token),/Permission/);
  await f.s.dispatch("productDelete", {id:f.product}, f.token);
  assert.equal(f.s.one("SELECT active FROM products WHERE id=?",f.product).active,0);
});
