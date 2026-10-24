import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { reportPrintModel, reportCSVRows } from "../src/printing/models.mjs";
import { serializeCSV } from "../src/printing/csv.mjs";
import { renderPrintDocument } from "../src/printing/document.mjs";
import { collectReorderReport } from "../src/reports/reorder.mjs";

const data = {
  totals: {
    sales: 100000,
    cogs: 70000,
    gross: 30000,
    other: 2000,
    expenses: 50000,
    net: -18000,
  },
  days: [
    {
      date: "2026-10-20",
      sales: 100000,
      cogs: 70000,
      other: 2000,
      expenses: 50000,
    },
  ],
  best: [{ name: "SSD", quantity: 1, revenue: 100000, cost: 70000 }],
  expenses: [
    { category: "Utilities", amount: 10000 },
    { category: "adjustment", amount: 40000 },
  ],
  trial: [
    { account: "cash", debit: 200000, credit: 100000, balance: 100000 },
    { account: "inventory", debit: 50000, credit: 0, balance: 50000 },
    { account: "receivables", debit: 30000, credit: 0, balance: 30000 },
    { account: "payables", debit: 0, credit: 40000, balance: -40000 },
    { account: "equity", debit: 0, credit: 158000, balance: -158000 },
    { account: "sales", debit: 0, credit: 100000, balance: -100000 },
    { account: "cost_of_goods", debit: 70000, credit: 0, balance: 70000 },
    { account: "expenses", debit: 50000, credit: 0, balance: 50000 },
    { account: "other_income", debit: 0, credit: 2000, balance: -2000 },
  ],
};
const inventory = {
  stock: [
    {
      name: "New SSD",
      sku: "NEW",
      stock: 2,
      value: 2000,
      oldest: "2026-10-22",
    },
    {
      name: "Old SSD",
      sku: "OLD",
      stock: 2,
      value: 1000,
      oldest: "2026-07-01",
    },
  ],
  customers: [
    { name: "Buyer", phone: "0700000000", balance: 30000, overdue: 10000 },
  ],
  suppliers: [{ name: "Supplier", phone: "", balance: 40000, overdue: 0 }],
};
const capital = {
  current: {
    cash: 100000,
    capital: 158000,
    earnings: -18000,
    net_worth: 140000,
  },
  months: [
    {
      month: "2026-10",
      invested: 158000,
      withdrawn: 0,
      profit: -18000,
      net_worth: 140000,
      change: 140000,
    },
  ],
};
const reorder = {
  as_of: "2026-10-24",
  revision: 1,
  rows: [
    {
      name: "SSD",
      brand: "Samsung",
      model: "990",
      sku: "SSD-01",
      stock: 0,
      reorder_level: 5,
      suggested_quantity: 10,
      estimated_cost: 800000,
    },
  ],
  summary: {
    products: 1,
    out_of_stock: 1,
    low_stock: 0,
    suggested_quantity: 10,
    estimated_cost: 800000,
    unpriced: 0,
  },
};
const context = {
  t: (key, vars) => (vars?.date ? `${key} ${vars.date}` : key),
  locale: "en",
  money: (n) => `AF ${(n / 100).toFixed(2)}`,
  account: (key) => key,
  from: "2026-10-01",
  to: "2026-10-23",
  today: "2026-10-24",
  reorder,
};
const model = (tab, ctx = context) =>
  reportPrintModel(tab, data, inventory, capital, ctx);
const tabs = [
  "profitLoss",
  "daily",
  "productProfit",
  "expenseBreak",
  "trialBalance",
  "balanceSheet",
  "capitalNet",
  "inventoryVal",
  "stockAging",
  "reorder",
  "zeroStock",
  "receivables",
  "payables",
];

