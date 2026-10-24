import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  normalizePrintOptions,
  printGeometry,
  electronPrintOptions,
  PAPER_SIZES,
  PRINT_LAYOUTS,
  PRINT_THEMES,
} from "../server/print-options.mjs";
import {
  renderPrintDocument,
  safePrintLogo,
} from "../src/printing/document.mjs";
import {
  invoicePrintModel,
  reportPrintModel,
} from "../src/printing/models.mjs";
const require = createRequire(import.meta.url);
const { validatePrintJob } = require("../electron/printing.cjs");
const money = (n) => `AF ${(n / 100).toFixed(2)}`;
const t = (key, vars) =>
  vars?.date
    ? `${key} ${vars.date}`
    : vars?.n !== undefined
      ? `${key} ${vars.n}`
      : key;
const context = {
  locale: "en",
  t,
  money,
  foreignMoney: (n) => `AED ${(n / 100).toFixed(2)}`,
  specs: (l) =>
    Object.entries(l.attributes || {}).map(([key, value]) => ({ key, value })),
  rate: (n) => String(n / 10000),
};
const invoice = {
  id: "invoice-1",
  kind: "sale",
  number: "SAL-001",
  date: "2026-10-24",
  party_name: "Customer",
  user_name: "Owner",
  total: 180000,
  paid: 100000,
  returned: 10000,
  lines: [
    {
      name: "Laptop <script>alert(1)</script>",
      brand: "Dell",
      model: "Precision",
      sku: "SKU-001",
      quantity: 2,
      price: 100000,
      discount: 20000,
      attributes: { CPU: "Core i7", RAM: "32 GB", Storage: "1 TB" },
    },
  ],
};
const model = () =>
  invoicePrintModel(
    invoice,
    { name: "Test Store", bill_footer: "Thank you" },
    context,
  );
