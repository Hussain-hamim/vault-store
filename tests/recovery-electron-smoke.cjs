// Actual main-process IPC and renderer, isolated profile and local service adapters.
const electron = require("electron"),
  { app, BrowserWindow, safeStorage, dialog } = electron;
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const { generateKeyPairSync, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "radefy-recovery-ui-"));
// Keep automatic-backup scheduling inside this fixture; never touch the user's LaunchAgent.
require("node:os").homedir = () => root;
const childProcess = require("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, ...args) =>
  file === "/bin/launchctl" || file === "schtasks.exe"
    ? Buffer.alloc(0)
    : originalExecFileSync(file, ...args);
require("node:module").syncBuiltinESMExports();
app.setPath("appData", root);
app.requestSingleInstanceLock = () => true;
process.env.RADEFY_USER_DATA = path.join(root, "profile");
Object.defineProperty(app, "isPackaged", { get: () => true });
app.getAppPath = () => process.cwd();
app.disableHardwareAcceleration();
// The remote Mac Dock ICNS issue is outside shop/recovery behavior.
if (app.dock) app.dock.setIcon = () => {};
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (s) => Buffer.from(s);
safeStorage.decryptString = (b) => b.toString();
const pair = generateKeyPairSync("ed25519"),
  config = {
    endpoint: "https://example.test/v1/activate",
    publicKeys: { v1: pair.publicKey.export({ type: "spki", format: "pem" }) },
  };
const lm = require("../electron/licensing.cjs"),
  Base = lm.LicenseManager;
lm.LicenseManager = class extends Base {
  constructor(o) {
    super({ ...o, config, getDeviceHash: async () => "d".repeat(64) });
  }
};
const rm = require("../electron/recovery.cjs"),
  Recovery = rm.RecoveryManager;
let service,
  offline = false,
  failApply = false;
const sql = new DatabaseSync(":memory:");
sql.exec(fs.readFileSync("licensing/schema.sql", "utf8"));
const env = {
  DB: {
    prepare(q) {
      return {
        bind(...args) {
          return { first: async () => sql.prepare(q).get(...args) || null };
        },
      };
    },
  },
  SIGNING_PRIVATE_KEY: pair.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64"),
  ACTIVATION_LIMITER: { limit: async () => ({ success: true }) },
};
rm.RecoveryManager = class extends Recovery {
  constructor(o) {
    const request = o.request;
    super({
      ...o,
      request: (...a) => {
        if (failApply && ["_recoveryApply", "_recoverySignIn"].includes(a[0])) {
          failApply = false;
          throw Error("test disk failure");
        }
        return request(...a);
      },
      fetchImpl: async (url, options) => {
        if (offline) throw Error();
        return service.fetch(new Request(url, options), env);
      },
    });
  }
};
dialog.showErrorBox = (_, message) => {
  console.error(message);
  app.exit(1);
};
let win;
const timer = setTimeout(() => {
  console.error("Recovery UI timeout");
  app.exit(1);
}, 60000);
async function js(code) {
  return win.webContents.executeJavaScript(code);
}
async function wait(check) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 70));
  }
  throw Error("Recovery UI wait failed");
}
async function fill(name, value) {
  await js(
    `(()=>{const e=document.querySelector('[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
const started = (async () => {
  const { createWorker } = await import(
      pathToFileURL(path.resolve("server/client.mjs")).href
    ),
    db = createWorker(path.join(root, "profile", "vault.sqlite"));
  await db.request("setup", {
    name: "Existing Owner",
    username: "owner",
    password: "original-password-123",
    storeName: "Recovery test store",
  });
  await db.close();
  service = (
    await import(pathToFileURL(path.resolve("licensing/worker.mjs")).href)
  ).default;
  require("../electron/main.cjs");
})();
app
  .whenReady()
  .then(async () => {
    await started;
    await wait(() => {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      return !!win;
    });
    await wait(() => js('!!document.querySelector(".auth-form")'));
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Forgot login?')).click()`,
    );
    await wait(() => js('!!document.querySelector(".owner-recovery")'));
    const s = await js('window.vault.recovery("status")');
    assert.equal(s.registered, false);
    const code = "",
      hash = (x) => createHash("sha256").update(x).digest("hex");
    sql
      .prepare(
        "INSERT INTO recovery_enrollments(installation_id,device_hash,public_key,code_hash,expires_at) VALUES (?,?,?,?,?)",
      )
      .run(
        s.installationId,
        s.deviceHash,
        s.publicKey,
        hash(code),
        Date.now() + 1800000,
      );
    assert.equal(
      await js('!!document.querySelector("[name=enrollmentCode]")'),
      false,
    );
    await wait(() =>
      js(
        `document.querySelector('.owner-recovery form button')?.disabled===false || !!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Check recovery status'))`,
      ),
    );
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Check recovery status'))?.click()`,
    );
    await wait(() =>
      js(
        'document.querySelector(".owner-recovery form button")?.disabled===false',
      ),
    );
    sql
      .prepare(
        "INSERT INTO recovery_codes(installation_id,code_hash,kind,expires_at,request_id,redeemed_at) VALUES (?,?,'reset',?,NULL,NULL)",
      )
      .run(s.installationId, hash("C".repeat(40)), Date.now() + 1800000);
    assert.equal(
      await js('!!document.querySelector(".owner-recovery [name=password]")'),
      false,
    );
    await fill("code", "C".repeat(40));
    offline = true;
    await js('document.querySelector(".owner-recovery form").requestSubmit()');
    await wait(() =>
      js(
        'document.querySelector(".owner-recovery").textContent.includes("Connect to the internet")',
      ),
    );
    offline = false;
    failApply = true;
    await js('document.querySelector(".owner-recovery form").requestSubmit()');
    await wait(() =>
      js(
        'document.querySelector(".owner-recovery").textContent.includes("Recovery service is unavailable")',
      ),
    );
    await js('document.querySelector(".owner-recovery form").requestSubmit()');
    await wait(() => js('!!document.querySelector(".sidebar")'));
    offline = true;
    win.reload();
    await wait(() => js('!!document.querySelector(".sidebar")'));
    assert.equal(await js('!!document.querySelector(".auth-form")'), false);
    await assert.rejects(
      js('window.vault.request("_recoveryApply",{})'),
      /Unknown operation/,
    );
    await js(
      `Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.textContent.trim()==='Settings').click()`,
    );
    await wait(() => js('!!document.querySelector(".settings-navigation")'));
    await js(
      `Array.from(document.querySelectorAll('.settings-navigation button')).find(b=>b.textContent.includes('Owner account recovery')).click()`,
    );
    await wait(() =>
      js('!!document.querySelector(".owner-recovery [name=password]")'),
    );
    await fill("password", "replacement-password-123");
    await js('document.querySelector(".owner-recovery form").requestSubmit()');
    await wait(() =>
      js(
        'document.querySelector(".owner-recovery").textContent.includes("Password changed")',
      ),
    );
    await js(
      `Array.from(document.querySelectorAll('.settings-navigation button')).find(b=>b.textContent.trim()==='Account').click()`,
    );
    await wait(() => js('!!document.querySelector(".settings-account")'));
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sign out').click()`,
    );
    await wait(() => js('!!document.querySelector(".auth-form")'));
    assert.equal(
      await js('document.querySelector("[name=username]").value'),
      "owner",
    );
    await fill("password", "replacement-password-123");
    await js('document.querySelector(".auth-form").requestSubmit()');
    await wait(() => js('!!document.querySelector(".sidebar")'));
    win.reload();
    await wait(() => js('!!document.querySelector(".sidebar")'));
    win.setContentSize(1280, 800);
    fs.writeFileSync(
      "/tmp/radefy-owner-recovery-settings.png",
      (await win.capturePage()).toPNG(),
    );
    console.log(
      "PASS: actual packaged IPC and UI: legacy enrollment, offline error, failed-save retry, automatic sign-in after recovery, offline session reload, password change then sign-out/new-password sign-in, Settings status and internal-operation blocking.",
    );
    clearTimeout(timer);
    win.destroy();
    app.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    if (win && !win.isDestroyed())
      console.error(await js("document.body.innerText"));
    clearTimeout(timer);
    app.exit(1);
  });
app.on("will-quit", () => {
  try {
    sql.close();
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});