test("all 13 report screens share exact rows with CSV and print, with numeric monetary CSV cells", () => {
  for (const tab of tabs) {
    const doc = model(tab),
      csv = reportCSVRows(doc);
    const section = doc.sections[0];
    assert.equal(csv.length, section.rows.length, tab);
    for (let row = 0; row < csv.length; row++) {
      const values = Object.values(csv[row]);
      section.columns.forEach((column, i) => {
        assert.equal(
          values[i],
          column.kind === "money"
            ? section.rawRows[row][i] / 100
            : section.rawRows[row][i],
          `${tab} row ${row}`,
        );
        if (column.kind === "money")
          assert.equal(section.rows[row][i], context.money(values[i] * 100));
      });
    }
    const html = renderPrintDocument(doc, { paper: "A4", theme: "teal" });
    assert.match(html, /<thead>/);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});
test("balance sheet CSV contains balance sheet rows and reconciles assets with liabilities plus equity", () => {
  const doc = model("balanceSheet");
  const rows = reportCSVRows(doc);
  assert.equal(doc.reconciled, true);
  assert.equal(rows.length, 8);
  assert.deepEqual(Object.keys(rows[0]), [
    "reports.colAccount",
    "common.total (AFN)",
  ]);
  assert.equal(rows[3]["common.total (AFN)"], 1800);
  assert.equal(rows.at(-1)["common.total (AFN)"], 1800);
  assert.equal(rows[6]["common.total (AFN)"], -180);
  const trial = model("trialBalance");
  assert.equal(trial.reconciled, true);
  assert.deepEqual(trial.sections[0].rawRows.at(-1), [
    "common.total",
    400000,
    400000,
    0,
  ]);
  const broken = {
    ...data,
    trial: data.trial.map((r) =>
      r.account === "cash"
        ? { ...r, balance: r.balance + 1, debit: r.debit + 1 }
        : r,
    ),
  };
  assert.equal(
    reportPrintModel("balanceSheet", broken, inventory, capital, context)
      .reconciled,
    false,
  );
});
test("daily profit includes other income, losses stay red, and aging is oldest first without mutating inventory", () => {
  const daily = model("daily");
  assert.equal(daily.sections[0].rawRows[0].at(-1), -18000);
  assert.equal(daily.sections[0].tones[0].at(-1), "negative");
  assert.equal(model("profitLoss").sections[0].tones.at(-1).at(-1), "negative");
  assert.equal(
    model("capitalNet").metrics.find((m) => m.label === "reports.earningsKept")
      .tone,
    "negative",
  );
  assert.equal(model("stockAging").sections[0].rawRows[0][0], "Old SSD · OLD");
  assert.equal(inventory.stock[0].sku, "NEW");
  assert.match(model("inventoryVal").subtitle, /2026-10-24/);
  assert.match(model("balanceSheet").subtitle, /2026-10-23/);
  assert.match(
    renderPrintDocument(daily, { theme: "rose" }),
    /class="num tone-negative"/,
  );
});
test("CSV preserves negative numbers, non-Latin text and phone zeros while escaping spreadsheet formulas", () => {
  const csv = serializeCSV([
    {
      name: '=HYPERLINK("bad")',
      amount_AF: -123.45,
      phone: "070001",
      notes: "دکان، دوکان\nsecond line",
    },
    { name: "  +SUM(1,2)", amount_AF: 0, phone: "", notes: "@cmd" },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"-123.45"/);
  assert.doesNotMatch(csv, /'-123.45/);
  assert.match(csv, /"070001"/);
  assert.match(csv, /'=HYPERLINK\(""bad""\)/);
  assert.match(csv, /'  \+SUM/);
  assert.match(csv, /'@cmd/);
  assert.match(csv, /دکان، دوکان\nsecond line/);
});
test("reorder exports collect every database page and reject changed or cancelled snapshots", async () => {
  const all = Array.from({ length: 2007 }, (_, id) => ({ id, stock: 0 }));
  let calls = 0;
  const request = async (args) => {
    calls++;
    assert.equal(args.limit, 1000);
    assert.equal(args.revision, 5);
    const offset = Number(args.cursor || 0);
    return {
      revision: 5,
      summary: offset ? undefined : { products: 2007 },
      rows: all.slice(offset, offset + 1000),
      next: offset + 1000 < all.length ? String(offset + 1000) : null,
    };
  };
  const report = await collectReorderReport(request, 5);
  assert.equal(calls, 3);
  assert.equal(report.rows.length, 2007);
  assert.equal(report.summary.products, 2007);
  assert.equal(report.next, null);
  await assert.rejects(
    collectReorderReport(
      async () => ({ revision: 6, rows: [], next: null }),
      5,
    ),
    /REPORT_CHANGED/,
  );
  await assert.rejects(
    collectReorderReport(request, 5, () => false),
    /REPORT_CHANGED/,
  );
});
test("every report label, hint and export instruction exists in English, Pashto and Dari", async () => {
  for (const locale of ["en", "ps", "prs"]) {
    const source = readFileSync(
      new URL(`../src/i18n/${locale}.ts`, import.meta.url),
      "utf8",
    );
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    const tree = (
      await import(
        `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
      )
    )[locale];
    const lookup = (key) =>
      key.split(".").reduce((obj, part) => obj?.[part], tree);
    const t = (key, vars) => {
      const value = lookup(key);
      assert.equal(typeof value, "string", `${locale}: ${key}`);
      return value.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));
    };
    for (const group of ["resale", "expenseAccounts"])
      for (const key of Object.keys(tree[group])) t(group + "." + key);
    t("expense.food");
    t("accounts.consignmentPayables");
    for (const tab of tabs) {
      const doc = model(tab, { ...context, locale, t });
      assert.ok(doc.sections[0].rows.length);
    }
    for (const key of [
      "hintReorder",
      "hintZeroStock",
      "zeroStockNote",
      "dailyFormula",
      "expenseNote",
      "reorderFormula",
      "estimateNote",
      "unpricedNote",
      "csv",
      "currentStockDate",
      "refresh",
      "invalidRange",
      "showingRows",
      "exportScope",
      "changed",
      "notReady",
      "browserPdfHint",
    ])
      t(`reports.${key}`);
  }
});

test("balance sheet exposes owner advances as assets and owner dues as liabilities without netting different owners", () => {
  const advanced = {
    ...data,
    trial: [
      ...data.trial.map((row) =>
        row.account === "cash"
          ? { ...row, debit: 150000, balance: 50000 }
          : row,
      ),
      {
        account: "consignment_payables",
        debit: 70000,
        credit: 20000,
        balance: 50000,
      },
    ],
    consignment: { due: 20000, recoverable: 70000 },
  };
  const report = reportPrintModel(
    "balanceSheet",
    advanced,
    inventory,
    capital,
    context,
  );
  assert.equal(report.reconciled, true);
  const rows = report.sections[0].rawRows;
  assert.equal(rows.find((row) => row[0] === "resale.recoverable")[1], 70000);
  assert.equal(rows.find((row) => row[0] === "resale.owedToOwners")[1], 20000);
  assert.equal(rows.find((row) => row[0] === "capital.totalAssets")[1], 200000);
  assert.equal(rows.at(-1)[1], 200000);
  assert.equal(reportCSVRows(report).length, 10);
});
