// Exercise the actual packaged main-process handlers against an isolated store.
const electron = require("electron");
const { app, BrowserWindow, safeStorage, dialog } = electron;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, sign } = require("node:crypto");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-activation-ui-"));
process.env.RADEFY_USER_DATA = path.join(root, "profile");
Object.defineProperty(app, "isPackaged", { get: () => true });
app.getAppPath = () => process.cwd();
app.disableHardwareAcceleration();
// Test-only OS encryption/device adapters; production has no bypass environment variable.
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (text) => Buffer.from("test-protected:" + text);
safeStorage.decryptString = (bytes) => {
  const text = bytes.toString();
  if (!text.startsWith("test-protected:")) throw Error("bad storage");
  return text.slice(15);
};
const licensing = require("../electron/licensing.cjs"),
  Base = licensing.LicenseManager;
const hash = "c".repeat(64),
  pair = generateKeyPairSync("ed25519");
const config = {
  endpoint: "https://activation.example/v1/activate",
  publicKeys: { v1: pair.publicKey.export({ type: "spki", format: "pem" }) },
};
let offline = true,
  activationCalls = 0;
licensing.LicenseManager = class extends Base {
  constructor(options) {
    super({
      ...options,
      config,
      getDeviceHash: async () => hash,
      fetchImpl: async () => {
        activationCalls++;
        if (offline) throw Error("offline");
        const payload = Buffer.from(
          JSON.stringify({
            version: 1,
            keyId: "v1",
            product: "radefy-techmart",
            licenseId: "ui-test",
            deviceHash: hash,
            activatedAt: "2026-10-24T00:00:00.000Z",
          }),
        ).toString("base64url");
        return Response.json({
          payload,
          signature: sign(null, Buffer.from(payload), pair.privateKey).toString(
            "base64url",
          ),
        });
      },
    });
  }
};
dialog.showErrorBox = (_title, message) => {
  console.error(message);
  app.exit(1);
};
const legacyScenario = process.argv.includes("--legacy");
const started = (async () => {
  if (legacyScenario) {
    const { pathToFileURL } = require("node:url");
    const { createWorker } = await import(
      pathToFileURL(path.resolve("server/client.mjs")).href
    );
    const db = createWorker(path.join(root, "profile", "vault.sqlite"));
    await db.request("setup", {
      storeName: "Existing client store",
      name: "Existing Owner",
      username: "owner",
      password: "existing-test-password",
    });
    await db.close();
  }
  require("../electron/main.cjs");
})();
let win;
const timer = setTimeout(() => {
  console.error("Activation UI timed out");
  app.exit(1);
}, 45000);
async function wait(check) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw Error("Timed out waiting for activation UI");
}
async function js(code) {
  return win.webContents.executeJavaScript(code);
}
app
  .whenReady()
  .then(async () => {
    await started;
    await wait(() => {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      return !!win;
    });
    if (legacyScenario) {
      await wait(() =>
        js('!!document.querySelector(".auth-form [name=username]")'),
      );
      assert.equal(
        await js('!!document.querySelector(".activation-form")'),
        false,
      );
      assert.equal(
        (await js("window.vault.activationStatus()")).mode,
        "legacy",
      );
      assert.equal(
        (await js('window.vault.request("status",{})')).store.name,
        "Existing client store",
      );
      assert.equal(activationCalls, 0, "Legacy upgrade must work offline");
      console.log(
        "PASS: actual packaged upgrade preserves existing store and login offline without activation.",
      );
      clearTimeout(timer);
      win.destroy();
      app.exit(0);
      return;
    }
    await wait(() => js('!!document.querySelector(".activation-form")'));
    assert.equal(
      await js('document.querySelector(".auth-form [name=username]")===null'),
      true,
    );
    for (const code of [
      'window.vault.request("setup",{})',
      'window.vault.request("login",{})',
      'window.vault.request("status",{})',
      'window.vault.request("products",{})',
      'window.vault.request("backupCreate",{})',
      'window.vault.restore("fake.sqlite","fake")',
      'window.vault.renderPrint({},"fake")',
      'window.vault.installSchedule("fake")',
      "window.vault.pickFolder()",
      "window.vault.pickBackup()",
    ]) {
      assert.match(
        await js(
          `(async()=>{try{await ${code};return "ALLOWED"}catch(e){return e.message}})()`,
        ),
        /ACTIVATION_REQUIRED/,
      );
    }
    win.setContentSize(1280, 800);
    await new Promise((r) => setTimeout(r, 250));
    fs.writeFileSync(
      "/tmp/radefy-activation-screen.png",
      (await win.capturePage()).toPNG(),
    );
    const key = "RADE-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";
    await js(
      `(()=>{const input=document.querySelector('[name=activationKey]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await js('document.querySelector(".activation-form").requestSubmit()');
    await wait(() =>
      js(
        'document.querySelector(".activation-form").textContent.includes("Connect to the internet")',
      ),
    );
    assert.equal(
      await js('!!document.querySelector("[name=username]")'),
      false,
    );
    offline = false;
    await js('document.querySelector(".activation-form").requestSubmit()');
    await wait(() =>
      js('!!document.querySelector(".auth-form [name=username]")'),
    );
    assert.equal(
      fs.existsSync(path.join(root, "profile", "activation-v1.dat")),
      true,
    );
    for (const [name, value] of Object.entries({
      storeName: "Activation test store",
      name: "Test Owner",
      username: "owner",
      password: "isolated-test-password",
    }))
      await js(
        `(()=>{const input=document.querySelector('[name=${name}]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await js('document.querySelector(".auth-form").requestSubmit()');
    await wait(() => js('!!document.querySelector(".sidebar")'));
    offline = true;
    const calls = activationCalls;
    await win.reload();
    await wait(() => js('!!document.querySelector(".sidebar")'));
    assert.equal(
      activationCalls,
      calls,
      "Offline reopen must not contact licensing service",
    );
    assert.equal((await js("window.vault.activationStatus()")).active, true);
    console.log(
      "PASS: real packaged IPC blocks setup/login/data/backup/restore/print; offline activation fails; successful activation opens local setup; account setup and offline reload work.",
    );
    clearTimeout(timer);
    win.destroy();
    await new Promise((r) => setTimeout(r, 150));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timer);
    app.exit(1);
  });
app.on("will-quit", () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});
