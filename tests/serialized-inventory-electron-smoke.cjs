// Isolated SQLite + real preload/API/UI. No screenshots or user-shop mutations.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-devices-"));
app.setPath("userData", path.join(root, "profile"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
let win, db;
const timeout = setTimeout(() => {
  console.error("Device workflow timed out");
  app.exit(1);
}, 120000);
app
  .whenReady()
  .then(async () => {
    const { createWorker } = await import(
      pathToFileURL(path.resolve("server/client.mjs")).href
    );
    db = createWorker(path.join(root, "test.sqlite"));
    const auth = await db.request("setup", {
      name: "Owner",
      username: "owner",
      password: "device-test-password",
      storeName: "Device shop",
    });
    const call = (cmd, args = {}) => db.request(cmd, args, auth.token);
    const supplier = (
      await call("partyCreate", { kind: "supplier", name: "Device supplier" })
    ).id;
    const p = (
      await call("productCreate", {
        name: "Exact laptop",
        brand: "Apple",
        model: "M3",
        sku: "EXACT-LAPTOP",
        category: "Computers",
        price: 50000,
      })
    ).id;
    await call("purchase", {
      currency: "AFN",
      party_id: supplier,
      paid: 0,
      request_key: randomUUID(),
      lines: [
        {
          product_id: p,
          quantity: 1,
          price: 10000,
          units: [{ serial: "OLDER-UNIT" }],
        },
      ],
    });
    ipcMain.handle("vault:accounts", (_e, a) =>
      a === "resume" ? undefined : { users: [], profiles: [] },
    );
    ipcMain.handle("vault:activation-status", () => ({
      active: true,
      required: false,
    }));
    ipcMain.handle("vault:command", async (_e, cmd, args, token) => {
      try {
        return { ok: true, result: await db.request(cmd, args, token) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {
        preload: path.resolve("electron/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
      },
    });
    const js = (c) => win.webContents.executeJavaScript(c);
    async function wait(c) {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (await js(c)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error(
        "Condition failed: " + c + "\n" + (await js("document.body.innerText")),
      );
    }
    async function input(selector, value, select = false) {
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? "change" : "input"}',{bubbles:true}));})()`,
      );
    }
    async function click(selector) {
      await wait(
        `!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,
      );
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    async function button(text, scope = "body") {
      const code = `[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
      await wait(`!!(${code})&&!(${code}).disabled`);
      await js(`(${code}).click()`);
    }
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".auth-form")');
    await js(
      `localStorage.setItem('vault-session',${JSON.stringify(auth.token)});localStorage.setItem('vault-locale','en')`,
    );
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".sidebar")');
    // Receive another physical device on a purchase, with its own cost and optional details.
    await click(".sidebar .nav-item:nth-child(4)");
    await wait(
      `!![...document.querySelectorAll('.sale-customer-name select option')].find(o=>o.value===${JSON.stringify(supplier)})`,
    );
    await input(".sale-customer-name select", supplier, true);
    await input(".purchase-currency-field select", "AFN", true);
    await input(".trade-catalog-tools .search-input input", "Exact laptop");
    await wait('!!document.querySelector(".product-pick-card")');
    await click(".product-pick-card");
    await input(".cart-line .form-grid input", "1");
    await input(".cart-line .form-grid .field:nth-child(2) input", "250");
    await click(".cart-line .device-receipt > button");
    await input(
      ".cart-line .device-detail-row .field:nth-child(1) input",
      "NEWER-UNIT",
    );
    await input(".cart-line .device-detail-row select", "Used", true);
    await input(
      ".cart-line .device-detail-row .field:nth-child(3) input",
      "88%",
    );
    await input(
      ".cart-line .device-detail-row .field:nth-child(4) input",
      "Small case scratch",
    );
    await button("Receive purchase");
    await wait(
      `[...document.querySelectorAll('#purchase-history-panel .docs-row')].some(r=>r.textContent.includes('PUR-000002'))`,
    );
    await js(
      `[...document.querySelectorAll('#purchase-history-panel .docs-row')].find(r=>r.textContent.includes('PUR-000002')).click()`,
    );
    await wait(
      'document.body.innerText.includes("NEWER-UNIT") && !!document.querySelector("[role=dialog]")',
    );
    await button("Close", "[role=dialog]");
    const units = (await call("devices", { product_id: p })).rows;
    assert.equal(units.length, 2);
    const selected = units.find((u) => u.serial === "NEWER-UNIT");
    assert.equal(selected.unit_cost, 25000);
    // The newer unit must be explicitly chosen and its exact cost must reach the ledger.
    await click(".sidebar .nav-item:nth-child(3)");
    await input(".sale-customer-name input", "Exact buyer");
    await input(".trade-catalog-tools .search-input input", "Exact laptop");
    await wait('!!document.querySelector(".product-pick-card")');
    await click(".product-pick-card");
    await wait(
      'document.querySelectorAll(".cart-line .device-option").length===2',
    );
    await js(
      `[...document.querySelectorAll('.cart-line .device-option')].find(l=>l.textContent.includes('NEWER-UNIT')).querySelector('input').click()`,
    );
    assert.equal(
      await js('document.querySelector(".cart-line .form-grid input").value'),
      "1",
    );
    await button("Create sale");
    await click("#history-panel .docs-row");
    await wait('!!document.querySelector("[role=dialog] .invoice-print")');
    const sales = await call("documents", { kind: "sale" });
    const sale = await call("document", { id: sales.rows[0].id });
    assert.equal(sale.cost, 25000);
    assert.equal(sale.lines[0].units[0].id, selected.id);
    assert.equal(sale.total - sale.cost, 25000);
    // Select and return that same unit, restoring its original cost.
    await button("Return items", "[role=dialog]");
    await click(".return-form .device-option input");
    await input(".return-form input[name=reason]", "Customer returned device");
    await click(".return-form .button-dark");
    await wait(
      '!document.querySelector(".return-form") && !document.querySelector("[role=dialog]")',
    );
    const returned = (await call("devices", { product_id: p })).rows;
    assert.equal(returned.length, 2);
    assert.equal(returned.find((u) => u.id === selected.id).unit_cost, 25000);
    const returns = await call("documents", { kind: "all" });
    assert.equal(
      (
        await call("document", {
          id: returns.rows.find((r) => r.kind === "sale_return").id,
        })
      ).cost,
      25000,
    );
    assert.equal((await call("reports")).totals.gross, 0);
    for (const [index, locale] of ["en", "ps", "prs"].entries()) {
      await js(`localStorage.setItem('vault-locale','${locale}')`);
      await win.loadFile(path.resolve("dist/client/index.html"));
      await wait('!!document.querySelector(".sidebar")');
      await click(".sidebar .nav-item:nth-child(2)");
      await input(".inventory-list .search-input input", "Exact laptop");
      await wait(
        'document.querySelector(".inventory-row")?.textContent.includes("Exact laptop")',
      );
      await click(".inventory-row");
      await wait(
        'document.querySelectorAll(".product-detail-modal .device-option").length===2',
      );
      await js(
        `[...document.querySelectorAll('.product-detail-modal .device-option')].find(l=>l.textContent.includes('NEWER-UNIT')).querySelector('input').click()`,
      );
      await wait('!!document.querySelector(".device-edit > .field input")');
      const price = String(510 + index) + ".25",
        eastern = price
          .replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])
          .replace(".", "٫");
      await js(
        `(()=>{const e=document.querySelector('.device-edit > .field input');e.setSelectionRange(0,e.value.length);e.dispatchEvent(new InputEvent('beforeinput',{data:${JSON.stringify(eastern)},inputType:'insertText',bubbles:true,cancelable:true}));})()`,
      );
      assert.equal(
        await js('document.querySelector(".device-edit > .field input").value'),
        price,
      );
      await click(".device-edit > .button-dark");
      await wait('!document.querySelector(".device-edit")');
      const updated = (await call("devices", { product_id: p })).rows.find(
        (u) => u.id === selected.id,
      );
      assert.equal(updated.price, (510 + index) * 100 + 25);
      assert.equal(updated.unit_cost, 25000);
      assert.equal(
        await js(
          `(()=>{const r=document.querySelector('.product-detail-modal .modal-actions').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0})()`,
        ),
        true,
      );
    }
    console.log(
      "PASS: purchase device details, exact device selection, exact cost/profit, invoice identity, return-to-stock, and device price editing with Eastern digits in English/Pashto/Dari through the desktop UI.",
    );
  })
  .then(async () => {
    clearTimeout(timeout);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(0);
  })
  .catch(async (e) => {
    clearTimeout(timeout);
    console.error(e);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
  });
