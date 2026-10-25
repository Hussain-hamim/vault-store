// Functional desktop UI checks only: isolated SQLite/profile, no screenshots or printer.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-ui-"));
app.setPath("userData", path.join(root, "profile"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
let db, win;
const timer = setTimeout(() => {
  console.error("UI smoke timed out");
  app.exit(1);
}, 40000);
app
  .whenReady()
  .then(async () => {
    const { createWorker } = await import(
      pathToFileURL(path.resolve("server/client.mjs")).href
    );
    db = createWorker(path.join(root, "test.sqlite"));
    const auth = await db.request("setup", {
      name: "Test Owner",
      username: "owner",
      password: "smoke-test-password",
      storeName: "Isolated test store",
    });
    const low = await db.request(
      "productCreate",
      {
        name: "Alert laptop",
        brand: "Dell",
        model: "Test",
        category: "Computers",
        serialized: false,
        sku: "ALERT-1",
        price: 300000,
        reorder_level: 2,
      },
      auth.token,
    );
    const debtor = await db.request(
      "partyCreate",
      { kind: "customer", name: "Balance customer", opening_balance: 250000 },
      auth.token,
    );
    ipcMain.handle("vault:activation-status", () => ({
      active: true,
      required: false,
      mode: "development",
    }));
    ipcMain.handle("vault:command", async (_event, command, args, token) => {
      try {
        return { ok: true, result: await db.request(command, args, token) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve("electron/preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (e) {
        console.error("Failed renderer check:", code);
        throw e;
      }
    };
    async function wait(code) {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(
        "Condition failed: " +
          code +
          "\n" +
          (await js("document.body.innerText")),
      );
    }
    const key = async (k, props = {}) =>
      js(
        '(document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown",' +
          JSON.stringify({
            key: k,
            bubbles: true,
            cancelable: true,
            ...props,
          }) +
          "))",
      );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".auth-form")');
    assert.match(
      await js('document.querySelector(".auth-company-credit").textContent'),
      /Built by Radefy Systems/,
    );
    assert.equal(
      await js('document.querySelectorAll(".auth-company-credit a").length'),
      3,
    );
    await js(
      'localStorage.setItem("vault-session",' +
        JSON.stringify(auth.token) +
        ');localStorage.setItem("vault-locale","en")',
    );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    assert.match(await js("document.title"), /Radefy TechMart/);
    assert.equal(
      await js('document.querySelector(".sidebar .brand-mark").naturalWidth'),
      256,
    );
    const clickButton = async (text) =>
      js(
        `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`,
      );
    await js('document.querySelector(".notifications-shortcut").click()');
    await wait('document.querySelectorAll(".notification-item").length===1');
    assert.match(
      await js('document.querySelector(".notification-item").textContent'),
      /Alert laptop/,
    );
    await js(
      'Array.from(document.querySelectorAll(".notification-tabs [role=tab]")).find(b=>b.textContent.startsWith("Customers owe you")).click()',
    );
    await wait(
      'document.querySelector(".notification-item")?.textContent.includes("Balance customer")',
    );
    assert.match(
      await js(
        'document.querySelector(".notification-item-action strong").textContent',
      ),
      /2,500/,
    );
    await clickButton("Open ledger");
    await wait(
      'document.querySelector("[role=dialog]")?.textContent.includes("Balance customer") && !document.querySelector(".notification-center")',
    );
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    await db.request(
      "payment",
      {
        party_id: debtor.id,
        amount: 250000,
        request_key: "notification-smoke-pay",
      },
      auth.token,
    );
    await js('document.querySelector(".notifications-shortcut").click()');
    await wait('!!document.querySelector(".notification-tabs")');
    await js(
      'Array.from(document.querySelectorAll(".notification-tabs [role=tab]")).find(b=>b.textContent.startsWith("Customers owe you")).click()',
    );
    await wait(
      'document.querySelector(".notification-items")?.textContent.includes("All clear")',
    );
    await wait(
      'document.querySelector(".notifications-shortcut .notification-count")?.textContent === "1"',
    );
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    await clickButton("Dashboard");
    await wait('!!document.querySelector(".widget-board")');
    assert.equal(
      await js('document.querySelectorAll(".dashboard-widget").length'),
      9,
    );
    await clickButton("Customize dashboard");
    await wait('!!document.querySelector(".widget-picker")');
    await js(
      'Array.from(document.querySelectorAll(".widget-option")).find(l=>l.textContent==="Total stock value").querySelector("input").click()',
    );
    await js(
      'Array.from(document.querySelectorAll(".widget-option")).find(l=>l.textContent==="Net profit").querySelector("input").click()',
    );
    await js(
      `document.querySelector('[aria-label="Move up Net profit"]').click()`,
    );
    await clickButton("Save dashboard");
    await wait('!document.querySelector(".widget-picker")');
    assert.equal(
      await js('document.querySelectorAll(".dashboard-widget").length'),
      9,
    );
    assert.equal(
      await js(
        'document.querySelector(".widget-board").textContent.includes("Total stock value")',
      ),
      false,
    );
    assert.equal(
      await js(
        'document.querySelector(".widget-board").textContent.includes("Net profit")',
      ),
      true,
    );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    await clickButton("Dashboard");
    await wait('!!document.querySelector(".widget-board")');
    assert.equal(
      await js(
        'document.querySelector(".widget-board").textContent.includes("Net profit")',
      ),
      true,
    );
    assert.match(
      await js('document.querySelectorAll(".dashboard-widget")[7].textContent'),
      /Net profit/,
    );
    await clickButton("Customize dashboard");
    await wait('!!document.querySelector(".widget-picker")');
    await clickButton("Restore defaults");
    await clickButton("Cancel");
    await wait('!document.querySelector(".widget-picker")');
    assert.equal(
      await js(
        'document.querySelector(".widget-board").textContent.includes("Net profit")',
      ),
      true,
    );
    await clickButton("Customize dashboard");
    await wait('!!document.querySelector(".widget-picker")');
    await clickButton("Restore defaults");
    await clickButton("Save dashboard");
    await wait('!document.querySelector(".widget-picker")');
    assert.match(
      await js('document.querySelectorAll(".dashboard-widget")[0].textContent'),
      /Total stock value/,
    );
    await clickButton("Customize dashboard");
    await wait('!!document.querySelector(".widget-picker")');
    await clickButton("Hide all");
    await clickButton("Save dashboard");
    await wait(
      'document.querySelectorAll(".dashboard-widget").length===0 && !document.querySelector(".widget-picker")',
    );
    await clickButton("Customize dashboard");
    await wait('!!document.querySelector(".widget-picker")');
    await clickButton("Show all");
    await clickButton("Save dashboard");
    await wait(
      'document.querySelectorAll(".dashboard-widget").length===14 && !document.querySelector(".widget-picker")',
    );
    assert.deepEqual(
      await js(
        'Array.from(document.querySelectorAll(".sidebar .nav-item")).map(b=>b.textContent.trim()).filter(label=>["Capital","Backups","Help & shortcuts"].includes(label))',
      ),
      [],
    );
    assert.equal(
      await js('document.querySelectorAll(".backup-promo").length'),
      0,
    );
    // Existing dashboard shortcut opens the Backups section inside Settings.
    await js('document.querySelector(".messages-icon").click()');
    await wait(
      'document.querySelector(".settings-navigation button[aria-current=page]")?.textContent==="Backups"',
    );
    assert.equal(
      await js(
        'document.querySelector(".sidebar .nav-item.active")?.textContent.trim()',
      ),
      "Settings",
    );
    await wait(
      '!!document.querySelector(".settings-detail .destination-list")',
    );
    await js(
      'Array.from(document.querySelectorAll(".settings-navigation button")).find(b=>b.textContent==="Capital").click()',
    );
    await wait(
      '!!document.querySelector(".settings-detail .capital-hero-metrics")',
    );
    await clickButton("Record investment");
    await wait('!!document.querySelector("[role=dialog]")');
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    assert.ok(
      await js('!!document.querySelector(".settings-detail .capital-page")'),
    );
    await js(
      'Array.from(document.querySelectorAll(".nav-item")).find(b=>b.textContent==="Settings").click()',
    );
    await wait('!!document.querySelector(".settings-navigation")');
    await js(
      'Array.from(document.querySelectorAll(".settings-navigation button")).find(b=>b.textContent==="Help & shortcuts").click()',
    );
    await wait('!!document.querySelector(".settings-detail .shortcut-list")');
    assert.ok(
      !(
        await js(
          'document.querySelector(".settings-detail .shortcut-list").textContent',
        )
      ).includes("Alt"),
    );
    await js(
      'Array.from(document.querySelectorAll(".settings-navigation button")).find(b=>b.textContent==="About").click()',
    );
    await wait('!!document.querySelector(".company-hero")');
    assert.match(
      await js('document.querySelector(".company-page").textContent'),
      /Built by Radefy Systems/,
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".company-hero .company-logo").length',
      ),
      1,
    );
    assert.equal(
      await js('document.querySelectorAll(".company-contact-list a").length'),
      3,
    );
    await key("F1");
    await wait(
      'document.querySelectorAll(".company-contact-list a").length === 3',
    );
    assert.equal(
      await js('document.querySelectorAll(".company-contact-list a").length'),
      3,
    );
    await key("k", { ctrlKey: true });
    await wait('document.activeElement?.getAttribute("role")==="combobox"');
    assert.equal(
      await js(
        'document.querySelectorAll("#command-results [role=option]").length',
      ),
      15,
    );
    await key("ArrowDown");
    await key("Enter");
    await wait(
      '!!document.querySelector("[role=dialog]") && !document.querySelector(".command-palette")',
    );
    assert.match(
      await js('document.querySelector("[role=dialog]").textContent'),
      /product/i,
    );
    await key("s", { ctrlKey: true, code: "KeyS" });
    assert.ok(await js('!!document.querySelector("[role=dialog]")'));
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    await js("document.activeElement?.blur()");
    await key("s", { ctrlKey: true, code: "KeyS" });
    await wait('!!document.querySelector(".sales-workspace")');
    assert.equal(
      await js('document.querySelectorAll("[role=dialog]").length'),
      0,
    );
    await js('document.querySelector(".sales-workspace input").focus()');
    await key("e", { ctrlKey: true, code: "KeyE" });
    assert.equal(
      await js('document.querySelectorAll("[role=dialog]").length'),
      0,
    );
    await js("document.activeElement?.blur()");
    await key("b", { ctrlKey: true, code: "KeyB" });
    await wait('!!document.querySelector("#purchase-bill-panel")');
    await js("document.activeElement?.blur()");
    await key("/", { ctrlKey: true });
    await wait('!!document.querySelector(".shortcut-list")');
    assert.equal(
      await js(
        'document.querySelectorAll(".shortcut-list .shortcut-row").length',
      ),
      16,
    );
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    await clickButton("Sales");
    await wait('!!document.querySelector("#resale-tab")');
    await js('document.querySelector("#resale-tab").click()');
    await wait('!!document.querySelector(".resale-page")');
    await clickButton("Receive customer product");
    await wait('!!document.querySelector(".resale-intake")');
    async function fill(selector, value) {
      await js(
        `(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event("input",{bubbles:true}));})()`,
      );
    }
    await fill('[name="owner_name"]', "New resale owner");
    await fill('[name="owner_phone"]', "0700003333");
    await fill('[name="product_name"]', "Owner laptop");
    await fill('[name="model"]', "Latitude 7400");
    await fill('[name="selling_price"]', "3000");
    await fill('[name="amount"]', "2000");
    await js(
      'document.querySelector(".resale-intake").closest("form").requestSubmit()',
    );
    await wait(
      '!document.querySelector(".resale-intake") && document.querySelector(".resale-list")?.textContent.includes("Owner laptop")',
    );
    await clickButton("Sell this item");
    await wait(
      '!!document.querySelector(".sale-fit-form") && !document.querySelector("#bill-panel").hidden',
    );
    assert.match(
      await js('document.querySelector(".sale-board-right").textContent'),
      /Owner laptop/,
    );
    for (const [width, height] of [
      [1024, 768],
      [1198, 900],
      [1536, 864],
    ]) {
      win.setContentSize(width, height);
      await wait(`window.innerWidth === ${width}`);
      assert.ok(
        await js(
          `(() => { const card=document.querySelector('#bill-panel .cart-line'); const title=card.querySelector('.cart-line-title').getBoundingClientRect(); const fields=card.querySelector('.form-grid.three').getBoundingClientRect(); return fields.top >= title.bottom && fields.width > card.getBoundingClientRect().width - 35; })()`,
        ),
      );
      assert.ok(
        await js(
          `Array.from(document.querySelectorAll('#bill-panel .cart-line .field > span')).every(el=>el.getBoundingClientRect().height<20)`,
        ),
      );
    }
    await fill(".sale-customer-name input", "Resale buyer");
    assert.equal(
      await js(
        'document.querySelector("#bill-panel .sale-payment-currency select").value',
      ),
      "AFN",
    );
    assert.equal(
      await js(
        'document.querySelector("#bill-panel [name=payment_rate]").value',
      ),
      "1",
    );
    await js(
      `(() => {const el=document.querySelector('#bill-panel .sale-payment-currency select');el.value='USD';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await fill('#bill-panel [name="payment_rate"]', "75");
    await fill('.sale-fit-form [name="paid"]', "40");
    await wait(
      'document.querySelector("#bill-panel [name=paid]").closest("label").textContent.includes("AF 3,000.00")',
    );
    await fill('#bill-panel [name="payment_rate"]', "70");
    await wait(
      'document.querySelector("#bill-panel [name=paid]").closest("label").textContent.includes("AF 2,800.00")',
    );
    assert.equal(
      await js(
        'document.querySelector("#bill-panel .cart-line .field:nth-child(2) input").value',
      ),
      "3000",
    );
    await fill('#bill-panel [name="payment_rate"]', "75");
    await js('document.querySelector(".sale-fit-form").requestSubmit()');
    await wait(
      'document.querySelector(".toast")?.textContent.toLowerCase().includes("sale")',
    );
    const saleRows = await db.request(
      "documents",
      { kind: "sale" },
      auth.token,
    );
    const currencySale = await db.request(
      "document",
      { id: saleRows.rows[0].id },
      auth.token,
    );
    assert.equal(currencySale.currency, "USD");
    assert.equal(currencySale.paid_foreign, 4000);
    assert.equal(currencySale.paid, 300000);
    assert.equal(currencySale.total, 300000);
    assert.equal(
      await js(
        'document.querySelector("#bill-panel .sale-payment-currency select").value',
      ),
      "AFN",
    );
    const overview = await db.request("overview", {}, auth.token);
    assert.equal(overview.totals.gross, 100000);
    assert.equal(overview.totals.net, 100000);
    await js('document.querySelector("#history-tab").click()');
    await wait('!!document.querySelector("#history-panel .docs-row")');
    await js('document.querySelector("#history-panel .docs-row").click()');
    await wait('!!document.querySelector(".invoice-print")');
    assert.match(
      await js(
        'document.querySelector(".invoice-payment-conversion").textContent',
      ),
      /USD 40.00.*AF 3,000.00/,
    );
    await clickButton("Return items");
    await wait('!!document.querySelector(".return-form")');
    await fill('.return-form input[data-numeric="integer"]', "1");
    await fill('.return-form input[name="reason"]', "Resale customer return");
    await wait(
      '!!document.querySelector(".return-refund-controls [name=refund_amount]")',
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls select").value',
      ),
      "AFN",
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls [name=refund_rate]").value',
      ),
      "1",
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls [name=refund_amount]").value',
      ),
      "3000.00",
    );
    await js(
      `(() => {const el=document.querySelector('.return-refund-controls select');el.value='USD';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await fill('.return-refund-controls [name="refund_rate"]', "75");
    await wait(
      'document.querySelector(".return-refund-controls [name=refund_amount]").value === "40.00"',
    );
    await fill('.return-refund-controls [name="refund_amount"]', "41");
    assert.equal(
      await js('document.querySelector(".return-form .button-dark").disabled'),
      true,
    );
    await fill('.return-refund-controls [name="refund_amount"]', "40");
    assert.equal(
      await js(
        'document.querySelector(".return-form .sale-print-check input").checked',
      ),
      false,
    );
    await js(
      'document.querySelector(".return-form .sale-print-check input").click()',
    );
    await js('document.querySelector(".return-form").requestSubmit()');
    await wait('!!document.querySelector(".print-setup-modal")');
    assert.match(
      await js(
        'document.querySelector(".invoice-payment-conversion").textContent',
      ),
      /USD 40.00.*AF 3,000.00/,
    );
    assert.ok(
      await js(
        'document.querySelector(".invoice-print").textContent.toLowerCase().includes("sale return")',
      ),
    );
    await key("Escape");
    await wait('!document.querySelector(".print-setup-modal")');
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    // Multi-currency posting and return UI use isolated SQLite; printing stays opt-in.
    const supplier = await db.request(
      "partyCreate",
      { kind: "supplier", name: "Currency supplier" },
      auth.token,
    );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    await clickButton("Purchases");
    await wait(
      '!!document.querySelector("#purchase-bill-panel .currency-picker select")',
    );
    await wait(
      'document.querySelector("#purchase-bill-panel .party-picker select").textContent.includes("Currency supplier")',
    );
    await wait(
      '!!document.querySelector("#purchase-bill-panel .product-pick-card")',
    );
    await js(
      `(() => { const el = document.querySelector('#purchase-bill-panel .party-picker select'); el.value=${JSON.stringify(supplier.id)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await js(
      `(() => { const el = document.querySelector('#purchase-bill-panel .currency-picker select'); el.value='USD'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await wait(
      'document.querySelector("#purchase-bill-panel .currency-picker select").value === "USD"',
    );
    await fill("#purchase-bill-panel .purchase-rate-field input", "70");
    await js(
      'Array.from(document.querySelectorAll("#purchase-bill-panel .product-pick-card")).find(b=>b.textContent.includes("Alert laptop")).click()',
    );
    await wait('!!document.querySelector("#purchase-bill-panel .cart-line")');
    await fill(
      '#purchase-bill-panel .cart-line input[data-numeric="integer"]',
      "2",
    );
    await fill(
      "#purchase-bill-panel .cart-line .field:nth-child(2) input",
      "10",
    );
    assert.equal(
      await js(
        'document.querySelector("#purchase-bill-panel .cart-line .field:nth-child(3) input").value',
      ),
      "700.00",
    );
    await fill('#purchase-bill-panel [name="paid"]', "5");
    await wait(
      'document.querySelector("#purchase-bill-panel [name=paid]").closest("label").textContent.includes("AF 350.00")',
    );
    await fill("#purchase-bill-panel .purchase-rate-field input", "71");
    await wait(
      'document.querySelector("#purchase-bill-panel [name=paid]").closest("label").textContent.includes("AF 355.00")',
    );
    await fill("#purchase-bill-panel .purchase-rate-field input", "70");
    for (const [width, height] of [
      [1198, 1262],
      [1024, 768],
      [1536, 864],
    ]) {
      win.setContentSize(width, height);
      await wait(`window.innerWidth === ${width}`);
      assert.ok(
        await js(
          `(() => { const currency=document.querySelector('#purchase-bill-panel .purchase-currency-field').getBoundingClientRect(); const rate=document.querySelector('#purchase-bill-panel .purchase-rate-field').getBoundingClientRect(); return Math.abs(currency.top-rate.top) < 2; })()`,
        ),
        `Currency/rate share a row at ${width}`,
      );
      assert.ok(
        await js(
          `document.querySelector('#purchase-bill-panel .purchase-party-fields').getBoundingClientRect().height < 150`,
        ),
      );
      assert.ok(
        await js(
          `document.querySelector('#purchase-bill-panel .cart-line').getBoundingClientRect().height < ${width <= 1100 ? 160 : 120}`,
        ),
      );
      assert.ok(
        await js(
          `Array.from(document.querySelectorAll('#purchase-bill-panel .currency-flag')).every(el=>el.getBoundingClientRect().width<=16 && el.getBoundingClientRect().height<=12)`,
        ),
      );
    }
    assert.equal(
      await js(
        'document.querySelector("#purchase-bill-panel .sale-print-check input").checked',
      ),
      false,
    );
    assert.ok(
      await js(
        'Array.from(document.querySelectorAll("#purchase-bill-panel .currency-flag")).every(img => img.complete && img.naturalWidth > 0)',
      ),
    );
    await js(
      'document.querySelector("#purchase-bill-panel .sale-fit-form").requestSubmit()',
    );
    await wait(
      'document.querySelector("#purchase-history-tab").getAttribute("aria-selected") === "true"',
    );
    assert.equal(
      await js('document.querySelectorAll(".print-setup-modal").length'),
      0,
    );
    const purchaseRows = await db.request(
      "documents",
      { kind: "purchase" },
      auth.token,
    );
    const purchased = await db.request(
      "document",
      { id: purchaseRows.rows[0].id },
      auth.token,
    );
    assert.equal(purchased.currency, "USD");
    assert.equal(purchased.total, 140000);
    assert.equal(purchased.paid_foreign, 500);
    assert.equal(purchased.paid, 35000);
    await js(
      'document.querySelector("#purchase-history-panel .docs-row").click()',
    );
    await wait('!!document.querySelector(".invoice-print")');
    assert.match(
      await js(
        'document.querySelector(".invoice-payment-conversion").textContent',
      ),
      /USD 5.00.*AF 350.00/,
    );
    await clickButton("Return items");
    await wait('!!document.querySelector(".return-form")');
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".invoice-print")).display',
      ),
      "none",
    );
    await fill('.return-form input[data-numeric="integer"]', "1");
    await fill('.return-form input[name="reason"]', "Currency return test");
    assert.equal(
      await js(
        'document.querySelector(".return-form .sale-print-check input").checked',
      ),
      false,
    );
    assert.ok(
      await js(
        '(() => { const form = document.querySelector(".return-form"); const rect = form.getBoundingClientRect(); return rect.height > 100 && getComputedStyle(form).overflowY === "auto"; })()',
      ),
    );
    await js('document.querySelector(".return-form").requestSubmit()');
    await wait('!document.querySelector("[role=dialog]")');
    const afterReturn = await db.request(
      "document",
      { id: purchased.id },
      auth.token,
    );
    assert.equal(afterReturn.returned, 70000);
    assert.equal(
      await js('document.querySelectorAll(".print-setup-modal").length'),
      0,
    );
    await js('document.querySelector("#purchase-bill-tab").click()');
    await wait('!document.querySelector("#purchase-bill-panel").hidden');
    assert.equal(
      await js(
        'document.querySelector("#purchase-bill-panel .sale-print-check input").checked',
      ),
      false,
    );
    await js(
      'document.querySelector("#purchase-bill-panel .currency-picker button").click()',
    );
    await wait(
      `!!document.querySelector('input[aria-label="Currency code (3 letters)"]')`,
    );
    await fill('input[aria-label="Currency code (3 letters)"]', "CAD");
    await fill('input[aria-label="Currency name"]', "Canadian dollar");
    await js(
      `(() => { const el = document.querySelector('.currency-country select'); el.value='ca'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await clickButton("Save currency");
    await wait(
      '!document.querySelector("[role=dialog]") && document.querySelector("#purchase-bill-panel .currency-picker select").value === "CAD"',
    );
    assert.equal(
      await js(
        'document.querySelector("#purchase-history-tab").getAttribute("aria-selected")',
      ),
      "false",
    ); // Adding a currency must never submit the purchase form.
    await fill("#purchase-bill-panel .purchase-rate-field input", "50");
    await fill('#purchase-bill-panel [name="paid"]', "3.25");
    await js(
      'Array.from(document.querySelectorAll("#purchase-bill-panel .product-pick-card")).find(b=>b.textContent.includes("Alert laptop")).click()',
    );
    await fill(
      "#purchase-bill-panel .cart-line .field:nth-child(2) input",
      "10",
    );
    await js(
      'document.querySelector("#purchase-bill-panel .sale-print-check input").click()',
    );
    await js(
      'document.querySelector("#purchase-bill-panel .sale-fit-form").requestSubmit()',
    );
    await wait('!!document.querySelector(".print-setup-modal")');
    assert.ok(
      await js(
        'document.querySelector(".invoice-print").textContent.includes("CAD")',
      ),
    );
    assert.match(
      await js(
        'document.querySelector(".invoice-payment-conversion").textContent',
      ),
      /CAD 3.25.*AF 162.50/,
    );
    await key("Escape");
    await wait('!document.querySelector(".print-setup-modal")');
    await key("Escape");
    await wait('!document.querySelector("[role=dialog]")');
    await clickButton("Settings");
    await wait('!!document.querySelector(".settings-navigation")');
    await clickButton("Store");
    await wait(
      'Array.from(document.querySelectorAll(".settings-page .currency-picker option")).some(o=>o.value === "CAD")',
    );
    await clickButton("Suppliers");
    await wait(
      'Array.from(document.querySelectorAll(".people-row")).some(el=>el.textContent.includes("Currency supplier"))',
    );
    await js(
      'Array.from(document.querySelectorAll(".people-row")).find(el=>el.textContent.includes("Currency supplier")).click()',
    );
    await wait('!!document.querySelector(".contact-ledger")');
    await clickButton("Pay supplier");
    await wait('!!document.querySelector(".supplier-payment-currency")');
    await js(
      `(() => { const el = document.querySelector('.supplier-payment-currency .currency-picker select'); el.value='USD'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await fill('.supplier-payment-currency input[name="fx_rate"]', "70");
    await fill('.modal input[name="amount"]', "5");
    await wait(
      'document.querySelector(".modal input[name=amount]").closest("label").textContent.includes("AF 350.00")',
    );
    await clickButton("Record payment");
    await wait(
      '!document.querySelector("[role=dialog]") && document.querySelector(".ledger-foreign-payment")?.textContent.includes("USD 5.00")',
    );
    assert.match(
      await js('document.querySelector(".ledger-foreign-payment").textContent'),
      /USD 5.00.*AF 350.00/,
    );
    const settled = await db.request(
      "partyDetail",
      { id: supplier.id },
      auth.token,
    );
    assert.equal(settled.party.balance, 33750);
    const settlement = settled.entries.find((e) => e.kind === "payment");
    assert.equal(settlement.paid_foreign, 500);
    assert.equal(settlement.debit, 35000);
    const currencyCustomer = await db.request(
      "partyCreate",
      { kind: "customer", name: "Currency customer", opening_balance: 100000 },
      auth.token,
    );
    await clickButton("Customers");
    await wait(
      'Array.from(document.querySelectorAll(".people-row")).some(el=>el.textContent.includes("Currency customer"))',
    );
    await js(
      'Array.from(document.querySelectorAll(".people-row")).find(el=>el.textContent.includes("Currency customer")).click()',
    );
    await wait('!!document.querySelector(".contact-ledger")');
    await clickButton("Receive payment");
    await wait('!!document.querySelector(".party-payment-currency")');
    assert.equal(
      await js(
        'document.querySelector(".party-payment-currency select").value',
      ),
      "AFN",
    );
    assert.equal(
      await js(
        'document.querySelector(".party-payment-currency [name=fx_rate]").value',
      ),
      "1",
    );
    assert.equal(
      await js(
        'document.querySelector(".party-payment-currency [name=fx_rate]").readOnly',
      ),
      true,
    );
    await fill('.modal input[name="amount"]', "100");
    await clickButton("Record payment");
    await wait(
      '!document.querySelector("[role=dialog]") && document.querySelector(".ledger-foreign-payment")?.textContent.includes("AFN 100.00")',
    );
    await clickButton("Receive payment");
    await wait('!!document.querySelector(".party-payment-currency")');
    assert.equal(
      await js(
        'document.querySelector(".party-payment-currency select").value',
      ),
      "AFN",
    );
    await js(
      `(() => {const el=document.querySelector('.party-payment-currency select');el.value='USD';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await fill('.party-payment-currency [name="fx_rate"]', "70");
    await fill('.modal input[name="amount"]', "5");
    await wait(
      'document.querySelector(".modal input[name=amount]").closest("label").textContent.includes("AF 350.00")',
    );
    await clickButton("Record payment");
    await wait(
      '!document.querySelector("[role=dialog]") && document.querySelector(".contact-ledger")?.textContent.includes("USD 5.00")',
    );
    assert.match(
      await js('document.querySelector(".contact-ledger").textContent'),
      /USD 5.00.*AF 350.00/,
    );
    const customerLedger = await db.request(
      "partyDetail",
      { id: currencyCustomer.id },
      auth.token,
    );
    assert.equal(customerLedger.party.balance, 55000);
    const received = customerLedger.entries.find(
      (e) => e.currency === "USD" && e.kind === "receipt",
    );
    assert.equal(received.paid_foreign, 500);
    assert.equal(received.credit, 35000);
    const purchaseList = await db.request(
      "documents",
      { kind: "purchase" },
      auth.token,
    );
    const cadPurchase = purchaseList.rows.find((row) => row.currency === "CAD");
    assert.ok(cadPurchase);
    await clickButton("Purchases");
    await js('document.querySelector("#purchase-history-tab").click()');
    await wait('!!document.querySelector("#purchase-history-panel .docs-row")');
    await js(
      `Array.from(document.querySelectorAll('#purchase-history-panel .docs-row')).find(el=>el.textContent.includes(${JSON.stringify(cadPurchase.number)})).click()`,
    );
    await wait('!!document.querySelector(".invoice-print")');
    await clickButton("Return items");
    await wait('!!document.querySelector(".return-form")');
    await fill('.return-form input[data-numeric="integer"]', "1");
    await wait(
      '!!document.querySelector(".return-refund-controls [name=refund_amount]")',
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls select").value',
      ),
      "AFN",
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls [name=refund_rate]").value',
      ),
      "1",
    );
    assert.equal(
      await js(
        'document.querySelector(".return-refund-controls [name=refund_amount]").value',
      ),
      (cadPurchase.paid / 100).toFixed(2),
    );
    await js(
      `(() => {const el=document.querySelector('.return-refund-controls select');el.value='USD';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await fill('.return-refund-controls [name="refund_rate"]', "50");
    await wait(
      `document.querySelector(".return-refund-controls [name=refund_amount]").value === ${JSON.stringify((cadPurchase.paid / 5000).toFixed(2))}`,
    );
    await fill('.return-form [name="reason"]', "Supplier foreign refund");
    await js(
      'document.querySelector(".return-form .sale-print-check input").click()',
    );
    await js('document.querySelector(".return-form").requestSubmit()');
    await wait('!!document.querySelector(".print-setup-modal")');
    assert.match(
      await js(
        'document.querySelector(".invoice-payment-conversion").textContent',
      ),
      new RegExp(
        `USD ${(cadPurchase.paid / 5000).toFixed(2)}.*AF ${(cadPurchase.paid / 100).toFixed(2)}`,
      ),
    );
    assert.match(
      await js('document.querySelector(".invoice-print table").textContent'),
      /CAD 10.00/,
    );
    assert.ok(
      !(
        await js('document.querySelector(".invoice-summary").textContent')
      ).includes("Outstanding"),
    );
    const updatedPurchase = await db.request(
      "document",
      { id: cadPurchase.id },
      auth.token,
    );
    assert.equal(updatedPurchase.returned, 50000);
    console.log(
      "PASS: USD/CAD purchase creation, custom currency flags/store sharing, sale/purchase returns, print opt-in/default-off, real stock/debtor notifications and payment refresh; dashboard selection/order/persistence/show-all/hide-all; Radefy branding; Settings help/About/Support; two-key shortcuts; unlisted resale owner/product intake and actual 3000/2000/1000 sale profit.",
    );
  })
  .then(async () => {
    clearTimeout(timer);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(0);
  })
  .catch(async (e) => {
    clearTimeout(timer);
    console.error(e);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
  });
