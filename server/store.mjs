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
  positive = z.number().int().min(1).max(1_000_000);
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
const productSchema = z.object({
  name: text.min(2),
  brand: text.min(1),
  model: text.min(1),
  sku: text.min(1),
  barcode: text.default(""),
  category: z.enum([
    "Computers",
    "Mobiles",
    "Tablets",
    "Storage",
    "Accessories",
  ]),
  price: money,
  minimum: money.default(0),
  reorder_level: z.number().int().min(0).max(1_000_000).default(5),
  location: text.default(""),
  condition: z.enum(["New", "Used", "Refurbished"]).default("New"),
  warranty: text.default(""),
  attributes: z.record(z.string(), z.string().max(200)).default({}),
  image: text.default(""),
  unit_cost: money.optional(),
  opening_quantity: z.number().int().min(0).max(100000).default(0),
});
const lineSchema = z.object({
  product_id: z.string(),
  quantity: positive,
  price: money,
  discount: money.default(0),
});
const docSchema = z.object({
  kind: z.enum(["sale", "purchase"]),
  party_id: z.string().nullable().optional(),
  date: date.optional(),
  due_date: date.nullable().optional(),
  paid: money,
  discount: money.default(0),
  note: text.default(""),
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
    if (version > 1)
      throw new Error("This database requires a newer version of Vault Store.");
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
    this.sessions = new Map();
    this.attempts = new Map();
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
    const s = this.sessions.get(token);
    if (!s || s.expires < Date.now())
      throw new Error("SESSION_EXPIRED: Please sign in again.");
    const u = this.one("SELECT * FROM users WHERE id=? AND active=1", s.id);
    if (!u) throw new Error("SESSION_EXPIRED: User is disabled.");
    s.expires = Date.now() + 8 * 3600_000;
    const user = this.publicUser(u);
    if (permission && !user.permissions.includes(permission))
      throw new Error(`Permission required: ${permission}`);
    return user;
  }
  session(user) {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, {
      id: user.id,
      expires: Date.now() + 8 * 3600_000,
    });
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
        "INSERT INTO parties VALUES (?,?,?,?,?,?,?,?,?)",
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
    const a = this.attempts.get(name) || { count: 0, until: 0 };
    if (a.until > Date.now())
      throw new Error("Too many attempts. Try again in five minutes.");
    const u = this.one(
      "SELECT * FROM users WHERE username=? AND active=1",
      name,
    );
    if (!u || !passwordValid(pass, u.password)) {
      a.count++;
      if (a.count >= 5) a.until = Date.now() + 300_000;
      this.attempts.set(name, a);
      throw new Error("Incorrect username or password.");
    }
    this.attempts.delete(name);
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
    };
    const number =
      data.number ||
      `${prefixes[kind]}-${String(this.one("UPDATE sequences SET value=value+1 WHERE name='documents' RETURNING value").value).padStart(6, "0")}`;
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
    if (d.date > today())
      throw new Error("Future transactions are not allowed.");
    const closed = this.setting("closedThrough");
    if (closed && d.date <= closed)
      throw new Error("This accounting period is closed.");
    this.run(
      "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      costs = [];
    if (line.quantity - remainder)
      costs.push({ qty: line.quantity - remainder, cost: base });
    if (remainder) costs.push({ qty: remainder, cost: base + 1 });
    for (const c of costs) {
      this.run(
        "INSERT INTO batches VALUES (?,?,?,?,?,?,?)",
        id(),
        product.id,
        line.id,
        c.qty,
        c.qty,
        c.cost,
        doc.created_at || `${doc.date}T${now().slice(11)}`,
      );
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
    const batches = this.all(
      "SELECT * FROM batches WHERE product_id=? AND remaining>0 AND SUBSTR(received_at,1,10)<=? ORDER BY received_at,rowid",
      product.id,
      doc.date,
    );
    let remaining = line.quantity,
      cost = 0;
    for (const b of batches) {
      if (!remaining) break;
      const q = Math.min(remaining, b.remaining);
      this.run("UPDATE batches SET remaining=remaining-? WHERE id=?", q, b.id);
      this.run(
        "INSERT INTO allocations VALUES (?,?,?,?,?,0)",
        id(),
        line.id,
        b.id,
        q,
        q * b.unit_cost,
      );
      cost += q * b.unit_cost;
      remaining -= q;
    }
    if (remaining) throw new Error(`Insufficient stock for ${product.name}.`);
    this.move(doc, product, -line.quantity, -cost);
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
  createProduct(user, data) {
    const d = productSchema.parse(data);
    if (d.minimum > d.price)
      throw new Error("Minimum price cannot exceed selling price.");
    return this.transaction(() => {
      const pid = id();
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
        0,
        d.image,
        now(),
      );
      this.run(
        "UPDATE products SET unit_cost=? WHERE id=?",
        d.unit_cost || 0,
        pid,
      );
      if (d.opening_quantity) {
        if (d.unit_cost === undefined)
          throw new Error("Enter the unit cost for opening stock.");
        this.adjust(user, {
          product_id: pid,
          quantity: d.opening_quantity,
          cost: d.unit_cost,
          note: "Opening stock at product creation",
          opening: true,
          request_key: `product-opening-${pid}`,
        });
      }
      this.audit(user, "Create product", pid, { name: d.name });
      return { id: pid };
    });
  }
  postTrade(user, input, identity = {}) {
    const d = docSchema.parse(input);
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
      let total = 0;
      for (const l of d.lines) {
        if (l.discount > l.price * l.quantity)
          throw new Error("Discount exceeds line value.");
        total += l.price * l.quantity - l.discount;
      }
      if (!Number.isSafeInteger(total) || total > 1e12)
        throw new Error("Invoice exceeds supported amount.");
      if (d.paid > total) throw new Error("Payment exceeds invoice total.");
      if (party.walk_in && d.paid !== total)
        throw new Error("Walk-in sales must be paid in full.");
      if (
        d.kind === "sale" &&
        party.credit_limit &&
        this.partyBalance(party.id).balance + (total - d.paid) >
          party.credit_limit
      )
        throw new Error("Customer credit limit exceeded.");
      if (d.due_date && d.due_date < (d.date || today()))
        throw new Error("Due date cannot be before the invoice date.");
      const doc = this.document(d.kind, user, { ...d, total, ...identity });
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
        const line = {
          ...l,
          id: id(),
          cost: d.kind === "purchase" ? l.price * l.quantity - l.discount : 0,
        };
        this.run(
          "INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,NULL)",
          line.id,
          doc.id,
          p.id,
          l.quantity,
          l.price,
          line.cost,
          l.discount,
        );
        if (d.kind === "sale") {
          line.cost = this.consume(p, line, doc);
          this.run(
            "UPDATE document_lines SET cost=? WHERE id=?",
            line.cost,
            line.id,
          );
        } else this.receive(p, line, doc);
        cost += line.cost;
      }
      this.run("UPDATE documents SET cost=? WHERE id=?", cost, doc.id);
      if (d.kind === "sale")
        this.ledger(doc, [
          ["cash", d.paid, 0],
          ["receivables", total - d.paid, 0, party.id],
          ["sales", 0, total],
          ["cost_of_goods", cost, 0],
          ["inventory", 0, cost],
        ]);
      else
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
      if (action === "delete" && d.confirmation !== old.number)
        throw new Error(
          "Type the exact invoice number to confirm hard deletion.",
        );
      // Restore the exact cost batches, then remove the original posting in one transaction.
      for (const line of old.lines) {
        const allocations = this.all(
          "SELECT * FROM allocations WHERE line_id=?",
          line.id,
        );
        for (const allocation of allocations) {
          if (allocation.returned)
            throw new Error("Returned allocations cannot be changed.");
          this.run(
            "UPDATE batches SET remaining=remaining+? WHERE id=?",
            allocation.quantity,
            allocation.batch_id,
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
  getDocument(did) {
    const doc = this.one(
      "SELECT d.*,p.name party_name,u.name user_name,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned FROM documents d LEFT JOIN parties p ON p.id=d.party_id LEFT JOIN users u ON u.id=d.user_id WHERE d.id=?",
      did,
    );
    if (!doc) throw new Error("Document not found.");
    doc.lines = this.all(
      "SELECT l.*,COALESCE(s.name,p.name) name,COALESCE(s.sku,p.sku) sku,COALESCE(s.image,p.image) image,COALESCE((SELECT SUM(quantity) FROM document_lines r WHERE r.original_line_id=l.id),0) returned_quantity FROM document_lines l JOIN products p ON p.id=l.product_id LEFT JOIN document_product_snapshots s ON s.line_id=l.id WHERE document_id=?",
      did,
    );
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
        credit_limit: money.default(0),
      })
      .parse(data);
    return this.transaction(() => {
      const pid = id();
      this.run(
        "INSERT INTO parties VALUES (?,?,?,?,?,?,?,?,?)",
        pid,
        d.kind,
        d.name,
        d.phone,
        d.email,
        d.address,
        d.credit_limit,
        0,
        now(),
      );
      this.audit(user, "Create contact", pid, { name: d.name });
      return { id: pid };
    });
  }
  payment(user, input) {
    const d = z
      .object({
        party_id: z.string(),
        amount: money.refine((n) => n > 0),
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
      if (d.amount > p.balance)
        throw new Error("Payment exceeds the outstanding balance.");
      const kind = p.kind === "customer" ? "receipt" : "payment";
      const doc = this.document(kind, user, {
        ...d,
        total: d.amount,
        paid: d.amount,
      });
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
  expense(user, input) {
    const d = z
      .object({
        amount: money.refine((n) => n > 0),
        category: z.enum([
          "Rent",
          "Salaries",
          "Utilities",
          "Transport",
          "Repairs",
          "Other",
        ]),
        note: text.min(2),
        date: date.optional(),
        request_key: z.string().min(8),
      })
      .parse(input);
    return this.transaction(() => {
      const prev = this.existingRequest(user, d.request_key, ["expense"]);
      if (prev) return this.getDocument(prev.id);
      const doc = this.document("expense", user, {
        ...d,
        total: d.amount,
        paid: d.amount,
      });
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
  returnTrade(user, input) {
    const d = z
      .object({
        original_id: z.string(),
        lines: z
          .array(
            z.object({
              line_id: z.string(),
              quantity: positive,
            }),
          )
          .min(1),
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
        if (original.kind === "purchase") {
          let remaining = l.quantity;
          amount = 0;
          const batches = this.all(
            "SELECT b.* FROM batches b WHERE b.line_id=? AND b.remaining>0 ORDER BY b.id",
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
      const doc = this.document(kind, user, {
        ...d,
        party_id: original.party_id,
        total,
        paid: refund,
      });
      for (const r of prepared) {
        const ol = r.original,
          p = this.one("SELECT * FROM products WHERE id=?", ol.product_id),
          lid = id();
        let lineCost = 0;
        this.run(
          "INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,?)",
          lid,
          doc.id,
          p.id,
          r.quantity,
          ol.price,
          0,
          ol.price * r.quantity - r.amount,
          ol.id,
        );
        if (kind === "sale_return") {
          let remaining = r.quantity;
          const allocations = this.all(
            "SELECT a.*,b.unit_cost FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.line_id=? AND a.returned<a.quantity",
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
            lineCost += q * a.unit_cost;
            remaining -= q;
          }
          if (remaining)
            throw new Error("Original cost allocation could not be restored.");
          this.move(doc, p, r.quantity, lineCost);
        } else {
          let remaining = r.quantity;
          const batches = this.all(
            "SELECT * FROM batches WHERE line_id=? AND remaining>0 ORDER BY id",
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
          ["inventory", cost, 0],
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
        quantity: z
          .number()
          .int()
          .min(-1_000_000)
          .max(1_000_000)
          .refine((n) => n !== 0),
        cost: money.default(0),
        note: text.min(3),
        request_key: z.string().min(8),
        opening: z.boolean().default(false),
      })
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
      const l = {
        id: id(),
        quantity: Math.abs(d.quantity),
        cost: Math.abs(d.quantity) * d.cost,
      };
      this.run(
        "INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,NULL)",
        l.id,
        doc.id,
        p.id,
        l.quantity,
        d.cost,
        l.cost,
        0,
      );
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
        id: z.string().optional(),
        category: z.string().max(30).default("All products"),
        filter: z.string().default("all"),
        after: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(args);
    let clauses = ["p.active=1"],
      params = [];
    if (d.id) {
      clauses.push("p.id=?");
      params.push(d.id);
    }
    if (d.q) {
      clauses.push(
        "(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode=?)",
      );
      const q = d.q.replace(/[\\%_]/g, "\\$&") + "%";
      params.push(q, q, d.q);
    }
    if (d.category !== "All products") {
      clauses.push("p.category=?");
      params.push(d.category);
    }
    if (d.filter === "low") clauses.push("p.stock<=p.reorder_level");
    if (d.after) {
      clauses.push("p.sku>?");
      params.push(d.after);
    }
    const rows = this.all(
      `SELECT p.* FROM products p WHERE ${clauses.join(" AND ")} ORDER BY p.sku LIMIT ?`,
      ...params,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    rows.length = Math.min(rows.length, d.limit);
    for (const p of rows) {
      p.attributes = JSON.parse(p.attributes);
      if (
        !user?.permissions.includes("view_costs") &&
        !user?.permissions.includes("purchases")
      )
        delete p.unit_cost;
      if (
        user?.permissions.includes("view_costs") ||
        user?.permissions.includes("purchases")
      )
        p.cost = this.one(
          "SELECT COALESCE(SUM(remaining*unit_cost),0) cost FROM batches WHERE product_id=? AND remaining>0",
          p.id,
        ).cost;
    }
    return { rows, next: more ? rows.at(-1).sku : null };
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
      "SELECT COUNT(*) products,COALESCE(SUM(stock),0) units,COALESCE(SUM(CASE WHEN stock<=reorder_level THEN 1 ELSE 0 END),0) low FROM products WHERE active=1",
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
      "SELECT category,SUM(stock) stock FROM products WHERE active=1 GROUP BY category ORDER BY stock DESC",
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
      `SELECT p.id,p.name,p.category,p.image,SUM(CASE WHEN d.kind='sale' THEN l.quantity ELSE -l.quantity END) quantity,SUM(CASE WHEN d.kind='sale' THEN l.price*l.quantity-l.discount ELSE -(l.price*l.quantity-l.discount) END) revenue,SUM(CASE WHEN d.kind='sale' THEN l.cost ELSE -l.cost END) cost FROM document_lines l JOIN documents d ON d.id=l.document_id JOIN products p ON p.id=l.product_id WHERE d.kind IN ('sale','sale_return') AND d.date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 100`,
      range.from,
      range.to,
    );
    const expenses = this.all(
      "SELECT category,SUM(total) amount FROM documents WHERE kind='expense' AND date BETWEEN ? AND ? GROUP BY category",
      range.from,
      range.to,
    );
    return { totals, days, trial, best, expenses };
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
      })
      .parse(input);
    const clauses = ["1=1"],
      params = [];
    if (d.kind !== "all") {
      clauses.push("d.kind=?");
      params.push(d.kind);
    }
    if (d.q) {
      clauses.push("(d.number LIKE ? OR p.name LIKE ?)");
      params.push(d.q + "%", d.q + "%");
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
    const rows = this.all(
      `SELECT d.*,p.name party_name,COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0) returned FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE ${clauses.join(" AND ")} ORDER BY d.created_at DESC,d.id DESC LIMIT ?`,
      ...params,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    rows.length = Math.min(rows.length, d.limit);
    return {
      rows,
      next: more
        ? Buffer.from(
            JSON.stringify([rows.at(-1).created_at, rows.at(-1).id]),
          ).toString("base64url")
        : null,
    };
  }
  listParties(input = {}) {
    const d = z
      .object({
        kind: z.enum(["customer", "supplier"]),
        q: z.string().max(100).default(""),
        after: z.string().default(""),
      })
      .parse(input);
    const account = d.kind === "customer" ? "receivables" : "payables";
    const rows = this.all(
      `SELECT p.*,COALESCE((SELECT SUM(${d.kind === "customer" ? "debit-credit" : "credit-debit"}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) balance FROM parties p WHERE p.kind=? AND p.name LIKE ? AND p.id>? ORDER BY p.id LIMIT 101`,
      account,
      d.kind,
      d.q + "%",
      d.after,
    );
    const more = rows.length > 100;
    rows.length = Math.min(rows.length, 100);
    return { rows, next: more ? rows.at(-1).id : null };
  }
  async createBackup(user, { destination, automatic = false } = {}) {
    if (this.backupBusy) throw new Error("A backup is already running.");
    this.backupBusy = true;
    const config = this.setting("backups");
    const targets = destination
      ? [path.resolve(destination)]
      : config.destinations;
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
          const folder = path.join(dest, "Vault Store Backups");
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
          lastSuccess: now(),
          ...(automatic ? { lastAutomatic: now() } : {}),
          retryAfter: null,
        });
      else if (automatic)
        this.saveSetting("backups", {
          ...config,
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
  async automaticBackup() {
    const c = this.setting("backups");
    if (
      c.destinations.length &&
      (!c.lastAutomatic ||
        Date.now() - Date.parse(c.lastAutomatic) >= 86400_000) &&
      (!c.retryAfter || Date.now() >= Date.parse(c.retryAfter))
    ) {
      return this.createBackup(null, { automatic: true });
    }
    return { skipped: true };
  }
  async dispatch(command, args = {}, token) {
    if (command === "status")
      return {
        setup: !this.one("SELECT id FROM users LIMIT 1"),
        store: this.setting("store"),
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
      inventoryReports: "reports",
      openingBalance: "finance",
      productDetail: "inventory",
      adjust: "inventory",
      sale: "sales",
      purchase: "purchases",
      parties: "people",
      partyCreate: "people",
      partyDetail: "people",
      payment: "finance",
      expense: "finance",
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
    switch (command) {
      case "me":
        return user;
      case "logout":
        this.sessions.delete(token);
        return { ok: true };
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
      case "productCreate":
        return this.createProduct(user, args);
      case "productUpdate": {
        const d = productSchema.parse(args);
        const existing = this.one("SELECT * FROM products WHERE id=?", args.id);
        if (!existing) throw new Error("Product not found.");
        if (d.minimum > d.price)
          throw new Error("Minimum price cannot exceed selling price.");
        return this.transaction(() => {
          this.run(
            "UPDATE products SET sku=?,barcode=?,name=?,brand=?,model=?,category=?,price=?,minimum=?,reorder_level=?,location=?,condition=?,warranty=?,attributes=?,serialized=0,image=? WHERE id=?",
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
            d.image,
            existing.id,
          );
          if (d.unit_cost !== undefined)
            this.run(
              "UPDATE products SET unit_cost=? WHERE id=?",
              d.unit_cost,
              existing.id,
            );
          this.audit(user, "Update product", existing.id, {
            name: d.name,
            price: d.price,
          });
          return { id: existing.id };
        });
      }
      case "inventoryReports": {
        if (!user.permissions.includes("view_costs"))
          throw new Error("Permission required: view_costs");
        const stock = this.all(
          "SELECT p.id,p.name,p.sku,p.category,p.stock,p.reorder_level,p.image,COALESCE(SUM(b.remaining*b.unit_cost),0) value,MIN(CASE WHEN b.remaining>0 THEN SUBSTR(b.received_at,1,10) END) oldest FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.active=1 GROUP BY p.id ORDER BY value DESC LIMIT 100",
        );
        const balances = (kind) =>
          this.all(
            `SELECT p.id,p.name,p.phone,COALESCE((SELECT SUM(${kind === "customer" ? "debit-credit" : "credit-debit"}) FROM party_totals j WHERE j.party_id=p.id AND j.account=?),0) balance,COALESCE((SELECT SUM(MAX(0,d.total-d.paid-COALESCE((SELECT SUM(total) FROM documents r WHERE r.original_id=d.id),0))) FROM documents d WHERE d.party_id=p.id AND d.kind=? AND d.due_date IS NOT NULL AND d.due_date<?),0) overdue FROM parties p WHERE kind=? ORDER BY balance DESC LIMIT 100`,
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
      case "deviceCatalog":
      case "devices":
        return [];
      case "productDetail": {
        const p = this.one("SELECT * FROM products WHERE id=?", args.id);
        if (!p) throw new Error("Product not found.");
        const movements = this.all(
          "SELECT m.*,d.number,d.kind FROM movements m JOIN documents d ON d.id=m.document_id WHERE product_id=? ORDER BY m.date DESC,m.id DESC LIMIT 100",
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
          doc.lines = doc.lines.map(({ cost, ...l }) => l);
        }
        return doc;
      }
      case "saleEdit":
        return this.mutateSale(user, args, "edit");
      case "saleDelete":
        return this.mutateSale(user, args, "delete");
      case "purchase":
        return this.postTrade(user, { ...args, kind: "purchase" });
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
        if (!user.permissions.includes(p))
          throw new Error(`Permission required: ${p}`);
        if (!user.permissions.includes("view_costs")) {
          delete doc.cost;
          delete doc.journal;
          doc.lines = doc.lines.map(({ cost, ...l }) => l);
        }
        return doc;
      }
      case "return": {
        const doc = this.getDocument(args.original_id);
        const p = doc.kind === "sale" ? "sales" : "purchases";
        if (
          !user.permissions.includes(p) ||
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
      case "partyDetail": {
        const party = this.partyBalance(args.id);
        const account = party.kind === "customer" ? "receivables" : "payables";
        return {
          party,
          entries: this.all(
            "SELECT j.*,d.number,d.kind,d.note,d.due_date FROM journal j JOIN documents d ON d.id=j.document_id WHERE j.party_id=? AND j.account=? ORDER BY j.date DESC,j.rowid DESC LIMIT 500",
            party.id,
            account,
          ).reverse(),
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
      case "expense":
        return this.expense(user, args);
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
          runs: this.all(
            "SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 60",
          ),
        };
      case "backupSettings": {
        const d = z
          .object({
            destinations: z.array(z.string().min(1).max(1000)).max(10),
          })
          .parse(args);
        const destinations = [
          ...new Set(d.destinations.map((p) => path.resolve(p))),
        ];
        this.saveSetting("backups", {
          ...this.setting("backups"),
          destinations,
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
      case "settings":
        return {
          store: this.setting("store"),
          closedThrough: this.setting("closedThrough"),
        };
      case "saveSettings": {
        const d = z
          .object({
            name: text.min(2),
            phone: text.default(""),
            address: text.default(""),
          })
          .parse(args);
        this.saveSetting("store", { ...this.setting("store"), ...d });
        this.audit(user, "Update store settings", "store", d);
        return { ok: true };
      }
      case "closePeriod": {
        const day = date.parse(args.date);
        if (day > today()) throw new Error("Cannot close a future period.");
        this.saveSetting("closedThrough", day);
        this.audit(user, "Close accounting period", day);
        return { ok: true };
      }
      case "ownerMovement": {
        const d = z
          .object({
            direction: z.enum(["deposit", "withdrawal"]),
            amount: money.refine((n) => n > 0),
            note: text.min(2),
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
      "INSERT INTO parties VALUES (?,?,?,?,?,?,?,?,?)",
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
      credit_limit: 100_000_000,
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
      credit_limit: 20_000_000,
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
