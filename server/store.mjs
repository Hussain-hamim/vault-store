import { discoverBackupTargets, backupDue } from "./backup-targets.mjs";
import {
  trackedCategory,
  unitFields,
  receiveUnits,
  migrateUnits,
  consumeUnits,
  documentUnits,
  returnSelection,
  returnUnits,
  unitCommand,
} from "./inventory-units.mjs";
import { productDraftCommand } from "./product-drafts.mjs";
import { saveProductPhoto, readProductPhoto } from "./product-photos.mjs";
import {
  DEFAULT_CURRENCIES,
  SUPPORTED_FLAG_COUNTRIES,
} from "../shared/currencies.mjs";
import {
  BUILTIN_PRODUCT_CATEGORIES,
  isBuiltinCategory,
} from "../shared/product-categories.mjs";
import { notifications } from "./notifications.mjs";
import {
  receiveConsignment,
  returnConsignment,
  payConsignment,
  editConsignmentPay,
  consignments,
  consignmentCredits,
  ownerBalance,
  consignmentSnapshot,
} from "./customer-resale.mjs";
import { DatabaseSync, backup } from "./sqlite.mjs";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  copyFileSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
  readSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { fileChecksum } from "./files.mjs";
import { acquireMaintenanceLock } from "./lock.mjs";
export const PERMISSIONS = [
  "sales",
  "purchases",
  "inventory",
  "people",
  "finance",
  "reports",
  "view_costs",
  "users",
  "backups",
  "settings",
];
export const ROLES = {
  Owner: PERMISSIONS,
  Manager: PERMISSIONS.filter((p) => p !== "users"),
  Cashier: ["sales", "people"],
  "Inventory clerk": ["inventory", "purchases", "people"],
  Accountant: ["finance", "reports", "view_costs", "people"],
};
const id = () => randomUUID(),
  now = () => new Date().toISOString();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const text = z.string().trim().max(500),
  money = z.number().int().min(0).max(1_000_000_000_000),
  positive = z.number().int().min(1).max(1_000_000),
  /** AFN per 1 AED, scaled by 10_000 (e.g. 18.5 → 185000). */
  fxRate = z.number().int().min(0).max(1_000_000_000);
const afnFromAed = (aedMinor, rateScaled) => {
  if (!aedMinor || !rateScaled) return 0;
  return Math.round((aedMinor * rateScaled) / 10_000);
};
const ensureFxColumns = (db) => {
  const add = (table, column, sqlType) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType} NOT NULL DEFAULT 0`,
      );
  };
  add("products", "cost_aed", "INTEGER");
  add("products", "fx_rate", "INTEGER");
  add("batches", "cost_aed", "INTEGER");
  add("batches", "fx_rate", "INTEGER");
  add("document_lines", "cost_aed", "INTEGER");
  add("document_lines", "fx_rate", "INTEGER");
  add("document_lines", "cargo_rent", "INTEGER");
  add("products", "cargo_rent", "INTEGER");
  add("documents", "fx_rate", "INTEGER");
  if (
    !db
      .prepare("PRAGMA table_info(documents)")
      .all()
      .some((c) => c.name === "paid_foreign")
  )
    db.exec(
      "ALTER TABLE documents ADD COLUMN paid_foreign INTEGER CHECK(paid_foreign>=0)",
    );
  for (const table of ["products", "documents", "document_lines", "batches"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((c) => c.name === "currency"))
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN currency TEXT NOT NULL DEFAULT 'AED'`,
      );
    if (
      table !== "documents" &&
      !columns.some((c) => c.name === "cost_foreign")
    ) {
      add(table, "cost_foreign", "INTEGER");
      db.exec(`UPDATE ${table} SET cost_foreign=cost_aed`);
    }
  }
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  );
const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const passwordValid = (password, encoded) => {
  const [salt, hash] = encoded.split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
};
const userSchema = z.object({
  name: text.min(2),
  username: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(10).max(128),
  role: z.enum([
    "Owner",
    "Manager",
    "Cashier",
    "Inventory clerk",
    "Accountant",
  ]),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});
const currencyFields = {
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("AED"),
  cost_foreign: money.optional(),
};
const normalizeForeign = (d) => ({
  ...d,
  cost_foreign: d.cost_foreign ?? d.cost_aed,
  cost_aed: d.currency === "AED" ? (d.cost_foreign ?? d.cost_aed) : 0,
});
const productSchema = z
  .object({
    name: text.min(2),
    brand: text.min(1),
    model: text.min(1),
    sku: text.min(1),
    barcode: text.default(""),
    category: text.min(2).max(80),
    price: money,
    minimum: money.default(0),
    reorder_level: z.number().int().min(0).max(1_000_000).default(5),
    location: text.default(""),
    condition: z.enum(["New", "Used", "Refurbished"]).default("New"),
    warranty: text.default(""),
    attributes: z.record(z.string(), z.string().max(200)).default({}),
    image: text.default(""),
    photo_data: z.string().max(500000).optional(),
    unit_cost: money.optional(),
    ...currencyFields,
    cost_aed: money.default(0),
    cargo_rent: money.default(0),
    fx_rate: fxRate.default(0),
    serialized: z.boolean().optional(),
    ...unitFields,
    opening_quantity: z.number().int().min(0).max(100000).default(0),
  })
  .transform(normalizeForeign);
const lineSchema = z
  .object({
    product_id: z.string(),
    ...unitFields,
    quantity: positive,
    price: money,
    discount: money.default(0),
    ...currencyFields,
    cost_aed: money.default(0),
    cargo_rent: money.default(0),
    fx_rate: fxRate.default(0),
  })
  .transform(normalizeForeign);
