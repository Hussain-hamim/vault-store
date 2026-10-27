const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { withPrintWindow } = require("../electron/printing.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-template-"));
app.setPath("userData", root);
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    const { renderPrintDocument } =
      await import("../src/printing/document.mjs");
    const { electronPrintOptions } =
      await import("../server/print-options.mjs");
    const image = (file) =>
      `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
    const fonts = {
      latin: `data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2").toString("base64")}`,
      arabic: `data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2").toString("base64")}`,
    };
    const doc = {
      kind: "invoice",
      billStyle: "saleShop",
      locale: "en",
      title: "Sale invoice",
      reference: "SAMPLE-001",
      subtitle: "2026-10-27",
      store: {
        name: "OMID COMPUTER CENTER",
        owner1_name: "Sample owner / مسؤل",
        name_ps: "امید کمپیوټر پلورنځی",
        services: "دلته هر ډول کمپیوټر او د کمپیوټر اړوند توکي ترلاسه کولای شئ",
        logo_left: image("src/assets/radefy-techmart-mark.png"),
        logo_right: image("public/assets/laptop.png"),
        bill_footer: "د پېرودلو څخه مو مننه. Thank you for your purchase.",
        address_ps: "د پلورنځي پته · Store address",
      },
      metadata: [
        { label: "Customer / پېرودونکی", value: "Sample customer" },
        { label: "Recorded by", value: "Sample owner" },
      ],
      companyCredit: {
        label: "Built by Radefy Systems",
        whatsapp: "+93 771 707 272",
      },
      summary: [
        { label: "Total", value: "AF 111,000.00" },
        { label: "Returned", value: "AF 0.00" },
        { label: "Paid", value: "AF 50,000.00" },
        { label: "Balance", value: "AF 61,000.00" },
      ],
      lines: [
        {
          name: "Dell XPS 14",
          identity: "Dell · XPS 14 · SKU-001 · DEVICE-001",
          specs: ["CPU: Core i7 · RAM: 16 GB · Storage: 512 GB"],
          quantity: 3,
          price: "AF 37,000.00",
          total: "AF 111,000.00",
          discountNote: "",
        },
      ],
      lineLabels: ["Product", "Qty", "Price", "Discount", "Amount"],
    };
    fs.mkdirSync(".local/template-preview", { recursive: true });
    fs.mkdirSync("output/pdf", { recursive: true });
    for (const paper of ["A4", "A5", "Letter", "A3"])
      for (const locale of ["en", "ps", "prs"]) {
        const options = { template: "golden", paper };
        const html = renderPrintDocument({ ...doc, locale }, options, fonts);
        await withPrintWindow(BrowserWindow, html, null, async (contents) => {
          const geometry = await contents.executeJavaScript(
            `(()=>{const s=document.querySelector('.sheet').getBoundingClientRect();return {overflow:[...document.querySelectorAll('table,th,td')].some(e=>{const r=e.getBoundingClientRect();return r.left<s.left-1||r.right>s.right+1}),height:s.height,body:document.body.scrollHeight};})()`,
          );
          assert.equal(
            geometry.overflow,
            false,
            `${paper}/${locale} contains table`,
          );
          const pdf = await contents.printToPDF(
            electronPrintOptions(options, "invoice", true),
          );
          assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
          const pages = (
            pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []
          ).length;
          if (paper === "A4" && locale === "en")
            fs.writeFileSync(".local/template-preview/golden.html", html);
          console.log(geometry);
          if (paper !== "A3")
            assert.equal(pages, 1, `normal sample fits A4 (${locale})`);
          console.log(JSON.stringify({ paper, locale, pages }));
          if (paper === "A4" && locale === "en") {
            fs.writeFileSync(".local/template-preview/golden.html", html);
            fs.writeFileSync("output/pdf/golden-sale-sample.pdf", pdf);
          }
        });
      }
    const long = {
      ...doc,
      lines: Array.from({ length: 60 }, (_, i) => ({
        ...doc.lines[0],
        identity: `DEVICE-${i + 1}`,
        specs: Array(5).fill("CPU: Core i7 · RAM: 16 GB · Storage: 512 GB"),
      })),
    };
    await withPrintWindow(
      BrowserWindow,
      renderPrintDocument(long, { template: "golden" }, fonts),
      null,
      async (c) => {
        const bytes = await c.printToPDF(
          electronPrintOptions({ template: "golden" }, "invoice", true),
        );
        assert.ok(
          (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length >
            1,
        );
      },
    );
    console.log(
      "Bilingual templates: geometry, A4 pagination and long invoices passed.",
    );
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