test("print preferences reject corrupt values and separate report papers from invoice receipts", () => {
  assert.equal(normalizePrintOptions(null).paper, "A4");
  assert.equal(
    normalizePrintOptions({
      paper: "__proto__",
      layout: "<script>",
      theme: "url(evil)",
    }).theme,
    "charcoal",
  );
  assert.equal(
    normalizePrintOptions({ paper: "receipt80", orientation: "landscape" })
      .orientation,
    "portrait",
  );
  assert.equal(
    normalizePrintOptions({ paper: "receipt58" }, "report").paper,
    "A4",
  );
  assert.equal(
    printGeometry({ paper: "A5", orientation: "landscape" }).width,
    210,
  );
});
test("every theme/layout/paper uses one escaped standalone renderer and preserves invoice values", () => {
  for (const paper of Object.keys(PAPER_SIZES))
    for (const layout of PRINT_LAYOUTS)
      for (const theme of Object.keys(PRINT_THEMES)) {
        const html = renderPrintDocument(model(), { paper, layout, theme });
        assert.ok(html.startsWith("<!doctype html>"));
        assert.ok(html.includes(`layout-${layout} theme-${theme}`));
        assert.match(html, /<footer class="company-print-credit">/);
        assert.match(html, /href="https:\/\/www\.radefysystems\.com\/"/);
        assert.match(html, /href="https:\/\/wa\.me\/93771707272"/);
        assert.match(html, /WhatsApp: \+93 77 170 7272/);
        assert.match(html, /<svg viewBox="0 0 100 100"/);
        assert.match(html, /Core i7/);
        assert.match(html, /Precision/);
        assert.match(html, /SKU-001/);
        assert.match(html, /AF 1800.00/);
        assert.match(html, /AF 700.00/);
        assert.doesNotMatch(html, /<script>/);
        assert.match(html, /&lt;script&gt;/);
        assert.match(html, /@page\{size:/);
        if (paper.startsWith("receipt")) {
          assert.match(html, /receipt-line/);
          assert.doesNotMatch(html, /<table class="invoice-table">/);
        }
      }
});
test("logo/spec/footer switches, Arabic locales and offline assets survive preview and export", () => {
  const doc = model();
  doc.locale = "prs";
  doc.store.logo = "data:image/png;base64,YWJj";
  const full = renderPrintDocument(
    doc,
    {},
    { arabic: "data:font/woff2;base64,YWJj" },
  );
  assert.match(full, /lang="fa-AF" dir="rtl"/);
  assert.match(full, /font-src data:/);
  assert.match(full, /font-family:Printarabic/);
  assert.match(full, /<bdi dir="ltr">AF/);
  assert.match(full, /<img class="logo"/);
  const short = renderPrintDocument(doc, {
    showSpecs: false,
    showFooter: false,
    showLogo: false,
  });
  assert.doesNotMatch(short, /Core i7|Thank you|<img/);
  assert.match(short, /SKU-001/);
  assert.match(short, /<footer class="company-print-credit">/);
  for (const value of [
    "https://example.com/logo.png",
    "file:///private/key",
    "data:image/svg+xml;base64,YWJj",
    'data:image/png;base64,x" onerror="alert(1)',
  ])
    assert.equal(safePrintLogo(value), "");
});
test("desktop paper dimensions use inches for PDF and microns for printer custom stock", () => {
  const pdf = electronPrintOptions({ paper: "receipt80" }, "invoice", true);
  assert.equal(pdf.pageSize.width, 80 / 25.4);
  assert.equal(pdf.pageSize.height, 200 / 25.4);
  const printer = electronPrintOptions(
    { paper: "receipt80", theme: "mono" },
    "invoice",
  );
  assert.equal(printer.pageSize.width, 80000);
  assert.equal(printer.pageSize.height, 200000);
  assert.equal(printer.color, false);
  assert.equal(printer.silent, false);
  assert.equal(
    electronPrintOptions(
      { paper: "Letter", orientation: "landscape" },
      "report",
      true,
    ).pageSize,
    "Letter",
  );
});
test("print jobs are bounded, authenticated by source and do not accept arbitrary job types", () => {
  const job = {
    kind: "invoice",
    mode: "pdf",
    title: "SAL-001",
    html: renderPrintDocument(model(), {}),
    options: {},
    source: { type: "invoice", id: "invoice-1" },
  };
  assert.equal(validatePrintJob(job), job);
  assert.throws(
    () =>
      validatePrintJob({
        ...job,
        source: { type: "report", permission: "reports" },
      }),
    /source/,
  );
  assert.throws(
    () => validatePrintJob({ ...job, html: "x".repeat(8000001) }),
    /oversized/,
  );
  assert.throws(
    () => validatePrintJob({ ...job, mode: "execute" }),
    /Invalid print job/,
  );
  assert.throws(
    () =>
      validatePrintJob({
        ...job,
        kind: "report",
        source: { type: "report", permission: "users" },
      }),
    /source/,
  );
});
test("all report tabs produce printable structured data with the same balances and explicit current-stock scope", () => {
  const data = {
    totals: {
      sales: 100000,
      cogs: 60000,
      gross: 40000,
      other: 1000,
      expenses: 5000,
      net: 36000,
    },
    days: [
      {
        date: "2026-10-24",
        sales: 100000,
        cogs: 60000,
        expenses: 5000,
        other: 1000,
      },
    ],
    best: [{ name: "SSD", quantity: 1, revenue: 100000, cost: 60000 }],
    expenses: [{ category: "Utilities", amount: 5000 }],
    trial: [
      { account: "cash", debit: 100000, credit: 20000, balance: 80000 },
      { account: "equity", debit: 0, credit: 80000, balance: -80000 },
    ],
  };
  const inventory = {
    stock: [
      {
        name: "SSD",
        sku: "SSD-1",
        stock: 3,
        value: 180000,
        oldest: "2026-10-20",
      },
    ],
    customers: [
      { name: "Customer", phone: "", balance: 70000, overdue: 10000 },
    ],
    suppliers: [{ name: "Supplier", phone: "", balance: 50000, overdue: 0 }],
  };
  const capital = {
    months: [
      {
        month: "2026-10",
        invested: 80000,
        withdrawn: 0,
        profit: 36000,
        net_worth: 116000,
        change: 116000,
      },
    ],
    current: {
      cash: 80000,
      capital: 80000,
      earnings: 36000,
      net_worth: 116000,
    },
  };
  const ctx = {
    ...context,
    account: (k) => k,
    from: "2026-10-01",
    to: "2026-10-23",
    today: "2026-10-24",
  };
  for (const tab of [
    "profitLoss",
    "daily",
    "productProfit",
    "expenseBreak",
    "trialBalance",
    "balanceSheet",
    "capitalNet",
    "inventoryVal",
    "stockAging",
    "receivables",
    "payables",
  ]) {
    const doc = reportPrintModel(tab, data, inventory, capital, ctx);
    assert.ok(doc.sections.length, tab);
    assert.ok(doc.sections[0].rows.length, tab);
    const html = renderPrintDocument(doc, { paper: "A4", theme: "navy" });
    assert.match(html, /<thead>/);
    assert.doesNotMatch(html, /undefined|NaN/);
    if (["inventoryVal", "stockAging", "receivables", "payables"].includes(tab))
      assert.match(doc.subtitle, /2026-10-24/);
    if (tab === "profitLoss") assert.match(html, /AF 360.00/);
    if (tab === "daily") assert.match(html, /AF 360.00/);
  }
});

test("customer custody receipts show the agreed owner amount without inventing an invoice debt", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "consignment_receipt",
      total: 0,
      paid: 0,
      returned: 0,
      lines: invoice.lines.map((line) => ({
        ...line,
        price: 0,
        discount: 0,
        owner_unit_amount: 61500,
      })),
    },
    { name: "Store" },
    context,
  );
  assert.equal(doc.title, "resale.receive");
  assert.equal(doc.summary.length, 0);
  assert.match(doc.note, /resale.custodyNote/);
  assert.ok(doc.lines[0].specs.some((line) => line.includes("AF 615.00")));
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /AF 615.00/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("paper preview includes white left/right gutters and browser/desktop margins agree for every paper", () => {
  for (const kind of ["invoice", "report"]) {
    for (const paper of Object.keys(PAPER_SIZES)) {
      if (kind === "report" && paper.startsWith("receipt")) continue;
      for (const margins of ["standard", "narrow"]) {
        const options = { paper, margins };
        const page = printGeometry(options, kind);
        const html = renderPrintDocument({ ...model(), kind }, options);
        assert.ok(page.margin >= (paper.startsWith("receipt") ? 3 : 10));
        assert.match(
          html,
          new RegExp(
            "@page\\{size:" +
              page.width +
              "mm " +
              page.height +
              "mm;margin:" +
              page.margin +
              "mm",
          ),
        );
        assert.ok(
          html.includes(
            "body{background:white;width:" +
              page.width +
              "mm;min-height:" +
              page.height +
              "mm;padding:" +
              page.margin +
              "mm",
          ),
        );
        assert.equal(
          electronPrintOptions(options, kind, true).margins.left,
          page.margin / 25.4,
        );
        assert.equal(
          electronPrintOptions(options, kind, true).margins.right,
          page.margin / 25.4,
        );
      }
    }
  }
});

