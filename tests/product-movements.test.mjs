import test from "node:test";
import assert from "node:assert/strict";
import { movementBalances } from "../src/product-movements.mjs";

test("stock after each purchase, sale and return uses newest-first current stock", () => {
  const rows = movementBalances(8, [
    { id: "return", quantity: 1 },
    { id: "sale", quantity: -3 },
    { id: "purchase", quantity: 10 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.remaining),
    [8, 7, 10],
  );
});
test("truncated history keeps older opening stock in the remaining balance", () => {
  const movements = Array.from({ length: 100 }, (_, id) => ({
    id,
    quantity: -1,
  }));
  const rows = movementBalances(25, movements);
  assert.equal(rows[0].remaining, 25);
  assert.equal(rows[99].remaining, 124);
  assert.equal(movements[0].remaining, undefined);
});
test("zero stock, removals and empty history are represented accurately", () => {
  assert.deepEqual(
    movementBalances(0, [{ quantity: -4 }, { quantity: 4 }]).map(
      (row) => row.remaining,
    ),
    [0, 4],
  );
  assert.deepEqual(movementBalances(0, []), []);
});

// Regression: random movement UUIDs must not reorder purchases and sales on one day.
import { Store } from "../server/store.mjs";
test("product detail orders same-day stock changes by posting order", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const session = store.setup({
    name: "Owner",
    username: "owner",
    password: "secure-test-password",
    storeName: "Stock test",
  });
  const user = store.auth(session.token);
  const supplier = store.createParty(user, {
    kind: "supplier",
    name: "Supplier",
  });
  const customer = store.createParty(user, {
    kind: "customer",
    name: "Customer",
  });
  const product = store.createProduct(user, {
    name: "SSD",
    brand: "Samsung",
    model: "990",
    sku: "MOVEMENT-1",
    category: "Storage",
    price: 10000,
  });
  const purchase = store.postTrade(user, {
    kind: "purchase",
    party_id: supplier.id,
    paid: 0,
    request_key: "purchase-movement-test",
    lines: [{ product_id: product.id, quantity: 10, price: 5000 }],
  });
  const sale = store.postTrade(user, {
    kind: "sale",
    due_date: "2099-12-31",
    party_id: customer.id,
    paid: 0,
    request_key: "sale-movement-test",
    lines: [{ product_id: product.id, quantity: 3, price: 10000 }],
  });
  store.run(
    "UPDATE movements SET id='zz-purchase' WHERE document_id=?",
    purchase.id,
  );
  store.run("UPDATE movements SET id='aa-sale' WHERE document_id=?", sale.id);
  const detail = await store.dispatch(
    "productDetail",
    { id: product.id },
    session.token,
  );
  assert.equal(detail.product.stock, 7);
  assert.deepEqual(
    detail.movements.map((m) => m.quantity),
    [-3, 10],
  );
  assert.deepEqual(
    movementBalances(detail.product.stock, detail.movements).map(
      (m) => m.remaining,
    ),
    [7, 10],
  );
});
