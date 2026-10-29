// Real packaged main/renderer paths with isolated data and no production cloud access.
const { app, BrowserWindow, dialog, safeStorage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const childMode = process.argv.includes("--imported");
const root = childMode
  ? process.argv[process.argv.indexOf("--imported") + 1]
  : fs.mkdtempSync(path.join(process.cwd(), ".local", "shop-flow-"));
const registryFile = path.join(root, "Radefy TechMart profiles.json");
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
app.getAppPath = () => process.cwd();
app.requestSingleInstanceLock = () => true;
Object.defineProperty(app, "isPackaged", { get: () => true });
app.disableHardwareAcceleration();
// The remote Mac Dock ICNS issue is outside shop/recovery behavior.
if (app.dock) app.dock.setIcon = () => {};
delete process.env.RADEFY_USER_DATA;
delete process.env.REDIFY_USER_DATA;
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (s) => Buffer.from(s);
safeStorage.decryptString = (b) => b.toString();
const lm = require("../electron/licensing.cjs"),
  BaseLicense = lm.LicenseManager;
lm.LicenseManager = class extends BaseLicense {
  constructor(o) {
    super({ ...o, getDeviceHash: async () => "c".repeat(64) });
  }
};
const rm = require("../electron/recovery.cjs"),
  BaseRecovery = rm.RecoveryManager;
rm.RecoveryManager = class extends BaseRecovery {
  constructor(o) {
    super({
      ...o,
      fetchImpl: async () => {
        throw Error("test offline");
      },
    });
  }
};
dialog.showErrorBox = (title, message) => console.error(title, message);
let relaunch,
  win,
  confirmation = 0;
app.relaunch = (args) => {
  relaunch = args;
};
app.quit = () => {};
dialog.showMessageBox = async (_win, options) => {
  assert.equal(options.title, "Add a separate shop?");
  return { response: confirmation };
};
const timer = setTimeout(() => {
  console.error("Shop profile test timeout");
  app.exit(1);
}, 45000);
const wait = async (predicate) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 70));
  }
  throw Error("Shop profile UI condition timed out");
};
const js = (code) => win.webContents.executeJavaScript(code);
(async () => {
  await app.whenReady();
  const { createWorker } = await import(
    pathToFileURL(path.resolve("server/client.mjs")).href
  );
  const { fileChecksum } = await import(
    pathToFileURL(path.resolve("server/files.mjs")).href
  );
  const original = path.join(root, "Vault Store");
  const source = path.join(root, "samsoor.sqlite");
  let owner;
  if (!childMode) {
    fs.mkdirSync(original);
    for (const [file, name] of [
      [path.join(original, "vault.sqlite"), "Rahmat"],
      [source, "Samsoor"],
    ]) {
      const db = createWorker(file);
      const session = await db.request("setup", {
        name,
        username: name.toLowerCase(),
        password: "synthetic-password",
        storeName: name + " shop",
      });
      if (name === "Rahmat") owner = session;
      await db.close();
    }
    fs.writeFileSync(
      source + ".json",
      JSON.stringify({
        application: "Vault Store",
        schema: 1,
        checksum: fileChecksum(source),
      }),
    );
    const { Accounts } = require("../electron/accounts.cjs");
    new Accounts(original, safeStorage).remember(owner.user, owner.token);
  }
  require("../electron/main.cjs");
  await wait(() => {
    win = BrowserWindow.getAllWindows()[0];
    return win && !win.webContents.isLoading();
  });
  if (childMode) {
    await wait(() => js('!!document.querySelector(".activation-form")'));
    const rows = JSON.parse(fs.readFileSync(registryFile));
    const originalId = rows.find((p) => p.directory === original).id;
    assert.equal(
      await js(
        'document.querySelector(".auth-form-container select").options.length',
      ),
      2,
    );
    assert.match(
      await js(
        'document.querySelector(".auth-form-container select").selectedOptions[0].textContent',
      ),
      /Samsoor/,
    );
    assert.equal((await js("window.vault.activationStatus()")).active, false);
    await assert.rejects(
      js('window.vault.request("status",{})'),
      /ACTIVATION_REQUIRED/,
    );
    await js(
      `{ const select = document.querySelector('.auth-form-container select'); select.value = ${JSON.stringify(originalId)}; select.dispatchEvent(new Event('change',{bubbles:true})); }`,
    );
    await wait(() => !!relaunch);
    assert.ok(relaunch.args.includes("--radefy-profile=" + originalId));
    console.log(
      "PASS: imported shop requires activation; activation screen switches back to original shop.",
    );
  } else {
    await wait(() => js('!!document.querySelector(".app-shell")'));
    const before = await js('window.vault.accounts("list")');
    const identity = fs.readFileSync(
      path.join(original, "owner-recovery-v1.dat"),
    );
    const callRestore = () =>
      js(
        `window.vault.restore(${JSON.stringify(source)}, ${JSON.stringify(owner.token)})`,
      );
    assert.equal((await callRestore()).cancelled, true);
    assert.equal(
      (await js('window.vault.accounts("list")')).profiles.length,
      1,
    );
    confirmation = 1;
    const result = await callRestore();
    const after = await js('window.vault.accounts("list")');
    assert.equal(after.profiles.length, 2);
    assert.equal(after.current, before.current);
    assert.ok(relaunch.args.includes("--radefy-profile=" + result.profileId));
    assert.equal(
      (await js(`window.vault.request("me",{},${JSON.stringify(owner.token)})`))
        .username,
      "rahmat",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(original, "owner-recovery-v1.dat")),
      identity,
    );
    const imported = JSON.parse(fs.readFileSync(registryFile)).find(
      (p) => p.id === result.profileId,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(imported.directory, "installation-v1.dat")),
      ).mode,
      "required",
    );
    assert.equal(
      fs.existsSync(path.join(imported.directory, "owner-recovery-v1.dat")),
      false,
    );
    await assert.rejects(callRestore(), /already saved/);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, "--imported", root], {
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error("Imported-profile child failed: " + code)),
      );
    });
    console.log(
      "PASS: restore cancel, isolated shop import, preserved original owner/session/identity, duplicate prevention and profile switch.",
    );
  }
  clearTimeout(timer);
  win.destroy();
  app.exit(0);
})().catch((e) => {
  console.error(e);
  clearTimeout(timer);
  app.exit(1);
});
