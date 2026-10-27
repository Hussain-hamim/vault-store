// Real main IPC, preload, isolated SQLite and Electron PDF rendering.
// Native sending is replaced so this test never contacts a WhatsApp recipient.
const { app, BrowserWindow, shell, dialog } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-wa-desktop-"));
const downloads = path.join(root, "downloads");
fs.mkdirSync(downloads);
fs.mkdirSync(path.join(root, "shop"));
app.setPath("appData", root);
app.setPath("userData", path.join(root, "shop"));
app.setPath("downloads", downloads);
app.getAppPath = () => process.cwd();
app.requestSingleInstanceLock = () => true;
app.disableHardwareAcceleration();
process.env.RADEFY_USER_DATA = path.join(root, "shop");
process.env.VAULT_DESKTOP_STATIC = "1";
process.on("exit", () => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});
global.fetch = async () => {
  throw new Error("External networking disabled in WhatsApp test");
};
shell.openExternal = async () => {
  throw new Error("Unexpected external launch in test");
};
let choice = 0;
dialog.showMessageBox = async () => ({ response: choice });
let finishNative,
  nativeCalls = 0;
const sharing = require("../electron/whatsapp-share.cjs");
sharing.createWhatsAppSender = () => async (input) => {
  nativeCalls++;
  assert.equal(input.phone, "93700000000");
  assert.equal(path.dirname(input.pdfPath), downloads);
  assert.equal(
    fs.readFileSync(input.pdfPath).subarray(0, input.format === "image" ? 8 : 5).toString("hex"),
    input.format === "image" ? "89504e470d0a1a0a" : Buffer.from("%PDF-").toString("hex"),
  );
  await new Promise((resolve, reject) => {
    finishNative = { resolve, reject };
  });
  return {
    submitted: true,
    pdfPath: input.pdfPath,
    downloadPath: input.pdfPath,
  };
};
const timeout = setTimeout(() => {
  console.error("WhatsApp smoke timed out");
  app.exit(1);
}, 60000);
async function wait(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("WhatsApp smoke wait timed out");
}
(async () => {
  await app.whenReady();
  const { createWorker } = await import(
    pathToFileURL(path.resolve("server/client.mjs")).href
  );
  const db = createWorker(
    path.join(process.env.RADEFY_USER_DATA, "vault.sqlite"),
  );
  const auth = await db.request("setup", {
    name: "Test Owner",
    username: "owner",
    password: "synthetic-wa-password",
    storeName: "WhatsApp test",
  });
  const call = (cmd, args) => db.request(cmd, args, auth.token);
  const supplier = (
    await call("partyCreate", { kind: "supplier", name: "Test supplier" })
  ).id;
  const customer = (
    await call("partyCreate", {
      kind: "customer",
      name: "Test customer",
      phone: "+93700000000",
    })
  ).id;
  const product = (
    await call("productCreate", {
      name: "Test cable",
      brand: "Test",
      model: "Cable",
      sku: "WA-TEST",
      category: "Accessories",
      price: 100,
    })
  ).id;
  await call("purchase", {
    currency: "AFN",
    party_id: supplier,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: product, quantity: 1, price: 50 }],
  });
  const invoice = await call("sale", {
    party_id: customer,
    paid: 0,
    request_key: randomUUID(),
    lines: [{ product_id: product, quantity: 1, price: 100 }],
  });
  await db.close();
  require("../electron/main.cjs");
  let win;
  await wait(() => {
    win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    return !!win;
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  await wait(() => js("!!window.vault?.shareWhatsApp"));
  const input = {
    phone: "+93700000000",
    text: "Test invoice PDF",
    job: {
      mode: "pdf",
      kind: "invoice",
      title: "Invoice",
      fileBase: "احمد SAL-1",
      source: { type: "invoice", id: invoice.id },
      options: { paper: "A4", orientation: "portrait", margins: "normal" },
      html: "<!doctype html><html><body><h1>Test invoice</h1><p>100 AFN</p></body></html>",
    },
  };
  await js(
    `window.testShareInput = ${JSON.stringify(input)}; window.testShareToken = ${JSON.stringify(auth.token)};`,
  );
  const unauthorized = await js(
    `window.vault.shareWhatsApp(window.testShareInput, "invalid").then(() => false, () => true)`,
  );
  assert.equal(unauthorized, true);
  assert.equal(nativeCalls, 0);
  assert.deepEqual(fs.readdirSync(downloads), []);
  async function startShare() {
    finishNative = null;
    await js(
      `window.testShareResult = null; window.vault.shareWhatsApp(window.testShareInput, window.testShareToken).then(result => window.testShareResult = {ok:true,result}, error => window.testShareResult = {ok:false,message:error.message,code:error.code}); true;`,
    );
    await wait(() => !!finishNative);
  }
  await startShare();
  assert.equal(
    await js("window.testShareResult"),
    null,
    "must await native attachment/send",
  );
  assert.equal(
    await js(
      `window.vault.shareWhatsApp(window.testShareInput, window.testShareToken).then(() => '', e => e.message)`,
    ),
    "WHATSAPP_BUSY",
  );
  finishNative.reject(sharing.shareError("WHATSAPP_ATTACH_FAILED"));
  await wait(() => js("!!window.testShareResult"));
  assert.equal(
    (await js("window.testShareResult")).message,
    "WHATSAPP_ATTACH_FAILED",
  );
  const firstFile = fs.readdirSync(downloads)[0];
  const firstBytes = fs.readFileSync(path.join(downloads, firstFile));
  await startShare();
  assert.equal(fs.readdirSync(downloads).length, 2);
  assert.deepEqual(
    fs.readFileSync(path.join(downloads, firstFile)),
    firstBytes,
  );
  finishNative.resolve();
  await wait(() => js("!!window.testShareResult"));
  const result = await js("window.testShareResult");
  assert.equal(result.ok, true);
  assert.equal(result.result.submitted, true);
  assert.equal(nativeCalls, 2);
  await js('window.testShareInput.formatLabels = {title:"Send as",image:"Image",cancel:"Cancel"}');
  choice = 2;
  const canceled = await js('window.vault.shareWhatsApp(window.testShareInput, window.testShareToken)');
  assert.equal(canceled.canceled, true);
  assert.equal(nativeCalls, 2);
  choice = 1;
  await startShare();
  const png = fs.readdirSync(downloads).find(name => name.endsWith(".png"));
  assert.ok(png);
  const { nativeImage } = require("electron");
  const dimensions = nativeImage.createFromPath(path.join(downloads, png)).getSize();
  assert.ok(dimensions.width > 0 && dimensions.height > 0);
  finishNative.resolve();
  await wait(() => js("!!window.testShareResult"));
  assert.equal((await js("window.testShareResult")).result.submitted, true);
  console.log(
    "PASS: real invoice PDF and PNG, format choice/cancel, IPC/auth, awaited failure/success, duplicate-click guard and unique saved PDFs; no WhatsApp messages sent.",
  );
  clearTimeout(timeout);
  app.quit();
})().catch((error) => {
  console.error(error);
  clearTimeout(timeout);
  app.exit(1);
});
