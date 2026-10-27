import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.mjs";
import { validateRestore, restoreDatabase } from "../server/restore.mjs";
import {
  automaticProductPhoto,
  productPhotoSelection,
  PRODUCT_PHOTO_CATALOG,
  productPhotoCreditUrls,
} from "../server/product-images.mjs";
import { decodeProductPhoto } from "../server/product-photos.mjs";
const jpg = readFileSync(
  new URL("../public/assets/products/apple-iphone-15-pro.jpg", import.meta.url),
);
const png = readFileSync(
  new URL("../public/assets/products/hp-elitebook-840-g4.png", import.meta.url),
);
const data = (bytes, mime) =>
  "data:image/" + mime + ";base64," + bytes.toString("base64");
const product = (extra) => ({
  name: "HP laptop",
  brand: "HP",
  model: "EliteBook 840 G4",
  sku: randomUUID(),
  category: "Computers",
  serialized: false,
  price: 100000,
  ...extra,
});
function fixture(t, file = ":memory:") {
  const s = new Store(file);
  t.after(() => s.close());
  const session = s.setup({
    name: "Photo owner",
    username: "owner",
    password: "product-photo-test-2026",
    storeName: "Photo test store",
  });
  return { s, token: session.token, user: s.auth(session.token) };
}
test("automatic photos use clean studio category illustrations", () => {
  assert.equal(
    automaticProductPhoto({
      brand: "Samsung",
      category: "Mobiles",
      model: "Galaxy S24",
    }).src,
    "/assets/phone.png",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Samsung",
      category: "Mobiles",
      model: "S24",
    }).kind,
    "category",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Apple",
      category: "Mobiles",
      model: "iPhone 15 Pro",
    }).src,
    "/assets/phone.png",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Hewlett-Packard",
      category: "Computers",
      model: "EliteBook 840 G4",
    }).src,
    "/assets/laptop.png",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Apple",
      category: "Tablets",
      model: "iPad",
    }).src,
    "/assets/tablet.png",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Samsung",
      category: "Storage",
      model: "990 EVO",
    }).src,
    "/assets/storage.png",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Apple",
      category: "Accessories",
      model: "Case",
      attributes: { Type: "Case" },
    }).src,
    "/assets/case.jpg",
  );
  assert.equal(
    automaticProductPhoto({
      brand: "Logitech",
      category: "Accessories",
      model: "K380",
      attributes: { Type: "Keyboard" },
    }).src,
    "/assets/keyboard.jpg",
  );
  const legacy = productPhotoSelection({
    brand: "Samsung",
    category: "Mobiles",
    model: "Galaxy S24",
    image: "/assets/phone.png",
  });
  assert.equal(legacy.src, "/assets/phone.png");
  assert.equal(legacy.kind, "category");
  const fromWiki = productPhotoSelection({
    brand: "HP",
    category: "Computers",
    model: "840 G4",
    image: "/assets/products/apple-macbook-air-m2.jpg",
  });
  assert.equal(fromWiki.src, "/assets/laptop.png");
  assert.equal(fromWiki.kind, "category");
});
test("bundled studio and reference photo files stay local and attributable", () => {
  for (const src of [
    "/assets/phone.png",
    "/assets/laptop.png",
    "/assets/tablet.png",
    "/assets/storage.png",
    "/assets/keyboard.jpg",
  ]) {
    const path = new URL("../public" + src, import.meta.url);
    assert.ok(existsSync(path), src);
    assert.ok(readFileSync(path).length > 1000, src);
  }
  assert.ok(PRODUCT_PHOTO_CATALOG.length >= 10);
  const credits = productPhotoCreditUrls();
  for (const photo of PRODUCT_PHOTO_CATALOG) {
    assert.ok(photo.src.startsWith("/assets/products/"));
    const path = new URL("../public" + photo.src, import.meta.url);
    assert.ok(existsSync(path));
    assert.ok(readFileSync(path).length > 1000);
    assert.ok(
      photo.author && photo.license && photo.source && photo.licenseUrl,
    );
    assert.ok(credits.includes(photo.source));
    assert.ok(credits.includes(photo.licenseUrl));
  }
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL("../public/assets/products/CREDITS.json", import.meta.url),
      ),
    ),
    PRODUCT_PHOTO_CATALOG,
  );
  assert.ok(
    !credits.some(
      (url) => url.startsWith("file:") || url.startsWith("javascript:"),
    ),
  );
});
test("uploads reject non-images, forged mime types and oversized content", () => {
  assert.throws(
    () => decodeProductPhoto("data:image/svg+xml;base64,PHN2Zz4="),
    /JPG/,
  );
  assert.throws(
    () => decodeProductPhoto(data(Buffer.from("not a photo at all"), "jpeg")),
    /format/,
  );
  assert.throws(() => decodeProductPhoto(data(png, "jpeg")), /format/);
  assert.throws(
    () => decodeProductPhoto(data(Buffer.alloc(350001), "png")),
    /oversized/,
  );
  assert.equal(decodeProductPhoto(data(jpg, "jpeg")).mime, "image/jpeg");
});
test("custom photos are separate from fast catalog rows, deduplicated, and reused only for the same company/model", async (t) => {
  const f = fixture(t);
  const a = await f.s.dispatch(
    "productCreate",
    product({ photo_data: data(png, "png") }),
    f.token,
  );
  const b = await f.s.dispatch(
    "productCreate",
    product({ photo_data: data(png, "png") }),
    f.token,
  );
  const rows = (await f.s.dispatch("catalog", {}, f.token)).rows;
  assert.equal(f.s.one("SELECT COUNT(*) n FROM product_photos").n, 1);
  assert.equal(
    rows.find((p) => p.id === a.id).image,
    rows.find((p) => p.id === b.id).image,
  );
  assert.ok(rows.every((p) => p.image.startsWith("photo:")));
  assert.ok(JSON.stringify(rows).length < 5000);
  const same = await f.s.dispatch(
    "productPhotoMatch",
    { category: "Computers", brand: "hp", model: "elitebook 840 g4" },
    f.token,
  );
  assert.equal(same.image, rows[0].image);
  for (const extra of [
    { brand: "Samsung" },
    { category: "Mobiles" },
    { model: "Other model" },
  ])
    assert.equal(
      (
        await f.s.dispatch(
          "productPhotoMatch",
          {
            category: "Computers",
            brand: "HP",
            model: "EliteBook 840 G4",
            ...extra,
          },
          f.token,
        )
      ).image,
      null,
    );
  assert.equal(
    (await f.s.dispatch("productPhoto", { ref: rows[0].image }, f.token)).src,
    data(png, "png"),
  );
});
test("failed creation rolls back new photo BLOBs with the product", async (t) => {
  const f = fixture(t);
  const d = product({ sku: "DUPLICATE" });
  await f.s.dispatch("productCreate", d, f.token);
  await assert.rejects(
    f.s.dispatch(
      "productCreate",
      { ...d, photo_data: data(png, "png") },
      f.token,
    ),
    /UNIQUE/,
  );
  assert.equal(f.s.one("SELECT COUNT(*) n FROM product_photos").n, 0);
  assert.equal(f.s.one("SELECT COUNT(*) n FROM products").n, 1);
});
test("editing a photo preserves the old photo for historical invoice snapshots", async (t) => {
  const f = fixture(t);
  const d = product({ photo_data: data(png, "png") });
  const p = await f.s.dispatch("productCreate", d, f.token);
  const supplier = f.s.createParty(f.user, {
    kind: "supplier",
    name: "Supplier",
  }).id;
  const buyer = f.s.createParty(f.user, { kind: "customer", name: "Buyer" }).id;
  f.s.postTrade(f.user, {
    kind: "purchase",
    party_id: supplier,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: p.id, quantity: 1, price: 70000 }],
  });
  const invoice = f.s.postTrade(f.user, {
    kind: "sale",
    party_id: buyer,
    paid: 100000,
    request_key: randomUUID(),
    lines: [{ product_id: p.id, quantity: 1, price: 100000 }],
  });
  const previous = invoice.lines[0].image;
  await f.s.dispatch(
    "productUpdate",
    { ...d, id: p.id, photo_data: data(jpg, "jpeg") },
    f.token,
  );
  assert.notEqual(
    f.s.one("SELECT image FROM products WHERE id=?", p.id).image,
    previous,
  );
  assert.equal(f.s.getDocument(invoice.id).lines[0].image, previous);
  assert.equal(
    (await f.s.dispatch("productPhoto", { ref: previous }, f.token)).src,
    data(png, "png"),
  );
  assert.equal(f.s.totals().gross, 30000);
});
test("resale intake saves a new product photo in the same custody transaction", async (t) => {
  const f = fixture(t);
  const receipt = await f.s.dispatch(
    "consignmentReceive",
    {
      new_owner: { name: "Laptop owner" },
      new_product: { ...product({ photo_data: data(png, "png") }) },
      quantity: 1,
      owner_unit_amount: 50000,
      request_key: randomUUID(),
    },
    f.token,
  );
  assert.ok(receipt.lines[0].image.startsWith("photo:"));
  assert.equal(
    (
      await f.s.dispatch(
        "productPhoto",
        { ref: receipt.lines[0].image },
        f.token,
      )
    ).src,
    data(png, "png"),
  );
  assert.equal(f.s.totals().net, 0);
});
test("photos survive a verified SQLite backup and restore on another computer profile", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "radefy-photo-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(t, join(root, "store.sqlite"));
  const p = await f.s.dispatch(
    "productCreate",
    product({ photo_data: data(png, "png") }),
    f.token,
  );
  const folder = join(root, "drive");
  mkdirSync(folder);
  const backup = await f.s.createBackup(f.user, { destination: folder });
  const file = backup.results[0].path;
  assert.equal(backup.results[0].status, "verified");
  assert.equal(validateRestore(file).products, 1);
  const target = join(root, "restored.sqlite");
  await restoreDatabase(file, target);
  const restored = new Store(target);
  try {
    const ref = restored.one(
      "SELECT image FROM products WHERE id=?",
      p.id,
    ).image;
    assert.equal(
      (await restored.dispatch("productPhoto", { ref }, f.token)).src,
      data(png, "png"),
    );
  } finally {
    restored.close();
  }
});
test("staff without product-read access cannot fetch photo blobs or model matches", async (t) => {
  const f = fixture(t);
  const p = await f.s.dispatch(
    "productCreate",
    product({ photo_data: data(png, "png") }),
    f.token,
  );
  await f.s.dispatch(
    "userCreate",
    {
      name: "Settings user",
      username: "settings",
      password: "settings-photo-2026",
      role: "Cashier",
      permissions: ["settings"],
    },
    f.token,
  );
  const session = await f.s.dispatch("login", {
    username: "settings",
    password: "settings-photo-2026",
  });
  const ref = f.s.one("SELECT image FROM products WHERE id=?", p.id).image;
  await assert.rejects(
    f.s.dispatch("productPhoto", { ref }, session.token),
    /Permission/,
  );
  await assert.rejects(
    f.s.dispatch(
      "productPhotoMatch",
      { category: "Computers", brand: "HP", model: "EliteBook 840 G4" },
      session.token,
    ),
    /Permission/,
  );
  await assert.rejects(
    f.s.dispatch("productCreate", product(), session.token),
    /Permission/,
  );
});

test("editing product details without a photo field preserves the custom photo until explicitly replaced", async (t) => {
  const f = fixture(t),
    draft = product({ photo_data: data(png, "png") });
  const created = await f.s.dispatch("productCreate", draft, f.token);
  const before = f.s.one(
    "SELECT image FROM products WHERE id=?",
    created.id,
  ).image;
  const changed = {
    ...draft,
    id: created.id,
    category: "Mobiles",
    brand: "Samsung",
    model: "Galaxy S24",
  };
  delete changed.photo_data;
  await f.s.dispatch("productUpdate", changed, f.token);
  assert.equal(
    f.s.one("SELECT image FROM products WHERE id=?", created.id).image,
    before,
  );
  await f.s.dispatch("productUpdate", { ...changed, image: "" }, f.token);
  assert.equal(
    f.s.one("SELECT image FROM products WHERE id=?", created.id).image,
    "/assets/phone.png",
  );
});
