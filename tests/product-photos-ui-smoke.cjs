// Isolated offline desktop workflow checks. No screenshots and no live-store data.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-photo-ui-"));
app.setPath("userData", path.join(root, "profile"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
let db, win;
const timer = setTimeout(() => {
  console.error("Photo UI test timed out");
  app.exit(1);
}, 45000);
app
  .whenReady()
  .then(async () => {
    const { createWorker } = await import(
      pathToFileURL(path.resolve("server/client.mjs")).href
    );
    db = createWorker(path.join(root, "store.sqlite"));
    const auth = await db.request("setup", {
      name: "Test Owner",
      username: "owner",
      password: "photo-ui-test-2026",
      storeName: "Photo UI test",
    });
    for (const product of [
      {
        name: "Samsung phone",
        brand: "Samsung",
        model: "Galaxy S24",
        category: "Mobiles",
        sku: "PHONE-SAMSUNG",
      },
      {
        name: "Apple phone",
        brand: "Apple",
        model: "iPhone 15 Pro",
        category: "Mobiles",
        sku: "PHONE-APPLE",
      },
      {
        name: "HP laptop",
        brand: "HP",
        model: "EliteBook 840 G4",
        category: "Computers",
        sku: "LAPTOP-HP",
      },
    ])
      await db.request(
        "productCreate",
        { ...product, price: 300000 },
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
      width: 1330,
      height: 1000,
      webPreferences: {
        preload: path.resolve("electron/preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    async function wait(code) {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
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
    async function fill(selector, value, type = "input") {
      await js(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type === "change" ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`,
      );
    }
    async function button(text) {
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    }
    async function open(url, file = false) {
      file ? await win.loadFile(url) : await win.loadURL(url);
      await wait(
        '!!document.querySelector(".auth-form") || !!document.querySelector(".sidebar")',
      );
      await js(
        'localStorage.setItem("vault-session",' +
          JSON.stringify(auth.token) +
          ');localStorage.setItem("vault-locale","en")',
      );
      file ? await win.loadFile(url) : await win.loadURL(url);
      await wait('!!document.querySelector(".inventory-row")');
    }
    await open(path.resolve("dist/client/index.html"), true);
    await wait(
      '[...document.querySelectorAll(".inventory-row .product-photo img")].length===3 && [...document.querySelectorAll(".inventory-row .product-photo img")].every(i=>i.naturalWidth>0)',
    );
    const sources = await js(
      '[...document.querySelectorAll(".inventory-row .product-photo img")].map(i=>i.src)',
    );
    assert.ok(sources.some((src) => src.includes("samsung-galaxy-s24")));
    assert.ok(sources.some((src) => src.includes("apple-iphone-15-pro")));
    assert.ok(sources.some((src) => src.includes("hp-elitebook-840-g4")));
    await button("Purchases");
    await wait('!!document.querySelector("#purchase-bill-panel")');
    async function newProduct() {
      await js(
        'document.querySelector("#purchase-bill-panel .trade-catalog-actions button").click()',
      );
      await wait('!!document.querySelector(".product-photo-picker")');
    }
    const formSelector = ".product-photo-picker";
    await newProduct();
    await fill('[name="category"]', "Mobiles", "change");
    await fill('[name="brand"]', "Samsung", "change");
    await fill('[name="model"]', "Galaxy S24");
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind==="exact"',
    );
    assert.match(
      await js('document.querySelector(".product-photo-picker img").src'),
      /samsung-galaxy-s24/,
    );
    await fill('[name="category"]', "Computers", "change");
    await fill('[name="brand"]', "HP", "change");
    await fill('[name="model"]', "EliteBook 840 G4");
    await wait(
      'document.querySelector(".product-photo-picker img")?.src.includes("hp-elitebook-840-g4")',
    );
    await fill('[name="brand"]', "Other", "change");
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind==="missing"',
    );
    assert.equal(
      await js('document.querySelectorAll(".product-photo-picker img").length'),
      0,
    );
    await fill('[name="category"]', "Mobiles", "change");
    await fill('[name="brand"]', "Samsung", "change");
    await fill('[name="model"]', "Galaxy S24");
    await wait(
      'document.querySelector(".product-photo-picker img")?.src.includes("samsung-galaxy-s24")',
    );
    const source = fs
      .readFileSync("public/assets/products/samsung-galaxy-s24.png")
      .toString("base64");
    await js(
      `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(source)}),c=>c.charCodeAt(0));const input=document.querySelector('.product-photo-picker input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([bytes],'samsung.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind==="custom" && document.querySelector(".product-photo-picker img")?.src.startsWith("data:image/jpeg")',
    );
    const uploadedPreview = await js(
      'document.querySelector(".product-photo-picker img").src',
    );
    await fill('[name="model"]', "Galaxy S24 Ultra");
    await fill('[name="brand"]', "Apple", "change");
    await fill('[name="category"]', "Computers", "change");
    await fill('[name="model"]', "MacBook Air M3");
    assert.equal(
      await js('document.querySelector(".product-photo-picker img").src'),
      uploadedPreview,
    );
    assert.equal(
      await js(
        'document.querySelector(".product-photo-picker .product-photo").dataset.photoKind',
      ),
      "custom",
    );
    await fill('[name="category"]', "Mobiles", "change");
    await fill('[name="brand"]', "Samsung", "change");
    await fill('[name="model"]', "Galaxy S24");
    await fill('[name="name"]', "Exact uploaded Samsung");
    await fill('[name="sku"]', "PHOTO-UPLOADED");
    await fill('[name="price"]', "3000");
    await wait(
      '!document.querySelector(".product-photo-picker").closest("form").querySelector(".modal-actions .button-dark").disabled',
    );
    await js(
      'document.querySelector(".product-photo-picker").closest("form").requestSubmit()',
    );
    await wait('!document.querySelector(".product-photo-picker")');
    const saved = (
      await db.request("catalog", { q: "PHOTO-UPLOADED" }, auth.token)
    ).rows[0];
    assert.ok(saved.image.startsWith("photo:"));
    const image = await db.request(
      "productPhoto",
      { ref: saved.image },
      auth.token,
    );
    assert.ok(image.src.startsWith("data:image/jpeg"));
    await newProduct();
    await fill('[name="category"]', "Mobiles", "change");
    await fill('[name="brand"]', "Samsung", "change");
    await fill('[name="model"]', "Galaxy S24");
    await wait(
      'document.querySelector(".product-photo-picker .product-photo")?.dataset.photoKind==="custom"',
    );
    assert.equal(
      await js('document.querySelector(".product-photo-picker img").src'),
      image.src,
    );
    await button("Use automatic photo");
    await wait(
      'document.querySelector(".product-photo-picker img")?.src.includes("samsung-galaxy-s24")',
    );
    await js(
      'document.querySelector(".product-photo-picker").closest("form").querySelector(".modal-actions .button").click()',
    );
    await wait('document.querySelectorAll("[role=dialog]").length===2');
    await button("Discard");
    await wait('!document.querySelector(".product-photo-picker")');
    // Compiled desktop app must display both bundled and SQLite photos without HTTP access.
    session.defaultSession.webRequest.onBeforeRequest((details, respond) =>
      respond({ cancel: /^(https?|wss?):/.test(details.url) }),
    );
    await open(path.resolve("dist/client/index.html"), true);
    await wait(
      '[...document.querySelectorAll(".inventory-row .product-photo img")].length===4 && [...document.querySelectorAll(".inventory-row .product-photo img")].every(i=>i.naturalWidth>0)',
    );
    const offline = await js(
      '[...document.querySelectorAll(".inventory-row .product-photo img")].map(i=>i.src)',
    );
    assert.ok(
      offline.some(
        (src) => src.startsWith("file:") && src.includes("hp-elitebook"),
      ),
    );
    assert.ok(offline.some((src) => src.startsWith("data:image/jpeg")));
    assert.ok(
      offline.every(
        (src) => src.startsWith("file:") || src.startsWith("data:"),
      ),
    );
    console.log(
      "PASS: company/model previews, neutral unknown-company fallback, exact-photo upload, SQLite save/reuse/reset, and compiled desktop photos with all internet blocked.",
    );
  })
  .then(async () => {
    clearTimeout(timer);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(0);
  })
  .catch(async (error) => {
    clearTimeout(timer);
    console.error(error);
    win?.destroy();
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
  });
