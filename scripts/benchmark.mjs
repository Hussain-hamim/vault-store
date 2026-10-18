import { Store, today } from "../server/store.mjs";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
const rows = Number(process.argv[2] || 1000000);
if (!Number.isInteger(rows) || rows < 100 || rows > 100000000)
  throw new Error("Choose 100 to 100,000,000 journal rows.");
const root = mkdtempSync(path.join(os.tmpdir(), "vault-benchmark-")),
  file = path.join(root, "benchmark.sqlite");
const s = new Store(file);
const session = s.setup({
    name: "Benchmark owner",
    username: "benchmark",
    password: "benchmark-only-password",
    storeName: "Performance benchmark",
  }),
  user = s.auth(session.token);
const doc = s.transaction(() =>
  s.document("opening", user, {
    date: today(),
    note: "Synthetic benchmark fixture",
  }),
);
const count = 50000,
  start = performance.now();
s.transaction(() => {
  const p = s.db.prepare(
    "INSERT INTO products(id,sku,name,brand,model,category,price,created_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < count; i++)
    p.run(
      "p" + i,
      "SKU-" + String(i).padStart(8, "0"),
      "Product " + String(i).padStart(8, "0"),
      "Brand",
      "Model",
      "Accessories",
      10000,
      new Date().toISOString(),
    );
});
const statement = s.db.prepare("INSERT INTO journal VALUES (?,?,?,?,?,?,?)");
for (let chunk = 0; chunk < rows; chunk += 10000) {
  s.transaction(() => {
    for (let i = chunk; i < Math.min(rows, chunk + 10000); i++)
      statement.run(
        "j" + i,
        doc.id,
        i % 2 ? "sales" : "cash",
        null,
        i % 2 ? 0 : 10000,
        i % 2 ? 10000 : 0,
        today(),
      );
  });
  if (chunk % 250000 === 0)
    console.log(
      `Created ${Math.min(rows, chunk + 10000).toLocaleString()} / ${rows.toLocaleString()} journal rows`,
    );
}
s.db.exec("ANALYZE; PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE)");
function measure(fn, n = 30) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const begin = performance.now();
    fn(i);
    times.push(performance.now() - begin);
  }
  times.sort((a, b) => a - b);
  return {
    p50_ms: +times[Math.floor(n * 0.5)].toFixed(2),
    p95_ms: +times[Math.floor(n * 0.95)].toFixed(2),
  };
}
const result = {
  date: new Date().toISOString(),
  platform: process.platform,
  cpu: os.cpus()[0]?.model,
  memory_GB: Math.round(os.totalmem() / 1024 ** 3),
  journal_rows: rows,
  products: count,
  db_MB: +(statSync(file).size / 1024 ** 2).toFixed(2),
  fixture_seconds: +((performance.now() - start) / 1000).toFixed(2),
  product_lookup: measure((i) =>
    s.listProducts({ q: "SKU-" + String(i * 71).padStart(8, "0") }, user),
  ),
  product_cursor_page: measure((i) =>
    s.listProducts({ after: "SKU-" + String(i * 100).padStart(8, "0") }, user),
  ),
  monthly_totals: measure(() => s.totals(), 10),
  database: file,
};
writeFileSync("docs/benchmark-results.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
s.close();
