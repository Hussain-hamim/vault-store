import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { restoreDatabase } from "../server/restore.mjs";
function fixture(t, file = ":memory:") {
  const s = new Store(file);
  t.after(() => s.close());
  const auth = s.setup({
    name: "Owner",
    username: "owner",
    password: "serialized-test-pass",
    storeName: "Device store",
  });
  const u = s.auth(auth.token);
  const supplier = s.createParty(u, { kind: "supplier", name: "Supplier" }).id,
    customer = s.createParty(u, { kind: "customer", name: "Customer" }).id;
  const create = (extra = {}) =>
    s.createProduct(u, {
      name: "MacBook Air",
      brand: "Apple",
      model: "M3",
      sku: randomUUID(),
      category: "Computers",
      price: 50000,
      serialized: true,
      ...extra,
    }).id;
  const product = create();
  const call = (cmd, args) => s.dispatch(cmd, args, auth.token);
  const buy = (price = 10000, quantity = 1, extra = {}) =>
    s.postTrade(u, {
      kind: "purchase",
      currency: "AFN",
      party_id: supplier,
      paid: 0,
      request_key: randomUUID(),
      lines: [{ product_id: product, quantity, price, ...extra }],
    });
  const sell = (ids, extra = {}) =>
    s.postTrade(u, {
      kind: "sale",
      party_id: customer,
      paid: 0,
      request_key: randomUUID(),
      lines: [
        {
          product_id: product,
          quantity: ids.length,
          price: 50000,
          unit_ids: ids,
          ...extra,
        },
      ],
    });
  const units = () =>
    s.all(
      "SELECT u.*,b.unit_cost FROM inventory_units u JOIN batches b ON b.id=u.batch_id WHERE u.product_id=? ORDER BY u.rowid",
      product,
    );
  const coherent = () => {
    for (const p of s.all("SELECT * FROM products WHERE serialized=1")) {
      assert.equal(
        s.one(
          "SELECT COUNT(*) n FROM inventory_units WHERE product_id=? AND status='available'",
          p.id,
        ).n,
        p.stock,
      );
      assert.equal(
        s.one(
          "SELECT COALESCE(SUM(remaining),0) n FROM batches WHERE product_id=?",
          p.id,
        ).n,
        p.stock,
      );
    }
    assert.equal(
      s.one("SELECT COALESCE(SUM(debit-credit),0) n FROM journal").n,
      0,
    );
  };
  return {
    s,
    u,
    auth,
    product,
    customer,
    supplier,
    create,
    call,
    buy,
    sell,
    units,
    coherent,
  };
}
test("exact device cost overrides FIFO; serial optional; returns restore the same device and profit", (t) => {
  const f = fixture(t);
  f.buy(10000);
  f.buy(25000, 1, {
    units: [
      {
        serial: "M3-USED",
        condition: "Used",
        battery: "89%",
        notes: "Scratched lid",
        accessories: "Charger",
      },
    ],
  });
  const [first, second] = f.units();
  assert.equal(first.serial, null);
  assert.notEqual(first.code, second.code);
  const sale = f.sell([second.id]);
  assert.equal(sale.cost, 25000);
  assert.equal(f.s.totals().gross, 25000);
  assert.equal(sale.lines[0].units[0].serial, "M3-USED");
  const ret = f.s.returnTrade(f.u, {
    original_id: sale.id,
    lines: [{ line_id: sale.lines[0].id, quantity: 1, unit_ids: [second.id] }],
    note: "Customer return",
    request_key: randomUUID(),
  });
  assert.equal(ret.cost, 25000);
  assert.equal(ret.lines[0].units[0].id, second.id);
  assert.equal(f.s.totals().gross, 0);
  assert.equal(f.units()[1].status, "available");
  f.coherent();
});
test("missing, duplicate, wrong-product and already-sold selections roll back atomically", (t) => {
  const f = fixture(t);
  f.buy(10000, 2);
  const [a, b] = f.units();
  assert.throws(() => f.sell([], { quantity: 1 }), /Select exactly/);
  assert.throws(() => f.sell([a.id, a.id]), /Select exactly/);
  const other = f.create({ opening_quantity: 1, unit_cost: 1 });
  const wrong = f.s.one(
    "SELECT id FROM inventory_units WHERE product_id=?",
    other,
  );
  assert.throws(() => f.sell([wrong.id]), /unavailable/);
  f.sell([a.id]);
  assert.throws(() => f.sell([a.id, b.id]), /unavailable/);
  assert.equal(f.units().find((u) => u.id === b.id).status, "available");
  f.coherent();
});
test("partial multi-device returns select the exact discounted purchase batch cost", (t) => {
  const f = fixture(t);
  const buy = f.buy(10000, 2, {
    discount: 1,
    units: [{ serial: "ROUND-A" }, { serial: "ROUND-B" }],
  });
  const [a, b] = f.units();
  assert.equal(a.unit_cost + b.unit_cost, 19999);
  const sale = f.sell([a.id, b.id]);
  const ret = f.s.returnTrade(f.u, {
    original_id: sale.id,
    lines: [{ line_id: sale.lines[0].id, quantity: 1, unit_ids: [b.id] }],
    note: "Return exact unit",
    request_key: randomUUID(),
  });
  assert.equal(ret.cost, b.unit_cost);
  assert.equal(f.units().find((u) => u.id === a.id).status, "sold");
  assert.throws(
    () =>
      f.s.returnTrade(f.u, {
        original_id: sale.id,
        lines: [{ line_id: sale.lines[0].id, quantity: 1, unit_ids: [b.id] }],
        note: "Duplicate return",
        request_key: randomUUID(),
      }),
    /not returnable/,
  );
  f.coherent();
});
test("supplier returns use the exact available device, cost and original purchase", (t) => {
  const f = fixture(t);
  const buy = f.buy(10000, 2, { discount: 1 });
  const [a, b] = f.units();
  const ret = f.s.returnTrade(f.u, {
    original_id: buy.id,
    lines: [{ line_id: buy.lines[0].id, quantity: 1, unit_ids: [b.id] }],
    note: "Supplier return",
    request_key: randomUUID(),
  });
  assert.equal(ret.total, b.unit_cost);
  assert.equal(ret.cost, b.unit_cost);
  assert.equal(f.units()[1].status, "returned_supplier");
  assert.throws(() => f.sell([b.id]), /unavailable/);
  f.sell([a.id]);
  f.coherent();
});
test("sale edit/delete restores exact units; a device cannot be sold twice on one invoice", (t) => {
  const f = fixture(t);
  f.buy(10000);
  f.buy(20000);
  const [a, b] = f.units();
  const sale = f.sell([b.id]);
  const edited = f.s.mutateSale(
    f.u,
    {
      id: sale.id,
      revision: sale.revision,
      currency: "AFN",
      party_id: f.customer,
      paid: 0,
      date: sale.date,
      request_key: randomUUID(),
      lines: [
        { product_id: f.product, quantity: 1, price: 45000, unit_ids: [a.id] },
      ],
    },
    "edit",
  );
  assert.equal(f.s.getDocument(edited.id).cost, 10000);
  assert.equal(f.units()[1].status, "available");
  f.s.mutateSale(
    f.u,
    {
      id: edited.id,
      revision: edited.revision,
      confirmation: edited.number,
      request_key: randomUUID(),
    },
    "delete",
  );
  f.coherent();
  assert.throws(
    () =>
      f.s.postTrade(f.u, {
        kind: "sale",
        party_id: f.customer,
        paid: 0,
        request_key: randomUUID(),
        lines: [
          {
            product_id: f.product,
            quantity: 1,
            price: 50000,
            unit_ids: [a.id],
          },
          {
            product_id: f.product,
            quantity: 1,
            price: 50000,
            unit_ids: [a.id],
          },
        ],
      }),
    /unavailable/,
  );
  f.coherent();
});
test("opening stock and adjustments track devices; accessories remain quantity FIFO", (t) => {
  const f = fixture(t);
  const p = f.create({
    opening_quantity: 2,
    unit_cost: 9000,
    units: [{ serial: "" }, { serial: "" }],
  });
  assert.equal(
    f.s.one("SELECT COUNT(*) n FROM inventory_units WHERE product_id=?", p).n,
    2,
  );
  const units = f.s.all("SELECT id FROM inventory_units WHERE product_id=?", p);
  f.s.adjust(f.u, {
    product_id: p,
    quantity: -1,
    unit_ids: [units[1].id],
    note: "Remove damaged device",
    request_key: randomUUID(),
  });
  const accessory = f.create({
    category: "Accessories",
    serialized: true,
    opening_quantity: 3,
    unit_cost: 400,
  });
  assert.equal(
    f.s.one("SELECT serialized FROM products WHERE id=?", accessory).serialized,
    0,
  );
  assert.equal(
    f.s.one(
      "SELECT COUNT(*) n FROM inventory_units WHERE product_id=?",
      accessory,
    ).n,
    0,
  );
  const sale = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: accessory, quantity: 2, price: 1000 }],
  });
  assert.equal(sale.cost, 800);
  f.coherent();
});
test("serials are optional but supplied duplicates are rejected; retries do not duplicate devices", (t) => {
  const f = fixture(t);
  f.buy(10000, 2);
  f.buy(10000, 1, { units: [{ serial: "UNIQUE-SERIAL" }] });
  assert.throws(
    () => f.buy(10000, 1, { units: [{ serial: "unique-serial" }] }),
    /UNIQUE/,
  );
  assert.equal(f.units().length, 3);
  const ids = [f.units()[0].id],
    key = randomUUID();
  const input = {
    kind: "sale",
    party_id: f.customer,
    paid: 0,
    request_key: key,
    lines: [
      { product_id: f.product, quantity: 1, price: 50000, unit_ids: ids },
    ],
  };
  const first = f.s.postTrade(f.u, input);
  const retry = f.s.postTrade(f.u, input);
  assert.equal(first.id, retry.id);
  f.coherent();
});
test("existing quantity device stock migrates without changing costs or accounting, once only", (t) => {
  const root = mkdtempSync(join(tmpdir(), "device-upgrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "store.sqlite");
  const f = fixture(t, file);
  f.s.run("UPDATE products SET serialized=0 WHERE id=?", f.product);
  f.buy(7000, 2);
  f.s.run("DELETE FROM settings WHERE key='individualDevicesV1'");
  const before = f.s.totals();
  const migrated = new Store(file);
  assert.equal(migrated.one("SELECT COUNT(*) n FROM inventory_units").n, 2);
  assert.equal(
    migrated.one("SELECT serialized FROM products WHERE id=?", f.product)
      .serialized,
    1,
  );
  assert.deepEqual(migrated.totals(), before);
  migrated.close();
  const reopened = new Store(file);
  assert.equal(reopened.one("SELECT COUNT(*) n FROM inventory_units").n, 2);
  reopened.close();
});
test("device metadata is editable only with inventory permission and invoice snapshots remain immutable", async (t) => {
  const f = fixture(t);
  f.buy();
  const [unit] = f.units();
  await f.call("unitUpdate", {
    id: unit.id,
    serial: "CUSTOM",
    condition: "Used",
    battery: "85%",
    notes: "Small scratch",
    price: 55000,
  });
  const sale = f.sell([unit.id]);
  assert.equal(sale.lines[0].units[0].notes, "Small scratch");
  await assert.rejects(
    f.call("unitUpdate", { id: unit.id, serial: "CHANGED" }),
    /Only available/,
  );
  await f.call("userCreate", {
    name: "Cashier",
    username: "cashier",
    password: "cashier-test-pass",
    role: "Cashier",
  });
  const auth = await f.s.dispatch("login", {
    username: "cashier",
    password: "cashier-test-pass",
  });
  await assert.rejects(
    f.s.dispatch("unitUpdate", { id: unit.id }, auth.token),
    /Permission/,
  );
  const list = await f.s.dispatch(
    "devices",
    { product_id: f.product },
    auth.token,
  );
  assert.ok(
    list.rows.every(
      (u) => u.unit_cost === undefined && u.owner_unit_amount === undefined,
    ),
  );
  f.coherent();
});
test("customer-owned exact devices accrue the correct owner share and reverse it on return", async (t) => {
  const f = fixture(t);
  const receipt = await f.call("consignmentReceive", {
    owner_id: f.customer,
    product_id: f.product,
    quantity: 2,
    owner_unit_amount: 20000,
    request_key: randomUUID(),
  });
  const units = f.units();
  const sale = f.sell([units[1].id]);
  assert.equal(sale.cost, 20000);
  assert.equal(f.s.totals().gross, 30000);
  f.s.returnTrade(f.u, {
    original_id: sale.id,
    lines: [
      { line_id: sale.lines[0].id, quantity: 1, unit_ids: [units[1].id] },
    ],
    note: "Owner device return",
    request_key: randomUUID(),
  });
  assert.equal(f.s.totals().gross, 0);
  await assert.rejects(
    f.call("consignmentReturn", {
      batch_id: units[0].batch_id,
      quantity: 1,
      request_key: randomUUID(),
    }),
    /exact/,
  );
  await f.call("consignmentReturn", {
    batch_id: units[0].batch_id,
    quantity: 1,
    unit_ids: [units[0].id],
    request_key: randomUUID(),
  });
  assert.equal(f.units()[0].status, "returned_supplier");
  assert.equal(f.units()[1].status, "available");
  f.coherent();
});
test("unsold purchase edits recreate devices atomically and hard delete removes their receipts", (t) => {
  const f = fixture(t);
  const buy = f.buy(10000, 1, {
    units: [{ serial: "PURCHASE-EDIT", condition: "Used" }],
  });
  const originalUnit = f.units()[0];
  const changed = f.s.mutatePurchase(
    f.u,
    {
      id: buy.id,
      revision: buy.revision,
      request_key: randomUUID(),
      party_id: f.supplier,
      currency: "AFN",
      paid: 0,
      date: buy.date,
      lines: [
        {
          product_id: f.product,
          quantity: 1,
          price: 12000,
          units: [{ serial: "PURCHASE-EDIT", condition: "Used" }],
        },
      ],
    },
    "edit",
  );
  assert.equal(f.units().length, 1);
  assert.equal(f.units()[0].id, originalUnit.id);
  assert.equal(f.units()[0].code, originalUnit.code);
  assert.equal(f.units()[0].unit_cost, 12000);
  f.coherent();
  f.s.mutatePurchase(
    f.u,
    {
      id: changed.id,
      revision: changed.revision,
      request_key: randomUUID(),
      confirmation: changed.number,
    },
    "delete",
  );
  assert.equal(f.units().length, 0);
  f.coherent();
});
test("legacy sales return their original cost after upgrading and create a replacement tracked device", (t) => {
  const root = mkdtempSync(join(tmpdir(), "device-legacy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "store.sqlite");
  const f = fixture(t, file);
  f.s.run("UPDATE products SET serialized=0 WHERE id=?", f.product);
  f.buy(8000);
  const sale = f.s.postTrade(f.u, {
    kind: "sale",
    party_id: f.customer,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: f.product, quantity: 1, price: 50000 }],
  });
  f.s.run("DELETE FROM settings WHERE key='individualDevicesV1'");
  const upgraded = new Store(file);
  try {
    const ret = upgraded.returnTrade(f.u, {
      original_id: sale.id,
      lines: [{ line_id: sale.lines[0].id, quantity: 1 }],
      note: "Legacy device return",
      request_key: randomUUID(),
    });
    assert.equal(ret.cost, 8000);
    assert.equal(
      upgraded.one(
        "SELECT COUNT(*) n FROM inventory_units WHERE status='available'",
      ).n,
      1,
    );
  } finally {
    upgraded.close();
  }
});
test("a device purchased again after supplier return keeps its identity and uses its new cost", (t) => {
  const f = fixture(t);
  const buy = f.buy(10000, 1, { units: [{ serial: "RECEIVE-AGAIN" }] });
  const unit = f.units()[0];
  f.s.returnTrade(f.u, {
    original_id: buy.id,
    lines: [{ line_id: buy.lines[0].id, quantity: 1, unit_ids: [unit.id] }],
    note: "Supplier return",
    request_key: randomUUID(),
  });
  f.buy(18000, 1, { units: [{ serial: "RECEIVE-AGAIN" }] });
  assert.equal(f.units().length, 1);
  assert.equal(f.units()[0].id, unit.id);
  assert.equal(f.sell([unit.id]).cost, 18000);
  f.coherent();
});
test("backups preserve individual devices, their original costs and sale links", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "device-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, join(root, "store.sqlite"));
  f.buy(9000, 2, {
    units: [{ serial: "BACKUP-DEVICE" }, { notes: "No serial" }],
  });
  const unit = f.units()[0];
  const sale = f.sell([unit.id]);
  const destination = join(root, "backups");
  mkdirSync(destination);
  const backup = await f.s.createBackup(f.u, { destination });
  const target = join(root, "restored.sqlite");
  await restoreDatabase(backup.results[0].path, target);
  const restored = new Store(target);
  try {
    assert.equal(restored.one("SELECT COUNT(*) n FROM inventory_units").n, 2);
    assert.equal(
      restored.one("SELECT status FROM inventory_units WHERE id=?", unit.id)
        .status,
      "sold",
    );
    assert.equal(restored.getDocument(sale.id).lines[0].units[0].id, unit.id);
    assert.equal(restored.getDocument(sale.id).cost, 9000);
  } finally {
    restored.close();
  }
});

test("ambiguous scan identifiers never select the wrong device", async (t) => {
  const f = fixture(t);
  f.buy();
  const a = f.units()[0];
  f.buy(15000, 1, { units: [{ serial: a.code }] });
  await assert.rejects(f.call("unitLookup", { code: a.code }), /more than one/);
  const b = f.units()[1];
  assert.equal((await f.call("unitLookup", { code: b.code })).unit.id, b.id);
});
test("deleting a sold-out device model preserves exact return identity and reactivates stock", async (t) => {
  const f = fixture(t);
  f.buy();
  const unit = f.units()[0],
    sale = f.sell([unit.id]);
  await f.call("productDelete", { id: f.product });
  assert.equal(
    f.s.one("SELECT active FROM products WHERE id=?", f.product).active,
    0,
  );
  f.s.returnTrade(f.u, {
    original_id: sale.id,
    lines: [{ line_id: sale.lines[0].id, quantity: 1, unit_ids: [unit.id] }],
    note: "Return after deletion",
    request_key: randomUUID(),
  });
  assert.equal(
    f.s.one("SELECT active FROM products WHERE id=?", f.product).active,
    1,
  );
  assert.equal(f.units()[0].id, unit.id);
  f.coherent();
});

test("a purchase price correction preserves device identity and details when metadata is omitted", (t) => {
  const f = fixture(t);
  const buy = f.buy(10000, 1, {
    units: [
      {
        serial: "KEEP-METADATA",
        condition: "Used",
        notes: "Case scratch",
        battery: "87%",
      },
    ],
  });
  const before = f.units()[0];
  f.s.mutatePurchase(
    f.u,
    {
      id: buy.id,
      revision: buy.revision,
      request_key: randomUUID(),
      party_id: f.supplier,
      currency: "AFN",
      paid: 0,
      date: buy.date,
      lines: [{ product_id: f.product, quantity: 1, price: 15000 }],
    },
    "edit",
  );
  const after = f.units()[0];
  assert.equal(after.id, before.id);
  assert.equal(after.code, before.code);
  assert.equal(after.serial, before.serial);
  assert.equal(after.notes, before.notes);
  assert.equal(after.condition, before.condition);
  assert.equal(after.battery, before.battery);
  assert.equal(after.unit_cost, 15000);
  f.coherent();
});
