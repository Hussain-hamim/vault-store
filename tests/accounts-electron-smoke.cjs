const { app, BrowserWindow, safeStorage } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-desktop-"));
app.setPath("appData", root);
app.getAppPath = () => process.cwd();
process.env.RADEFY_USER_DATA = path.join(root, "shop");
process.env.VAULT_DESKTOP_STATIC = "1";
app.requestSingleInstanceLock = () => true;
app.disableHardwareAcceleration();
const timer = setTimeout(() => {
  console.error("Accounts test timed out");
  app.exit(1);
}, 45000);
(async () => {
  await app.whenReady();
  fs.mkdirSync(process.env.RADEFY_USER_DATA);
  const { createWorker } = await import(
    pathToFileURL(path.resolve("server/client.mjs")).href
  );
  const db = createWorker(
    path.join(process.env.RADEFY_USER_DATA, "vault.sqlite"),
  );
  const session = await db.request("setup", {
    name: "Test Owner",
    username: "owner",
    password: "synthetic-password",
    storeName: "Test Shop",
  });
  await db.close();
  const { Accounts } = require("../electron/accounts.cjs");
  new Accounts(process.env.RADEFY_USER_DATA, safeStorage).remember(
    session.user,
    session.token,
  );
  const otherDirectory = path.join(root, "other-shop");
  fs.mkdirSync(otherDirectory);
  const other = createWorker(path.join(otherDirectory, "vault.sqlite"));
  await other.request("setup", {
    name: "Another Owner",
    username: "another",
    password: "another-password",
    storeName: "Second Shop",
  });
  await other.close();
  const { profileId } = require("../electron/accounts.cjs");
  fs.writeFileSync(
    path.join(root, "Radefy TechMart profiles.json"),
    JSON.stringify([
      { id: profileId(otherDirectory), directory: otherDirectory },
    ]),
  );
  let relaunch;
  app.relaunch = (options) => {
    relaunch = options;
  };
  require("../electron/main.cjs");
  let win;
  const wait = async (predicate) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 70));
    }
    throw Error("Condition timed out");
  };
  await wait(async () => {
    win = BrowserWindow.getAllWindows()[0];
    return win && !win.webContents.isLoading();
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  await wait(() => js('!!document.querySelector(".app-shell")'));
  app.quit = () => {};
  await js(`document.querySelector(".sidebar-profile button, .profile-button")?.click()`);
  // Open the account menu using the owner label, independent of its CSS class.
  await js(`{ const button = Array.from(document.querySelectorAll("aside button")).find(b => b.textContent.includes("Test Owner")); if (!document.querySelector('select[aria-label="Switch shop / user"]')) button.click(); }`);
  await wait(() => js(`!!document.querySelector('select[aria-label="Switch shop / user"]')`));
  await js(`{ const select = document.querySelector('select[aria-label="Switch shop / user"]'); select.value = Array.from(select.options).find(o => o.value.startsWith("shop:")).value; select.dispatchEvent(new Event("change", {bubbles:true})); }`);
  await wait(async () => !!relaunch);
  assert.equal(await js('!!document.querySelector(".app-shell")'), true);
  assert.equal(relaunch.args.includes("--radefy-recovery"), false);
  await js("localStorage.clear(); sessionStorage.clear(); location.reload()");
  await wait(() => js('!!document.querySelector(".app-shell")'));
  const result = await js('window.vault.accounts("list")');
  assert.equal(result.users[0].username, "owner");
  assert.equal(
    result.profiles.find((p) => p.id === result.current).name,
    "Test Shop",
  );
  assert.equal(result.profiles.length, 2);
  await js(
    'window.vault.request("logout",{},localStorage.getItem("vault-session"))',
  );
  await js("localStorage.clear(); location.reload()");
  await wait(() => js('!!document.querySelector(".auth-form")'));
  assert.equal(
    await js('document.querySelector("input[name=username]").value'),
    "owner",
  );
  assert.equal(
    (await js('window.vault.accounts("list")')).users[0].signedIn,
    false,
  );
  assert.equal(
    await js('document.querySelectorAll(".auth-form-container select").length'),
    1,
  );
  await js(
    `Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Forgot login?")).click()`,
  );
  await wait(() => js('!!document.querySelector(".owner-recovery")'));
  assert.equal(
    await js('document.querySelectorAll(".auth-form-container select").length'),
    1,
  );
  app.quit = () => {};
  const otherProfile = result.profiles.find((p) => p.id !== result.current);
  await js(
    `window.vault.accounts("profile-recovery", ${JSON.stringify(otherProfile.id)})`,
  );
  assert.ok(relaunch.args.includes("--radefy-profile=" + otherProfile.id));
  assert.ok(relaunch.args.includes("--radefy-recovery"));
  assert.equal(
    fs.readFileSync(
      path.join(root, "Radefy TechMart profiles.json.selected"),
      "utf8",
    ),
    otherProfile.id,
  );
  await js(
    `window.vault.accounts("remove-profile", ${JSON.stringify(result.current)})`,
  );
  const remaining = await js('window.vault.accounts("list")');
  assert.equal(remaining.profiles.length, 1);
  assert.equal(remaining.profiles[0].id, otherProfile.id);
  assert.ok(
    fs.existsSync(path.join(process.env.RADEFY_USER_DATA, "vault.sqlite")),
  );
  const registry = JSON.parse(
    fs.readFileSync(path.join(root, "Radefy TechMart profiles.json"), "utf8"),
  );
  assert.equal(registry.find((p) => p.id === result.current).hidden, true);
  await assert.rejects(
    js(
      `window.vault.accounts("remove-profile", ${JSON.stringify(otherProfile.id)})`,
    ),
    /only saved shop/,
  );
  console.log(
    "PASS: main-process saved session restores with empty renderer storage; logout revokes and retains account chooser.",
  );
  clearTimeout(timer);
  win.destroy();
  app.exit(0);
})().catch((e) => {
  console.error(e);
  clearTimeout(timer);
  app.exit(1);
});