test("foreign purchase and return printouts use saved currency quotes and conversion rates", () => {
  for (const kind of ["purchase", "purchase_return"]) {
    const source = {
      ...invoice,
      kind,
      currency: "USD",
      fx_rate: 700000,
      lines: invoice.lines.map((l) => ({
        ...l,
        currency: "USD",
        cost_foreign: 1000,
        cost_aed: 0,
      })),
    };
    const doc = invoicePrintModel(
      source,
      { name: "Store" },
      {
        ...context,
        t: (key, vars) =>
          key === "currencies.unitCost"
            ? `Unit cost (${vars.code})`
            : context.t(key, vars),
        foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}`,
        rate: (n) => `${n / 10000} AF / USD`,
      },
    );
    assert.ok(doc.purchase);
    assert.ok(doc.lineLabels.includes("Unit cost (USD)"));
    assert.equal(doc.lines[0].costAed, "USD 10.00");
    const html = renderPrintDocument(doc, { paper: "A4" });
    assert.match(html, /USD 10.00/);
    assert.match(html, /70 AF \/ USD/);
    assert.doesNotMatch(html, /AED|undefined|NaN/);
  }
});

test("purchase print and PDF models retain source payment plus its original AF conversion", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "purchase",
      currency: "USD",
      fx_rate: 700000,
      paid_foreign: 1250,
      paid: 97500,
    },
    { name: "Store" },
    { ...context, foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}` },
  );
  const payment = doc.metadata.find(
    (row) => row.label === "currencies.paidAtPurchase",
  );
  assert.equal(payment.value, "USD 12.50 → AF 875.00");
  assert.ok(
    doc.summary.some(
      (row) => row.label === "invoice.paid" && row.value === "AF 975.00",
    ),
  );
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /USD 12.50/);
  assert.match(html, /AF 875.00/);
  assert.match(html, /AF 975.00/);
  const legacy = invoicePrintModel(
    {
      ...invoice,
      kind: "purchase",
      currency: "USD",
      fx_rate: 700000,
      paid_foreign: null,
    },
    { name: "Store" },
    context,
  );
  assert.ok(
    !legacy.metadata.some((row) => row.label === "currencies.paidAtPurchase"),
  );
});