const docSchema = z.object({
  currency: currencyFields.currency,
  kind: z.enum(["sale", "purchase"]),
  party_id: z.string().nullable().optional(),
  date: date.optional(),
  due_date: date.nullable().optional(),
  paid: money,
  paid_foreign: money.optional(),
  discount: money.default(0),
  note: text.default(""),
  fx_rate: fxRate.default(0),
  request_key: z.string().min(8).max(100),
  lines: z.array(lineSchema).min(1).max(200),
});
export class Store {
  constructor(file, { demo = false } = {}) {
    this.file = file;
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=1000;",
    );
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 2)
      throw new Error(
        "This database requires a newer version of Radefy TechMart.",
      );
    this.db.exec(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    // Additive migrations preserve existing stores and their posted costs.
    if (
      !this.all("PRAGMA table_info(products)").some(
        (c) => c.name === "unit_cost",
      )
    )
      this.db.exec(
        "ALTER TABLE products ADD COLUMN unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost>=0)",
      );
    if (
      !this.all("PRAGMA table_info(devices)").some(
        (c) => c.name === "serial_missing",
      )
    )
      this.db.exec(
        "ALTER TABLE devices ADD COLUMN serial_missing INTEGER NOT NULL DEFAULT 0",
      );
    ensureFxColumns(this.db);
    if (
      !this.db
        .prepare("PRAGMA table_info(products)")
        .all()
        .some((c) => c.name === "consignment_only")
    )
      this.db.exec(
        "ALTER TABLE products ADD COLUMN consignment_only INTEGER NOT NULL DEFAULT 0",
      );
    const addColumn = (table, column, definition) => {
      if (
        !this.all(`PRAGMA table_info(${table})`).some((c) => c.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn("batches", "owner_id", "TEXT REFERENCES parties(id)");
    addColumn(
      "batches",
      "owner_unit_amount",
      "INTEGER NOT NULL DEFAULT 0 CHECK(owner_unit_amount>=0)",
    );
    addColumn(
      "documents",
      "expense_account_id",
      "TEXT REFERENCES expense_accounts(id)",
    );
    addColumn("parties", "active", "INTEGER NOT NULL DEFAULT 1");
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_batches_owner ON batches(owner_id,id) WHERE owner_id IS NOT NULL; CREATE INDEX IF NOT EXISTS idx_expense_account_totals ON documents(expense_account_id,date,total) WHERE kind='expense'; CREATE INDEX IF NOT EXISTS idx_current_reorder ON products((stock=0) DESC,sku,id) WHERE active=1 AND consignment_only=0 AND stock<=reorder_level; CREATE INDEX IF NOT EXISTS idx_current_receivables ON party_totals((debit-credit) DESC,party_id) WHERE account='receivables' AND debit>credit",
    );
    if (!this.setting("expenseAccountsReady"))
      this.transaction(() => {
        for (const name of [
          "Rent",
          "Utilities",
          "Food",
          "Other",
          "Salaries",
          "Transport",
          "Repairs",
          ...this.all(
            "SELECT DISTINCT category FROM documents WHERE kind='expense' AND category<>''",
          ).map((r) => r.category),
        ])
          this.run(
            "INSERT OR IGNORE INTO expense_accounts VALUES (?,?,?)",
            id(),
            name,
            now(),
          );
        this.db.exec(
          "UPDATE documents SET expense_account_id=(SELECT id FROM expense_accounts WHERE name=documents.category COLLATE NOCASE) WHERE kind='expense' AND expense_account_id IS NULL",
        );

        this.saveSetting("expenseAccountsReady", true);
      });
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL) STRICT",
    );
    this.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    // Cache mirrors durable sessions so worker reloads keep desktop/browser logins.
    this.sessions = new Map(
      this.all("SELECT token,user_id,expires_at FROM sessions").map((r) => [
        r.token,
        { id: r.user_id, expires: r.expires_at },
      ]),
    );
    this.backupBusy = false;
    this.run(
      "INSERT OR IGNORE INTO settings VALUES (?,?)",
      "store",
      JSON.stringify({
        name: "My electronics store",
        currency: "AFN",
        currencyLabel: "AF",
        taxEnabled: false,
        timezone: "Asia/Kabul",
        demo: false,
        language: "en",
      }),
    );
    this.run(
      "INSERT OR IGNORE INTO settings VALUES (?,?)",
      "backups",
      JSON.stringify({
        destinations: [],
        lastSuccess: null,
        retentionDays: 30,
      }),
    );
    if (!this.setting("dailyTotalsReady"))
      this.transaction(() => {
        this.db.exec(
          "DELETE FROM daily_totals; INSERT INTO daily_totals SELECT date,account,SUM(debit),SUM(credit) FROM journal GROUP BY date,account;",
        );
        this.saveSetting("dailyTotalsReady", true);
      });
    if (!this.setting("partyTotalsReady"))
      this.transaction(() => {
        this.db.exec(
          "DELETE FROM party_totals; INSERT INTO party_totals SELECT party_id,account,SUM(debit),SUM(credit) FROM journal WHERE party_id IS NOT NULL GROUP BY party_id,account;",
        );
        this.saveSetting("partyTotalsReady", true);
      });
    if (!this.one("SELECT value FROM sequences WHERE name='documents'"))
      this.run(
        "INSERT INTO sequences VALUES ('documents',?)",
        this.one("SELECT COUNT(*) n FROM documents").n,
      );
    if (!this.one("SELECT value FROM sequences WHERE name='sale_documents'")) {
      const sold = this.one(
        "SELECT COUNT(*) n FROM documents WHERE kind='sale'",
      ).n;
      this.run("INSERT INTO sequences VALUES ('sale_documents',?)", sold);
    }
    if (!this.setting("productSnapshotsReady"))
      this.transaction(() => {
        this.db.exec(
          "INSERT OR IGNORE INTO document_product_snapshots SELECT l.id,p.name,p.sku,p.brand,p.model,p.attributes,p.image,p.serialized FROM document_lines l JOIN products p ON p.id=l.product_id;",
        );
        this.saveSetting("productSnapshotsReady", true);
      });
    if (!this.setting("quantityOnlyStock"))
      this.transaction(() => {
        this.db.exec("UPDATE products SET serialized=0");
        this.db.exec("UPDATE document_product_snapshots SET serialized=0");
        this.saveSetting("quantityOnlyStock", true);
      });
    if (demo && !this.one("SELECT id FROM users LIMIT 1")) this.seed();
    migrateUnits(this);
  }
  all(sql, ...params) {
    return this.db.prepare(sql).all(...params);
  }
  one(sql, ...params) {
    return this.db.prepare(sql).get(...params);
  }
  run(sql, ...params) {
    return this.db.prepare(sql).run(...params);
  }
  setting(key) {
    return JSON.parse(
      this.one("SELECT value FROM settings WHERE key=?", key)?.value || "null",
    );
  }
  /** Store profile for UI/print, with legacy single-logo migrated to logo_left. */
  storeBill() {
    const store = { ...(this.setting("store") || {}) };
    if (!store.logo_left && store.logo) store.logo_left = store.logo;
    if (!store.logo && store.logo_left) store.logo = store.logo_left;
    return store;
  }
  saveSetting(key, value) {
    this.run(
      "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  transaction(fn) {
    const level = this.transactionLevel || 0;
    const savepoint = `vault_nested_${level}`;
    this.db.exec(level ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.transactionLevel = level + 1;
    try {
      const result = fn();
      this.db.exec(level ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.db.exec(
        level ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK",
      );
      throw error;
    } finally {
      this.transactionLevel = level;
    }
  }
  audit(user, action, entity, details = {}) {
    this.run(
      "INSERT INTO audit(user_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?)",
      user?.id || null,
      action,
      entity,
      JSON.stringify(details),
      now(),
    );
  }
  publicUser(user) {
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      permissions: JSON.parse(user.permissions),
    };
  }
  auth(token, permission) {
    if (!token || typeof token !== "string")
      throw new Error("SESSION_EXPIRED: Please sign in again.");
    let s = this.sessions.get(token);
    if (!s) {
      const row = this.one("SELECT * FROM sessions WHERE token=?", token);
      if (row) {
        s = { id: row.user_id, expires: row.expires_at };
        this.sessions.set(token, s);
      }
    }
    if (!s || s.expires < Date.now()) {
      if (s) {
        this.sessions.delete(token);
        this.run("DELETE FROM sessions WHERE token=?", token);
      }
      throw new Error("SESSION_EXPIRED: Please sign in again.");
    }
    const u = this.one("SELECT * FROM users WHERE id=? AND active=1", s.id);
    if (!u) {
      this.sessions.delete(token);
      this.run("DELETE FROM sessions WHERE token=?", token);
      throw new Error("SESSION_EXPIRED: User is disabled.");
    }
    s.expires = 253402300799000;
    this.run(
      "UPDATE sessions SET expires_at=? WHERE token=?",
      s.expires,
      token,
    );
    const user = this.publicUser(u);
    if (permission && !user.permissions.includes(permission))
      throw new Error(`Permission required: ${permission}`);
    return user;
  }
  session(user) {
    const token = randomBytes(32).toString("hex");
    const expires = 253402300799000;
    this.sessions.set(token, { id: user.id, expires });
    this.run(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)",
      token,
      user.id,
      expires,
    );
    return { token, user: this.publicUser(user) };
  }
  setup(data) {
    if (this.one("SELECT id FROM users LIMIT 1"))
      throw new Error("Store has already been set up.");
    const d = userSchema.parse({ ...data, role: "Owner" });
    const uid = id();
    this.transaction(() => {
      this.run(
        "INSERT INTO users VALUES (?,?,?,?,?,?,1,?)",
        uid,
        d.name,
        d.username,
        passwordHash(d.password),
        d.role,
        JSON.stringify(PERMISSIONS),
        now(),
      );
      this.saveSetting("store", {
        ...this.setting("store"),
        name: text.min(2).parse(data.storeName),
      });
      this.run(
        "INSERT INTO parties(id,kind,name,phone,email,address,credit_limit,walk_in,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        id(),
        "customer",
        "Walk-in customer",
        "",
        "",
        "",
        0,
        1,
        now(),
      );
    });
    return this.session(this.one("SELECT * FROM users WHERE id=?", uid));
  }
  login(data) {
    const name = z.string().max(60).parse(data.username).toLowerCase();
    const pass = z.string().max(128).parse(data.password);
    const u = this.one(
      "SELECT * FROM users WHERE username=? AND active=1",
      name,
    );
    if (!u || !passwordValid(pass, u.password)) {
      throw new Error("Incorrect username or password.");
    }
    this.audit(u, "Sign in", u.id);
    return this.session(u);
  }
  ledger(doc, rows) {
    const balance = rows.reduce((s, r) => s + (r[1] || 0) - (r[2] || 0), 0);
    if (balance !== 0) throw new Error("Unbalanced journal entry.");
    for (const [account, debit = 0, credit = 0, party = null] of rows) {
      if (debit || credit)
        this.run(
          "INSERT INTO journal VALUES (?,?,?,?,?,?,?)",
          id(),
          doc.id,
          account,
          party,
          debit,
          credit,
          doc.date,
        );
    }
  }
  document(kind, user, data = {}) {
    const prefixes = {
      sale: "SAL",
      purchase: "PUR",
      expense: "EXP",
      receipt: "RCT",
      payment: "PAY",
      sale_return: "SR",
      purchase_return: "PR",
      opening: "OPN",
      adjustment: "ADJ",
      owner: "OWN",
      consignment_receipt: "CNS",
      consignment_return: "CNR",
      consignment_payment: "CPO",
      consignment_recovery: "CPR",
    };
    const number =
      data.number ||
      (kind === "sale"
        ? `SAL-${this.one("UPDATE sequences SET value=value+1 WHERE name='sale_documents' RETURNING value").value}`
        : `${prefixes[kind]}-${String(this.one("UPDATE sequences SET value=value+1 WHERE name='documents' RETURNING value").value).padStart(6, "0")}`);
    const d = {
      id: id(),
      number,
      kind,
      date: data.date || today(),
      party_id: data.party_id || null,
      total: 0,
      paid: 0,
      cost: 0,
      discount: 0,
      note: "",
      category: "",
      original_id: null,
      due_date: null,
      request_key: id(),
      ...data,
    };
    d.date = d.date || today();
    if (d.date > today())
      throw new Error("Future transactions are not allowed.");
    const closed = this.setting("closedThrough");
    if (closed && d.date <= closed)
      throw new Error("This accounting period is closed.");
    this.run(
      "INSERT INTO documents(id,number,kind,party_id,date,total,paid,cost,discount,note,category,original_id,due_date,request_key,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      d.id,
      d.number,
      d.kind,
      d.party_id,
      d.date,
      d.total,
      d.paid,
      d.cost,
      d.discount,
      d.note,
      d.category,
      d.original_id,
      d.due_date,
      d.request_key,
      data.user_id || user.id,
      data.created_at || now(),
    );
    return d;
  }
  move(doc, product, quantity, cost) {
    const latest = this.one(
      "SELECT MAX(date) date FROM movements WHERE product_id=?",
      product.id,
    ).date;
    if (latest && doc.date < latest && doc.editDate !== doc.date)
      throw new Error(
        "Stock transactions must follow the most recent stock movement date for this product.",
      );
    this.run(
      "UPDATE products SET stock=stock+? WHERE id=?",
      quantity,
      product.id,
    );
    this.run(
      "INSERT INTO movements VALUES (?,?,?,?,?,?)",
      id(),
      doc.id,
      product.id,
      quantity,
      cost,
      doc.date,
    );
  }
  receive(product, line, doc) {
    const base = Math.floor(line.cost / line.quantity),
      remainder = line.cost % line.quantity,
      costs = [],
      unitAed = line.cost_aed || 0,
      rate = line.fx_rate || 0;
    if (line.quantity - remainder)
      costs.push({ qty: line.quantity - remainder, cost: base });
    if (remainder) costs.push({ qty: remainder, cost: base + 1 });
    if (product.serialized && line.quantity > 1000)
      throw new Error("Receive at most 1,000 individual devices per line.");
    if (line.units && line.units.length !== line.quantity)
      throw new Error("Enter details for each received device.");
    let unitOffset = 0;
    for (const c of costs) {
      const bid = id();
      this.run(
        "INSERT INTO batches(id,product_id,line_id,quantity,remaining,unit_cost,received_at) VALUES (?,?,?,?,?,?,?)",
        bid,
        product.id,
        line.id,
        c.qty,
        c.qty,
        c.cost,
        doc.created_at || `${doc.date}T${now().slice(11)}`,
      );
      this.run(
        "UPDATE batches SET cost_aed=?,fx_rate=? WHERE id=?",
        unitAed,
        rate,
        bid,
      );
      this.saveForeign("batches", bid, line);
      if (product.serialized)
        receiveUnits(
          this,
          product,
          bid,
          c.qty,
          line,
          doc.kind,
          line.units?.slice(unitOffset, unitOffset + c.qty),
          line._restoreUnits,
        );
      unitOffset += c.qty;
    }
    this.move(doc, product, line.quantity, line.cost);
  }
  consume(product, line, doc) {
    const latest = this.one(
      "SELECT MAX(date) date FROM movements WHERE product_id=?",
      product.id,
    )?.date;
    if (latest && doc.date < latest && doc.editDate !== doc.date)
      throw new Error(
        "Stock transactions must follow the most recent stock movement date for this product.",
      );
    if (product.serialized) return consumeUnits(this, product, line, doc);
    // Strict FIFO: oldest receipt first; rowid breaks same-timestamp ties.
    const batches = this.all(
      "SELECT * FROM batches WHERE product_id=? AND remaining>0 AND SUBSTR(received_at,1,10)<=? ORDER BY received_at ASC, rowid ASC",
      product.id,
      doc.date,
    );
    let remaining = line.quantity,
      cost = 0;
    for (const b of batches) {
      if (!remaining) break;
      const q = Math.min(remaining, b.remaining);
      if (b.owner_id && doc.kind !== "sale")
        throw new Error(
          "Return customer-owned stock through Customer resale instead of a stock adjustment.",
        );
      this.run("UPDATE batches SET remaining=remaining-? WHERE id=?", q, b.id);
      this.run(
        "INSERT INTO allocations VALUES (?,?,?,?,?,0)",
        id(),
        line.id,
        b.id,
        q,
        q * (b.owner_id ? b.owner_unit_amount : b.unit_cost),
      );
      cost += q * (b.owner_id ? b.owner_unit_amount : b.unit_cost);
      remaining -= q;
    }
    if (remaining) throw new Error(`Insufficient stock for ${product.name}.`);
    const ownerCost = this.one(
      "SELECT COALESCE(SUM(a.cost),0) n FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.line_id=? AND b.owner_id IS NOT NULL",
      line.id,
    ).n;
    this.move(doc, product, -line.quantity, -(cost - ownerCost));
    return cost;
  }
  existingRequest(user, key, kinds) {
    const doc = this.one(
      "SELECT id,kind,user_id FROM documents WHERE request_key=?",
      key,
    );
    if (!doc) return null;
    if (doc.user_id !== user.id || !kinds.includes(doc.kind))
      throw new Error("Request key is already used for another operation.");
    return doc;
  }
  currencies() {
    return this.setting("currencies") || DEFAULT_CURRENCIES;
  }
  customProductCategories() {
    const rows = this.setting("product_categories");
    return Array.isArray(rows)
      ? rows.filter((c) => typeof c === "string" && c.trim())
      : [];
  }
  productCategories() {
    const seen = new Set();
    const rows = [];
    for (const c of [
      ...BUILTIN_PRODUCT_CATEGORIES,
      ...this.customProductCategories(),
      ...this.all(
        "SELECT DISTINCT category FROM products WHERE active=1 AND category<>'' ORDER BY category COLLATE NOCASE",
      ).map((r) => r.category),
    ]) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      rows.push(c);
    }
    return rows;
  }
  rememberProductCategory(category) {
    const name = String(category || "").trim();
    if (!name || isBuiltinCategory(name)) return;
    const rows = this.customProductCategories();
    if (rows.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    if (rows.length >= 100) return;
    this.saveSetting("product_categories", [...rows, name]);
  }
  validateCurrency(currency, rate) {
    if (!this.currencies().some((c) => c.code === currency))
      throw new Error("Choose a saved currency.");
    if (currency === "AFN" && rate && rate !== 10000)
      throw new Error("The AFN conversion rate must be 1.");
  }
  saveForeign(table, recordId, data) {
    this.run(
      `UPDATE ${table} SET currency=?${table === "documents" ? "" : ",cost_foreign=?"} WHERE id=?`,
      ...(table === "documents"
        ? [data.currency || "AED", recordId]
        : [
            data.currency || "AED",
            data.cost_foreign ?? data.cost_aed ?? 0,
            recordId,
          ]),
    );
  }
  createProduct(user, data) {
    const d = productSchema.parse(data);
    this.validateCurrency(d.currency, d.fx_rate);
    if (d.minimum > d.price)
      throw new Error("Minimum price cannot exceed selling price.");
    if (d.cost_foreign && !d.fx_rate)
      throw new Error(
        "Enter the currency→AFN exchange rate used for this cost.",
      );
    if (d.fx_rate && !d.cost_foreign)
      throw new Error("Enter the supplier unit cost in the selected currency.");
    if (
      trackedCategory(d.category) &&
      d.serialized !== false &&
      d.opening_quantity > 1000
    )
      throw new Error("Receive at most 1,000 individual devices per entry.");
    // Cargo rent is always entered in AFN and added on top of converted unit cost.
    const cargo = d.cargo_rent || 0;
    const unitCost =
      d.cost_foreign && d.fx_rate
        ? afnFromAed(d.cost_foreign, d.fx_rate) + cargo
        : (d.unit_cost ?? 0);
    return this.transaction(() => {
      const pid = id();
      const productPhoto = saveProductPhoto(this, d);
      this.run(
        "INSERT INTO products(id,sku,barcode,name,brand,model,category,price,minimum,reorder_level,location,condition,warranty,attributes,serialized,image,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        pid,
        d.sku,
        d.barcode,
        d.name,
        d.brand,
        d.model,
        d.category,
        d.price,
        d.minimum,
        d.reorder_level,
        d.location,
        d.condition,
        d.warranty,
        JSON.stringify(d.attributes),
        trackedCategory(d.category) && d.serialized !== false ? 1 : 0,
        productPhoto,
        now(),
      );
      this.run(
        "UPDATE products SET unit_cost=?,cost_aed=?,fx_rate=?,cargo_rent=? WHERE id=?",
        unitCost,
        d.cost_aed || 0,
        d.fx_rate || 0,
        cargo,
        pid,
      );
      this.saveForeign("products", pid, d);
      if (d.opening_quantity) {
        if (!unitCost && unitCost !== 0)
          throw new Error("Enter the unit cost for opening stock.");
        if (d.cost_foreign && !d.fx_rate)
          throw new Error(
            "Enter the currency→AFN exchange rate for opening stock.",
          );
        this.adjust(user, {
          product_id: pid,
          quantity: d.opening_quantity,
          cost: unitCost,
          currency: d.currency,
          cost_foreign: d.cost_foreign,
          cost_aed: d.cost_aed || 0,
          fx_rate: d.fx_rate || 0,
          units: d.units,
          note: "Opening stock at product creation",
          opening: true,
          request_key: `product-opening-${pid}`,
        });
      }
      this.rememberProductCategory(d.category);
      this.audit(user, "Create product", pid, { name: d.name });
      return { id: pid };
    });
  }
  postTrade(user, input, identity = {}) {
    const d = docSchema.parse({
      ...input,
      lines: Array.isArray(input.lines)
        ? input.lines.map((l) => ({
            ...l,
            currency: l.currency || input.currency || "AED",
          }))
        : input.lines,
    });
    return this.transaction(() => {
      const previous = this.existingRequest(user, d.request_key, [d.kind]);
      if (previous) return this.getDocument(previous.id);
      if (d.kind === "sale" && !d.party_id)
        d.party_id = this.one("SELECT id FROM parties WHERE walk_in=1")?.id;
      const party = this.one(
        "SELECT * FROM parties WHERE id=?",
        d.party_id || "",
      );
      if (
        !party ||
        party.kind !== (d.kind === "sale" ? "customer" : "supplier")
      )
        throw new Error("Choose a valid customer or supplier.");
      if (d.discount)
        throw new Error("Apply discounts to individual invoice lines.");
      if (
        d.kind === "purchase" &&
        d.lines.some((l) => l.cost_foreign) &&
        !d.fx_rate
      )
        throw new Error(
          "Enter the currency→AFN exchange rate used for this purchase.",
        );
      if (d.kind === "purchase") this.validateCurrency(d.currency, d.fx_rate);
      let total = 0;
      for (const l of d.lines) {
        if (d.kind === "purchase") {
          if (l.currency !== d.currency)
            throw new Error("Line currency must match purchase currency.");
          this.validateCurrency(l.currency, l.fx_rate || d.fx_rate);
        }
        if (
          d.kind === "purchase" &&
          l.cost_foreign !== undefined &&
          d.fx_rate &&
          !l.cost_foreign &&
          l.price
        )
          throw new Error("Enter the unit cost in the selected currency.");
        if (d.kind === "purchase" && l.cost_foreign) {
          const expected = afnFromAed(l.cost_foreign, l.fx_rate || d.fx_rate);
          if (Math.abs(l.price - expected) > 1)
            throw new Error(
              "Purchase line AFN cost must match foreign cost × exchange rate.",
            );
          l.fx_rate = l.fx_rate || d.fx_rate;
        }
        // Cargo rent is AFN per unit (not converted from the purchase currency).
        const cargoAfn =
          d.kind === "purchase" && l.cargo_rent ? l.cargo_rent : 0;
        if (l.discount > l.price * l.quantity + cargoAfn * l.quantity)
          throw new Error("Discount exceeds line value.");
        total += l.price * l.quantity - l.discount + cargoAfn * l.quantity;
        l._cargo_afn = cargoAfn;
      }
      if (!Number.isSafeInteger(total) || total > 1e12)
        throw new Error("Invoice exceeds supported amount.");
      if (d.paid_foreign !== undefined) {
        this.validateCurrency(d.currency, d.fx_rate);
        if (!d.fx_rate)
          throw new Error("Enter the currency→AFN rate for this payment.");
        const converted = afnFromAed(d.paid_foreign, d.fx_rate);
        money.parse(converted);
        if (d.paid !== converted)
          throw new Error(
            "AFN payment must match the foreign payment × exchange rate.",
          );
      }
      if (d.paid > total) throw new Error("Payment exceeds invoice total.");
      if (party.walk_in && d.paid !== total)
        throw new Error("Walk-in sales must be paid in full.");
      if (d.due_date && d.due_date < (d.date || today()))
        throw new Error("Due date cannot be before the invoice date.");
      const doc = this.document(d.kind, user, { ...d, total, ...identity });
      if ((d.kind === "purchase" || d.paid_foreign !== undefined) && d.fx_rate)
        this.run(
          "UPDATE documents SET fx_rate=? WHERE id=?",
          d.fx_rate,
          doc.id,
        );
      if (d.kind === "purchase" || d.paid_foreign !== undefined)
        this.saveForeign("documents", doc.id, d);
      if (d.paid_foreign !== undefined)
        this.run(
          "UPDATE documents SET paid_foreign=? WHERE id=?",
          d.paid_foreign,
          doc.id,
        );
      let cost = 0;
      for (const l of d.lines) {
        const p = this.one(
          "SELECT * FROM products WHERE id=? AND active=1",
          l.product_id,
        );
        if (!p) throw new Error("Product is unavailable.");
        if (
          d.kind === "sale" &&
          l.price * l.quantity - l.discount < p.minimum * l.quantity &&
          user.role !== "Owner" &&
          user.role !== "Manager"
        )
          throw new Error(
            "Selling below the minimum price requires a manager.",
          );
        const cargoAfn = l._cargo_afn || 0;
        const line = {
          ...l,
          _restoreUnits: identity.unitRestore?.get(p.id),
          id: id(),
          cost:
            d.kind === "purchase"
              ? l.price * l.quantity - l.discount + cargoAfn * l.quantity
              : 0,
          cost_aed: d.kind === "purchase" ? l.cost_aed || 0 : 0,
          cargo_rent: d.kind === "purchase" ? l.cargo_rent || 0 : 0,
          fx_rate: d.kind === "purchase" ? l.fx_rate || d.fx_rate || 0 : 0,
        };
        this.run(
          "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost,discount,original_line_id,cost_aed,fx_rate) VALUES (?,?,?,?,?,?,?,NULL,?,?)",
          line.id,
          doc.id,
          p.id,
          l.quantity,
          l.price,
          line.cost,
          l.discount,
          line.cost_aed,
          line.fx_rate,
        );
        if (d.kind === "purchase") {
          this.run(
            "UPDATE document_lines SET cargo_rent=? WHERE id=?",
            line.cargo_rent,
            line.id,
          );
          this.saveForeign("document_lines", line.id, line);
        }
        if (d.kind === "sale") {
          line.cost = this.consume(p, line, doc);
          this.run(
            "UPDATE document_lines SET cost=? WHERE id=?",
            line.cost,
            line.id,
          );
        } else {
          this.receive(p, line, doc);
          this.saveForeign("products", p.id, line);
          const landedUnit =
            l.quantity > 0 ? Math.floor(line.cost / l.quantity) : l.price;
          this.run(
            "UPDATE products SET unit_cost=?,cost_aed=?,fx_rate=?,cargo_rent=? WHERE id=?",
            landedUnit,
            line.cost_aed,
            line.fx_rate,
            line.cargo_rent,
            p.id,
          );
        }
        cost += line.cost;
      }
      this.run("UPDATE documents SET cost=? WHERE id=?", cost, doc.id);
      if (d.kind === "sale") {
        const owed = consignmentCredits(this, doc.id);
        this.ledger(doc, [
          ["cash", d.paid, 0],
          ["receivables", total - d.paid, 0, party.id],
          ["sales", 0, total],
          ["cost_of_goods", cost, 0],
          ["inventory", 0, cost - owed.reduce((sum, r) => sum + r.amount, 0)],
          ...owed.map((r) => ["consignment_payables", 0, r.amount, r.owner_id]),
        ]);
      } else
        this.ledger(doc, [
          ["inventory", total, 0],
          ["cash", 0, d.paid],
          ["payables", 0, total - d.paid, party.id],
        ]);
      this.audit(user, `Post ${d.kind}`, doc.id, { number: doc.number, total });
      return this.getDocument(doc.id);
    });
  }
  mutateSale(user, input, action) {
    if (
      !user.permissions.includes("sales") ||
      !["Owner", "Manager"].includes(user.role)
    )
      throw new Error(
        "Editing and deleting invoices requires an owner or manager with sales permission.",
      );
    const d = z
      .object({
        id: z.string(),
        revision: z.number().int().min(0),
        request_key: z.string().min(8),
        confirmation: z.string().optional(),
      })
      .parse(input);
    return this.transaction(() => {
      const prior = this.one(
        "SELECT * FROM invoice_operations WHERE request_key=?",
        d.request_key,
      );
      if (prior) {
        if (prior.user_id !== user.id || prior.action !== action)
          throw new Error("Request key already used.");
        const result = JSON.parse(prior.result);
        if (result.id !== d.id)
          throw new Error("Request key already used for another invoice.");
        return result;
      }
      const old = this.getDocument(d.id);
      if (old.kind !== "sale")
        throw new Error("Only sale invoices can be edited or deleted here.");
      if (old.revision !== d.revision)
        throw new Error("This invoice changed. Reload it before continuing.");
      const closed = this.setting("closedThrough");
      if (closed && old.date <= closed)
        throw new Error("This accounting period is closed.");
      if (
        this.one("SELECT id FROM documents WHERE original_id=? LIMIT 1", old.id)
      )
        throw new Error(
          "This invoice has linked returns. Use the return records to preserve its stock and accounting history; editing or hard deletion is blocked.",
        );
      if (
        this.one(
          "SELECT id FROM payment_allocations WHERE invoice_id=? LIMIT 1",
          old.id,
        )
      )
        throw new Error(
          "This invoice has later payment receipts. Resolve those linked receipts before editing or hard deletion.",
        );
      if (
        this.one(
          "SELECT id FROM consignment_payout_allocations WHERE sale_id=? LIMIT 1",
          old.id,
        )
      )
        throw new Error(
          "This invoice has settled customer-owner proceeds. Use a sale return to preserve the owner ledger.",
        );
      // Restore the exact cost batches, then remove the original posting in one transaction.
      for (const line of old.lines) {
        const allocations = this.all(
          "SELECT * FROM allocations WHERE line_id=?",
          line.id,
        );
        const tracked = this.one(
          "SELECT serialized FROM products WHERE id=?",
          line.product_id,
        )?.serialized;
        const historicalDevices = this.one(
          "SELECT 1 FROM unit_lines WHERE line_id=? LIMIT 1",
          line.id,
        );
        if (tracked && !historicalDevices && action === "edit")
          throw new Error(
            "This older quantity invoice has no device identities. Return it and create a new device sale instead.",
          );
        for (const allocation of allocations) {
          if (allocation.returned)
            throw new Error("Returned allocations cannot be changed.");
          this.run(
            "UPDATE batches SET remaining=remaining+? WHERE id=?",
            allocation.quantity,
            allocation.batch_id,
          );
          if (tracked && !historicalDevices)
            receiveUnits(
              this,
              this.one("SELECT * FROM products WHERE id=?", line.product_id),
              allocation.batch_id,
              allocation.quantity,
              null,
              "legacy_reversal",
            );
        }
        this.run(
          "UPDATE devices SET status='in_stock',sale_line_id=NULL WHERE sale_line_id=?",
          line.id,
        );
        this.run(
          "UPDATE products SET stock=stock+? WHERE id=?",
          line.quantity,
          line.product_id,
        );
        this.run(
          "UPDATE inventory_units SET status='available',sale_line_id=NULL WHERE sale_line_id=?",
          line.id,
        );
        this.run("DELETE FROM unit_lines WHERE line_id=?", line.id);
        this.run("DELETE FROM allocations WHERE line_id=?", line.id);
        this.run(
          "DELETE FROM document_product_snapshots WHERE line_id=?",
          line.id,
        );
      }
      this.run("DELETE FROM journal WHERE document_id=?", old.id);
      this.run("DELETE FROM movements WHERE document_id=?", old.id);
      this.run("DELETE FROM invoice_revisions WHERE document_id=?", old.id);
      this.run("DELETE FROM document_lines WHERE document_id=?", old.id);
      this.run("DELETE FROM documents WHERE id=?", old.id);
      let result = { id: old.id, number: old.number, deleted: true };
      if (action === "edit") {
        const updated = this.postTrade(
          user,
          { ...input, kind: "sale", request_key: old.request_key },
          {
            id: old.id,
            number: old.number,
            created_at: old.created_at,
            user_id: old.user_id,
            editDate: old.date,
          },
        );
        this.run(
          "INSERT INTO invoice_revisions VALUES (?,?)",
          old.id,
          old.revision + 1,
        );
        result = {
          id: updated.id,
          number: updated.number,
          revision: old.revision + 1,
        };
      }
      // Keep only an administrative audit reference after a hard deletion.
      this.audit(
        user,
        action === "edit" ? "Edit sale invoice" : "Hard delete sale invoice",
        old.id,
        {
          number: old.number,
          revision: old.revision,
          ...(action === "edit"
            ? {
                previous_total: old.total,
                total: this.getDocument(old.id).total,
              }
            : {}),
        },
      );
      this.run(
        "INSERT INTO invoice_operations VALUES (?,?,?,?)",
        d.request_key,
        user.id,
        action,
        JSON.stringify(result),
      );
      return result;
    });
  }
  mutatePurchase(user, input, action) {
    if (
      !user.permissions.includes("purchases") ||
      !["Owner", "Manager"].includes(user.role)
    )
      throw new Error(
        "Editing and deleting purchases requires an owner or manager with purchases permission.",
      );
    const d = z
      .object({
        id: z.string(),
        revision: z.number().int().min(0),
        request_key: z.string().min(8),
        confirmation: z.string().optional(),
      })
      .parse(input);
    return this.transaction(() => {
      const prior = this.one(
        "SELECT * FROM invoice_operations WHERE request_key=?",
        d.request_key,
      );
      if (prior) {
        if (prior.user_id !== user.id || prior.action !== action)
          throw new Error("Request key already used.");
        const result = JSON.parse(prior.result);
        if (result.id !== d.id)
          throw new Error("Request key already used for another invoice.");
        return result;
      }
      const old = this.getDocument(d.id);
      if (old.kind !== "purchase")
        throw new Error(
          "Only purchase invoices can be edited or deleted here.",
        );
      if (old.category === "Opening balance")
        throw new Error("Opening balance purchases cannot be edited here.");
      if (old.revision !== d.revision)
        throw new Error("This invoice changed. Reload it before continuing.");
      const closed = this.setting("closedThrough");
      if (closed && old.date <= closed)
        throw new Error("This accounting period is closed.");
      if (
        this.one("SELECT id FROM documents WHERE original_id=? LIMIT 1", old.id)
      )
        throw new Error(
          "This invoice has linked returns. Use the return records to preserve its stock and accounting history; editing or hard deletion is blocked.",
        );
      if (
        this.one(
          "SELECT id FROM payment_allocations WHERE invoice_id=? LIMIT 1",
          old.id,
        )
      )
        throw new Error(
          "This invoice has later supplier payments. Resolve those linked payments before editing or hard deletion.",
        );
      const unitRestore = new Map();
      // Reverse received stock only while every batch from this purchase is still intact.
      for (const line of old.lines) {
        const batches = this.all(
          "SELECT * FROM batches WHERE line_id=? ORDER BY rowid",
          line.id,
        );
        if (!batches.length)
          throw new Error(
            `Stock batches for ${line.name || "a product"} are missing.`,
          );
        const qty = batches.reduce((s, b) => s + b.quantity, 0);
        const remaining = batches.reduce((s, b) => s + b.remaining, 0);
        if (qty !== line.quantity || remaining !== qty)
          throw new Error(
            "Some of this purchase has already been sold. Return that stock first, or keep the original purchase unchanged.",
          );
        for (const b of batches) {
          if (
            this.one(
              "SELECT 1 FROM unit_lines e JOIN inventory_units u ON u.id=e.unit_id WHERE u.batch_id=? AND e.line_id<>? LIMIT 1",
              b.id,
              line.id,
            )
          )
            throw new Error(
              "Device history exists for this purchase. Use purchase returns instead.",
            );
          unitRestore.set(line.product_id, [
            ...(unitRestore.get(line.product_id) || []),
            ...this.all(
              "SELECT * FROM inventory_units WHERE batch_id=? ORDER BY rowid",
              b.id,
            ),
          ]);
          this.run(
            "DELETE FROM unit_lines WHERE unit_id IN (SELECT id FROM inventory_units WHERE batch_id=?)",
            b.id,
          );
          this.run("DELETE FROM inventory_units WHERE batch_id=?", b.id);
          this.run("DELETE FROM batches WHERE id=?", b.id);
        }
        const stockUpdate = this.run(
          "UPDATE products SET stock=stock-? WHERE id=? AND stock>=?",
          line.quantity,
          line.product_id,
          line.quantity,
        );
        if (stockUpdate.changes !== 1)
          throw new Error(
            `Cannot reverse purchase stock for ${line.name || "a product"}.`,
          );
        this.run(
          "DELETE FROM document_product_snapshots WHERE line_id=?",
          line.id,
        );
      }
      this.run("DELETE FROM journal WHERE document_id=?", old.id);
      this.run("DELETE FROM movements WHERE document_id=?", old.id);
      this.run("DELETE FROM invoice_revisions WHERE document_id=?", old.id);
      this.run("DELETE FROM document_lines WHERE document_id=?", old.id);
      this.run("DELETE FROM documents WHERE id=?", old.id);
      let result = { id: old.id, number: old.number, deleted: true };
      if (action === "edit") {
        const updated = this.postTrade(
          user,
          { ...input, kind: "purchase", request_key: old.request_key },
          {
            id: old.id,
            number: old.number,
            created_at: old.created_at,
            user_id: old.user_id,
            editDate: old.date,
            unitRestore,
          },
        );
        this.run(
          "INSERT INTO invoice_revisions VALUES (?,?)",
          old.id,
          old.revision + 1,
        );
        result = {
          id: updated.id,
          number: updated.number,
          revision: old.revision + 1,
        };
      }
      this.audit(
        user,
        action === "edit"
          ? "Edit purchase invoice"
          : "Hard delete purchase invoice",
        old.id,
        {
          number: old.number,
          revision: old.revision,
          ...(action === "edit"
            ? {
                previous_total: old.total,
                total: this.getDocument(old.id).total,
              }
            : {}),
        },
      );
      this.run(
        "INSERT INTO invoice_operations VALUES (?,?,?,?)",
        d.request_key,
        user.id,
        action,
        JSON.stringify(result),
      );
      return result;
    });
  }
  getDocument(did) {
    const doc = this.one(
      "SELECT d.*,p.name party_name,p.phone party_phone,u.name user_name,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned FROM documents d LEFT JOIN parties p ON p.id=d.party_id LEFT JOIN users u ON u.id=d.user_id WHERE d.id=?",
      did,
    );
    if (!doc) throw new Error("Document not found.");
    doc.currency_country = this.currencies().find(
      (c) => c.code === doc.currency,
    )?.country;
    if (doc.party_id) {
      try {
        const party = this.partyBalance(doc.party_id);
        const invoiceDue = Math.max(
          0,
          doc.total - (doc.paid || 0) - (doc.returned || 0),
        );
        doc.party_balance = party.balance || 0;
        if (doc.kind === "sale") {
          doc.previous_balance = Math.max(0, doc.party_balance - invoiceDue);
          doc.new_balance = doc.party_balance;
        }
      } catch {
        doc.party_balance = 0;
      }
    }
    doc.lines = this.all(
      "SELECT l.*,COALESCE(s.name,p.name) name,COALESCE(s.sku,p.sku) sku,COALESCE(s.brand,p.brand) brand,COALESCE(s.model,p.model) model,COALESCE(s.attributes,p.attributes) attributes,COALESCE(s.image,p.image) image,p.category,COALESCE((SELECT SUM(quantity) FROM document_lines r WHERE r.original_line_id=l.id),0) returned_quantity FROM document_lines l JOIN products p ON p.id=l.product_id LEFT JOIN document_product_snapshots s ON s.line_id=l.id WHERE document_id=?",
      did,
    ).map((line) => ({
      ...line,
      attributes:
        typeof line.attributes === "string"
          ? JSON.parse(line.attributes || "{}")
          : line.attributes || {},
    }));
    for (const line of doc.lines)
      line.units = documentUnits(this, line, doc.kind);
    if (doc.kind === "purchase")
      for (const line of doc.lines)
        line.return_batches = this.all(
          "SELECT remaining,unit_cost FROM batches WHERE line_id=? AND remaining>0 ORDER BY received_at ASC,rowid ASC",
          line.id,
        );
    if (doc.kind === "consignment_receipt")
      for (const line of doc.lines)
        line.owner_unit_amount =
          this.one(
            "SELECT owner_unit_amount FROM batches WHERE line_id=?",
            line.id,
          )?.owner_unit_amount || 0;
    doc.revision =
      this.one(
        "SELECT revision FROM invoice_revisions WHERE document_id=?",
        did,
      )?.revision || 0;
    doc.journal = this.all("SELECT * FROM journal WHERE document_id=?", did);
    return doc;
  }
  partyBalance(pid) {
    const p = this.one("SELECT * FROM parties WHERE id=?", pid);
    if (!p) throw new Error("Contact not found.");
    const account = p.kind === "customer" ? "receivables" : "payables";
    const net = this.one(
      "SELECT COALESCE(SUM(debit-credit),0) n FROM party_totals WHERE party_id=? AND account=?",
      pid,
      account,
    ).n;
    return { ...p, balance: (p.kind === "customer" ? net : -net) || 0 };
  }
  createParty(user, data) {
    const d = z
      .object({
        kind: z.enum(["customer", "supplier"]),
        name: text.min(2),
        phone: text.default(""),
        email: text.default(""),
        address: text.default(""),
        opening_balance: money.default(0),
        opening_date: date.optional(),
        request_key: z.string().min(8).optional(),
      })
      .parse(data);
    return this.transaction(() => {
      if (d.opening_balance && user.role !== "Owner")
        throw new Error("Only the owner can enter opening balances.");
      const pid = id();
      this.run(
        "INSERT INTO parties(id,kind,name,phone,email,address,credit_limit,walk_in,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        pid,
        d.kind,
        d.name,
        d.phone,
        d.email,
        d.address,
        0,
        0,
        now(),
      );
      if (d.opening_balance) {
        const requestKey = d.request_key || `party-opening-${pid}`;
        const prev = this.existingRequest(user, requestKey, [
          "sale",
          "purchase",
        ]);
        if (!prev) {
          const doc = this.document(
            d.kind === "customer" ? "sale" : "purchase",
            user,
            {
              party_id: pid,
              total: d.opening_balance,
              date: d.opening_date,
              note: "Opening balance brought forward",
              request_key: requestKey,
              category: "Opening balance",
            },
          );
          this.ledger(
            doc,
            d.kind === "customer"
              ? [
                  ["receivables", d.opening_balance, 0, pid],
                  ["equity", 0, d.opening_balance],
                ]
              : [
                  ["equity", d.opening_balance, 0],
                  ["payables", 0, d.opening_balance, pid],
                ],
          );
          this.audit(user, "Enter opening balance", doc.id, {
            party: d.name,
            amount: d.opening_balance,
          });
        }
      }
      this.audit(user, "Create contact", pid, { name: d.name });
      return {
        id: pid,
        kind: d.kind,
        name: d.name,
        phone: d.phone,
        email: d.email,
        address: d.address,
        balance: d.opening_balance || 0,
        walk_in: 0,
      };
    });
  }
  updateParty(user, data) {
    const d = z
      .object({
        id: z.string(),
        opening: z.object({ request_key: z.string().min(8), amount: money, date }).optional(),
        name: text.min(2),
        phone: text.default(""),
        email: text.default(""),
        address: text.default(""),
      })
      .parse(data);
    return this.transaction(() => {
      const p = this.one("SELECT * FROM parties WHERE id=?", d.id);
      if (!p || !p.active) throw new Error("Contact not found.");
      if (p.walk_in) throw new Error("The walk-in customer cannot be edited.");
      if (d.opening) {
        if (user.role !== "Owner") throw new Error("Only the owner can edit opening balances.");
        const o = d.opening;
        const old = this.one("SELECT * FROM documents WHERE request_key=?", o.request_key);
        if (old && (old.party_id !== p.id || old.category !== "Opening balance"))
          throw new Error("Opening balance does not belong to this contact.");
        if (!old && this.one("SELECT id FROM documents WHERE party_id=? AND category='Opening balance'", p.id))
          throw new Error("Reload the contact before editing its opening balance.");
        const closed = this.setting("closedThrough");
        if (o.date > today()) throw new Error("Future transactions are not allowed.");
        if (closed && (o.date <= closed || (old && old.date <= closed)))
          throw new Error("This accounting period is closed.");
        if (old && (old.paid > 0 || this.one("SELECT id FROM payment_allocations WHERE invoice_id=? LIMIT 1", old.id) || this.one("SELECT id FROM documents WHERE original_id=? LIMIT 1", old.id)))
          throw new Error("This opening balance has linked payments or returns and cannot be edited.");
        let doc = old;
        if (old) {
          this.run("DELETE FROM journal WHERE document_id=?", old.id);
          this.run("UPDATE documents SET total=?,date=? WHERE id=?", o.amount, o.date, old.id);
          doc = { ...old, total: o.amount, date: o.date };
        } else if (o.amount > 0) {
          doc = this.document(p.kind === "customer" ? "sale" : "purchase", user, {
            party_id: p.id, total: o.amount, date: o.date, request_key: o.request_key,
            note: "Opening balance brought forward", category: "Opening balance",
          });
        }
        if (doc && o.amount > 0) this.ledger(doc, p.kind === "customer"
          ? [["receivables", o.amount, 0, p.id], ["equity", 0, o.amount]]
          : [["equity", o.amount, 0], ["payables", 0, o.amount, p.id]]);
        this.audit(user, "Edit opening balance", p.id, { previous: old?.total || 0, amount: o.amount });
      }
      this.run(
        "UPDATE parties SET name=?,phone=?,email=?,address=? WHERE id=?",
        d.name,
        d.phone,
        d.email,
        d.address,
        d.id,
      );
      this.audit(user, "Update contact", d.id, { name: d.name });
      return { id: d.id };
    });
  }
  deleteParty(user, data) {
    const d = z.object({ id: z.string() }).parse(data);
    return this.transaction(() => {
      const p = this.partyBalance(d.id);
      if (p.walk_in) throw new Error("The walk-in customer cannot be deleted.");
      if (!p.active) return { id: p.id };
      if (p.balance !== 0)
        throw new Error(
          p.kind === "customer"
            ? "This customer still has a balance. You cannot delete them until the balance is 0."
            : "This supplier still has a balance. You cannot delete them until the balance is 0.",
        );
      if (p.kind === "customer") {
        const owed = ownerBalance(this, p.id);
        if (owed !== 0)
          throw new Error(
            "This customer still has a customer-resale balance. Settle owner proceeds before deleting.",
          );
        const custody = this.one(
          "SELECT COALESCE(SUM(remaining),0) n FROM batches WHERE owner_id=?",
          p.id,
        ).n;
        if (custody > 0)
          throw new Error(
            "This customer still has unsold resale stock. Hand it back or sell it before deleting.",
          );
      }
      this.run("UPDATE parties SET active=0 WHERE id=?", p.id);
      this.audit(user, "Delete contact", p.id, {
        name: p.name,
        kind: p.kind,
      });
      return { id: p.id };
    });
  }
  payment(user, input) {
    const d = z
      .object({
        party_id: z.string(),
        amount: money.refine((n) => n > 0),
        amount_foreign: money.refine((n) => n > 0).optional(),
        currency: currencyFields.currency.optional(),
        fx_rate: fxRate.optional(),
        date: date.optional(),
        note: text.default(""),
        request_key: z.string().min(8),
      })
      .parse(input);
    return this.transaction(() => {
      const prev = this.existingRequest(user, d.request_key, [
        "receipt",
        "payment",
      ]);
      if (prev) return this.getDocument(prev.id);
      const p = this.partyBalance(d.party_id);
      if (d.amount_foreign !== undefined) {
        this.validateCurrency(d.currency, d.fx_rate);
        if (!d.fx_rate)
          throw new Error(
            "Enter the currency→AFN exchange rate for this payment.",
          );
        const converted = afnFromAed(d.amount_foreign, d.fx_rate);
        money.parse(converted);
        if (converted !== d.amount)
          throw new Error(
            "AFN payment must match foreign amount × exchange rate.",
          );
      }
      if (d.amount > p.balance)
        throw new Error("Payment exceeds the outstanding balance.");
      const kind = p.kind === "customer" ? "receipt" : "payment";
      const doc = this.document(kind, user, {
        ...d,
        total: d.amount,
        paid: d.amount,
      });
      if (d.amount_foreign !== undefined) {
        this.saveForeign("documents", doc.id, d);
        this.run(
          "UPDATE documents SET paid_foreign=?,fx_rate=? WHERE id=?",
          d.amount_foreign,
          d.fx_rate,
          doc.id,
        );
      }
      let rest = d.amount;
      const invoices = this.all(
        `SELECT d.*,d.total-d.paid-COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) outstanding FROM documents d WHERE party_id=? AND kind=? ORDER BY date,id`,
        p.id,
        p.kind === "customer" ? "sale" : "purchase",
      );
      for (const inv of invoices) {
        if (inv.date > doc.date) continue;
        const amount = Math.min(rest, Math.max(0, inv.outstanding));
        if (amount) {
          this.run(
            "UPDATE documents SET paid=paid+? WHERE id=?",
            amount,
            inv.id,
          );
          this.run(
            "INSERT INTO payment_allocations VALUES (?,?,?,?)",
            id(),
            doc.id,
            inv.id,
            amount,
          );
          rest -= amount;
        }
      }
      if (rest) throw new Error("Payment could not be allocated.");
      this.ledger(
        doc,
        p.kind === "customer"
          ? [
              ["cash", d.amount, 0],
              ["receivables", 0, d.amount, p.id],
            ]
          : [
              ["payables", d.amount, 0, p.id],
              ["cash", 0, d.amount],
            ],
      );
      this.audit(user, "Record payment", doc.id, { amount: d.amount });
      return this.getDocument(doc.id);
    });
  }
  deletePayment(user, input) {
    if (
      !user.permissions.includes("finance") ||
      !["Owner", "Manager"].includes(user.role)
    )
      throw new Error(
        "Deleting payment records requires an owner or manager with finance permission.",
      );
    const d = z
      .object({
        id: z.string(),
        revision: z.number().int().min(0),
        request_key: z.string().min(8),
        confirmation: z.string().optional(),
      })
      .parse(input);
    return this.transaction(() => {
      const prior = this.one(
        "SELECT * FROM invoice_operations WHERE request_key=?",
        d.request_key,
      );
      if (prior) {
        if (prior.user_id !== user.id || prior.action !== "payment_delete")
          throw new Error("Request key already used.");
        const result = JSON.parse(prior.result);
        if (result.id !== d.id)
          throw new Error("Request key already used for another payment.");
        return result;
      }
      const old = this.getDocument(d.id);
      const ownerSettlement = [
        "consignment_payment",
        "consignment_recovery",
      ].includes(old.kind);
      if (!["receipt", "payment"].includes(old.kind) && !ownerSettlement)
        throw new Error(
          "Only customer receipts, supplier payments, and owner settlements can be deleted here.",
        );
      if (old.revision !== d.revision)
        throw new Error("This payment changed. Reload it before continuing.");
      const closed = this.setting("closedThrough");
      if (closed && old.date <= closed)
        throw new Error("This accounting period is closed.");
      if (ownerSettlement) {
        this.run(
          "DELETE FROM consignment_payout_allocations WHERE payment_id=?",
          old.id,
        );
      } else {
        const allocations = this.all(
          "SELECT * FROM payment_allocations WHERE payment_id=?",
          old.id,
        );
        for (const allocation of allocations) {
          const reversed = this.run(
            "UPDATE documents SET paid=paid-? WHERE id=? AND paid>=?",
            allocation.amount,
            allocation.invoice_id,
            allocation.amount,
          );
          if (reversed.changes !== 1)
            throw new Error(
              "Could not reverse a linked invoice payment. Reload and try again.",
            );
        }
        this.run("DELETE FROM payment_allocations WHERE payment_id=?", old.id);
      }
      this.run("DELETE FROM invoice_revisions WHERE document_id=?", old.id);
      this.run("DELETE FROM journal WHERE document_id=?", old.id);
      this.run("DELETE FROM documents WHERE id=?", old.id);
      const result = { id: old.id, number: old.number, deleted: true };
      this.audit(user, "Hard delete payment", old.id, {
        number: old.number,
        kind: old.kind,
        amount: old.total,
      });
      this.run(
        "INSERT INTO invoice_operations VALUES (?,?,?,?)",
        d.request_key,
        user.id,
        "payment_delete",
        JSON.stringify(result),
      );
      return result;
    });
  }
  expenseAccounts(input = {}) {
    const range = this.dateRange(input);
    return {
      ...range,
      rows: this.all(
        `SELECT a.id,a.name,
      COALESCE(SUM(CASE WHEN d.date BETWEEN ? AND ? THEN d.total ELSE 0 END),0) period_total,
      COALESCE(SUM(d.total),0) lifetime_total
      FROM expense_accounts a LEFT JOIN documents d ON d.expense_account_id=a.id AND d.kind='expense'
      GROUP BY a.id ORDER BY a.name COLLATE NOCASE`,
        range.from,
        range.to,
      ),
    };
  }
  expense(user, input) {
    const d = z
      .object({
        amount: money.refine((n) => n > 0),
        category: text.optional(),
        account_id: z.string().optional(),
        note: text.min(2),
        date: date.optional(),
        request_key: z.string().min(8),
      })
      .parse(input);
    return this.transaction(() => {
      const prev = this.existingRequest(user, d.request_key, ["expense"]);
      if (prev) return this.getDocument(prev.id);
      const account = d.account_id
        ? this.one("SELECT * FROM expense_accounts WHERE id=?", d.account_id)
        : this.one(
            "SELECT * FROM expense_accounts WHERE name=? COLLATE NOCASE",
            d.category || "",
          );
      if (!account) throw new Error("Choose a valid expense account.");
      const doc = this.document("expense", user, {
        ...d,
        total: d.amount,
        paid: d.amount,
        category: account.name,
      });
      this.run(
        "UPDATE documents SET expense_account_id=? WHERE id=?",
        account.id,
        doc.id,
      );
      this.ledger(doc, [
        ["expenses", d.amount, 0],
        ["cash", 0, d.amount],
      ]);
      this.audit(user, "Record expense", doc.id, {
        amount: d.amount,
        category: d.category,
      });
      return this.getDocument(doc.id);
    });
  }
  expenseUpdate(user, input) {
    const d = z
      .object({
        id: z.string().min(1),
        amount: money.refine((n) => n > 0),
        category: text.optional(),
        account_id: z.string().optional(),
        note: text.min(2),
        date: date.optional(),
      })
      .parse(input);
    return this.transaction(() => {
      const old = this.one("SELECT * FROM documents WHERE id=?", d.id);
      if (!old || old.kind !== "expense") throw new Error("Expense not found.");
      const closed = this.setting("closedThrough");
      if (closed && (old.date <= closed || (d.date && d.date <= closed)))
        throw new Error("This accounting period is closed.");
      const account = d.account_id
        ? this.one("SELECT * FROM expense_accounts WHERE id=?", d.account_id)
        : this.one(
            "SELECT * FROM expense_accounts WHERE name=? COLLATE NOCASE",
            d.category || "",
          );
      if (!account) throw new Error("Choose a valid expense account.");
      const date = d.date || old.date;
      this.run("DELETE FROM journal WHERE document_id=?", old.id);
      this.run(
        "UPDATE documents SET date=?, total=?, paid=?, note=?, category=?, expense_account_id=? WHERE id=?",
        date,
        d.amount,
        d.amount,
        d.note,
        account.name,
        account.id,
        old.id,
      );
      const doc = { id: old.id, date };
      this.ledger(doc, [
        ["expenses", d.amount, 0],
        ["cash", 0, d.amount],
      ]);
      this.audit(user, "Update expense", old.id, {
        amount: d.amount,
        category: account.name,
      });
      return this.getDocument(old.id);
    });
  }
  returnTrade(user, input) {
    const d = z
      .object({
        original_id: z.string(),
        lines: z
          .array(
            z.object({
              line_id: z.string(),
              unit_ids: unitFields.unit_ids,
              quantity: positive,
            }),
          )
          .min(1),
        refund_foreign: money.optional(),
        refund_currency: currencyFields.currency.optional(),
        refund_rate: fxRate.optional(),
        note: text.min(2),
        request_key: z.string().min(8),
        date: date.optional(),
      })
      .parse(input);
    return this.transaction(() => {
      const prev = this.existingRequest(user, d.request_key, [
        "sale_return",
        "purchase_return",
      ]);
      if (prev) return this.getDocument(prev.id);
      const original = this.getDocument(d.original_id);
      if (!["sale", "purchase"].includes(original.kind))
        throw new Error("Only sales or purchases can be returned.");
      const kind = original.kind === "sale" ? "sale_return" : "purchase_return";
      if (new Set(d.lines.map((l) => l.line_id)).size !== d.lines.length)
        throw new Error("Duplicate return line.");
      let total = 0,
        cost = 0;
      const ownerReversals = new Map();
      const prepared = d.lines.map((l) => {
        const ol = original.lines.find((x) => x.id === l.line_id);
        if (!ol || l.quantity > ol.quantity - ol.returned_quantity)
          throw new Error("Return quantity exceeds the remaining quantity.");
        const value = ol.price * ol.quantity - ol.discount;
        const before = Math.floor((value * ol.returned_quantity) / ol.quantity),
          after = Math.floor(
            (value * (ol.returned_quantity + l.quantity)) / ol.quantity,
          );
        let amount = after - before;
        const selectedUnits = returnSelection(this, original, ol, l);
        if (original.kind === "purchase" && selectedUnits)
          amount = selectedUnits.reduce((n, u) => n + u.unit_cost, 0);
        else if (original.kind === "purchase") {
          let remaining = l.quantity;
          amount = 0;
          const batches = this.all(
            "SELECT b.* FROM batches b WHERE b.line_id=? AND b.remaining>0 ORDER BY b.received_at ASC, b.rowid ASC",
            ol.id,
          );
          for (const b of batches) {
            const q = Math.min(remaining, b.remaining);
            amount += q * b.unit_cost;
            remaining -= q;
            if (!remaining) break;
          }
          if (remaining)
            throw new Error("Cannot return items that have already been sold.");
        }
        total += amount;
        return { ...l, original: ol, amount };
      });
      const outstanding = original.total - original.returned - original.paid;
      const creditReduction = Math.min(total, Math.max(0, outstanding));
      const refund = total - creditReduction;
      if (d.refund_foreign !== undefined) {
        this.validateCurrency(d.refund_currency, d.refund_rate);
        if (!d.refund_rate)
          throw new Error("Enter the currency→AFN refund rate.");
        if (afnFromAed(d.refund_foreign, d.refund_rate) !== refund)
          throw new Error(
            "Converted refund must equal the cash refund due after reducing the unpaid balance. Adjust the amount/rate or refund in AFN.",
          );
      }

      const doc = this.document(kind, user, {
        ...d,
        party_id: original.party_id,
        total,
        paid: refund,
      });
      this.saveForeign("documents", doc.id, original);
      if (original.fx_rate)
        this.run(
          "UPDATE documents SET fx_rate=? WHERE id=?",
          original.fx_rate,
          doc.id,
        );
      if (d.refund_foreign !== undefined)
        this.run(
          "UPDATE documents SET paid_foreign=?,currency=?,fx_rate=? WHERE id=?",
          d.refund_foreign,
          d.refund_currency,
          d.refund_rate,
          doc.id,
        );
      for (const r of prepared) {
        const ol = r.original,
          p = this.one("SELECT * FROM products WHERE id=?", ol.product_id),
          lid = id();
        let lineCost = 0,
          lineOwnerCost = 0;
        this.run(
          "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost,discount,original_line_id) VALUES (?,?,?,?,?,?,?,?)",
          lid,
          doc.id,
          p.id,
          r.quantity,
          ol.price,
          0,
          ol.price * r.quantity - r.amount,
          ol.id,
        );
        this.saveForeign("document_lines", lid, ol);
        this.run(
          "UPDATE document_lines SET cost_aed=?,fx_rate=? WHERE id=?",
          ol.cost_aed || 0,
          ol.fx_rate || 0,
          lid,
        );
        const exact = returnUnits(this, p, original, ol, r, { id: lid }, doc);
        if (exact) {
          lineCost = exact.cost;
          lineOwnerCost = exact.ownerCost;
          for (const [owner, amount] of exact.owners)
            ownerReversals.set(
              owner,
              (ownerReversals.get(owner) || 0) + amount,
            );
        } else if (kind === "sale_return") {
          let remaining = r.quantity;
          // Undo sale allocations in the same FIFO order they were consumed.
          const allocations = this.all(
            "SELECT a.*,b.unit_cost,b.owner_id,b.owner_unit_amount FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.line_id=? AND a.returned<a.quantity ORDER BY a.rowid ASC",
            ol.id,
          );
          for (const a of allocations) {
            if (!remaining) break;
            const q = Math.min(remaining, a.quantity - a.returned);
            this.run(
              "UPDATE allocations SET returned=returned+? WHERE id=?",
              q,
              a.id,
            );
            this.run(
              "UPDATE batches SET remaining=remaining+? WHERE id=?",
              q,
              a.batch_id,
            );
            if (p.serialized)
              receiveUnits(this, p, a.batch_id, q, { id: lid }, kind);
            const restored =
              q * (a.owner_id ? a.owner_unit_amount : a.unit_cost);
            lineCost += restored;
            if (a.owner_id) {
              lineOwnerCost += restored;
              ownerReversals.set(
                a.owner_id,
                (ownerReversals.get(a.owner_id) || 0) + restored,
              );
            }
            remaining -= q;
          }
          if (remaining)
            throw new Error("Original cost allocation could not be restored.");
          this.move(doc, p, r.quantity, lineCost - lineOwnerCost);
        } else {
          let remaining = r.quantity;
          const batches = this.all(
            "SELECT * FROM batches WHERE line_id=? AND remaining>0 ORDER BY received_at ASC, rowid ASC",
            ol.id,
          );
          for (const b of batches) {
            if (!remaining) break;
            const q = Math.min(remaining, b.remaining);
            this.run(
              "UPDATE batches SET remaining=remaining-?,quantity=quantity-? WHERE id=?",
              q,
              q,
              b.id,
            );
            if (p.serialized) {
              const units = this.all(
                "SELECT * FROM inventory_units WHERE batch_id=? AND status='available' LIMIT ?",
                b.id,
                q,
              );
              if (units.length !== q)
                throw new Error("Device inventory does not match batch stock.");
              for (const u of units)
                this.run(
                  "UPDATE inventory_units SET status='returned_supplier' WHERE id=?",
                  u.id,
                );
            }
            lineCost += q * b.unit_cost;
            remaining -= q;
          }
          if (remaining)
            throw new Error("Cannot return items that have already been sold.");
          this.move(doc, p, -r.quantity, -lineCost);
        }
        this.run("UPDATE document_lines SET cost=? WHERE id=?", lineCost, lid);
        cost += lineCost;
      }
      if (kind === "sale_return")
        this.ledger(doc, [
          ["sales", total, 0],
          ["cash", 0, refund],
          ["receivables", 0, creditReduction, original.party_id],
          [
            "inventory",
            cost - [...ownerReversals.values()].reduce((sum, n) => sum + n, 0),
            0,
          ],
          ...[...ownerReversals].map(([owner, amount]) => [
            "consignment_payables",
            amount,
            0,
            owner,
          ]),
          ["cost_of_goods", 0, cost],
        ]);
      else {
        if (cost !== total)
          throw new Error(
            "Partial purchase return has a rounding difference. Return the remaining batch together.",
          );
        this.ledger(doc, [
          ["payables", creditReduction, 0, original.party_id],
          ["cash", refund, 0],
          ["inventory", 0, cost],
        ]);
      }
      this.run(
        "UPDATE documents SET paid=paid-? WHERE id=?",
        refund,
        original.id,
      );
      this.run("UPDATE documents SET cost=? WHERE id=?", cost, doc.id);
      this.audit(user, "Post return", doc.id, {
        original: original.number,
        total,
        refund,
      });
      return this.getDocument(doc.id);
    });
  }
  adjust(user, input) {
    const d = z
      .object({
        product_id: z.string(),
        ...unitFields,
        quantity: z
          .number()
          .int()
          .min(-1_000_000)
          .max(1_000_000)
          .refine((n) => n !== 0),
        cost: money.default(0),
        ...currencyFields,
        cost_aed: money.default(0),
        fx_rate: fxRate.default(0),
        note: text.min(3),
        request_key: z.string().min(8),
        opening: z.boolean().default(false),
      })
      .transform(normalizeForeign)
      .parse(input);
    return this.transaction(() => {
      const prev = this.existingRequest(user, d.request_key, [
        d.opening ? "opening" : "adjustment",
      ]);
      if (prev) return this.getDocument(prev.id);
      const p = this.one("SELECT * FROM products WHERE id=?", d.product_id);
      if (!p) throw new Error("Product not found.");
      if (
        d.opening &&
        (user.role !== "Owner" ||
          d.quantity < 0 ||
          this.one("SELECT COUNT(*) n FROM movements WHERE product_id=?", p.id)
            .n)
      )
        throw new Error(
          "Opening inventory requires an owner, positive quantity, and no prior stock movements.",
        );
      const doc = this.document(d.opening ? "opening" : "adjustment", user, {
        note: d.note,
        request_key: d.request_key,
      });
      if (d.fx_rate)
        this.run(
          "UPDATE documents SET fx_rate=? WHERE id=?",
          d.fx_rate,
          doc.id,
        );
      const l = {
        id: id(),
        quantity: Math.abs(d.quantity),
        units: d.units,
        unit_ids: d.unit_ids,
        cost: Math.abs(d.quantity) * d.cost,
        currency: d.currency,
        cost_foreign: d.cost_foreign,
        cost_aed: d.cost_aed || 0,
        fx_rate: d.fx_rate || 0,
      };
      this.run(
        "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost,discount,original_line_id,cost_aed,fx_rate) VALUES (?,?,?,?,?,?,?,NULL,?,?)",
        l.id,
        doc.id,
        p.id,
        l.quantity,
        d.cost,
        l.cost,
        0,
        l.cost_aed,
        l.fx_rate,
      );
      this.saveForeign("document_lines", l.id, l);
      this.saveForeign("documents", doc.id, d);
      if (!Number.isSafeInteger(l.cost) || l.cost > 1e12)
        throw new Error("Stock adjustment exceeds supported amount.");
      let cost = l.cost;
      if (d.quantity > 0) this.receive(p, l, doc);
      else cost = this.consume(p, l, doc);
      this.run("UPDATE documents SET cost=? WHERE id=?", cost, doc.id);
      this.ledger(
        doc,
        d.quantity > 0
          ? [
              ["inventory", cost, 0],
              [d.opening ? "equity" : "other_income", 0, cost],
            ]
          : [
              ["expenses", cost, 0],
              ["inventory", 0, cost],
            ],
      );
      this.audit(user, "Adjust stock", p.id, {
        quantity: d.quantity,
        reason: d.note,
      });
      return this.getDocument(doc.id);
    });
  }
  listProducts(args = {}, user) {
    const d = z
      .object({
        q: z.string().max(100).default(""),
        barcode: z.string().max(80).optional(),
        id: z.string().optional(),
        ids: z.array(z.string()).max(100).optional(),
        category: z.string().max(30).default("All products"),
        filter: z.string().default("all"),
        after: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(args);
    let clauses = ["p.active=1"],
      params = [];
    if (d.ids?.length) {
      clauses.push(`p.id IN (${d.ids.map(() => "?").join(",")})`);
      params.push(...d.ids);
    } else if (d.id) {
      clauses.push("p.id=?");
      params.push(d.id);
    } else {
      // Customer-resale one-offs stay on the resale tab, not shop inventory/catalog.
      clauses.push("p.consignment_only=0");
    }
    if (d.barcode) {
      clauses.push("p.barcode=? COLLATE NOCASE");
      params.push(d.barcode.trim());
    } else if (d.q) {
      clauses.push(
        "(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode=? COLLATE NOCASE OR p.barcode LIKE ? ESCAPE '\\')",
      );
      const q = d.q.replace(/[\\%_]/g, "\\$&") + "%";
      params.push(q, q, d.q.trim(), q);
    }
    if (d.category !== "All products") {
      clauses.push("p.category=?");
      params.push(d.category);
    }
    if (d.filter === "low")
      clauses.push("p.stock<=p.reorder_level AND p.consignment_only=0");
    if (d.after && !d.ids?.length && !d.id) {
      clauses.push("p.sku>?");
      params.push(d.after);
    }
    const byIds = !!(d.ids?.length || d.id);
    const fetchLimit = d.ids?.length
      ? Math.min(Math.max(d.ids.length, 1), 100)
      : d.limit;
    const rows = this.all(
      `SELECT p.* FROM products p WHERE ${clauses.join(" AND ")} ORDER BY p.sku LIMIT ?`,
      ...params,
      byIds ? fetchLimit : d.limit + 1,
    );
    const more = byIds ? false : rows.length > d.limit;
    if (!byIds) rows.length = Math.min(rows.length, d.limit);
    const ids = rows.map((p) => p.id);
    const consignmentById = new Map();
    const costById = new Map();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      for (const row of this.all(
        `SELECT product_id, COALESCE(SUM(remaining),0) n FROM batches WHERE product_id IN (${placeholders}) AND owner_id IS NOT NULL AND remaining>0 GROUP BY product_id`,
        ...ids,
      ))
        consignmentById.set(row.product_id, row.n);
      if (
        user?.permissions.includes("view_costs") ||
        user?.permissions.includes("purchases")
      ) {
        for (const row of this.all(
          `SELECT product_id, COALESCE(SUM(remaining*unit_cost),0) cost FROM batches WHERE product_id IN (${placeholders}) AND remaining>0 GROUP BY product_id`,
          ...ids,
        ))
          costById.set(row.product_id, row.cost);
      }
    }
    const hideCosts =
      !user?.permissions.includes("view_costs") &&
      !user?.permissions.includes("purchases");
    for (const p of rows) {
      p.attributes = JSON.parse(p.attributes);
      p.consignment_stock = consignmentById.get(p.id) || 0;
      if (hideCosts) {
        delete p.unit_cost;
        delete p.cost_aed;
        delete p.cost_foreign;
        delete p.fx_rate;
      } else {
        p.cost = costById.get(p.id) || 0;
      }
    }
    return { rows, next: more ? rows.at(-1)?.sku : null };
  }
  dateRange(input = {}) {
    return z
      .object({
        from: date.default(today().slice(0, 7) + "-01"),
        to: date.default(today()),
      })
      .refine((d) => d.from <= d.to, "Start date must not be after end date.")
      .parse(input);
  }
  totals(input = {}) {
    const d = this.dateRange(input);
    const rows = this.all(
      "SELECT account,SUM(debit) debit,SUM(credit) credit FROM daily_totals WHERE date BETWEEN ? AND ? GROUP BY account",
      d.from,
      d.to,
    );
    const net = (a) => {
      const r = rows.find((x) => x.account === a);
      return r ? r.debit - r.credit : 0;
    };
    const sales = -net("sales") || 0,
      cogs = net("cost_of_goods"),
      expenses = net("expenses"),
      other = -net("other_income") || 0;
    const cash = net("cash");
    return {
      sales,
      cogs,
      expenses,
      other,
      gross: sales - cogs,
      net: sales - cogs - expenses + other,
      cash,
      ...d,
    };
  }
  overview(user, args = {}) {
    const d = this.dateRange(args),
      totals = this.totals(d),
      daily = this.all(
        `SELECT date,SUM(CASE WHEN account='sales' THEN credit-debit ELSE 0 END) sales,SUM(CASE WHEN account='cost_of_goods' THEN debit-credit ELSE 0 END) cost,SUM(CASE WHEN account='expenses' THEN debit-credit ELSE 0 END) expenses FROM daily_totals WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
        d.from,
        d.to,
      );
    const stock = this.one(
      "SELECT COUNT(*) products,COALESCE(SUM(stock),0) units,COALESCE(SUM(CASE WHEN stock<=reorder_level THEN 1 ELSE 0 END),0) low FROM products WHERE active=1 AND consignment_only=0",
    );
    const inventory = this.one(
      "SELECT COALESCE(SUM(remaining*unit_cost),0) value FROM batches WHERE remaining>0",
    ).value;
    const outstanding = this.all(
      "SELECT account,SUM(debit-credit) n FROM daily_totals WHERE account IN ('receivables','payables') GROUP BY account",
    );
    const salesCount = this.one(
      "SELECT COUNT(*) n FROM documents WHERE kind='sale' AND category<>'Opening balance' AND date BETWEEN ? AND ?",
      d.from,
      d.to,
    ).n;
    const recent = this.all(
      "SELECT d.*,p.name party_name FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE d.kind='sale' ORDER BY d.date DESC,d.created_at DESC LIMIT 5",
    );
    const categories = this.all(
      "SELECT category,SUM(stock) stock FROM products WHERE active=1 AND consignment_only=0 GROUP BY category ORDER BY stock DESC",
    );
    const result = {
      totals,
      daily,
      stock,
      inventory,
      outstanding,
      salesCount,
      recent,
      categories,
    };
    if (!user.permissions.includes("view_costs")) {
      delete result.inventory;
      for (const k of ["cogs", "expenses", "other", "gross", "net"])
        delete result.totals[k];
      result.daily = result.daily.map(({ date, sales }) => ({ date, sales }));
      result.recent = result.recent.map(({ cost, ...r }) => r);
    }
    return result;
  }
  reorderReport(args = {}) {
    const d = z
      .object({
        limit: z.number().int().min(1).max(1000).default(10),
        cursor: z.string().max(1500).nullable().optional(),
        revision: z.number().int().nonnegative().optional(),
        zeroOnly: z.boolean().default(false),
        availableOnly: z.boolean().default(false),
      })
      .parse(args);
    // Audit revision prevents a multi-page export from mixing stock snapshots.
    const revision = this.one("SELECT COALESCE(MAX(id),0) n FROM audit").n;
    if (d.revision !== undefined && d.revision !== revision)
      throw new Error("REPORT_CHANGED");
    const available = d.availableOnly;
    const eligible = available
      ? "active=1 AND consignment_only=0 AND stock>0"
      : "active=1 AND consignment_only=0 AND stock<=reorder_level" +
        (d.zeroOnly ? " AND stock=0" : "");
    const referenceCost =
      "COALESCE((SELECT b.unit_cost FROM batches b WHERE b.product_id=p.id AND b.owner_id IS NULL ORDER BY b.received_at DESC,b.rowid DESC LIMIT 1),p.unit_cost)";
    let after = "",
      params = [];
    if (d.cursor) {
      if (available) {
        const cursor = z
          .tuple([z.string(), z.string()])
          .parse(JSON.parse(d.cursor));
        after = " AND (sku,id)>(?,?)";
        params = cursor;
      } else {
        const cursor = z
          .tuple([z.number().int().min(0).max(1), z.string(), z.string()])
          .parse(JSON.parse(d.cursor));
        after = " AND ((stock=0) < ? OR ((stock=0)=? AND (sku,id)>(?,?)))";
        params = [cursor[0], ...cursor];
      }
    }
    const rows = this.all(
      available
        ? `SELECT id,name,brand,model,sku,barcode,category,stock,reorder_level,
      ${referenceCost} reference_unit_cost,
      stock*${referenceCost} estimated_cost
      FROM products p WHERE ${eligible}${after}
      ORDER BY sku,id LIMIT ?`
        : `SELECT id,name,brand,model,sku,stock,reorder_level,
      MAX(1,reorder_level*2) target_level,
      MAX(1,reorder_level*2)-stock suggested_quantity,
      ${referenceCost} reference_unit_cost,
      (MAX(1,reorder_level*2)-stock)*${referenceCost} estimated_cost
      FROM products p WHERE ${eligible}${after}
      ORDER BY (stock=0) DESC,sku,id LIMIT ?`,
      ...params,
      d.limit + 1,
    );
    const hasMore = rows.length > d.limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    const summary = d.cursor
      ? undefined
      : available
        ? this.one(`SELECT COUNT(*) products,
      COALESCE(SUM(stock),0) units,
      COALESCE(SUM(stock*${referenceCost}),0) estimated_cost,
      COALESCE(SUM(${referenceCost}=0),0) unpriced
      FROM products p WHERE ${eligible}`)
        : this.one(`SELECT COUNT(*) products,
      COALESCE(SUM(stock=0),0) out_of_stock,
      COALESCE(SUM(stock>0),0) low_stock,
      COALESCE(SUM(MAX(1,reorder_level*2)-stock),0) suggested_quantity,
      COALESCE(SUM((MAX(1,reorder_level*2)-stock)*${referenceCost}),0) estimated_cost,
      COALESCE(SUM(${referenceCost}=0),0) unpriced
      FROM products p WHERE ${eligible}`);
    for (const amount of [
      ...rows.map((r) => r.estimated_cost),
      ...(summary
        ? available
          ? [summary.estimated_cost, summary.units]
          : [summary.estimated_cost, summary.suggested_quantity]
        : []),
    ])
      if (!Number.isSafeInteger(amount))
        throw new Error("Report totals exceed supported precision.");
    return {
      rows,
      summary,
      revision,
      as_of: today(),
      next: hasMore
        ? available
          ? JSON.stringify([last.sku, last.id])
          : JSON.stringify([Number(last.stock === 0), last.sku, last.id])
        : null,
    };
  }
  reports(args = {}) {
    const range = this.dateRange(args),
      totals = this.totals(range);
    const days = this.all(
      `SELECT date,SUM(CASE WHEN account='sales' THEN credit-debit ELSE 0 END) sales,SUM(CASE WHEN account='cost_of_goods' THEN debit-credit ELSE 0 END) cogs,SUM(CASE WHEN account='expenses' THEN debit-credit ELSE 0 END) expenses,SUM(CASE WHEN account='other_income' THEN credit-debit ELSE 0 END) other,SUM(CASE WHEN account='cash' THEN debit-credit ELSE 0 END) cash FROM daily_totals WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date DESC`,
      range.from,
      range.to,
    );
    const trial = this.all(
      "SELECT account,SUM(debit) debit,SUM(credit) credit,SUM(debit-credit) balance FROM daily_totals WHERE date<=? GROUP BY account ORDER BY account",
      range.to,
    );
    const best = this.all(
      `SELECT p.id,p.name,p.brand,p.model,p.category,p.image,SUM(CASE WHEN d.kind='sale' THEN l.quantity ELSE -l.quantity END) quantity,SUM(CASE WHEN d.kind='sale' THEN l.price*l.quantity-l.discount ELSE -(l.price*l.quantity-l.discount) END) revenue,SUM(CASE WHEN d.kind='sale' THEN l.cost ELSE -l.cost END) cost FROM document_lines l JOIN documents d ON d.id=l.document_id JOIN products p ON p.id=l.product_id WHERE d.kind IN ('sale','sale_return') AND d.date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 100`,
      range.from,
      range.to,
    );
    const expenses = this.all(
      "SELECT d.kind source_kind,COALESCE(NULLIF(d.category,''),d.kind) category,SUM(j.debit-j.credit) amount FROM journal j JOIN documents d ON d.id=j.document_id WHERE j.account='expenses' AND j.date BETWEEN ? AND ? GROUP BY d.kind,COALESCE(NULLIF(d.category,''),d.kind) HAVING SUM(j.debit-j.credit)<>0 ORDER BY amount DESC",
      range.from,
      range.to,
    );
    const invoices = this.all(
      `SELECT d.id,d.number,d.date,d.kind,COALESCE(p.name,'') party_name,
        SUM(CASE WHEN d.kind='sale' THEN l.price*l.quantity-l.discount ELSE -(l.price*l.quantity-l.discount) END) revenue,
        SUM(CASE WHEN d.kind='sale' THEN l.cost ELSE -l.cost END) cost
      FROM documents d
      JOIN document_lines l ON l.document_id=d.id
      LEFT JOIN parties p ON p.id=d.party_id
      WHERE d.kind IN ('sale','sale_return') AND d.date BETWEEN ? AND ?
      GROUP BY d.id
      ORDER BY d.date DESC,d.created_at DESC,d.id DESC
      LIMIT 200`,
      range.from,
      range.to,
    );
    const resale = this.all(
      `SELECT d.id,d.number,d.date,COALESCE(pr.name,'') product_name,COALESCE(ow.name,'') owner_name,
        SUM(CASE WHEN d.kind='sale' THEN a.quantity ELSE -a.quantity END) AS quantity,
        SUM(CASE WHEN d.kind='sale' THEN CAST(ROUND((l.price*l.quantity-l.discount)*1.0*a.quantity/l.quantity) AS INTEGER) ELSE -CAST(ROUND((l.price*l.quantity-l.discount)*1.0*a.quantity/l.quantity) AS INTEGER) END) AS revenue,
        SUM(CASE WHEN d.kind='sale' THEN a.cost ELSE -a.cost END) AS owner_share
      FROM allocations a
      JOIN batches b ON b.id=a.batch_id AND b.owner_id IS NOT NULL
      JOIN document_lines l ON l.id=a.line_id
      JOIN documents d ON d.id=l.document_id
      JOIN products pr ON pr.id=l.product_id
      JOIN parties ow ON ow.id=b.owner_id
      WHERE d.kind IN ('sale','sale_return') AND d.date BETWEEN ? AND ?
      GROUP BY d.id,d.number,d.date,d.created_at,pr.id,pr.name,ow.id,ow.name
      HAVING SUM(CASE WHEN d.kind='sale' THEN a.quantity ELSE -a.quantity END)<>0
         OR SUM(CASE WHEN d.kind='sale' THEN a.cost ELSE -a.cost END)<>0
      ORDER BY d.date DESC,d.created_at DESC,d.id DESC
      LIMIT 200`,
      range.from,
      range.to,
    );
    const money = this.wealthSnapshot(range.to);
    const cashFlow = this.one(
      `SELECT
        COALESCE(SUM(CASE WHEN j.debit>j.credit THEN j.debit-j.credit ELSE 0 END),0) cash_in,
        COALESCE(SUM(CASE WHEN j.credit>j.debit THEN j.credit-j.debit ELSE 0 END),0) cash_out
      FROM journal j WHERE j.account='cash' AND j.date BETWEEN ? AND ?`,
      range.from,
      range.to,
    );
    const cashByKind = this.all(
      `SELECT d.kind,
        SUM(CASE WHEN j.debit>j.credit THEN j.debit-j.credit ELSE 0 END) cash_in,
        SUM(CASE WHEN j.credit>j.debit THEN j.credit-j.debit ELSE 0 END) cash_out
      FROM journal j JOIN documents d ON d.id=j.document_id
      WHERE j.account='cash' AND j.date BETWEEN ? AND ?
      GROUP BY d.kind
      HAVING cash_in<>0 OR cash_out<>0
      ORDER BY (cash_in+cash_out) DESC`,
      range.from,
      range.to,
    );
    return {
      totals,
      days,
      trial,
      best,
      expenses,
      invoices,
      resale,
      money: {
        ...money,
        cash_in: cashFlow.cash_in,
        cash_out: cashFlow.cash_out,
        cash_net: cashFlow.cash_in - cashFlow.cash_out,
        by_kind: cashByKind,
      },
      consignment: consignmentSnapshot(this, range.to),
    };
  }
  monthEnd(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  nextMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  wealthSnapshot(asOf) {
    const rows = this.all(
      "SELECT account,SUM(debit-credit) balance FROM daily_totals WHERE date<=? GROUP BY account",
      asOf,
    );
    const bal = (a) => rows.find((r) => r.account === a)?.balance || 0;
    const ownerClaims = consignmentSnapshot(this, asOf);
    const cash = bal("cash"),
      receivables = bal("receivables"),
      inventory = bal("inventory"),
      payables = -bal("payables"),
      consignment_payables = ownerClaims.due,
      consignment_recoverable = ownerClaims.recoverable,
      capital = -bal("equity"),
      earnings = -["sales", "cost_of_goods", "expenses", "other_income"].reduce(
        (s, a) => s + bal(a),
        0,
      ),
      assets = cash + receivables + inventory + consignment_recoverable,
      liabilities = payables + consignment_payables,
      net_worth = assets - liabilities;
    return {
      as_of: asOf,
      cash,
      receivables,
      inventory,
      payables,
      consignment_payables,
      consignment_recoverable,
      assets,
      liabilities,
      capital,
      earnings,
      net_worth,
    };
  }
  capitalReport(args = {}) {
    const d = z
      .object({
        to: date.optional(),
        after: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .parse(args);
    const asOf = date.parse(d.to || today());
    const first =
      this.one("SELECT MIN(date) d FROM journal WHERE date<=?", asOf)?.d ||
      asOf;
    const current = this.wealthSnapshot(asOf);
    const months = [];
    let ym = first.slice(0, 7);
    const lastYm = asOf.slice(0, 7);
    while (ym <= lastYm) {
      const start = `${ym}-01`;
      const endRaw = this.monthEnd(ym);
      const end = endRaw > asOf ? asOf : endRaw;
      const prevEnd =
        start > first
          ? new Date(Date.parse(start + "T00:00:00Z") - 86400000)
              .toISOString()
              .slice(0, 10)
          : null;
      const snap = this.wealthSnapshot(end);
      const prev = prevEnd ? this.wealthSnapshot(prevEnd) : null;
      // Only owner cash investments/withdrawals — not inventory openings or stock adjusts.
      const equityFlow = this.one(
        `SELECT COALESCE(SUM(CASE WHEN j.credit>j.debit THEN j.credit-j.debit ELSE 0 END),0) invested,COALESCE(SUM(CASE WHEN j.debit>j.credit THEN j.debit-j.credit ELSE 0 END),0) withdrawn FROM journal j JOIN documents d ON d.id=j.document_id WHERE j.account='equity' AND d.kind='owner' AND j.date BETWEEN ? AND ?`,
        start,
        end,
      );
      const profit = this.totals({ from: start, to: end });
      months.push({
        month: ym,
        invested: equityFlow.invested,
        withdrawn: equityFlow.withdrawn,
        profit: profit.net,
        cash: snap.cash,
        capital: snap.capital,
        earnings: snap.earnings,
        net_worth: snap.net_worth,
        change: snap.net_worth - (prev?.net_worth || 0),
      });
      ym = this.nextMonth(ym);
    }
    months.reverse();
    const clauses = ["d.kind=?", "d.date<=?"],
      params = ["owner", asOf];
    if (d.after) {
      let cursor;
      try {
        cursor = z
          .tuple([z.string(), z.string(), z.string()])
          .parse(
            JSON.parse(Buffer.from(d.after, "base64url").toString("utf8")),
          );
      } catch {
        throw new Error("Invalid pagination cursor.");
      }
      clauses.push(
        "(d.date<? OR (d.date=? AND d.created_at<?) OR (d.date=? AND d.created_at=? AND d.id<?))",
      );
      params.push(
        cursor[0],
        cursor[0],
        cursor[1],
        cursor[0],
        cursor[1],
        cursor[2],
      );
    }
    const movementRows = this.all(
      `SELECT d.id,d.number,d.date,d.note,d.created_at,COALESCE(SUM(CASE WHEN j.account='equity' THEN j.credit-j.debit ELSE 0 END),0) capital_change FROM documents d LEFT JOIN journal j ON j.document_id=d.id WHERE ${clauses.join(" AND ")} GROUP BY d.id ORDER BY d.date DESC,d.created_at DESC,d.id DESC LIMIT ?`,
      ...params,
      d.limit + 1,
    );
    const more = movementRows.length > d.limit;
    movementRows.length = Math.min(movementRows.length, d.limit);
    const movements = movementRows.map((m) => ({
      ...m,
      direction: m.capital_change >= 0 ? "deposit" : "withdrawal",
      amount: Math.abs(m.capital_change),
    }));
    return {
      current,
      months: months.slice(0, 36),
      movements,
      next: more
        ? Buffer.from(
            JSON.stringify([
              movements.at(-1).date,
              movements.at(-1).created_at,
              movements.at(-1).id,
            ]),
          ).toString("base64url")
        : null,
    };
  }
  dayBook(input = {}) {
    const day = date.parse(input.date || today());
    const opening = this.one(
      "SELECT COALESCE(SUM(debit-credit),0) n FROM daily_totals WHERE account='cash' AND date<?",
      day,
    ).n;
    const totals = this.totals({ from: day, to: day });
    const entries = this.all(
      "SELECT d.*,p.name party_name,COALESCE((SELECT SUM(j.debit-j.credit) FROM journal j WHERE j.document_id=d.id AND j.account='cash'),0) cash_change FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE d.date=? ORDER BY d.created_at",
      day,
    );
    return {
      date: day,
      opening,
      closing: opening + totals.cash,
      totals,
      entries,
    };
  }
  listDocuments(input = {}) {
    const d = z
      .object({
        kind: z.enum(["sale", "purchase", "expense", "all"]).default("all"),
        q: z.string().max(100).default(""),
        after: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(50),
        from: date.optional(),
        to: date.optional(),
        expense_account_id: z.string().min(1).optional(),
      })
      .parse(input);
    const clauses = ["1=1"],
      params = [];
    if (d.kind !== "all") {
      clauses.push("d.kind=?");
      params.push(d.kind);
    }
    if (d.expense_account_id) {
      if (d.kind !== "expense")
        throw new Error("Account filter is only available for expenses.");
      clauses.push("d.expense_account_id=?");
      params.push(d.expense_account_id);
    }
    if (d.q) {
      const like = d.q.replace(/[\\%_]/g, "\\$&");
      const prefix = like + "%";
      const contains = "%" + like + "%";
      clauses.push(
        "(d.number LIKE ? ESCAPE '\\' OR d.number LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR IFNULL(p.phone,'') LIKE ? ESCAPE '\\' OR d.category LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\')",
      );
      params.push(prefix, contains, contains, prefix, contains, contains);
    }
    if (d.after) {
      let cursor;
      try {
        cursor = z
          .tuple([z.string(), z.string()])
          .parse(
            JSON.parse(Buffer.from(d.after, "base64url").toString("utf8")),
          );
      } catch {
        throw new Error("Invalid pagination cursor.");
      }
      clauses.push("(d.created_at<? OR (d.created_at=? AND d.id<?))");
      params.push(cursor[0], cursor[0], cursor[1]);
    }
    if (d.from) {
      clauses.push("d.date>=?");
      params.push(d.from);
    }
    if (d.to) {
      clauses.push("d.date<=?");
      params.push(d.to);
    }
    const account =
      d.kind === "sale"
        ? "receivables"
        : d.kind === "purchase"
          ? "payables"
          : null;
    const rows = this.all(
      account
        ? `SELECT d.*,p.name party_name,p.phone party_phone,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned,COALESCE((SELECT SUM(${d.kind === "sale" ? "debit-credit" : "credit-debit"}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) party_balance FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE ${clauses.join(" AND ")} ORDER BY d.created_at DESC,d.id DESC LIMIT ?`
        : `SELECT d.*,p.name party_name,p.phone party_phone,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE ${clauses.join(" AND ")} ORDER BY d.created_at DESC,d.id DESC LIMIT ?`,
      ...(account ? [account] : []),
      ...params,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    rows.length = Math.min(rows.length, d.limit);
    let month_total;
    if (d.kind === "expense") {
      const monthFrom = today().slice(0, 7) + "-01";
      const monthTo = today();
      const monthClauses = ["kind='expense'", "date>=?", "date<=?"];
      const monthParams = [monthFrom, monthTo];
      if (d.expense_account_id) {
        monthClauses.push("expense_account_id=?");
        monthParams.push(d.expense_account_id);
      }
      month_total = this.one(
        `SELECT COALESCE(SUM(total),0) n FROM documents WHERE ${monthClauses.join(" AND ")}`,
        ...monthParams,
      ).n;
    }
    return {
      rows,
      next: more
        ? Buffer.from(
            JSON.stringify([rows.at(-1).created_at, rows.at(-1).id]),
          ).toString("base64url")
        : null,
      ...(month_total !== undefined ? { month_total } : {}),
    };
  }
  listParties(input = {}) {
    const d = z
      .object({
        kind: z.enum(["customer", "supplier"]),
        q: z.string().max(100).default(""),
        after: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(100),
      })
      .parse(input);
    const account = d.kind === "customer" ? "receivables" : "payables";
    const like = d.q ? "%" + d.q.replace(/[\\%_]/g, "\\$&") + "%" : "%";
    const rows = this.all(
      `SELECT p.*,COALESCE((SELECT SUM(${d.kind === "customer" ? "debit-credit" : "credit-debit"}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) balance FROM parties p WHERE p.kind=? AND COALESCE(p.active,1)=1 AND (p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\') AND p.id>? ORDER BY p.id LIMIT ?`,
      account,
      d.kind,
      like,
      like,
      d.after,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    rows.length = Math.min(rows.length, d.limit);
    return { rows, next: more ? rows.at(-1).id : null };
  }
  async createBackup(
    user,
    { destination, automatic = false, targets: selectedTargets } = {},
  ) {
    if (this.backupBusy) throw new Error("A backup is already running.");
    this.backupBusy = true;
    const config = this.setting("backups");
    if (!config.backupId) {
      config.backupId = id();
      this.saveSetting("backups", config);
    }
    const targets =
      selectedTargets ||
      (destination ? [path.resolve(destination)] : this.backupTargets(config));
    const automaticTargets = { ...config.automaticTargets };
    const results = [];
    let snapshot, releaseLock;
    try {
      releaseLock = acquireMaintenanceLock(this.file);
      if (!targets.length) throw new Error("Add a backup destination first.");
      const staging = path.join(path.dirname(this.file), "backup-staging");
      mkdirSync(staging, { recursive: true });
      snapshot = path.join(staging, `${id()}.sqlite`);
      await backup(this.db, snapshot);
      const check = new DatabaseSync(snapshot, { readOnly: true });
      try {
        const integrity = check.prepare("PRAGMA integrity_check").get();
        if (
          Object.values(integrity)[0] !== "ok" ||
          check.prepare("PRAGMA foreign_key_check").all().length
        )
          throw new Error("Backup integrity verification failed.");
      } finally {
        check.close();
      }
      const size = statSync(snapshot).size,
        checksum = fileChecksum(snapshot);
      for (const dest of targets) {
        const rid = id();
        try {
          if (!existsSync(dest))
            throw new Error("Destination is disconnected or does not exist.");
          if (!statSync(dest).isDirectory())
            throw new Error("Destination must be a folder.");
          const folder = path.join(
            dest,
            "Vault Store Backups",
            config.backupId,
          );
          mkdirSync(folder, { recursive: true });
          const stamp = now().replace(/[:.]/g, "-"),
            filename = `vault-${today()}-${stamp}-${rid.slice(0, 8)}.sqlite`,
            target = path.join(folder, filename),
            tmp = target + ".partial";
          copyFileSync(snapshot, tmp);
          chmodSync(tmp, 0o600);
          const fd = openSync(tmp, "r");
          fsyncSync(fd);
          closeSync(fd);
          if (fileChecksum(tmp) !== checksum)
            throw new Error("Copied backup checksum does not match.");
          renameSync(tmp, target);
          writeFileSync(
            target + ".json",
            JSON.stringify(
              {
                application: "Vault Store",
                schema: 1,
                databaseSchema: 2,
                createdAt: now(),
                businessDate: today(),
                automatic,
                checksum,
                size: size,
                currency: "AFN",
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          this.run(
            "INSERT INTO backup_runs VALUES (?,?,?,?,?,?,?)",
            rid,
            now(),
            target,
            "verified",
            checksum,
            size,
            "Integrity and checksum verified",
          );
          this.rotateBackups(folder);
          if (automatic) automaticTargets[dest] = now();
          results.push({
            path: target,
            status: "verified",
            size: size,
          });
        } catch (e) {
          this.run(
            "INSERT INTO backup_runs VALUES (?,?,?,?,?,?,?)",
            rid,
            now(),
            dest,
            "failed",
            "",
            0,
            e.message,
          );
          results.push({ path: dest, status: "failed", message: e.message });
        }
      }
      if (results.every((r) => r.status === "verified"))
        this.saveSetting("backups", {
          ...config,
          automaticTargets,
          lastSuccess: now(),
          ...(automatic ? { lastAutomatic: now() } : {}),
          retryAfter: null,
        });
      else if (automatic)
        this.saveSetting("backups", {
          ...config,
          automaticTargets,
          retryAfter: new Date(Date.now() + 3600_000).toISOString(),
        });
      this.audit(user, "Create backup", "backups", { results });
      return { results };
    } finally {
      if (snapshot && existsSync(snapshot)) unlinkSync(snapshot);
      releaseLock?.();
      this.backupBusy = false;
    }
  }
  rotateBackups(folder) {
    const files = readdirSync(folder).filter((n) =>
      /^vault-\d{4}-\d{2}-\d{2}-.+\.sqlite$/.test(n),
    );
    const cutoff = new Date(Date.parse(today()) - 29 * 86400_000)
      .toISOString()
      .slice(0, 10);
    for (const f of files) {
      const full = path.join(folder, f),
        manifest = full + ".json";
      if (!existsSync(manifest)) continue;
      try {
        const m = JSON.parse(readFileSync(manifest, "utf8"));
        if (m.application !== "Vault Store" || m.schema !== 1) continue;
        if (m.businessDate < cutoff) {
          unlinkSync(full);
          unlinkSync(manifest);
        }
      } catch {}
    }
    const byDay = new Map();
    for (const f of files.sort().reverse()) {
      const full = path.join(folder, f);
      if (!existsSync(full) || !existsSync(full + ".json")) continue;
      try {
        const m = JSON.parse(readFileSync(full + ".json", "utf8"));
        if (m.application !== "Vault Store" || m.schema !== 1) continue;
        if (byDay.has(m.businessDate)) {
          unlinkSync(full);
          unlinkSync(full + ".json");
        } else byDay.set(m.businessDate, f);
      } catch {}
    }
  }
  backupTargets(config = this.setting("backups")) {
    return [
      ...new Set([
        ...(config.destinations || []),
        ...(config.allDrives ? discoverBackupTargets(this.file) : []),
      ]),
    ];
  }
  async automaticBackup() {
    const c = this.setting("backups");
    if (
      !this.one("SELECT id FROM users LIMIT 1") ||
      (c.retryAfter && Date.now() < Date.parse(c.retryAfter))
    )
      return { skipped: true };
    const targets = this.backupTargets(c).filter((dest) =>
      backupDue(
        c.automaticTargets?.[dest] ??
          (!c.automaticTargets && c.destinations?.includes(dest)
            ? c.lastAutomatic
            : null),
      ),
    );
    if (targets.length)
      return this.createBackup(null, { automatic: true, targets });
    return { skipped: true };
  }
  async dispatch(command, args = {}, token) {
    if (command === "status")
      return {
        setup: !this.one("SELECT id FROM users LIMIT 1"),
        ownerUsername:
          this.one(
            "SELECT username FROM users WHERE role='Owner' AND active=1 ORDER BY created_at,id LIMIT 1",
          )?.username || "",
        store: this.storeBill(),
        permissions: PERMISSIONS,
        roles: ROLES,
      };
    if (command === "setup") return this.setup(args);
    if (command === "login") return this.login(args);
    if (command === "demoSession") {
      if (!this.setting("store").demo)
        throw new Error("Demo sign-in is disabled.");
      return this.session(
        this.one("SELECT * FROM users WHERE role='Owner' AND active=1 LIMIT 1"),
      );
    }
    const permission = {
      products: "inventory",
      productCreate: "inventory",
      productUpdate: "inventory",
      productDelete: "inventory",
      inventoryReports: "reports",
      reorderReport: "reports",
      openingBalance: "finance",
      adjust: "inventory",
      sale: "sales",
      purchase: "purchases",
      parties: "people",
      partyCreate: "people",
      partyUpdate: "people",
      partyDelete: "people",
      partyDetail: "people",
      customerSalesHistory: "people",
      payment: "finance",
      paymentDelete: "finance",
      expense: "finance",
      expenseUpdate: "finance",
      expenseAccounts: "finance",
      expenseAccountCreate: "finance",
      consignments: "finance",
      consignmentReceive: "finance",
      consignmentReturn: "finance",
      consignmentPay: "finance",
      consignmentPayEdit: "finance",
      reports: "reports",
      dayBook: "finance",
      users: "users",
      userCreate: "users",
      userUpdate: "users",
      userPermissions: "users",
      backups: "backups",
      backupCreate: "backups",
      backupSettings: "backups",
      backupVerify: "backups",
      settings: "settings",
      saveSettings: "settings",
      audit: "users",
      ownerMovement: "finance",
      closePeriod: "settings",
    }[command];
    const user = this.auth(token, permission);
    if (
      [
        "productDraftList",
        "productDraftRead",
        "productDraftSave",
        "productDraftDelete",
        "productDraftPublish",
      ].includes(command)
    )
      return productDraftCommand(this, user, command, args);
    switch (command) {
      case "me":
        return user;
      case "ownerPasswordChange": {
        if (user.role !== "Owner") throw new Error("Owner access required.");
        const password = z.string().min(10).max(128).parse(args.password);
        const result = this.transaction(() => {
          const owner = this.one(
            "SELECT * FROM users WHERE id=? AND active=1",
            user.id,
          );
          this.run(
            "UPDATE users SET password=? WHERE id=?",
            passwordHash(password),
            user.id,
          );
          this.run("DELETE FROM sessions");
          this.audit(user, "Owner password changed", user.id);
          return this.login({ username: owner.username, password });
        });
        this.sessions.clear();
        return result;
      }
      case "logout":
        this.sessions.delete(token);
        this.run("DELETE FROM sessions WHERE token=?", token);
        return { ok: true };
      case "notifications":
        return notifications(this, user, args);
      case "overview":
        return this.overview(user, args);
      case "products":
        return this.listProducts(args, user);
      case "catalog":
        if (
          !user.permissions.some((p) =>
            ["inventory", "sales", "purchases"].includes(p),
          )
        )
          throw new Error("Permission required: inventory or sales");
        return this.listProducts(args, user);
      case "productPhotoMatch": {
        if (!user.permissions.includes("inventory"))
          throw new Error("Permission required: inventory");
        const d = z
          .object({ brand: text, model: text, category: text })
          .parse(args);
        const photo = this.one(
          "SELECT image FROM products WHERE active=1 AND category=? AND brand=? COLLATE NOCASE AND model=? COLLATE NOCASE AND substr(image,1,6)='photo:' ORDER BY rowid DESC LIMIT 1",
          d.category,
          d.brand,
          d.model,
        );
        return { image: photo?.image || null };
      }
      case "productPhoto":
        if (
          !user.permissions.some((p) =>
            ["inventory", "sales", "purchases", "reports", "finance"].includes(
              p,
            ),
          )
        )
          throw new Error("Permission required for product photos.");
        return readProductPhoto(this, args.ref);
      case "productCreate":
        return this.createProduct(user, args);
      case "productDelete":
        return this.transaction(() => {
          const product = this.one(
            "SELECT * FROM products WHERE id=?",
            args.id,
          );
          if (!product) throw new Error("Product not found.");
          const remaining = this.one(
            "SELECT COALESCE(SUM(remaining),0) n FROM batches WHERE product_id=?",
            product.id,
          ).n;
          if (product.stock !== 0 || remaining !== 0)
            throw new Error(
              "Stock remains. This product cannot be deleted until its quantity is zero.",
            );
          if (product.active) {
            this.run("UPDATE products SET active=0 WHERE id=?", product.id);
            this.audit(user, "Delete product", product.id, {
              sku: product.sku,
              name: product.name,
            });
          }
          return { id: product.id };
        });
      case "productUpdate": {
        const d = productSchema.parse(args);
        this.validateCurrency(d.currency, d.fx_rate);
        const existing = this.one("SELECT * FROM products WHERE id=?", args.id);
        if (!existing) throw new Error("Product not found.");
        if (existing.serialized && !trackedCategory(d.category))
          throw new Error(
            "A device model cannot be changed into quantity-based accessories.",
          );
        if (d.minimum > d.price)
          throw new Error("Minimum price cannot exceed selling price.");
        return this.transaction(() => {
          const productPhoto = saveProductPhoto(this, {
            ...d,
            image: args.image === undefined ? existing.image : d.image,
          });
          this.run(
            "UPDATE products SET sku=?,barcode=?,name=?,brand=?,model=?,category=?,price=?,minimum=?,reorder_level=?,location=?,condition=?,warranty=?,attributes=?,image=? WHERE id=?",
            d.sku,
            d.barcode,
            d.name,
            d.brand,
            d.model,
            d.category,
            d.price,
            d.minimum,
            d.reorder_level,
            d.location,
            d.condition,
            d.warranty,
            JSON.stringify(d.attributes),
            productPhoto,
            existing.id,
          );
          if (d.cost_foreign && !d.fx_rate)
            throw new Error(
              "Enter the currency→AFN exchange rate used for this cost.",
            );
          if (d.fx_rate && !d.cost_foreign)
            throw new Error(
              "Enter the supplier unit cost in the selected currency.",
            );
          const cargo = d.cargo_rent || 0;
          const unitCost =
            d.cost_foreign && d.fx_rate
              ? afnFromAed(d.cost_foreign, d.fx_rate) + cargo
              : d.unit_cost !== undefined
                ? d.unit_cost
                : existing.unit_cost;
          this.run(
            "UPDATE products SET unit_cost=?,cost_aed=?,fx_rate=?,cargo_rent=? WHERE id=?",
            unitCost,
            d.cost_aed || 0,
            d.fx_rate || 0,
            cargo,
            existing.id,
          );
          this.saveForeign("products", existing.id, d);
          this.rememberProductCategory(d.category);
          if (
            !existing.serialized &&
            trackedCategory(d.category) &&
            d.serialized
          ) {
            this.run(
              "UPDATE products SET serialized=1 WHERE id=?",
              existing.id,
            );
            for (const b of this.all(
              "SELECT * FROM batches WHERE product_id=? AND remaining>0",
              existing.id,
            ))
              receiveUnits(
                this,
                { ...existing, ...d },
                b.id,
                b.remaining,
                null,
                "migration",
              );
          }
          this.audit(user, "Update product", existing.id, {
            name: d.name,
            price: d.price,
          });
          return {
            id: existing.id,
            product: this.listProducts({ id: existing.id, limit: 1 }, user)
              .rows[0],
          };
        });
      }
      case "reorderReport":
        if (!user.permissions.includes("view_costs"))
          throw new Error("Permission required: view_costs");
        return this.reorderReport(args);
      case "inventoryReports": {
        if (!user.permissions.includes("view_costs"))
          throw new Error("Permission required: view_costs");
        const stock = this.all(
          "SELECT p.id,p.name,p.sku,p.category,p.stock,p.reorder_level,p.image,COALESCE(SUM(b.remaining*b.unit_cost),0) value,MIN(CASE WHEN b.remaining>0 THEN SUBSTR(b.received_at,1,10) END) oldest FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.active=1 AND p.consignment_only=0 GROUP BY p.id ORDER BY value DESC LIMIT 100",
        );
        const balances = (kind) =>
          this.all(
            `SELECT p.id,p.name,p.phone,COALESCE((SELECT SUM(${kind === "customer" ? "debit-credit" : "credit-debit"}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) balance,COALESCE((SELECT SUM(MAX(0,d.total-d.paid-COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0))) FROM documents d WHERE d.party_id=p.id AND d.kind=? AND d.due_date IS NOT NULL AND d.due_date<?),0) overdue FROM parties p WHERE kind=? AND COALESCE(p.active,1)=1 ORDER BY balance DESC LIMIT 100`,
            kind === "customer" ? "receivables" : "payables",
            kind === "customer" ? "sale" : "purchase",
            today(),
            kind,
          );
        return {
          stock,
          customers: balances("customer"),
          suppliers: balances("supplier"),
        };
      }
      case "openingBalance": {
        if (user.role !== "Owner")
          throw new Error("Only the owner can enter opening balances.");
        const d = z
          .object({
            party_id: z.string(),
            amount: money.refine((n) => n > 0),
            date: date,
            request_key: z.string().min(8),
          })
          .parse(args);
        return this.transaction(() => {
          const prev = this.existingRequest(user, d.request_key, [
            "sale",
            "purchase",
          ]);
          if (prev) return this.getDocument(prev.id);
          const party = this.partyBalance(d.party_id);
          if (party.walk_in)
            throw new Error("Walk-in accounts cannot have opening debt.");
          const doc = this.document(
            party.kind === "customer" ? "sale" : "purchase",
            user,
            {
              party_id: party.id,
              total: d.amount,
              date: d.date,
              note: "Opening balance brought forward",
              request_key: d.request_key,
              category: "Opening balance",
            },
          );
          this.ledger(
            doc,
            party.kind === "customer"
              ? [
                  ["receivables", d.amount, 0, party.id],
                  ["equity", 0, d.amount],
                ]
              : [
                  ["equity", d.amount, 0],
                  ["payables", 0, d.amount, party.id],
                ],
          );
          this.audit(user, "Enter opening balance", doc.id, {
            party: party.name,
            amount: d.amount,
          });
          return doc;
        });
      }
      case "unitLookup":
      case "unitUpdate":
      case "deviceCatalog":
      case "devices":
        return unitCommand(this, user, command, args);
      case "globalSearch": {
        const d = z
          .object({
            q: z.string().max(100).default(""),
            limit: z.number().int().min(1).max(20).default(8),
          })
          .parse(args);
        const q = d.q.trim();
        if (!q) return { results: [] };
        const like = q.replace(/[\\%_]/g, "\\$&");
        const prefix = like + "%";
        const contains = "%" + like + "%";
        const results = [];
        const canProducts = user.permissions.some((p) =>
          ["inventory", "sales", "purchases"].includes(p),
        );
        const canPeople = user.permissions.includes("people");
        if (canProducts) {
          const products = this.all(
            `SELECT p.* FROM products p WHERE p.active=1 AND p.consignment_only=0 AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.model LIKE ? ESCAPE '\\' OR p.barcode=? COLLATE NOCASE OR IFNULL(p.barcode,'') LIKE ? ESCAPE '\\') ORDER BY p.name LIMIT ?`,
            contains,
            prefix,
            contains,
            contains,
            q.trim(),
            contains,
            d.limit,
          );
          for (const p of products) {
            p.attributes = JSON.parse(p.attributes);
            if (
              !user.permissions.includes("view_costs") &&
              !user.permissions.includes("purchases")
            ) {
              delete p.unit_cost;
              delete p.cost_aed;
              delete p.cost_foreign;
              delete p.fx_rate;
            }
            results.push({
              type: "product",
              id: p.id,
              title: p.name,
              subtitle: [p.brand, p.model, p.sku, p.barcode]
                .filter(Boolean)
                .join(" · "),
              meta: `${p.stock} in stock · ${p.category}`,
              product: p,
            });
          }
        }
        if (canPeople) {
          for (const kind of ["customer", "supplier"]) {
            const account = kind === "customer" ? "receivables" : "payables";
            const signed =
              kind === "customer" ? "debit-credit" : "credit-debit";
            const parties = this.all(
              `SELECT p.*,COALESCE((SELECT SUM(${signed}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) balance FROM parties p WHERE p.kind=? AND COALESCE(p.active,1)=1 AND (p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\' OR IFNULL(p.email,'') LIKE ? ESCAPE '\\') ORDER BY p.name LIMIT ?`,
              account,
              kind,
              contains,
              prefix,
              contains,
              d.limit,
            );
            for (const party of parties) {
              results.push({
                type: kind,
                id: party.id,
                title: party.name,
                subtitle: party.phone || party.email || kind,
                meta: party.balance,
                party,
              });
            }
          }
        }
        results.sort((a, b) => {
          const rank = { product: 0, customer: 1, supplier: 2 };
          return (
            (rank[a.type] ?? 9) - (rank[b.type] ?? 9) ||
            a.title.localeCompare(b.title)
          );
        });
        return { results: results.slice(0, d.limit * 2) };
      }
      case "productDetail": {
        if (
          !user.permissions.some((p) =>
            ["inventory", "sales", "purchases"].includes(p),
          )
        )
          throw new Error("Permission required: inventory or sales");
        const p = this.one("SELECT * FROM products WHERE id=?", args.id);
        if (!p) throw new Error("Product not found.");
        if (
          !user.permissions.includes("view_costs") &&
          !user.permissions.includes("purchases")
        ) {
          delete p.cost_aed;
          delete p.cost_foreign;
          delete p.fx_rate;
        }
        const movements = this.all(
          "SELECT m.*,d.number,d.kind FROM movements m JOIN documents d ON d.id=m.document_id WHERE product_id=? ORDER BY m.date DESC,m.rowid DESC LIMIT 100",
          p.id,
        );
        return {
          product: {
            ...p,
            unit_cost:
              user.permissions.includes("view_costs") ||
              user.permissions.includes("purchases")
                ? p.unit_cost
                : undefined,
            attributes: JSON.parse(p.attributes),
          },
          movements: user.permissions.includes("view_costs")
            ? movements
            : movements.map(({ cost, ...r }) => r),
        };
      }
      case "sale": {
        if (!user.permissions.includes("sales"))
          throw new Error("Permission required: sales");
        const doc = this.postTrade(user, { ...args, kind: "sale" });
        if (!user.permissions.includes("view_costs")) {
          delete doc.cost;
          delete doc.journal;
          doc.lines = doc.lines.map(({ cost, owner_unit_amount, ...l }) => l);
        }
        return doc;
      }
      case "saleEdit":
        return this.mutateSale(user, args, "edit");
      case "saleDelete":
        return this.mutateSale(user, args, "delete");
      case "purchase":
        return this.postTrade(user, { ...args, kind: "purchase" });
      case "purchaseEdit":
        return this.mutatePurchase(user, args, "edit");
      case "purchaseDelete":
        return this.mutatePurchase(user, args, "delete");
      case "documents": {
        if (
          !["sale", "purchase"].includes(args.kind) &&
          !user.permissions.includes("finance")
        )
          throw new Error("Permission required: finance");
        if (args.kind === "sale" && !user.permissions.includes("sales"))
          throw new Error("Permission required: sales");
        if (args.kind === "purchase" && !user.permissions.includes("purchases"))
          throw new Error("Permission required: purchases");
        const result = this.listDocuments(args);
        if (!user.permissions.includes("view_costs"))
          result.rows = result.rows.map(({ cost, ...r }) => r);
        return result;
      }
      case "document": {
        const doc = this.getDocument(args.id);
        const p = doc.kind.includes("sale")
          ? "sales"
          : doc.kind.includes("purchase")
            ? "purchases"
            : "finance";
        if (
          !user.permissions.includes(p) &&
          !(user.role === "Accountant" && user.permissions.includes("finance"))
        )
          throw new Error(`Permission required: ${p}`);
        if (!user.permissions.includes("view_costs")) {
          delete doc.cost;
          delete doc.journal;
          doc.lines = doc.lines.map(({ cost, owner_unit_amount, ...l }) => l);
        }
        return doc;
      }
      case "return": {
        const doc = this.getDocument(args.original_id);
        const p = doc.kind === "sale" ? "sales" : "purchases";
        if (
          (!user.permissions.includes(p) &&
            !(
              user.role === "Accountant" && user.permissions.includes("finance")
            )) ||
          !["Owner", "Manager", "Accountant"].includes(user.role)
        )
          throw new Error("Returns require manager or accountant permission.");
        return this.returnTrade(user, args);
      }
      case "adjust":
        return this.adjust(user, args);
      case "parties":
        return this.listParties(args);
      case "partyCreate":
        return this.createParty(user, args);
      case "partyUpdate":
        return this.updateParty(user, args);
      case "partyDelete":
        return this.deleteParty(user, args);
      case "customerSalesHistory": {
        const d = z.object({ id: z.string(), start: date.optional(), end: date.optional() }).parse(args);
        if (d.start && d.end && d.start > d.end) throw new Error("Start date must be before end date.");
        const party = this.partyBalance(d.id);
        if (party.kind !== "customer") throw new Error("Customer required.");
        const conditions = ["d.party_id=?", "d.kind='sale'", "d.category!='Opening balance'"];
        const params = [d.id];
        if (d.start) { conditions.push("d.date>=?"); params.push(d.start); }
        if (d.end) { conditions.push("d.date<=?"); params.push(d.end); }
        const rows = this.all(`SELECT d.id,d.number,d.date,d.total,d.paid,
          COALESCE((SELECT SUM(r.total) FROM documents r WHERE r.original_id=d.id AND r.kind='sale_return'),0) returned
          FROM documents d WHERE ${conditions.join(" AND ")} ORDER BY d.date DESC,d.created_at DESC,d.id DESC`, ...params);
        const lines = this.all(`SELECT l.document_id,l.quantity,COALESCE(s.name,p.name) name,
          COALESCE(s.brand,p.brand) brand,COALESCE(s.model,p.model) model,COALESCE(s.sku,p.sku) sku
          FROM document_lines l JOIN documents d ON d.id=l.document_id
          JOIN products p ON p.id=l.product_id LEFT JOIN document_product_snapshots s ON s.line_id=l.id
          WHERE ${conditions.join(" AND ")} ORDER BY l.rowid`, ...params);
        const byDocument = new Map();
        for (const line of lines) {
          if (!byDocument.has(line.document_id)) byDocument.set(line.document_id, []);
          byDocument.get(line.document_id).push(line);
        }
        for (const row of rows) {
          row.remaining = Math.max(0, row.total - row.returned - row.paid);
          row.lines = byDocument.get(row.id) || [];
        }
        const totals = rows.reduce((sum, row) => {
          for (const field of ["total", "paid", "returned", "remaining"]) sum[field] += row[field];
          return sum;
        }, { total: 0, paid: 0, returned: 0, remaining: 0 });
        return { party, rows, totals };
      }
      case "partyDetail": {
        const d = z
          .object({
            id: z.string(),
            after: z.string().default(""),
            limit: z.number().int().min(1).max(100).default(25),
            view: z.enum(["trade", "resale"]).default("trade"),
          })
          .parse(args);
        const party = this.partyBalance(d.id);
        if (
          d.view === "resale" &&
          (!user.permissions.includes("finance") ||
            !user.permissions.includes("view_costs") ||
            party.kind !== "customer")
        )
          throw new Error(
            "Permission required: finance and view_costs for customer resale.",
          );
        if (
          user.permissions.includes("finance") &&
          user.permissions.includes("view_costs")
        )
          party.consignment_balance = ownerBalance(this, party.id);
        const balance =
          d.view === "resale" ? party.consignment_balance : party.balance;
        const account =
          d.view === "resale"
            ? "consignment_payables"
            : party.kind === "customer"
              ? "receivables"
              : "payables";
        const signedSql =
          d.view === "resale"
            ? "credit-debit"
            : party.kind === "customer"
              ? "debit-credit"
              : "credit-debit";
        let clauses = ["j.party_id=?", "j.account=?"],
          params = [party.id, account];
        if (d.after) {
          const cursor = JSON.parse(
            Buffer.from(d.after, "base64url").toString("utf8"),
          );
          clauses.push(
            d.view === "resale"
              ? "(j.date < ? OR (j.date = ? AND j.rowid < ?))"
              : "(j.date < ? OR (j.date = ? AND j.id < ?))",
          );
          params.push(
            cursor.date,
            cursor.date,
            d.view === "resale" ? cursor.sequence : cursor.id,
          );
        }
        const rows = this.all(
          `SELECT j.*,j.rowid sequence,d.number,d.kind,d.note,d.due_date,d.category,d.currency,d.fx_rate,d.paid_foreign FROM journal j JOIN documents d ON d.id=j.document_id WHERE ${clauses.join(" AND ")} ORDER BY j.date DESC,${d.view === "resale" ? "j.rowid" : "j.id"} DESC LIMIT ?`,
          ...params,
          d.limit + 1,
        );
        const more = rows.length > d.limit;
        rows.length = Math.min(rows.length, d.limit);
        let page_start_balance = balance;
        if (rows[0]) {
          const newer = this.one(
            `SELECT COALESCE(SUM(${signedSql}),0) n FROM journal WHERE party_id=? AND account=? AND (date > ? OR (date = ? AND ${d.view === "resale" ? "rowid" : "id"} > ?))`,
            party.id,
            account,
            rows[0].date,
            rows[0].date,
            d.view === "resale" ? rows[0].sequence : rows[0].id,
          ).n;
          page_start_balance = balance - newer;
        }
        return {
          party,
          entries: rows,
          page_start_balance,
          next: more
            ? Buffer.from(
                JSON.stringify({
                  date: rows.at(-1).date,
                  id: rows.at(-1).id,
                  sequence: rows.at(-1).sequence,
                }),
              ).toString("base64url")
            : null,
          invoices: this.all(
            "SELECT d.*,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned FROM documents d WHERE party_id=? AND kind IN ('sale','purchase') ORDER BY date DESC LIMIT 100",
            party.id,
          ).map(({ cost, ...r }) =>
            user.permissions.includes("view_costs") ? { ...r, cost } : r,
          ),
        };
      }
      case "payment":
        return this.payment(user, args);
      case "paymentDelete":
        return this.deletePayment(user, args);
      case "expenseAccounts":
        return this.expenseAccounts(args);
      case "expenseAccountCreate": {
        const d = z
          .object({ name: z.string().trim().min(2).max(80) })
          .parse(args);
        return this.transaction(() => {
          if (
            this.one(
              "SELECT id FROM expense_accounts WHERE name=? COLLATE NOCASE",
              d.name,
            )
          )
            throw new Error(
              "An expense account with this name already exists.",
            );
          const accountId = id();
          this.run(
            "INSERT INTO expense_accounts VALUES (?,?,?)",
            accountId,
            d.name,
            now(),
          );
          this.audit(user, "Create expense account", accountId, {
            name: d.name,
          });
          return { id: accountId, name: d.name };
        });
      }
      case "consignments":
      case "consignmentReceive":
      case "consignmentReturn":
      case "consignmentPay":
      case "consignmentPayEdit": {
        if (!user.permissions.includes("view_costs"))
          throw new Error("Permission required: view_costs");
        if (
          ["consignmentReceive", "consignmentReturn"].includes(command) &&
          !user.permissions.includes("inventory")
        )
          throw new Error("Permission required: inventory");
        return {
          consignments,
          consignmentReceive: receiveConsignment,
          consignmentReturn: returnConsignment,
          consignmentPay: payConsignment,
          consignmentPayEdit: editConsignmentPay,
        }[command](
          this,
          ...(command === "consignments" ? [args] : [user, args]),
        );
      }
      case "expense":
        return this.expense(user, args);
      case "expenseUpdate":
        return this.expenseUpdate(user, args);
      case "reports":
        if (!user.permissions.includes("view_costs"))
          throw new Error("Permission required: view_costs");
        return this.reports(args);
      case "dayBook": {
        const book = this.dayBook(args);
        if (!user.permissions.includes("view_costs")) {
          for (const k of ["gross", "net", "cogs", "other"])
            delete book.totals[k];
          book.entries = book.entries.map(({ cost, ...r }) => r);
        }
        return book;
      }
      case "users":
        return this.all(
          "SELECT id,name,username,role,permissions,active,created_at FROM users ORDER BY created_at",
        ).map((u) => ({ ...u, permissions: JSON.parse(u.permissions) }));
      case "userCreate": {
        const d = userSchema.parse(args);
        if (user.role !== "Owner" && d.role === "Owner")
          throw new Error("Only the owner can create another owner.");
        const uid = id();
        this.transaction(() => {
          this.run(
            "INSERT INTO users VALUES (?,?,?,?,?,?,1,?)",
            uid,
            d.name,
            d.username,
            passwordHash(d.password),
            d.role,
            JSON.stringify(
              d.role === "Owner" ? PERMISSIONS : d.permissions || ROLES[d.role],
            ),
            now(),
          );
          this.audit(user, "Create user", uid, { name: d.name, role: d.role });
        });
        return { id: uid };
      }
      case "userPermissions": {
        const d = z
          .object({
            id: z.string(),
            role: userSchema.shape.role,
            permissions: z.array(z.enum(PERMISSIONS)),
          })
          .parse(args);
        const target = this.one("SELECT * FROM users WHERE id=?", d.id);
        if (!target) throw new Error("User not found.");
        if (
          user.role !== "Owner" &&
          (target.role === "Owner" || d.role === "Owner")
        )
          throw new Error("Only an owner can change owner access.");
        if (
          target.role === "Owner" &&
          d.role !== "Owner" &&
          (d.id === user.id ||
            this.one(
              "SELECT COUNT(*) n FROM users WHERE role='Owner' AND active=1",
            ).n < 2)
        )
          throw new Error("Keep an active owner with full access.");
        this.transaction(() => {
          this.run(
            "UPDATE users SET role=?,permissions=? WHERE id=?",
            d.role,
            JSON.stringify(d.role === "Owner" ? PERMISSIONS : d.permissions),
            d.id,
          );
          this.audit(user, "Update access rights", d.id, {
            role: d.role,
            permissions: d.permissions,
          });
        });
        return { ok: true };
      }
      case "userUpdate": {
        z.object({ id: z.string(), active: z.boolean() }).parse(args);
        const uid = args.id;
        if (uid === user.id)
          throw new Error("You cannot disable your own account.");
        const u = this.one("SELECT * FROM users WHERE id=?", uid);
        if (!u) throw new Error("User not found.");
        if (u.role === "Owner" && user.role !== "Owner")
          throw new Error("Only an owner can change another owner account.");
        if (
          u.role === "Owner" &&
          this.one(
            "SELECT COUNT(*) n FROM users WHERE role='Owner' AND active=1",
          ).n < 2
        )
          throw new Error("The last owner cannot be disabled.");
        this.run(
          "UPDATE users SET active=? WHERE id=?",
          args.active ? 1 : 0,
          uid,
        );
        this.audit(user, "Update user", uid, { active: !!args.active });
        return { ok: true };
      }
      case "backups":
        return {
          config: this.setting("backups"),
          availableTargets: this.backupTargets(),
          runs: this.all(
            "SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 60",
          ),
        };
      case "backupSettings": {
        const d = z
          .object({
            destinations: z.array(z.string().min(1).max(1000)).max(10),
            allDrives: z.boolean().optional(),
          })
          .parse(args);
        const destinations = [
          ...new Set(d.destinations.map((p) => path.resolve(p))),
        ];
        this.saveSetting("backups", {
          ...this.setting("backups"),
          destinations,
          ...(d.allDrives !== undefined ? { allDrives: d.allDrives } : {}),
          retryAfter: null,
        });
        this.audit(user, "Update backup destinations", "backups", {
          destinations,
        });
        return { ok: true };
      }
      case "backupCreate":
        return this.createBackup(user, args);
      case "backupVerify": {
        const f = z.string().parse(args.path);
        const known = this.one(
          "SELECT * FROM backup_runs WHERE path=? AND status='verified'",
          f,
        );
        if (!known) throw new Error("Choose a known verified backup.");
        if (!existsSync(f)) throw new Error("Backup drive is disconnected.");
        const checksum = fileChecksum(f);
        if (checksum !== known.checksum)
          throw new Error("Backup checksum mismatch.");
        const db = new DatabaseSync(f, { readOnly: true });
        try {
          if (
            Object.values(db.prepare("PRAGMA integrity_check").get())[0] !==
              "ok" ||
            db.prepare("PRAGMA foreign_key_check").all().length
          )
            throw new Error("Integrity check failed.");
          return {
            ok: true,
            products: db.prepare("SELECT COUNT(*) n FROM products").get().n,
            documents: db.prepare("SELECT COUNT(*) n FROM documents").get().n,
          };
        } finally {
          db.close();
        }
      }
      case "currencies":
        return this.currencies();
      case "productCategories":
        return this.productCategories();
      case "currencyCreate": {
        if (
          !user.permissions.some((p) =>
            ["settings", "purchases", "inventory", "finance"].includes(p),
          )
        )
          throw new Error(
            "Permission required: settings, purchases, inventory or finance",
          );
        const d = z
          .object({
            code: z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^[A-Z]{3}$/),
            name: text.min(2).max(80),
            country: z
              .string()
              .regex(/^[a-z]{2}$/)
              .refine(
                (c) => SUPPORTED_FLAG_COUNTRIES.includes(c),
                "Choose a valid country flag.",
              ),
          })
          .parse(args);
        return this.transaction(() => {
          const rows = this.currencies();
          const existing = rows.find((c) => c.code === d.code);
          if (existing) {
            if (existing.name === d.name && existing.country === d.country)
              return existing;
            throw new Error("Currency code already exists.");
          }
          if (rows.length >= 300) throw new Error("Currency limit reached.");
          this.saveSetting("currencies", [...rows, d]);
          this.audit(user, "Add currency", d.code, d);
          return d;
        });
      }
      case "settings":
        return {
          store: this.storeBill(),
          closedThrough: this.setting("closedThrough"),
        };
      case "saveSettings": {
        const logoField = z
          .string()
          .max(900_000)
          .default("")
          .refine(
            (v) =>
              !v || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(v),
            "Logo must be a PNG, JPG, WEBP or GIF image.",
          );
        const d = z
          .object({
            name: text.min(2),
            name_ps: text.default(""),
            phone: text.default(""),
            address: text.default(""),
            address_ps: text.default(""),
            email: text.default(""),
            logo: logoField,
            logo_left: logoField,
            logo_right: logoField,
            services: text.default(""),
            owner1_name: text.default(""),
            owner1_phone: text.default(""),
            owner1_whatsapp: text.default(""),
            owner2_name: text.default(""),
            owner2_phone: text.default(""),
            owner2_whatsapp: text.default(""),
            bill_footer: text.default(""),
            language: z.enum(["en", "ps", "prs"]).default("en"),
          })
          .parse(args);
        const prev = this.setting("store") || {};
        const next = { ...prev, ...d };
        // Keep legacy `logo` in sync with left logo; migrate old single logo once.
        if (!next.logo_left && next.logo) next.logo_left = next.logo;
        if (next.logo_left && !next.logo) next.logo = next.logo_left;
        this.saveSetting("store", next);
        this.audit(user, "Update store settings", "store", {
          name: d.name,
          name_ps: d.name_ps,
          phone: d.phone,
          address: d.address,
          address_ps: d.address_ps,
          email: d.email,
          services: d.services,
          owner1_name: d.owner1_name,
          owner2_name: d.owner2_name,
          bill_footer: d.bill_footer,
          language: d.language,
          logo_left: d.logo_left || d.logo ? "[logo updated]" : "",
          logo_right: d.logo_right ? "[logo updated]" : "",
        });
        return { ok: true };
      }
      case "closePeriod": {
        const day = date.parse(args.date);
        if (day > today()) throw new Error("Cannot close a future period.");
        this.saveSetting("closedThrough", day);
        this.audit(user, "Close accounting period", day);
        return { ok: true };
      }
      case "capitalReport": {
        if (
          !user.permissions.some((p) =>
            ["finance", "reports", "view_costs"].includes(p),
          )
        )
          throw new Error("Permission required: finance or reports");
        return this.capitalReport(args);
      }
      case "ownerMovement": {
        const d = z
          .object({
            direction: z.enum(["deposit", "withdrawal"]),
            amount: money.refine((n) => n > 0),
            note: text.min(2),
            date: date.optional(),
            request_key: z.string().min(8),
          })
          .parse(args);
        return this.transaction(() => {
          const prev = this.existingRequest(user, d.request_key, ["owner"]);
          if (prev) return this.getDocument(prev.id);
          const doc = this.document("owner", user, {
            total: d.amount,
            paid: d.amount,
            note: d.note,
            request_key: d.request_key,
            ...(d.date ? { date: d.date } : {}),
          });
          this.ledger(
            doc,
            d.direction === "deposit"
              ? [
                  ["cash", d.amount, 0],
                  ["equity", 0, d.amount],
                ]
              : [
                  ["equity", d.amount, 0],
                  ["cash", 0, d.amount],
                ],
          );
          this.audit(user, "Owner cash movement", doc.id, {
            direction: d.direction,
            amount: d.amount,
          });
          return doc;
        });
      }
      case "audit":
        return this.all(
          "SELECT a.*,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200",
        );
      default:
        throw new Error("Unknown operation.");
    }
  }
  close() {
    this.db.close();
  }
  seed() {
    const uid = id();
    this.run(
      "INSERT INTO users VALUES (?,?,?,?,?,?,1,?)",
      uid,
      "Hussain Ahmad",
      "owner",
      passwordHash("vault-demo-2026"),
      "Owner",
      JSON.stringify(PERMISSIONS),
      now(),
    );
    const user = this.publicUser(
      this.one("SELECT * FROM users WHERE id=?", uid),
    );
    this.saveSetting("store", {
      ...this.setting("store"),
      name: "Kabul Electronics",
      demo: true,
      phone: "+93 700 123 456",
      address: "Kabul, Afghanistan",
    });
    const walk = id();
    this.run(
      "INSERT INTO parties(id,kind,name,phone,email,address,credit_limit,walk_in,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      walk,
      "customer",
      "Walk-in customer",
      "",
      "",
      "",
      0,
      1,
      now(),
    );
    const c1 = this.createParty(user, {
      kind: "customer",
      name: "Ahmad Zia",
      phone: "+93 700 234 567",
    }).id;
    this.createParty(user, {
      kind: "customer",
      name: "Fatima Rahimi",
      phone: "+93 790 456 789",
    });
    this.createParty(user, {
      kind: "customer",
      name: "Omid Technologies",
      phone: "+93 780 345 678",
    });
    const supplier = this.createParty(user, {
      kind: "supplier",
      name: "Pamir Technology",
      phone: "+93 700 111 222",
      address: "Kabul Electronics Market",
    }).id;
    this.createParty(user, {
      kind: "supplier",
      name: "Ariana Distribution",
      phone: "+93 790 111 333",
    });
    const items = [
      [
        "MacBook Air M3",
        "Apple",
        "MacBook Air",
        "Computers",
        7250000,
        6300000,
        18,
        "laptop",
        "8 GB",
        "256 GB",
      ],
      [
        "iPhone 15 Pro",
        "Apple",
        "iPhone 15 Pro",
        "Mobiles",
        6450000,
        5400000,
        24,
        "phone",
        "8 GB",
        "256 GB",
      ],
      [
        "iPad Air M2",
        "Apple",
        "iPad Air",
        "Tablets",
        3850000,
        3100000,
        16,
        "tablet",
        "8 GB",
        "128 GB",
      ],
      [
        "ThinkPad X1 Carbon",
        "Lenovo",
        "ThinkPad X1",
        "Computers",
        6800000,
        5700000,
        12,
        "laptop",
        "16 GB",
        "512 GB",
      ],
      [
        "Galaxy S24 Ultra",
        "Samsung",
        "Galaxy S24 Ultra",
        "Mobiles",
        7200000,
        6100000,
        20,
        "phone",
        "12 GB",
        "256 GB",
      ],
      [
        "Sony WH-1000XM5",
        "Sony",
        "WH-1000XM5",
        "Accessories",
        1750000,
        1320000,
        28,
        "headphones",
        "",
        "",
      ],
      [
        "Samsung 990 Pro 1TB",
        "Samsung",
        "990 Pro",
        "Storage",
        780000,
        580000,
        32,
        "storage",
        "",
        "1 TB",
      ],
      [
        "USB-C Power Adapter",
        "Anker",
        "Nano 65W",
        "Accessories",
        185000,
        110000,
        46,
        "adapter",
        "",
        "",
      ],
      [
        "WD Elements 2TB",
        "Western Digital",
        "Elements",
        "Storage",
        490000,
        350000,
        18,
        "storage",
        "",
        "2 TB",
      ],
      [
        "AirPods Pro 2",
        "Apple",
        "AirPods Pro",
        "Accessories",
        1400000,
        1080000,
        22,
        "headphones",
        "",
        "",
      ],
    ];
    const products = [];
    const firstDay = today().slice(0, 7) + "-01";
    this.transaction(() => {
      const opening = this.document("opening", user, {
        date: firstDay,
        note: "Demo opening capital",
        total: 1_000_000_000,
      });
      this.ledger(opening, [
        ["cash", 1_000_000_000, 0],
        ["equity", 0, 1_000_000_000],
      ]);
    });
    for (let i = 0; i < items.length; i++) {
      const [
        name,
        brand,
        model,
        category,
        price,
        cost,
        qty,
        img,
        ram,
        storage,
      ] = items[i];
      const p = this.createProduct(user, {
        serialized: false,
        name,
        brand,
        model,
        category,
        sku: `VLT-${String(i + 1).padStart(4, "0")}`,
        barcode: `1000000000${String(i + 1).padStart(3, "0")}`,
        price,
        minimum: Math.round(price * 0.9),
        reorder_level: 5,
        location: `A-${i + 1}`,
        warranty: "12 months",
        attributes: {
          RAM: ram,
          Storage: storage,
          Color: i % 2 ? "Space Black" : "Silver",
        },
        image: `/assets/${img}.png`,
      }).id;
      products.push(p);
      this.postTrade(user, {
        kind: "purchase",
        party_id: supplier,
        date: firstDay,
        paid: Math.round(qty * cost * 0.7),
        request_key: id(),
        lines: [
          {
            product_id: p,
            quantity: qty,
            price: cost,
          },
        ],
      });
    }
    const days = Number(today().slice(-2));
    for (let day = 1; day <= days; day++) {
      for (let s = 0; s < (day % 3) + 1; s++) {
        const pi = (day * 3 + s) % products.length,
          p = this.one("SELECT * FROM products WHERE id=?", products[pi]);
        if (p.stock <= 0) continue;
        this.postTrade(user, {
          kind: "sale",
          party_id: s % 2 ? c1 : walk,
          date: `${today().slice(0, 8)}${String(day).padStart(2, "0")}`,
          paid: s % 2 ? Math.floor(p.price * 0.7) : p.price,
          request_key: id(),
          lines: [
            {
              product_id: p.id,
              quantity: 1,
              price: p.price,
            },
          ],
        });
      }
      if (day % 3 === 0)
        this.expense(user, {
          amount: (120 + day * 9) * 100,
          category: ["Utilities", "Transport", "Other"][day % 3],
          note:
            day % 2
              ? "Store electricity and utilities"
              : "Local delivery costs",
          date: `${today().slice(0, 8)}${String(day).padStart(2, "0")}`,
          request_key: id(),
        });
    }
    this.run(
      "UPDATE products SET reorder_level=stock+2 WHERE sku IN ('VLT-0004','VLT-0007','VLT-0009')",
    );
  }
}
