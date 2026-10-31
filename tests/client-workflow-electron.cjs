// Current development UI + real SQLite worker in a disposable desktop profile.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-client-workflow-"));
app.setPath("userData", path.join(root, "profile"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
let db, win;
const timer = setTimeout(() => {
  console.error("Client workflow timeout");
  app.exit(1);
}, 90000);
app
  .whenReady()
  .then(async () => {
    const { createWorker } = await import("../server/client.mjs");
    db = createWorker(path.join(root, "test.sqlite"));
    const auth = await db.request("setup", {
      name: "Test Owner",
      username: "owner",
      password: "isolated-test-password",
      storeName: "Workflow test shop",
    });
    const call = (c, a = {}) => db.request(c, a, auth.token);
    let first;
    for (let i = 0; i < 15; i++) {
      const p = await call("productCreate", {
        name: `Latitude ${String(i).padStart(2, "0")}`,
        brand: "Dell",
        model: "7490",
        sku: "CLIENT-" + i,
        category: i === 0 ? "Computers" : "Storage",
        price: 300000,
        unit_cost: 100000,
        opening_quantity: 3,
        attributes: { Generation: "8th Gen", RAM: "16 GB" },
      });
      if (!first) first = p.id;
    }
    const party = await call("partyCreate", {
      kind: "customer",
      name: "Ali due today",
    });
    await call("partyCreate", {
      kind: "customer",
      name: "Zed larger debt",
      opening_balance: 500000,
    });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kabul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await call("sale", {
      party_id: party.id,
      date: today,
      due_date: today,
      paid: 0,
      lines: [{ product_id: first, quantity: 1, price: 300000 }],
      request_key: randomUUID(),
    });
    ipcMain.handle("vault:due-reminders", () => true);
    ipcMain.handle("vault:accounts", (_e, action) =>
      action === "resume" ? undefined : { users: [], profiles: [] },
    );
    ipcMain.handle("vault:activation-status", () => ({
      active: true,
      required: false,
      mode: "development",
    }));
    ipcMain.handle("vault:command", async (_e, c, a, token) => {
      try {
        return { ok: true, result: await db.request(c, a, token) };
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
        nodeIntegration: false,
      },
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    async function wait(code) {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error(code + "\n" + (await js("document.body.innerText")));
    }
    async function click(label, scope = "body") {
      const find = `[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
      await wait(`(()=>{const b=${find};return !!b&&!b.disabled})()`);
      await js(`(${find}).click()`);
      await js(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
    }
    async function set(selector, value, select = false) {
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? "change" : "input"}',{bubbles:true}));})()`,
      );
      await js("new Promise(r=>requestAnimationFrame(()=>r()))");
    }
    async function shortcut(key) {
      await js(
        `document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:true,bubbles:true,cancelable:true}))`,
      );
    }
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".auth-form")');
    await js(
      `localStorage.setItem('vault-session',${JSON.stringify(auth.token)});localStorage.setItem('vault-locale','en')`,
    );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    await shortcut("n");
    await wait('!!document.querySelector(".product-entry-modal")');
    assert.equal(
      await js('document.querySelector("[name=brand]").value'),
      "Dell",
    );
    const currencies = await js(
      '[...document.querySelectorAll(".currency-picker select option")].map(e=>e.value)',
    );
    assert.deepEqual(currencies.sort(), ["AED", "AFN", "USD"]);
    for (const [field, query, expected] of [["Storage", "5", "512 GB"], ["RAM", "16", "16 GB"], ["Generation", "8", "8th Gen"]]) {
      await set(`[name=${field}]`, query);
      assert.deepEqual(await js(`[...document.querySelectorAll('[name=${field}]')][0].closest('.entry-spec').querySelector('[role=listbox]') ? [...document.querySelector('[name=${field}]').closest('.entry-spec').querySelectorAll('[role=option]')].map(e=>e.textContent.trim()) : []`), [expected]);
    }
    await set("[name=Generation]", "8");
    await js(
      'document.querySelector("[name=Generation]").dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}))',
    );
    await wait('document.querySelector("[name=Generation]").value==="8th Gen"');
    await set("[name=Generation]", "14");
    await js(
      'document.querySelector("[name=Generation]").dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}))',
    );
    await wait(
      'document.querySelector("[name=Generation]").value==="14th Gen"',
    );
    await click("Cancel", ".product-entry-modal");
    await click("Discard", "[role=dialog]");
    await shortcut("i");
    await wait('document.querySelectorAll(".inventory-row-main").length===10');
    await click("Print", ".inventory-page");
    await wait(
      'document.querySelector(".print-preview-area iframe")?.contentDocument?.querySelectorAll("tbody tr").length===15',
    );
    const report = await js(
      `(()=>{const d=document.querySelector('.print-preview-area iframe').contentDocument;const s=d.querySelector('.sheet').getBoundingClientRect();return {text:d.body.innerText,identity:!!d.querySelector('td.product-identity strong'),specs:!!d.querySelector('td.product-identity small'),contained:[...d.querySelectorAll('table,th,td')].every(e=>{const r=e.getBoundingClientRect();return r.left>=s.left-1&&r.right<=s.right+1})}})()`,
    );
    assert(
      report.identity && report.specs && report.contained,
      JSON.stringify(report),
    );
    assert.match(report.text, /44,000/);
    assert.match(report.text, /Stock value/);
    await click("Close", ".print-setup-modal");
    await js('document.querySelector(".inventory-row-main").click()');
    await wait('!!document.querySelector(".product-detail-modal")');
    await click("Edit product", ".product-detail-modal");
    await wait('!!document.querySelector(".product-entry-modal")');
    await set("[name=opening_quantity]", "1");
    await click("Save changes", ".product-entry-modal");
    await wait('!document.querySelector(".product-entry-modal")');
    assert.equal((await call("catalog", { id: first })).rows[0].stock, 1);
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    await js('document.querySelectorAll(".sidebar .nav-item")[4].click()');
    await wait('!!document.querySelector(".people-customer")');
    await set('select[aria-label="Customer filter"]', "debtors", true);
    await wait('document.querySelectorAll(".people-row").length===2');
    assert.equal(
      await js(
        'document.querySelector("select[aria-label=\\"Sort by\\"]").value',
      ),
      "balance",
    );
    assert.match(
      await js('document.querySelector(".people-row").textContent'),
      /Zed/,
    );
    await click("Print", ".people-page");
    await wait(
      'document.querySelector(".print-preview-area iframe")?.contentDocument?.querySelectorAll("tbody tr").length===2',
    );
    assert.match(
      await js(
        'document.querySelector(".print-preview-area iframe").contentDocument.querySelector("tbody tr").textContent',
      ),
      /Zed/,
    );
    await click("Close", ".print-setup-modal");
    win.webContents.send("vault:open-due", "due");
    await wait('!!document.querySelector(".notification-items details")');
    assert.match(
      await js('document.querySelector(".notification-items").textContent'),
      /Ali due today/,
    );
    await js(
      'document.querySelector(".notification-items details").open=true;document.querySelector(".notification-items details button").click()',
    );
    await wait('!!document.querySelector(".invoice-print")');
    const totals = await js(
      '[...document.querySelectorAll(".invoice-summary > div")].map(e=>e.innerText)',
    );
    assert.equal(totals.length, 3, JSON.stringify(totals));
    assert(!totals.join(" ").includes("Previous"));
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    await shortcut("s");
    await wait('!!document.querySelector(".product-pick-card")');
    await js('document.querySelector(".product-pick-card").click()');
    await wait('!!document.querySelector("[name=due_date]")');
    assert.equal(
      await js('document.querySelector("[name=due_date]").required'),
      true,
    );
    console.log(
      "PASS: desktop Dell/AED defaults, restricted currency picker, 8/14 generation normalization, complete 15-row inventory print with batch value and contained tables, unnamed-device stock correction, debtors sorting/print, due notification navigation, three invoice totals and required unpaid-sale due dates.",
    );
    clearTimeout(timer);
    win.destroy();
    await db.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    clearTimeout(timer);
    if (win) win.destroy();
    if (db) await db.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
  });
