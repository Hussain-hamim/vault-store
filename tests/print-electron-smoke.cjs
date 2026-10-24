// Automated PDF output test; no user store, printer or visible window is used.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { withPrintWindow } = require("../electron/printing.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-print-smoke-"));
app.setPath("userData", path.join(root, "profile"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.on("will-quit", () => fs.rmSync(root, { recursive: true, force: true }));
app
  .whenReady()
  .then(async () => {
    const { renderPrintDocument } = await import(
      pathToFileURL(path.resolve("src/printing/document.mjs")).href
    );
    const { reportPrintModel } = await import(
      pathToFileURL(path.resolve("src/printing/models.mjs")).href
    );
    const { electronPrintOptions, printGeometry } = await import(
      pathToFileURL(path.resolve("server/print-options.mjs")).href
    );
    const fonts = {
      latin: `data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2").toString("base64")}`,
      arabic: `data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2").toString("base64")}`,
    };
    const tests = [
      { paper: "A4", layout: "modern", theme: "navy" },
      {
        paper: "A5",
        orientation: "landscape",
        layout: "classic",
        theme: "teal",
      },
      { paper: "Letter", layout: "minimal", theme: "mono", report: true },
      {
        paper: "A4",
        orientation: "landscape",
        layout: "modern",
        theme: "teal",
        report: true,
        model: "daily",
      },
      {
        paper: "A4",
        layout: "classic",
        theme: "rose",
        report: true,
        model: "reorder",
      },
      { paper: "receipt80", layout: "compact", theme: "rose" },
      { paper: "receipt58", layout: "minimal", theme: "charcoal" },
    ];
    for (const options of tests) {
      let doc = {
        kind: options.report ? "report" : "invoice",
        locale: "prs",
        title: "بل / Invoice",
        reference: "PRINT-TEST-001",
        store: { name: "ازمایښتي دوکان", bill_footer: "Thank you" },
        metadata: [{ label: "Customer", value: "Test customer" }],
        summary: [{ label: "Total", value: "AF 18500.00" }],
        emptyLabel: "No rows",
        lineLabels: ["Product", "Qty", "Price", "Discount", "Total"],
        lines: [
          {
            name: "Dell Precision",
            identity: "Dell · Precision · SKU-001",
            specs: ["CPU: Core i7", "RAM: 32 GB", "Storage: 1 TB"],
            quantity: 2,
            price: "AF 10000.00",
            discount: "AF 1500.00",
            total: "AF 18500.00",
          },
        ],
        ...(options.report
          ? {
              sections: [
                {
                  title: "Daily report",
                  columns: [
                    { label: "Day" },
                    { label: "Sales", numeric: true },
                  ],
                  rows: Array.from({ length: 150 }, (_, i) => [
                    `2026-10-${i + 1}`,
                    "AF 18500.00",
                  ]),
                },
              ],
            }
          : {}),
      };
      if (options.model) {
        const rows = Array.from({ length: 150 }, (_, i) => ({
          date: new Date(Date.UTC(2026, 9, 24 - i)).toISOString().slice(0, 10),
          sales: 100000,
          cogs: 70000,
          expenses: 40000,
          other: 2000,
          name: `ازمایښتي SSD ${i + 1}`,
          brand: "Samsung",
          model: "990",
          sku: `SSD-${i + 1}`,
          stock: 0,
          reorder_level: 5,
          suggested_quantity: 10,
          estimated_cost: 800000,
        }));
        const store = doc.store;
        doc = reportPrintModel(
          options.model,
          {
            totals: { sales: 15000000, expenses: 6000000, net: -1200000 },
            days: rows,
          },
          {},
          {},
          {
            locale: "prs",
            t: (key) => key,
            money: (n) => `AF ${(n / 100).toFixed(2)}`,
            account: (key) => key,
            from: "2026-05-28",
            to: "2026-10-24",
            today: "2026-10-24",
            reorder: {
              rows,
              as_of: "2026-10-24",
              summary: {
                out_of_stock: 150,
                low_stock: 0,
                suggested_quantity: 1500,
                estimated_cost: 120000000,
                unpriced: 0,
              },
            },
          },
        );
        doc.store = store;
      }
      const html = renderPrintDocument(doc, options, fonts);
      const result = await withPrintWindow(
        BrowserWindow,
        html,
        null,
        async (contents) => {
          const preview = await contents.executeJavaScript(`(() => {
            const body=document.body.getBoundingClientRect(),sheet=document.querySelector('.sheet').getBoundingClientRect();
            return {left:sheet.left-body.left,right:body.right-sheet.right,background:getComputedStyle(document.body).backgroundColor,width:body.width,tableOverflow:[...document.querySelectorAll('table')].some(t=>{const r=t.getBoundingClientRect();return r.left<sheet.left-1||r.right>sheet.right+1;})};
          })()`);
          const previewGeo = printGeometry(options, doc.kind);
          const expectedMargin = (previewGeo.margin * 96) / 25.4;
          assert.ok(
            Math.abs(preview.left - expectedMargin) < 1,
            "preview has left paper gutter",
          );
          assert.ok(
            Math.abs(preview.right - expectedMargin) < 1,
            "preview has right paper gutter",
          );
          assert.equal(preview.background, "rgb(255, 255, 255)");
          assert.equal(
            preview.tableOverflow,
            false,
            "tables fit inside paper gutters",
          );
          const bytes = await contents.printToPDF(
            electronPrintOptions(options, doc.kind, true),
          );
          const text = bytes.toString("latin1");
          assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
          const box = text.match(
            /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/,
          );
          assert.ok(box, "PDF page box");
          const geo = printGeometry(options, doc.kind);
          assert.ok(
            Math.abs(Number(box[1]) - (geo.width / 25.4) * 72) < 2,
            `${options.paper} width ${box[1]}`,
          );
          assert.ok(
            Math.abs(Number(box[2]) - (geo.height / 25.4) * 72) < 2,
            `${options.paper} height ${box[2]}`,
          );
          const pages = (text.match(/\/Type\s*\/Page\b/g) || []).length;
          if (options.report) assert.ok(pages > 1, "long report paginates");
          return {
            paper: options.paper,
            orientation: options.orientation || "portrait",
            pages,
            bytes: bytes.length,
          };
        },
      );
      console.log(JSON.stringify(result));
    }
    console.log("Desktop print/PDF smoke passed.");
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
  });
