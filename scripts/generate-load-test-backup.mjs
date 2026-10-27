/**
 * Build a restoreable Vault Store backup packed with synthetic rows so you can
 * stress-test Inventory, Customers, Suppliers, Sales, Purchases, Expenses,
 * Capital, Daily book, Audit and related screens.
 *
 * Usage:
 *   npm run loadtest:backup -- --count=1000000
 *   npm run loadtest:backup -- --fit
 *   npm run loadtest:backup -- --count=50000 --out=.local/load-test-backup
 *
 * Login after restore: username loadtest / password LoadTest-2026!
 *
 * Keep the .sqlite and matching .json together, then restore from
 * Settings → Backups → Choose backup to restore.
 */
import {
  mkdirSync,
  existsSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";
import { Store, today } from "../server/store.mjs";
import { fileChecksum } from "../server/files.mjs";
import { stripCustomPhotosFromBackup } from "../server/backup-photos.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const OUT = path.resolve(root, arg("out", ".local/load-test-backup"));
const FORCE = flag("force");
const FIT = flag("fit");
const CHUNK = Math.max(
  1_000,
  Math.min(25_000, Number(arg("chunk", "10000")) || 10_000),
);

/** Rough final DB size (bytes) for this lean fixture. */
function estimateBytes(n) {
  const raw =
    n * 220 + // products
    n * 2 * 140 + // customers + suppliers
    n * 4 * 180 + // sale/purchase/expense/capital documents
    n * 2 * 90 + // sale/purchase lines
    n * 8 * 80 + // journal
    n * 2 * 90 + // movements
    n * 2 * 120 + // snapshots
    n * 90; // audit
  return Math.ceil(raw * 2.35);
}

async function freeBytes(dir) {
  try {
    const fs = await import("node:fs");
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(dir);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {}
  try {
    const drive = path.resolve(dir).slice(0, 2);
    const out = execSync(
      `powershell -NoProfile -Command "(Get-PSDrive ${drive[0]}).Free"`,
      { encoding: "utf8" },
    ).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function pad(n, width) {
  return String(n).padStart(width, "0");
}

function dateFor(i) {
  const base = Date.parse(today() + "T12:00:00Z") - (i % 1095) * 86400_000;
  return new Date(base).toISOString().slice(0, 10);
}

function isoFor(i, date) {
  const hh = String(i % 24).padStart(2, "0");
  const mm = String((i * 7) % 60).padStart(2, "0");
  const ss = String((i * 13) % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:${ss}.000Z`;
}

function log(msg) {
  console.log(`[load-test] ${msg}`);
}

function dropLoadTriggers(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS journal_daily_insert;
    DROP TRIGGER IF EXISTS journal_daily_delete;
    DROP TRIGGER IF EXISTS journal_party_insert;
    DROP TRIGGER IF EXISTS journal_party_delete;
    DROP TRIGGER IF EXISTS document_line_snapshot;
    DROP TRIGGER IF EXISTS product_stock_reactivate;
  `);
}

function restoreLoadTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS journal_daily_insert AFTER INSERT ON journal BEGIN
     INSERT INTO daily_totals(date,account,debit,credit) VALUES(NEW.date,NEW.account,NEW.debit,NEW.credit)
     ON CONFLICT(date,account) DO UPDATE SET debit=debit+NEW.debit,credit=credit+NEW.credit;
    END;
    CREATE TRIGGER IF NOT EXISTS journal_daily_delete AFTER DELETE ON journal BEGIN
     UPDATE daily_totals SET debit=debit-OLD.debit,credit=credit-OLD.credit WHERE date=OLD.date AND account=OLD.account;
    END;
    CREATE TRIGGER IF NOT EXISTS journal_party_insert AFTER INSERT ON journal WHEN NEW.party_id IS NOT NULL BEGIN
     INSERT INTO party_totals(party_id,account,debit,credit) VALUES(NEW.party_id,NEW.account,NEW.debit,NEW.credit)
     ON CONFLICT(party_id,account) DO UPDATE SET debit=debit+NEW.debit,credit=credit+NEW.credit;
    END;
    CREATE TRIGGER IF NOT EXISTS journal_party_delete AFTER DELETE ON journal WHEN OLD.party_id IS NOT NULL BEGIN
     UPDATE party_totals SET debit=debit-OLD.debit,credit=credit-OLD.credit WHERE party_id=OLD.party_id AND account=OLD.account;
    END;
    CREATE TRIGGER IF NOT EXISTS document_line_snapshot AFTER INSERT ON document_lines BEGIN
     INSERT INTO document_product_snapshots(line_id,name,sku,brand,model,attributes,image,serialized)
     SELECT NEW.id,COALESCE(s.name,p.name),COALESCE(s.sku,p.sku),COALESCE(s.brand,p.brand),COALESCE(s.model,p.model),COALESCE(s.attributes,p.attributes),COALESCE(s.image,p.image),COALESCE(s.serialized,p.serialized)
     FROM products p LEFT JOIN document_product_snapshots s ON s.line_id=NEW.original_line_id WHERE p.id=NEW.product_id;
    END;
    CREATE TRIGGER IF NOT EXISTS product_stock_reactivate AFTER UPDATE OF stock ON products
    WHEN NEW.stock>0 AND NEW.active=0 BEGIN
      UPDATE products SET active=1 WHERE id=NEW.id;
    END;
  `);
}

function rebuildSummaries(db) {
  log("Rebuilding daily_totals / party_totals…");
  db.exec("DELETE FROM daily_totals; DELETE FROM party_totals;");
  db.exec(`
    INSERT INTO daily_totals(date,account,debit,credit)
    SELECT date,account,SUM(debit),SUM(credit) FROM journal GROUP BY date,account;
  `);
  db.exec(`
    INSERT INTO party_totals(party_id,account,debit,credit)
    SELECT party_id,account,SUM(debit),SUM(credit) FROM journal
    WHERE party_id IS NOT NULL GROUP BY party_id,account;
  `);
}

function forChunks(n, width, fn) {
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(n, start + CHUNK);
    fn(start, end, width);
    if (start === 0 || end === n || end % (CHUNK * 10) === 0)
      log(`  … ${end.toLocaleString()} / ${n.toLocaleString()}`);
  }
}

async function main() {
  let COUNT = Math.max(1, Number(arg("count", "1000000")) || 1000000);
  mkdirSync(OUT, { recursive: true });
  const free = await freeBytes(OUT);
  // Peak ≈ live DB (+ small headroom). Final publish renames when possible.
  const safety = 1.2;
  const maxFit = free
    ? Math.max(1_000, Math.floor(free / (estimateBytes(1) * safety)))
    : COUNT;

  if (FIT) {
    COUNT = Math.min(COUNT, maxFit);
    log(`--fit selected ${COUNT.toLocaleString()} rows/screen for available disk`);
  }

  const needed = estimateBytes(COUNT);
  log(`Requested ${COUNT.toLocaleString()} rows per screen`);
  log(`Estimated DB size ~${(needed / 1e9).toFixed(2)} GB`);
  if (free) log(`Free space at output ~${(free / 1e9).toFixed(2)} GB`);
  if (free && needed * safety > free && !FORCE) {
    throw new Error(
      `Not enough free disk for ${COUNT.toLocaleString()} rows/screen ` +
        `(need ~${((needed * safety) / 1e9).toFixed(1)} GB, have ${(free / 1e9).toFixed(1)} GB). ` +
        `Free space, use --fit, lower --count, or pass --force.`,
    );
  }

  const width = Math.max(7, String(COUNT - 1).length);
  const work = path.join(OUT, "_work");
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const live = path.join(work, "live.sqlite");
  const started = performance.now();

  log("Creating store + owner…");
  const store = new Store(live);
  store.setup({
    name: "Load Test Owner",
    username: "loadtest",
    password: "LoadTest-2026!",
    storeName: "Load Test Shop",
  });
  const owner = store.one("SELECT * FROM users WHERE username='loadtest'");
  if (!store.one("SELECT id FROM expense_accounts LIMIT 1")) {
    store.run(
      "INSERT INTO expense_accounts VALUES (?,?,?)",
      "exp-rent",
      "Rent",
      new Date().toISOString(),
    );
  }
  const expenseId = store.one("SELECT id FROM expense_accounts LIMIT 1").id;

  store.db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA synchronous=OFF;
    PRAGMA journal_mode=MEMORY;
    PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-250000;
    PRAGMA locking_mode=EXCLUSIVE;
  `);
  dropLoadTriggers(store.db);

  const attrs = "{}";
  const image = "/assets/headphones.png";

  log("Inserting products (Inventory)…");
  {
    const stmt = store.db.prepare(
      `INSERT INTO products(id,sku,barcode,name,brand,model,category,price,minimum,reorder_level,location,condition,warranty,attributes,serialized,stock,active,image,created_at,currency)
       VALUES (?,?,?,?,?,?,?,?,0,5,'','New','',?,0,10,1,?,?,'AFN')`,
    );
    forChunks(COUNT, width, (a, b) => {
      store.db.exec("BEGIN");
      for (let i = a; i < b; i++) {
        const id = `p${pad(i, width)}`;
        stmt.run(
          id,
          `LT-SKU-${pad(i, width)}`,
          `LT${pad(i, width)}`,
          `Load Product ${pad(i, width)}`,
          "LoadBrand",
          `Model-${pad(i % 10000, 5)}`,
          "Accessories",
          250000,
          attrs,
          image,
          isoFor(i, dateFor(i)),
        );
      }
      store.db.exec("COMMIT");
    });
  }

  log("Inserting customers…");
  {
    const stmt = store.db.prepare(
      `INSERT INTO parties(id,kind,name,phone,email,address,credit_limit,walk_in,active,created_at)
       VALUES (?,'customer',?,?, '', '',0,0,1,?)`,
    );
    forChunks(COUNT, width, (a, b) => {
      store.db.exec("BEGIN");
      for (let i = a; i < b; i++) {
        stmt.run(
          `c${pad(i, width)}`,
          `Customer ${pad(i, width)}`,
          `+9377${String(10000000 + (i % 89999999)).padStart(8, "0")}`,
          isoFor(i, dateFor(i)),
        );
      }
      store.db.exec("COMMIT");
    });
  }

  log("Inserting suppliers…");
  {
    const stmt = store.db.prepare(
      `INSERT INTO parties(id,kind,name,phone,email,address,credit_limit,walk_in,active,created_at)
       VALUES (?,'supplier',?,?, '', '',0,0,1,?)`,
    );
    forChunks(COUNT, width, (a, b) => {
      store.db.exec("BEGIN");
      for (let i = a; i < b; i++) {
        stmt.run(
          `s${pad(i, width)}`,
          `Supplier ${pad(i, width)}`,
          `+9370${String(10000000 + (i % 89999999)).padStart(8, "0")}`,
          isoFor(i, dateFor(i)),
        );
      }
      store.db.exec("COMMIT");
    });
  }

  const insertDocs = (kind, prefix, partyPrefix, price, paid) => {
    log(`Inserting ${kind} documents…`);
    const doc = store.db.prepare(
      `INSERT INTO documents(id,number,kind,party_id,date,total,paid,cost,discount,note,category,original_id,due_date,request_key,user_id,created_at,expense_account_id,currency,fx_rate)
       VALUES (?,?,?,?,?,?,?,?,0,'','',NULL,NULL,?,?,?,?,'AFN',10000)`,
    );
    const line = store.db.prepare(
      `INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost,discount,original_line_id,currency)
       VALUES (?,?,?,?,?,?,0,NULL,'AFN')`,
    );
    const snap = store.db.prepare(
      `INSERT INTO document_product_snapshots(line_id,name,sku,brand,model,attributes,image,serialized)
       VALUES (?,?,?,?,?,?,?,0)`,
    );
    const move = store.db.prepare(
      `INSERT INTO movements(id,document_id,product_id,quantity,cost,date) VALUES (?,?,?,?,?,?)`,
    );
    const jr = store.db.prepare(
      `INSERT INTO journal(id,document_id,account,party_id,debit,credit,date) VALUES (?,?,?,?,?,?,?)`,
    );
    forChunks(COUNT, width, (a, b) => {
      store.db.exec("BEGIN");
      for (let i = a; i < b; i++) {
        const d = dateFor(i);
        const w = width;
        const did = `${prefix}${pad(i, w)}`;
        const lid = `${prefix}l${pad(i, w)}`;
        const pid = `p${pad(i, w)}`;
        const party = partyPrefix ? `${partyPrefix}${pad(i, w)}` : null;
        const number =
          kind === "sale"
            ? `SAL-${i + 1}`
            : `${prefix.toUpperCase()}-${String(i + 1).padStart(6, "0")}`;
        const cost =
          kind === "purchase"
            ? price
            : kind === "sale"
              ? Math.floor(price * 0.6)
              : 0;
        doc.run(
          did,
          number,
          kind,
          party,
          d,
          price,
          paid,
          cost,
          `lt-${kind}-${i}`,
          owner.id,
          isoFor(i, d),
          kind === "expense" ? expenseId : null,
        );
        if (kind === "sale" || kind === "purchase") {
          line.run(lid, did, pid, 1, price, cost);
          snap.run(
            lid,
            `Load Product ${pad(i, w)}`,
            `LT-SKU-${pad(i, w)}`,
            "LoadBrand",
            `Model-${pad(i % 10000, 5)}`,
            attrs,
            image,
          );
          move.run(
            `${prefix}m${pad(i, w)}`,
            did,
            pid,
            kind === "sale" ? -1 : 1,
            cost,
            d,
          );
        }
        if (kind === "sale") {
          jr.run(`j${prefix}a${pad(i, w)}`, did, "receivables", party, price, 0, d);
          jr.run(`j${prefix}b${pad(i, w)}`, did, "sales", null, 0, price, d);
          jr.run(`j${prefix}c${pad(i, w)}`, did, "cost_of_goods", null, cost, 0, d);
          jr.run(`j${prefix}d${pad(i, w)}`, did, "inventory", null, 0, cost, d);
        } else if (kind === "purchase") {
          jr.run(`j${prefix}a${pad(i, w)}`, did, "inventory", null, price, 0, d);
          jr.run(`j${prefix}b${pad(i, w)}`, did, "payables", party, 0, price, d);
        } else if (kind === "expense") {
          jr.run(`j${prefix}a${pad(i, w)}`, did, "expenses", null, price, 0, d);
          jr.run(`j${prefix}b${pad(i, w)}`, did, "cash", null, 0, price, d);
        } else if (kind === "owner") {
          jr.run(`j${prefix}a${pad(i, w)}`, did, "cash", null, price, 0, d);
          jr.run(`j${prefix}b${pad(i, w)}`, did, "equity", null, 0, price, d);
        }
      }
      store.db.exec("COMMIT");
    });
  };

  insertDocs("sale", "sal", "c", 100000, 0);
  insertDocs("purchase", "pur", "s", 60000, 0);
  insertDocs("expense", "exp", null, 15000, 15000);
  insertDocs("owner", "own", null, 500000, 500000);

  log("Inserting audit history…");
  {
    const stmt = store.db.prepare(
      `INSERT INTO audit(user_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?)`,
    );
    forChunks(COUNT, width, (a, b) => {
      store.db.exec("BEGIN");
      for (let i = a; i < b; i++) {
        stmt.run(
          owner.id,
          "Load test seed",
          `p${pad(i, width)}`,
          JSON.stringify({ i }),
          isoFor(i, dateFor(i)),
        );
      }
      store.db.exec("COMMIT");
    });
  }

  log("Updating sequences…");
  store.run("UPDATE sequences SET value=? WHERE name='sale_documents'", COUNT);
  store.run("UPDATE sequences SET value=? WHERE name='documents'", COUNT * 3);

  rebuildSummaries(store.db);
  restoreLoadTriggers(store.db);

  log("Checkpointing database…");
  store.db.exec(`
    PRAGMA analysis_limit=1000;
    ANALYZE;
    PRAGMA optimize;
    PRAGMA wal_checkpoint(TRUNCATE);
    PRAGMA journal_mode=DELETE;
  `);
  store.close();

  for (const suffix of ["-wal", "-shm"]) {
    const extra = live + suffix;
    if (existsSync(extra)) unlinkSync(extra);
  }
  stripCustomPhotosFromBackup(live);
  for (const suffix of ["-wal", "-shm"]) {
    const extra = live + suffix;
    if (existsSync(extra)) unlinkSync(extra);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = "load-test-shop";
  const folder = path.join(OUT, "Vault Store Backups", backupId);
  mkdirSync(folder, { recursive: true });
  const filename = `vault-${today()}-${stamp}-loadtest.sqlite`;
  const target = path.join(folder, filename);
  const tmp = target + ".partial";
  const size = statSync(live).size;
  const checksum = fileChecksum(live);
  // Prefer rename on the same volume so a second full copy is not required.
  try {
    renameSync(live, target);
  } catch {
    copyFileSync(live, tmp);
    renameSync(tmp, target);
    try {
      unlinkSync(live);
    } catch {}
  }
  try {
    chmodSync(target, 0o600);
  } catch {}
  const fd = openSync(target, "r");
  try {
    fsyncSync(fd);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  } finally {
    closeSync(fd);
  }
  writeFileSync(
    target + ".json",
    JSON.stringify(
      {
        application: "Vault Store",
        schema: 1,
        databaseSchema: 2,
        createdAt: new Date().toISOString(),
        businessDate: today(),
        automatic: false,
        checksum,
        size,
        currency: "AFN",
        loadTest: {
          countPerScreen: COUNT,
          screens: [
            "inventory/products",
            "customers",
            "suppliers",
            "sales",
            "purchases",
            "expenses",
            "capital",
            "daily-book",
            "audit",
          ],
          login: { username: "loadtest", password: "LoadTest-2026!" },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  writeFileSync(
    path.join(OUT, "README.txt"),
    [
      "Radefy TechMart load-test backup",
      "================================",
      "",
      `Rows per screen: ${COUNT.toLocaleString()}`,
      `Backup file: ${target}`,
      `Manifest:     ${target}.json`,
      "",
      "Restore in the desktop app:",
      "  Settings → Backups → Choose backup to restore",
      "Keep the .sqlite and .json files together.",
      "",
      "Sign in after restore:",
      "  username: loadtest",
      "  password: LoadTest-2026!",
      "",
      "Seeded screens:",
      "  Inventory, Customers, Suppliers, Sales history,",
      "  Purchases history, Expenses, Capital, Daily book, Audit.",
      "",
      "Regenerate:",
      "  npm run loadtest:backup -- --count=1000000",
      "  npm run loadtest:backup -- --fit",
      "",
    ].join("\n"),
  );

  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  log(`Done in ${elapsed}s`);
  log(`Backup: ${target}`);
  log(`Size:   ${(size / 1e6).toFixed(1)} MB`);
  log(`Login:  loadtest / LoadTest-2026!`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
