// Responsive UI checks: isolated store/profile; never modifies the user store.
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
}, 120000);
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
        unit_cost: 100000,
        opening_quantity: 12,
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
    await js(
      'localStorage.setItem("vault-session",' +
        JSON.stringify(auth.token) +
        ');localStorage.setItem("vault-locale","en")',
    );
    await win.loadURL("http://127.0.0.1:4173/");
    await wait('!!document.querySelector(".sidebar")');
    const sizes = [
      [877, 942, 1],
      [1024, 576, 1],
      [1280, 720, 0.9],
      [1024, 640, 1],
      [1280, 720, 1],
      [1366, 768, 1],
      [1440, 900, 1],
      [1920, 1080, 1],
      [1920, 1080, 1.5],
      [1366, 768, 1.25],
      [800, 600, 1],
    ];
    for (const [width, height, zoom] of sizes) {
      win.setContentSize(width, height);
      win.webContents.setZoomFactor(zoom);
      for (const screen of [
        "Sales",
        "Purchases",
        "Settings",
        "Inventory",
        "Dashboard",
        "Reports",
        "Customers",
        "Suppliers",
        "Expenses",
        "Daily book",
      ]) {
        await js(
          `Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.textContent.trim()===${JSON.stringify(screen)}).click()`,
        );
        await wait(
          screen === "Sales" || screen === "Purchases"
            ? '!!document.querySelector(".sale-board")'
            : '!document.querySelector(".sale-board")',
        );
        if (screen === "Sales" || screen === "Purchases") {
          await wait(
            '!!document.querySelector(".cart-line") || !!document.querySelector(".product-pick-card:not(:disabled)")',
          );
          await js(
            "if (!document.querySelector('.cart-line')) document.querySelector('.product-pick-card:not(:disabled)').click()",
          );
          await wait('!!document.querySelector(".cart-line")');
          await js(
            "document.querySelector('.sale-actions .button-dark').scrollIntoView({block:'nearest'})",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 220));
        if (screen === "Inventory") {
          await wait('!!document.querySelector(".inventory-row")');
          const inventory = await js(`(() => {
            const list=document.querySelector('.inventory-list'), cost=list.querySelector('.inventory-row-cost'), header=list.querySelector('.inventory-list-cols');
            const workspace=document.querySelector('.main-workspace').clientWidth;
            return {workspace,costVisible:!!cost && getComputedStyle(cost).display!=='none',headerVisible:getComputedStyle(header).display!=='none',overflow:[...list.querySelectorAll('.inventory-row-main')].some(row=>row.scrollWidth>row.clientWidth+1)};
          })()`);
          if (inventory.workspace >= 900) {
            const composition = await js(`(() => {
              const workspace=document.querySelector('.main-workspace').getBoundingClientRect(), page=document.querySelector('.inventory-page').getBoundingClientRect();
              return {ratio:page.width/workspace.width,left:page.left-workspace.left,right:workspace.right-page.right,width:page.width};
            })()`);
            assert.ok(
              composition.ratio <= 0.821,
              `Inventory must preserve reference side margins at ${width}/${zoom}`,
            );
            assert.ok(
              composition.width <= 1041,
              `Inventory maximum width at ${width}/${zoom}`,
            );
            assert.ok(
              Math.abs(composition.left - composition.right) < 2,
              `Inventory must remain centered at ${width}/${zoom}`,
            );
          }
          if (inventory.workspace >= 600) {
            assert.equal(
              inventory.costVisible,
              true,
              `Inventory cost hidden at ${width}/${zoom}`,
            );
            assert.equal(
              inventory.headerVisible,
              true,
              `Inventory headings hidden at ${width}/${zoom}`,
            );
          }
          assert.equal(
            inventory.overflow,
            false,
            `Inventory columns overflow at ${width}/${zoom}`,
          );
        }
        if (screen === "Sales" || screen === "Purchases") {
          const boardLayout = await js(`(() => {
            const workspace=document.querySelector('.main-workspace').clientWidth;
            const left=document.querySelector('.sale-board-left').getBoundingClientRect(),right=document.querySelector('.sale-board-right').getBoundingClientRect();
            const panels=[...document.querySelectorAll('.sale-customer-panel,.sale-pay-panel,.sale-bill-panel,.sale-catalog-panel')];
            return {workspace,sideBySide:Math.abs(left.top-right.top)<2 && right.left>=left.right-1,panelOverflow:panels.filter(p=>p.scrollWidth>p.clientWidth+1).map(p=>p.className)};
          })()`);
          if (boardLayout.workspace >= 600)
            assert.equal(
              boardLayout.sideBySide,
              true,
              `${screen} must retain desktop columns at ${width}/${zoom}`,
            );
          assert.deepEqual(
            boardLayout.panelOverflow,
            [],
            `${screen} panel overflow at ${width}/${zoom}`,
          );
          if (width === 877 && zoom === 1)
            fs.writeFileSync(
              `/tmp/radefy-mac-${screen.toLowerCase()}.png`,
              (await win.capturePage()).toPNG(),
            );
        }
        if (["Customers", "Suppliers", "Expenses"].includes(screen)) {
          const listLayout = await js(`(() => {
            const list=document.querySelector('.people-list,.docs-list'),header=list?.querySelector('.people-list-cols,.docs-list-cols');
            return {workspace:document.querySelector('.main-workspace').clientWidth,headingsVisible:!!header && getComputedStyle(header).display!=='none',rowOverflow:[...(list?.querySelectorAll('.people-row,.docs-row')||[])].some(r=>r.scrollWidth>r.clientWidth+1)};
          })()`);
          if (listLayout.workspace >= 600)
            assert.equal(
              listLayout.headingsVisible,
              true,
              `${screen} desktop headings hidden at ${width}/${zoom}`,
            );
          assert.equal(
            listLayout.rowOverflow,
            false,
            `${screen} row overflow at ${width}/${zoom}`,
          );
        }
        const result = await js(`(() => {
          const root=document.querySelector('.workspace-scroll'), board=document.querySelector('.sale-board');
          const rect=board?.getBoundingClientRect();
          const clipped=[...document.querySelectorAll('.sale-board input,.sale-board select,.sale-actions button')].filter(el=>el.getBoundingClientRect().width>0).filter(el=>{const r=el.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;}).map(el=>el.outerHTML.slice(0,120));
          return {width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,workspaceOverflow:root?.scrollWidth>root?.clientWidth+1,columns:board?getComputedStyle(board).gridTemplateColumns:null,actionVisible:!board || (()=>{const r=document.querySelector(".sale-actions .button-dark").getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1;})(),clipped};
        })()`);
        console.log(JSON.stringify({ screen, width, height, zoom, ...result }));
        assert.equal(
          result.bodyOverflow,
          false,
          `${screen} body overflow ${width}/${zoom}`,
        );
        assert.equal(
          result.workspaceOverflow,
          false,
          `${screen} workspace overflow ${width}/${zoom}`,
        );
        assert.equal(
          result.actionVisible,
          true,
          `${screen} save action unreachable ${width}/${zoom}`,
        );
        assert.deepEqual(
          result.clipped,
          [],
          `${screen} clipped controls ${width}/${zoom}`,
        );
        if (screen === "Sales" && width === 1280 && zoom === 1)
          fs.writeFileSync(
            "/tmp/radefy-responsive-sale.png",
            (await win.capturePage()).toPNG(),
          );
      }
    }
    console.log("Responsive desktop smoke passed.");
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