test("supplier payment receipts show supplier identity and both source and converted amounts", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "payment",
      party_name: "Supplier",
      currency: "USD",
      fx_rate: 700000,
      paid_foreign: 500,
      paid: 35000,
      total: 35000,
      lines: [],
    },
    { name: "Store" },
    { ...context, foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}` },
  );
  assert.equal(doc.metadata[0].label, "invoice.supplier");
  assert.equal(
    doc.metadata.find((row) => row.label === "payment.amount").value,
    "USD 5.00 → AF 350.00",
  );
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /USD 5.00/);
  assert.match(html, /AF 350.00/);
});

test("customer receipt printouts show customer identity and source plus converted payment", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "receipt",
      party_name: "Customer",
      currency: "USD",
      fx_rate: 700000,
      paid_foreign: 500,
      paid: 35000,
      total: 35000,
      lines: [],
    },
    { name: "Store" },
    { ...context, foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}` },
  );
  assert.equal(doc.metadata[0].label, "invoice.customer");
  assert.equal(
    doc.metadata.find((row) => row.label === "payment.amount").value,
    "USD 5.00 → AF 350.00",
  );
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /USD 5.00/);
  assert.match(html, /AF 350.00/);
});

test("sale print and PDF show original payment and its AF conversion alongside AF totals", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "sale",
      currency: "USD",
      fx_rate: 700000,
      paid_foreign: 1000,
      paid: 70000,
    },
    { name: "Store" },
    { ...context, foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}` },
  );
  assert.equal(
    doc.metadata.find((row) => row.label === "currencies.paidAtSale").value,
    "USD 10.00 → AF 700.00",
  );
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /USD 10.00/);
  assert.match(html, /AF 700.00/);
});

test("sale return print/PDF shows original refund currency and AF cash refund", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "sale_return",
      currency: "USD",
      fx_rate: 600000,
      paid_foreign: 1000,
      paid: 60000,
      total: 100000,
    },
    { name: "Store" },
    { ...context, foreignMoney: (n) => `USD ${(n / 100).toFixed(2)}` },
  );
  assert.equal(
    doc.metadata.find((row) => row.label === "currencies.refundPaid").value,
    "USD 10.00 → AF 600.00",
  );
  assert.ok(!doc.summary.some((row) => row.label === "invoice.outstanding"));
  assert.equal(
    doc.summary.find((row) => row.label === "currencies.returnCredit").value,
    "AF 400.00",
  );
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /USD 10.00/);
  assert.match(html, /AF 600.00/);
});

test("purchase return print/PDF separates refund currency from original purchase quotes", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      kind: "purchase_return",
      currency: "EUR",
      fx_rate: 600000,
      paid_foreign: 500,
      paid: 30000,
      total: 70000,
      lines: invoice.lines.map((l) => ({
        ...l,
        currency: "USD",
        cost_foreign: 1000,
        cost_aed: 0,
      })),
    },
    { name: "Store" },
    {
      ...context,
      t: (key, vars) =>
        key === "currencies.unitCost"
          ? `Unit cost (${vars.code})`
          : context.t(key, vars),
      foreignMoney: (n, code = "EUR") => `${code} ${(n / 100).toFixed(2)}`,
    },
  );
  assert.equal(
    doc.metadata.find((row) => row.label === "currencies.refundReceived").value,
    "EUR 5.00 → AF 300.00",
  );
  assert.equal(doc.lines[0].costAed, "USD 10.00");
  assert.ok(doc.lineLabels.includes("Unit cost (USD)"));
  assert.equal(
    doc.summary.find((row) => row.label === "currencies.returnCredit").value,
    "AF 400.00",
  );
  assert.ok(!doc.summary.some((row) => row.label === "invoice.outstanding"));
  const html = renderPrintDocument(doc, { paper: "A4" });
  assert.match(html, /EUR 5.00/);
  assert.match(html, /USD 10.00/);
  assert.match(html, /AF 300.00/);
});
