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
test("sale bills use the shop chrome; purchase bills keep the standard header", () => {
  const sale = invoicePrintModel(
    invoice,
    {
      name: "Radefy TechMart",
      name_ps: "رادیفي ټیکمارټ",
      logo_left: "data:image/png;base64,YWJj",
      logo_right: "data:image/png;base64,ZGVm",
      services: "Laptops · Mobiles · CCTV",
      owner1_name: "Ahmad",
      owner1_phone: "+93 70 000 0001",
      owner1_whatsapp: "+93 70 000 0002",
      owner2_name: "Omar",
      owner2_phone: "+93 70 000 0003",
      bill_footer: "Thank you for shopping",
      address_ps: "کابل، افغانستان",
    },
    context,
  );
  assert.equal(sale.billStyle, "saleShop");
  const saleHtml = renderPrintDocument(sale, { paper: "A4" });
  assert.match(saleHtml, /sale-shop-header/);
  assert.match(saleHtml, /sale-shop-bill/);
  assert.match(saleHtml, /Radefy TechMart/);
  assert.match(saleHtml, /رادیفي ټیکمارټ/);
  assert.match(saleHtml, /Laptops/);
  assert.match(saleHtml, /Mobiles/);
  assert.match(saleHtml, /CCTV/);
  assert.match(saleHtml, /Ahmad/);
  assert.match(saleHtml, /Omar/);
  assert.match(saleHtml, /\+93 70 000 0001/);
  assert.match(saleHtml, /Thank you for shopping/);
  assert.match(saleHtml, /sale-signature/);
  assert.match(saleHtml, /invoice\.customerSignature/);
  assert.match(saleHtml, /کابل، افغانستان/);
  assert.match(saleHtml, /data:image\/png;base64,YWJj/);
  assert.match(saleHtml, /data:image\/png;base64,ZGVm/);
  assert.doesNotMatch(saleHtml, /class="document-header"/);

  const purchase = invoicePrintModel(
    { ...invoice, kind: "purchase", number: "PUR-001" },
    {
      name: "Radefy TechMart",
      name_ps: "رادیفي ټیکمارټ",
      logo: "data:image/png;base64,YWJj",
      services: "Should not show",
      bill_footer: "Purchase footer",
    },
    context,
  );
  assert.equal(purchase.billStyle, "standard");
  const purchaseHtml = renderPrintDocument(purchase, { paper: "A4" });
  assert.match(purchaseHtml, /class="document-header"/);
  assert.doesNotMatch(purchaseHtml, /<header class="sale-shop-header"/);
  assert.doesNotMatch(purchaseHtml, /Should not show/);
  assert.doesNotMatch(purchaseHtml, /class="sale-signature"/);
  assert.match(purchaseHtml, /Purchase footer/);
});
test("logo/spec/footer switches, Arabic locales and offline assets survive preview and export", () => {
  const doc = model();
  doc.locale = "prs";
  doc.store.logo = "data:image/png;base64,YWJj";
  doc.store.logo_left = "data:image/png;base64,YWJj";
  const full = renderPrintDocument(
    doc,
    {},
    { arabic: "data:font/woff2;base64,YWJj" },
  );
  assert.match(full, /lang="fa-AF" dir="rtl"/);
  assert.match(full, /font-src data:/);
  assert.match(full, /font-family:Printarabic/);
  assert.match(full, /<bdi dir="ltr">AF/);
  assert.match(full, /<img src="data:image\/png;base64,YWJj"/);
  const short = renderPrintDocument(doc, {
    showSpecs: false,
    showFooter: false,
    showLogo: false,
    showWatermark: false,
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
  const labelJob = {
    kind: "label",
    mode: "print",
    title: "QR labels",
    html: renderPrintDocument(
      {
        kind: "label",
        locale: "en",
        title: "QR labels",
        source: { type: "report", permission: "inventory" },
        labels: [
          {
            name: "MacBook",
            identity: "Apple · M2",
            barcode: "RTM1001",
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="1" height="1"/></svg>',
          },
        ],
      },
      { paper: "label29x18" },
    ),
    options: { paper: "label29x18" },
    source: { type: "report", permission: "inventory" },
  };
  assert.equal(validatePrintJob(labelJob), labelJob);
  assert.match(labelJob.html, /flex-direction:column/);
  assert.match(labelJob.html, /barcode-top/);
  assert.match(labelJob.html, /barcode-bottom/);
  assert.match(labelJob.html, /align-items:center/);
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

test("invoice device identities remain printed when optional specifications are hidden", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      lines: [
        {
          ...invoice.lines[0],
          units: [
            {
              id: "unit-1",
              code: "TM-00000001",
              serial: "SERIAL-DEVICE",
              condition: "Used",
              notes: "Small scratch",
            },
          ],
        },
      ],
    },
    { name: "Device store" },
    context,
  );
  for (const paper of ["A4", "receipt80"]) {
    const html = renderPrintDocument(doc, { paper, showSpecs: false });
    assert.match(html, /SERIAL-DEVICE/);
    assert.doesNotMatch(html, /Small scratch/);
  }
});

test("golden stationery is bilingual, sale-only, escaped and preserves device/discount details", () => {
  const doc = model();
  doc.store.name_ps = "د کمپیوټر پلورنځی";
  doc.store.watermark = "data:image/png;base64,d2F0ZXI=";
  doc.store.owner1_name = "Ghouth";
  doc.store.owner1_whatsapp = "0775662322";
  doc.lines[0].identity += " · DEVICE-001";
  const html = renderPrintDocument(doc, { template: "golden", theme: "mono" });
  assert.match(html, /golden-bill/);
  assert.match(html, /Description/);
  assert.match(html, /تفصیل/);
  assert.match(html, /DEVICE-001/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /discount/);
  assert.match(html, /class="gold-watermark"/);
  assert.match(html, /data:image\/png;base64,d2F0ZXI=/);
  assert.match(html, /مسؤل/);
  assert.match(html, /Ghouth/);
  assert.match(html, /gold-icon-whatsapp/);
  assert.doesNotMatch(html, /class="gold-details"/);
  assert.doesNotMatch(html, /Recorded by/);
  assert.doesNotMatch(html, /invoice\.recordedBy/);
  assert.match(html, /<span>Total<\/span>/);
  assert.match(html, /<span>Paid<\/span>/);
  assert.match(html, /<span>Balance<\/span>/);
  assert.doesNotMatch(html, /ټول/);
  assert.doesNotMatch(html, /ورکړل شوي/);
  assert.equal((html.match(/class="row-number"/g) || []).length, 16);
  assert.match(html, /theme-golden/);
  assert.doesNotMatch(
    renderPrintDocument(doc, { template: "golden", showWatermark: false }),
    /class="gold-watermark"/,
  );
  assert.doesNotMatch(
    renderPrintDocument(
      { ...doc, billStyle: "standard" },
      { template: "golden" },
    ),
    /class="gold-header"/,
  );
  assert.equal(
    normalizePrintOptions({ template: "golden", paper: "receipt58" }).paper,
    "A4",
  );
});

test("golden bills print Western LTR phones and isolate bilingual text in Pashto locale", async () => {
  const { westernDigits } = await import("../src/printing/bidi.mjs");
  assert.equal(westernDigits("۰۷۷۵۶۶۲۳۲۲"), "0775662322");
  assert.equal(westernDigits("٠٧٠٠٠٠٠٠٠١"), "0700000001");
  const doc = model();
  doc.locale = "ps";
  doc.store.name_ps = "د کمپیوټر پلورنځی";
  doc.store.address_ps = "کابل، افغانستان";
  doc.store.address = "Kabul, Afghanistan";
  doc.store.services = "لپټاپ · Laptops · Mobiles";
  doc.store.owner1_name = "Ghouth";
  doc.store.owner1_whatsapp = "۰۷۷۵۶۶۲۳۲۲";
  doc.store.owner1_phone = "٠٧٠٠٠٠٠٠٠١";
  const html = renderPrintDocument(doc, { template: "golden" });
  assert.match(html, /lang="ps" dir="ltr"/);
  assert.match(html, /class="ltr-phone" dir="ltr">0775662322/);
  assert.match(html, /class="ltr-phone" dir="ltr">0700000001/);
  assert.doesNotMatch(html, /۰۷۷۵۶۶۲۳۲۲/);
  assert.doesNotMatch(html, /٠٧٠٠٠٠٠٠٠١/);
  assert.match(html, /gold-icon-whatsapp/);
  assert.match(html, /gold-icon-phone/);
  assert.match(html, /class="gold-bi"/);
  assert.match(html, /lang="ps" dir="rtl">نوم<\/span>/);
  assert.match(html, /lang="ps" dir="rtl">کابل، افغانستان<\/p>/);
  assert.match(html, /dir="ltr">Kabul, Afghanistan<\/p>/);
  assert.match(html, /dir="rtl">لپټاپ<\/span> · <span dir="ltr">Laptops<\/span>/);
});

test("golden bills omit metadata, print English totals, time, RTL owners and contact icons", () => {
  const doc = invoicePrintModel(
    {
      ...invoice,
      created_at: "2026-10-27T12:35:03.855Z",
      previous_balance: 100000,
      new_balance: 180000,
    },
    {
      name: "Test Store",
      owner1_name: "Ahmad",
      owner1_phone: "+93 70 000 0001",
      owner1_whatsapp: "0775662322",
      owner2_name: "Omar",
      owner2_whatsapp: "0780000000",
    },
    context,
  );
  const html = renderPrintDocument(doc, { template: "golden" });
  assert.match(html, /2026-10-27 17:05/);
  assert.match(html, /مسؤلين:/);
  assert.doesNotMatch(html, /مسؤل:/);
  assert.match(html, /gold-icon-whatsapp/);
  assert.match(html, /gold-icon-phone/);
  assert.match(html, /<span>Previous balance<\/span>/);
  assert.match(html, /<span>Total balance<\/span>/);
  assert.doesNotMatch(html, /class="gold-details"/);
  assert.doesNotMatch(html, /invoice\.recordedBy/);
  assert.doesNotMatch(html, /sales\.previousBalance/);
});

test("sale invoices watermark the line grid with a dedicated image or the left logo", () => {
  const doc = model();
  doc.store.logo_left = "data:image/png;base64,YWJj";
  const fromLogo = renderPrintDocument(doc, { template: "golden" });
  assert.match(
    fromLogo,
    /class="gold-watermark" src="data:image\/png;base64,YWJj"/,
  );
  doc.store.watermark = "data:image/png;base64,d2F0ZXI=";
  const custom = renderPrintDocument(doc, { template: "golden" });
  assert.match(
    custom,
    /class="gold-watermark" src="data:image\/png;base64,d2F0ZXI="/,
  );
  assert.doesNotMatch(
    custom,
    /class="gold-watermark" src="data:image\/png;base64,YWJj"/,
  );
  const letterhead = renderPrintDocument(doc, { template: "standard" });
  assert.match(
    letterhead,
    /class="standard-watermark" src="data:image\/png;base64,d2F0ZXI="/,
  );
  assert.doesNotMatch(
    renderPrintDocument(doc, { template: "standard", showWatermark: false }),
    /class="standard-watermark"/,
  );
});

test("print preferences isolate sales, purchase invoices and customer/supplier ledgers with legacy fallback", async () => {
  const { readPrintPreferences, printPreferenceKey } =
    await import("../src/printing/preferences.mjs");
  const records = new Map([
    ["vault-print-invoice-v1", JSON.stringify({ layout: "classic" })],
  ]);
  const storage = { getItem: (key) => records.get(key) };
  const sale = { ...model(), preferenceGroup: "sale" };
  const purchase = {
    ...model(),
    billStyle: "standard",
    preferenceGroup: "purchase",
  };
  assert.equal(readPrintPreferences(sale, storage).layout, "classic");
  assert.equal(readPrintPreferences(sale, storage).template, "golden");
  records.set(printPreferenceKey(sale), JSON.stringify({ template: "standard" }));
  assert.equal(readPrintPreferences(sale, storage).template, "standard");
  records.set(printPreferenceKey(sale), JSON.stringify({ template: "golden" }));
  assert.equal(readPrintPreferences(sale, storage).template, "golden");
  assert.equal(readPrintPreferences(purchase, storage).template, "standard");
  assert.notEqual(
    printPreferenceKey({ kind: "report", preferenceGroup: "customer-ledger" }),
    printPreferenceKey({ kind: "report", preferenceGroup: "supplier-ledger" }),
  );
});
