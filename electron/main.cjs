const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
  shell,
  safeStorage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
let db, mainWindow, licensing, recovery;
let serviceRoot;
let reloadingWorker = false;
const backupMode = process.argv.includes("--backup-mode");
const uiOrigin = "http://127.0.0.1:4173";
const { brand, userDataPath } = require("./brand.cjs");
// Pin the original profile before setting the new display name: upgrades retain data and sessions.
app.setPath(
  "userData",
  userDataPath(
    app.getPath("appData"),
    process.env.RADEFY_USER_DATA || process.env.REDIFY_USER_DATA,
  ),
);
app.setName(brand.name);
if (!backupMode && !app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
function trusted(event) {
  const url = event.senderFrame?.url || "";
  const ok =
    app.isPackaged || process.env.VAULT_DESKTOP_STATIC
      ? url.startsWith(
          pathToFileURL(path.join(app.getAppPath(), "dist/client/")).href,
        )
      : url.startsWith("http://localhost:4173/") ||
        url.startsWith("http://127.0.0.1:4173/");
  if (!ok) throw new Error("Untrusted application frame.");
}
async function createDatabaseWorker() {
  const { createWorker } = await import(
    pathToFileURL(path.join(serviceRoot, "client.mjs")).href
  );
  const worker = createWorker(
    path.join(app.getPath("userData"), "vault.sqlite"),
  );
  try {
    await worker.request("status");
    return worker;
  } catch (error) {
    await worker.close();
    throw error;
  }
}
async function waitForDevUi(ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${uiOrigin}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    "Vite is not running on 127.0.0.1:4173.\n\nKeep npm run dev running, then use npm run desktop:dev.",
  );
}
async function reloadDatabaseWorker(reason = "server change") {
  if (reloadingWorker || !db) return;
  reloadingWorker = true;
  console.log(`[vault-desktop] Reloading database worker (${reason})…`);
  const previous = db;
  try {
    db = await createDatabaseWorker();
    await previous.close();
    // Keep the window open — sessions are durable in SQLite, so the user stays signed in.
  } catch (error) {
    console.error("[vault-desktop] Worker reload failed:", error);
    db = previous;
  } finally {
    reloadingWorker = false;
  }
}
function watchServerForReload() {
  if (app.isPackaged || process.env.VAULT_DESKTOP_STATIC) return;
  let timer;
  try {
    fs.watch(serviceRoot, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith(".sqlite") || filename.endsWith("~"))
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        reloadDatabaseWorker(filename).catch((e) => console.error(e));
      }, 350);
    });
    console.log(
      "[vault-desktop] Watching server/ — edits reload the DB worker and window.",
    );
  } catch (error) {
    console.warn("[vault-desktop] Could not watch server/:", error.message);
  }
}
async function start() {
  const existingDatabase = fs.existsSync(
    path.join(app.getPath("userData"), "vault.sqlite"),
  );
  db = await createDatabaseWorker();
  const { LicenseManager } = require("./licensing.cjs");
  licensing = new LicenseManager({
    enabled: app.isPackaged,
    directory: app.getPath("userData"),
    safeStorage,
    config: require("../shared/licensing.json"),
  });
  const legacyInitialized =
    existingDatabase && !(await db.request("status")).setup;
  await licensing.initialize({ legacyInitialized });
  if (app.isPackaged && licensing.hash) {
    const { RecoveryManager } = require("./recovery.cjs");
    recovery = new RecoveryManager({
      licensing,
      request: (...args) => db.request(...args),
    });
    try {
      licensing.recoveryPublicKey = recovery.identity().publicKey;
    } catch {}
    if (licensing.state.active && !backupMode) {
      void recovery.sync();
      const timer = setInterval(() => {
        if (licensing.state.active) void recovery.sync();
      }, 300000);
      timer.unref();
    }
  }
  ipcMain.handle("vault:recovery", async (event, action, args = {}) => {
    trusted(event);
    try {
      licensing.assertActive();
      if (!recovery) throw Error("DESKTOP_ONLY");
      if (action === "status") return { ok: true, result: recovery.status() };
      if (action === "prepare")
        return { ok: true, result: await recovery.sync() };
      if (action === "sync" || action === "enroll") {
        if (action === "sync") {
          const user = await db.request("me", {}, args.token);
          if (user.role !== "Owner") throw Error("OWNER_ONLY");
        } else if (
          typeof args.enrollmentCode !== "string" ||
          !args.enrollmentCode.trim()
        )
          throw Error("INVALID_INPUT");
        if (
          args.enrollmentCode != null &&
          (typeof args.enrollmentCode !== "string" ||
            args.enrollmentCode.length > 120)
        )
          throw Error("INVALID_INPUT");
        return { ok: true, result: await recovery.sync(args.enrollmentCode) };
      }
      if (action === "recover")
        return { ok: true, result: await recovery.recover(args.code) };
      if (action === "reset")
        return {
          ok: true,
          result: await recovery.reset(args.code, args.password),
        };
      throw Error("INVALID_INPUT");
    } catch (e) {
      return {
        ok: false,
        error: [
          "NETWORK_ERROR",
          "ENROLLMENT_REQUIRED",
          "INVALID_CODE",
          "WRONG_STORE",
          "EXPIRED_CODE",
          "CODE_USED",
          "RATE_LIMITED",
          "RETRY_PASSWORD",
          "INVALID_INPUT",
          "BUSY",
          "INVALID_RESPONSE",
          "DESKTOP_ONLY",
          "STORAGE_UNAVAILABLE",
          "OWNER_ONLY",
        ].includes(e.message)
          ? e.message
          : "SERVICE_UNAVAILABLE",
      };
    }
  });
  ipcMain.handle("vault:activation-status", async (event) => {
    trusted(event);
    return licensing.status().error
      ? licensing.initialize({ legacyInitialized })
      : licensing.status();
  });
  ipcMain.handle("vault:activate", async (event, key) => {
    trusted(event);
    try {
      return { ok: true, result: await licensing.activate(key) };
    } catch (error) {
      return {
        ok: false,
        error: [
          "INVALID_KEY",
          "KEY_IN_USE",
          "RATE_LIMITED",
          "NETWORK_ERROR",
          "INVALID_RECEIPT",
          "DEVICE_UNAVAILABLE",
          "STORAGE_UNAVAILABLE",
          "ACTIVATION_BUSY",
        ].includes(error.code)
          ? error.code
          : "SERVICE_UNAVAILABLE",
      };
    }
  });
  if (backupMode) {
    try {
      licensing.assertActive();
      await db.request("_automaticBackup");
      app.exit(0);
    } catch (e) {
      console.error(e.message);
      app.exit(1);
    }
    return;
  }
  ipcMain.handle("vault:command", async (event, command, args, token) => {
    trusted(event);
    if (typeof command !== "string" || command.startsWith("_"))
      throw new Error("Unknown operation.");
    try {
      licensing.assertActive();
      const result = await db.request(command, args, token);
      if (
        recovery &&
        [
          "setup",
          "saveSettings",
          "userCreate",
          "userPermissions",
          "userUpdate",
        ].includes(command)
      )
        void recovery.sync();
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("vault:open-support", async (event, url) => {
    trusted(event);
    const { supportLinks } = await import(
      pathToFileURL(path.join(serviceRoot, "support.mjs")).href
    );
    const { productPhotoCreditUrls } = await import(
      pathToFileURL(path.join(serviceRoot, "product-images.mjs")).href
    );
    if (
      typeof url !== "string" ||
      !(
        supportLinks(brand.support).some((link) => link.url === url) ||
        productPhotoCreditUrls().includes(url)
      )
    )
      throw new Error("Unknown support destination.");
    await shell.openExternal(url);
  });
  ipcMain.handle("vault:folder", async (event) => {
    trusted(event);
    licensing.assertActive();
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Choose backup folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("vault:backup-file", async (event) => {
    trusted(event);
    licensing.assertActive();
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a Radefy TechMart recovery copy",
      filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
      properties: ["openFile"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("vault:schedule", async (event, token) => {
    trusted(event);
    licensing.assertActive();
    const user = await db.request("me", {}, token);
    if (!user.permissions.includes("backups"))
      throw new Error("Backup permission required.");
    const { installSchedule } = await import(
      pathToFileURL(path.join(serviceRoot, "schedule.mjs")).href
    );
    return installSchedule({
      executable: process.execPath,
      appPath: app.isPackaged ? null : app.getAppPath(),
      userData: app.getPath("userData"),
    });
  });
  ipcMain.handle("vault:restore", async (event, file, token) => {
    trusted(event);
    licensing.assertActive();
    const user = await db.request("me", {}, token);
    if (user.role !== "Owner" || !user.permissions.includes("backups"))
      throw new Error("Only a store owner can restore data.");
    const { validateRestore, restoreDatabase } = await import(
      pathToFileURL(path.join(serviceRoot, "restore.mjs")).href
    );
    const info = validateRestore(file);
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Restore this backup?",
      message: `Replace the current store with the selected backup?`,
      detail: `${file}\n\n${info.products} products · ${info.documents} transactions\n\nA safety copy of the current store will be saved first. You will be signed out and the app will restart.`,
      buttons: ["Cancel", "Restore backup"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return { cancelled: true };
    await db.request("canRestore", {}, token);
    await db.close();
    db = null;
    try {
      await restoreDatabase(
        file,
        path.join(app.getPath("userData"), "vault.sqlite"),
      );
      app.relaunch();
      app.exit(0);
    } catch (e) {
      db = await createDatabaseWorker();
      throw e;
    }
  });
  let printBusy = false;
  ipcMain.handle("vault:render-print", async (event, input, token) => {
    trusted(event);
    licensing.assertActive();
    if (printBusy)
      return {
        ok: false,
        error: "Another print job is open. Finish it before starting another.",
      };
    printBusy = true;
    try {
      const { validatePrintJob, withPrintWindow } = require("./printing.cjs");
      const job = validatePrintJob(input);
      const user = await db.request("me", {}, token);
      if (job.kind === "invoice")
        await db.request("document", { id: job.source.id }, token);
      else if (!user.permissions.includes(job.source.permission))
        throw new Error("Permission required: " + job.source.permission);
      const { electronPrintOptions } = await import(
        pathToFileURL(path.join(serviceRoot, "print-options.mjs")).href
      );
      let destination;
      if (job.mode === "pdf") {
        const filename = job.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
        const result = await dialog.showSaveDialog(mainWindow, {
          title: job.title,
          defaultPath: filename + ".pdf",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (result.canceled || !result.filePath)
          return { ok: true, result: { cancelled: true } };
        destination = result.filePath;
      }
      const result = await withPrintWindow(
        BrowserWindow,
        job.html,
        mainWindow,
        async (contents) => {
          if (job.mode === "pdf") {
            const bytes = await contents.printToPDF(
              electronPrintOptions(job.options, job.kind, true),
            );
            await fs.promises.writeFile(destination, bytes);
            return { saved: true };
          }
          return new Promise((resolve, reject) =>
            contents.print(
              electronPrintOptions(job.options, job.kind),
              (success, reason) => {
                if (success) resolve({ printed: true });
                else if (/cancel/i.test(reason)) resolve({ cancelled: true });
                else reject(new Error(reason || "Could not print document."));
              },
            ),
          );
        },
      );
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      printBusy = false;
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f3f6fa",
    icon: path.join(app.getAppPath(), "build/icon.png"),
    title: brand.name,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (
      !url.startsWith("file:") &&
      !url.startsWith("http://localhost:4173") &&
      !url.startsWith("http://127.0.0.1:4173")
    )
      event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  app.setAboutPanelOptions({
    applicationName: brand.name,
    applicationVersion: app.getVersion(),
    copyright: "Developed by " + brand.company,
    iconPath: path.join(app.getAppPath(), "build/icon.png"),
  });
  if (process.platform === "darwin")
    app.dock?.setIcon(path.join(app.getAppPath(), "build/icon.png"));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: brand.name,
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
  if (app.isPackaged)
    await mainWindow.loadFile(
      path.join(app.getAppPath(), "dist/client/index.html"),
    );
  else if (process.env.VAULT_DESKTOP_STATIC)
    await mainWindow.loadFile(
      path.join(app.getAppPath(), "dist/client/index.html"),
    );
  else {
    await waitForDevUi();
    await mainWindow.loadURL(`${uiOrigin}/?desktop=1`);
    if (process.env.VAULT_DESKTOP_DEV === "1")
      mainWindow.webContents.openDevTools({ mode: "detach" });
    watchServerForReload();
  }
  const timer = setInterval(
    () =>
      licensing.state.active &&
      db
        ?.request("_automaticBackup")
        .catch((e) => console.error("Backup:", e.message)),
    60_000,
  );
  timer.unref();
  if (licensing.state.active)
    db.request("_automaticBackup").catch((e) => console.error(e.message));
}
app
  .whenReady()
  .then(() => {
    serviceRoot = path.join(
      app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
      "server",
    );
    return start();
  })
  .catch((e) => {
    dialog.showErrorBox(brand.name + " could not start", e.message);
    app.exit(1);
  });
app.on("window-all-closed", () => {
  db?.close();
  app.quit();
});
