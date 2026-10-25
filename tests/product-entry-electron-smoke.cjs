// Responsive UI checks: isolated store/profile; never modifies the user store.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-product-entry-"));
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
    await db.request(
      "partyCreate",
      { kind: "supplier", name: "RTL supplier", phone: "0700123456" },
      auth.token,
    );
    ipcMain.handle("vault:accounts", (_e, action) =>
      action === "resume" ? undefined : { users: [], profiles: [] },
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
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".auth-form")');
    await js(
      'localStorage.setItem("vault-session",' +
        JSON.stringify(auth.token) +
        ');localStorage.setItem("vault-locale","en")',
    );
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".sidebar")');
    win.setContentSize(1280, 720);
    async function fill(name, value, select = false) {
      await js(
        `(()=>{const e=document.querySelector('.product-entry-modal [name="${name}"]');Object.getOwnPropertyDescriptor(${select ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(select ? "change" : "input")},{bubbles:true}));})()`,
      );
    }
    async function button(label, scope = "[role=dialog]") {
      await wait(
        `(()=>{const d=[...document.querySelectorAll(${JSON.stringify(scope)})].at(-1);const b=d&&[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});return b&&!b.disabled;})()`,
      );
      await js(
        `(()=>{const dialogs=[...document.querySelectorAll(${JSON.stringify(scope)})];const el=[...dialogs.at(-1).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('Missing button '+${JSON.stringify(label)});el.click();})()`,
      );
    }
    async function ready() {
      await wait(
        '!!document.querySelector(".product-entry-modal .button-dark")&&!document.querySelector(".product-entry-modal .button-dark").disabled',
      );
    }
    async function openProduct() {
      await key("n", { ctrlKey: true, code: "KeyN" });
      await wait('!!document.querySelector(".product-entry-modal")');
    }
    await openProduct();
    await fill("name", "Unfinished laptop");
    await fill("cost", "12.");
    await js(
      `new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1600;const ctx=canvas.getContext('2d');const data=ctx.createImageData(canvas.width,canvas.height);let seed=17;for(let i=0;i<data.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);canvas.toBlob(blob=>{const input=document.querySelector('.product-photo-picker input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([blob],'detail.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve();},'image/png');})`,
    );
    await wait(
      'document.querySelector(".product-photo-picker img")?.src.startsWith("data:image/jpeg") && document.querySelector(".product-photo-picker img").naturalWidth>0',
    );
    const compressed = await js(
      `(()=>{const i=document.querySelector('.product-photo-picker img');return {bytes:atob(i.src.split(',')[1]).length,width:i.naturalWidth,height:i.naturalHeight};})()`,
    );
    assert.ok(compressed.bytes <= 150000, JSON.stringify(compressed));
    assert.ok(Math.max(compressed.width, compressed.height) <= 640);

    await ready();
    await button("Save & New");
    assert.equal((await db.request("catalog", {}, auth.token)).rows.length, 1);
    await button("Save Draft");
    await wait(
      'document.querySelector(".entry-notice")?.textContent==="Draft saved"',
    );
    assert.equal(
      (await db.request("productDraftList", { intent: "catalog" }, auth.token))
        .count,
      1,
    );
    assert.equal((await db.request("catalog", {}, auth.token)).rows.length, 1);
    await button("Cancel");
    await wait('!document.querySelector(".product-entry-modal")');
    // Restart the renderer to prove the form is backed by SQLite, not component state.
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".sidebar")');
    await openProduct();
    await js(
      'document.querySelector(".product-entry-modal .modal-actions button:first-child").click()',
    );
    await wait('!!document.querySelector(".entry-draft-row")');
    await button("Resume");
    await wait(
      'document.querySelector("[name=name]")?.value==="Unfinished laptop"',
    );
    assert.equal(
      await js('document.querySelector("[name=cost]").value'),
      "12.",
    );
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind==="custom"',
    );
    await fill("brand", "HP", true);
    await fill("model", "EliteBook 840 G4");
    await fill("sku", "ENTRY-1");
    for (const [name, data] of [
      ["cost", "۱۰۰"],
      ["rate", "۱۸"],
    ]) {
      await js(
        `(()=>{const e=document.querySelector('[name="${name}"]');e.setSelectionRange(0,e.value.length);e.dispatchEvent(new InputEvent('beforeinput',{data:'${data}',inputType:'insertText',bubbles:true,cancelable:true}));})()`,
      );
    }
    await fill("price", "2500");
    await fill("opening_quantity", "2");
    assert.equal(
      await js(
        '!!document.querySelector(".modal-actions button")?.textContent.includes("Drafts")',
      ),
      true,
    );
    assert.equal(
      await js('document.querySelectorAll(".entry-suggestions").length'),
      0,
    );
    await js(
      'document.querySelector("[name=Storage]").focus(); document.querySelector("[name=Storage]").click()',
    );
    await wait(
      'document.querySelector("[name=Storage]").getAttribute("aria-expanded")==="true"',
    );
    for (const key of ["ArrowDown", "Enter"]) {
      await js(
        `document.querySelector('[name=Storage]').dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true,cancelable:true}));`,
      );
    }
    assert.equal(
      await js('document.querySelector("[name=Storage]").value'),
      "128 GB",
    );
    assert.equal(
      await js('document.querySelectorAll(".entry-suggestions").length'),
      0,
    );
    await js(
      'document.querySelector("[name=RAM]").focus(); document.querySelector("[name=RAM]").click()',
    );
    await js(
      `[...document.querySelectorAll('.entry-suggestions button')].find(b=>b.textContent==='32 GB').click()`,
    );
    assert.equal(
      await js('document.querySelector("[name=RAM]").value'),
      "32 GB",
    );
    await fill("RAM", "60 GB");
    await ready();
    await js(
      `for(let i=0;i<3;i++) document.querySelector('[name=RAM]').dispatchEvent(new KeyboardEvent('keydown',{key:'s',code:'KeyS',ctrlKey:true,bubbles:true,cancelable:true}));`,
    );
    await wait(
      'document.querySelector("[name=name]")?.value===""&&document.querySelector(".entry-notice")?.textContent.includes("Ready")',
    );
    const first = (await db.request("catalog", { q: "ENTRY-1" }, auth.token))
      .rows[0];
    assert.equal(first.stock, 2);
    assert.equal(first.unit_cost, 180000);
    assert.equal(first.fx_rate, 180000);
    assert.equal(first.attributes.RAM, "60 GB");
    assert.equal(
      (await db.request("productDraftList", { intent: "catalog" }, auth.token))
        .count,
      0,
    );
    assert.equal(
      await js('document.querySelector("[name=brand]").value'),
      "HP",
    );
    assert.equal(await js('document.querySelector("[name=rate]").value'), "18");
    assert.equal(
      await js('document.querySelector("[name=opening_quantity]").value'),
      "0",
    );
    await fill("name", "Second product");
    await fill("model", "Second model");
    await fill("sku", "ENTRY-2");
    await fill("cost", "200");
    await fill("price", "5000");
    await ready();
    await button("Save & New");
    await wait('document.querySelector("[name=name]")?.value===""');
    await fill("name", "Preserve my unfinished third");
    await button("Previous");
    await wait('document.querySelector("[name=sku]")?.value==="ENTRY-2"');
    assert.equal(
      await js('!!document.querySelector("[name=opening_quantity]")'),
      false,
    );
    await fill("name", "Second product edited");
    await button("Previous");
    await wait('document.querySelector("[name=sku]")?.value==="ENTRY-1"');
    await button("Use automatic photo");
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind!=="custom"',
    );
    await button("Back to New");
    await wait(
      'document.querySelector("[name=name]")?.value==="Preserve my unfinished third"',
    );
    await button("Previous");
    assert.equal(
      await js('document.querySelector("[name=name]").value'),
      "Second product edited",
    );
    await ready();
    await key("s", { metaKey: true, code: "KeyS" });
    await wait(
      'document.querySelector("[name=name]")?.value==="Preserve my unfinished third"',
    );
    assert.equal(
      (await db.request("catalog", { q: "ENTRY-2" }, auth.token)).rows[0].name,
      "Second product edited",
    );
    assert.equal((await db.request("catalog", {}, auth.token)).rows.length, 3);
    assert.equal(
      (await db.request("catalog", { id: first.id }, auth.token)).rows[0].stock,
      2,
    );
    await button("Cancel");
    await wait('document.querySelectorAll("[role=dialog]").length===2');
    await button("Continue Editing");
    assert.equal(
      await js('document.querySelector("[name=name]").value'),
      "Preserve my unfinished third",
    );
    await button("Cancel");
    await button("Save Draft");
    // The unsaved automatic-photo change on an earlier record must also be handled.
    await wait(
      'document.querySelector("[name=sku]")?.value==="ENTRY-1" && document.querySelectorAll("[role=dialog]").length===2',
    );
    assert.notEqual(
      await js(
        'document.querySelector(".product-photo-picker .product-photo").dataset.photoKind',
      ),
      "custom",
    );
    await button("Save changes");
    await wait('!document.querySelector(".product-entry-modal")');
    assert.equal(
      (await db.request("productDraftList", { intent: "catalog" }, auth.token))
        .count,
      1,
    );
    // Purchase entry saves each new product into the current bill once; Previous only edits.
    await js(
      '[...document.querySelectorAll(".sidebar button")].find(b=>b.textContent.trim()==="Purchases").click()',
    );
    await wait('!!document.querySelector("#purchase-bill-panel")');
    await js(
      'document.querySelector("#purchase-bill-panel .trade-catalog-actions button").click()',
    );
    await wait('!!document.querySelector(".product-entry-modal")');
    await fill("name", "Purchase one");
    await fill("model", "Purchase model");
    await fill("sku", "PURCHASE-ENTRY");
    await fill("price", "3000");
    await ready();
    await button("Save & New");
    await wait('document.querySelector("[name=name]")?.value===""');
    assert.equal(await js('document.querySelectorAll(".cart-line").length'), 1);
    await button("Previous");
    await wait(
      'document.querySelector("[name=sku]")?.value==="PURCHASE-ENTRY"',
    );
    await fill("name", "Purchase one edited");
    await ready();
    await button("Save changes");
    await wait('document.querySelector("[name=name]")?.value===""');
    assert.equal(await js('document.querySelectorAll(".cart-line").length'), 1);
    assert.ok(
      (await js('document.querySelector(".cart-line").innerText')).includes(
        "Purchase one edited",
      ),
    );
    await button("Cancel");
    await wait('!document.querySelector(".product-entry-modal")');
    // Delete through the actual product detail UI; nonzero stock stays protected.
    const removable = await db.request("productCreate", {name:"Delete test item",brand:"HP",model:"Test",sku:"DELETE-UI",category:"Computers",price:10000},auth.token);
    await win.loadFile(path.resolve("dist/client/index.html"));
    await wait('!!document.querySelector(".sidebar")');
    await js(`document.querySelectorAll('.sidebar .nav-item')[1].click()`);
    await wait('!!document.querySelector(".inventory-list .search-input input")');
    async function findProduct(text) {
      await js(`(()=>{const e=document.querySelector('.inventory-list .search-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait(`document.querySelector('.inventory-row')?.textContent.includes(${JSON.stringify(text)})`);
      await js(`document.querySelector('.inventory-row').click()`);
      await wait('!!document.querySelector(".product-detail-modal")');
    }
    await findProduct("Delete test item");
    await button("Delete");
    await wait('!!document.querySelector(".product-delete-confirm")');
    await button("Delete", ".product-delete-confirm");
    await wait('!document.querySelector(".product-detail-modal")');
    assert.equal((await db.request("catalog",{q:"DELETE-UI"},auth.token)).rows.length,0);
    await findProduct("Alert laptop");
    await button("Delete");
    await wait(`document.querySelector('.product-detail-modal').textContent.includes('12 units remaining')`);
    assert.equal(await js('!!document.querySelector(".product-delete-confirm")'),false);
    await button("Done");
    // Actual locale/theme rendering and DOM geometry; no screenshots.
    for (const locale of ["en", "ps", "prs"]) {
      await js(
        `localStorage.setItem('vault-locale',${JSON.stringify(locale)})`,
      );
      await win.loadFile(path.resolve("dist/client/index.html"));
      await wait('!!document.querySelector(".sidebar")');
      win.setContentSize(1440, 900);
      win.webContents.setZoomFactor(1);
      for (const [index, prefix, rowSelector] of [
        [1, "inventory", ".inventory-row-main"],
        [4, "people", ".people-row"],
        [5, "people", ".people-row"],
      ]) {
        await js(
          `document.querySelectorAll('.sidebar .nav-item')[${index}].click()`,
        );
        await wait(`!!document.querySelector('${rowSelector}')`);
        await js(
          "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
        );
        const alignment = await js(
          `(()=>{const heads=[...document.querySelector('.${prefix}-list-cols').children], cells=[...document.querySelector('${rowSelector}').children];return heads.filter(h=>h.getAttribute("aria-hidden")!=="true").map((h,i)=>{const a=h.getBoundingClientRect(),b=cells[i].getBoundingClientRect();return {left:Math.abs(a.left-b.left),right:Math.abs(a.right-b.right)}})})()`,
        );
        assert.ok(
          alignment.every((x) => x.left < 3 && x.right < 3),
          JSON.stringify({ locale, prefix, alignment }),
        );
      }
      await openProduct();
      // Free text must retain its original characters and protected fields must not be intercepted.
      const protectedInput = await js(
        `(()=>{const e=document.createElement('input');e.type='password';document.body.append(e);const ev=new InputEvent('beforeinput',{data:'۱۲۳',bubbles:true,cancelable:true});e.dispatchEvent(ev);e.remove();return ev.defaultPrevented;})()`,
      );
      assert.equal(protectedInput, false);
      await js(`(()=>{const e=document.querySelector('[name=barcode]');const data=new DataTransfer();data.setData('text','۱۲۳۴۵');e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
      // Exercise the document beforeinput/paste interception, not only native setters.
      for (const [name, data] of [
        ["cost", "۱۰۰"],
        ["rate", "١٨٫٥"],
      ]) {
        await js(
          `(()=>{const e=document.querySelector('[name="${name}"]');e.focus();e.setSelectionRange(0,e.value.length);e.dispatchEvent(new InputEvent('beforeinput',{data:'${data}',inputType:'insertText',bubbles:true,cancelable:true}));})()`,
        );
      }
      await wait(
        `[...document.querySelectorAll('.product-entry-modal input[readonly]')].some(e=>e.value==='1850.00')`,
      );
      await js(
        `(()=>{const e=document.querySelector('[name=cost]');e.setSelectionRange(0,e.value.length);const data=new DataTransfer();data.setData('text','۱۵۰');e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`,
      );
      await wait(
        `[...document.querySelectorAll('.product-entry-modal input[readonly]')].some(e=>e.value==='2775.00')`,
      );
      assert.equal(await js('document.querySelector("[name=barcode]").value'), "12345");
      await fill("barcode", "");
      await fill("cost", "");
      await fill("rate", "");
      for (const theme of ["navy", "light", "dark", "ocean", "sand"]) {
        await js(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        for (const [width, height, zoom] of [
          [1280, 720, 1],
          [1366, 768, 1],
          [1440, 900, 1],
          [1024, 576, 1],
          [1366, 768, 1.25],
          [800, 600, 1],
        ]) {
          win.setContentSize(width, height);
          win.webContents.setZoomFactor(zoom);
          await wait(
            `Math.abs(innerWidth-${width / zoom})<2 && Math.abs(innerHeight-${height / zoom})<2`,
          );
          await js(
            "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
          );
          const geometry = await js(
            `(()=>{const m=document.querySelector('.product-entry-modal'),b=m.querySelector('.form-body'),footer=m.querySelector('.modal-actions'),r=footer.getBoundingClientRect();return {inner:[innerWidth,innerHeight],panels:getComputedStyle(m.querySelector(".product-entry-panels")).gridTemplateColumns,scroll:b.scrollHeight-b.clientHeight,width:b.scrollWidth-b.clientWidth,footer:r.bottom<=innerHeight&&r.top>=0,modal:m.getBoundingClientRect().right<=innerWidth};})()`,
          );
          assert.ok(
            geometry.footer && geometry.modal,
            JSON.stringify({ locale, theme, width, height, zoom, geometry }),
          );
          assert.ok(
            geometry.width <= 2,
            JSON.stringify({ locale, theme, width, height, zoom, geometry }),
          );
          if (width >= 1280 && zoom === 1)
            assert.ok(
              geometry.scroll <= 2,
              JSON.stringify({ locale, theme, width, height, zoom, geometry }),
            );
        }
      }
      await js(
        'document.querySelector(".product-entry-modal .modal-close").click()',
      );
      await wait('!document.querySelector(".product-entry-modal")');
      win.webContents.setZoomFactor(1);
    }
    console.log(
      "PASS: draft restart/resume, Save & New, Previous updates, keyboard save, purchase integration, RTL column alignment, Eastern-digit typing/pasting and saved costs, and desktop layout in 3 languages and 5 themes.",
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
