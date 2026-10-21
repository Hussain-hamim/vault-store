const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
let db, mainWindow;
let serviceRoot;
let reloadingWorker = false;
const backupMode = process.argv.includes("--backup-mode");
const uiOrigin = "http://127.0.0.1:4173";
app.setName("Vault Store");
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
  return createWorker(path.join(app.getPath("userData"), "vault.sqlite"));
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
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.reloadIgnoringCache();
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
  db = await createDatabaseWorker();
  if (backupMode) {
    try {
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
      return { ok: true, result: await db.request(command, args, token) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("vault:folder", async (event) => {
    trusted(event);
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Choose backup folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("vault:backup-file", async (event) => {
    trusted(event);
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a Vault recovery copy",
      filters: [{ name: "Vault SQLite backup", extensions: ["sqlite"] }],
      properties: ["openFile"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("vault:schedule", async (event, token) => {
    trusted(event);
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
  ipcMain.handle("vault:invoice-pdf", async (event, id, token) => {
    trusted(event);
    const doc = await db.request("document", { id }, token);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Download invoice PDF",
      defaultPath: `${doc.number}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const bytes = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      preferCSSPageSize: true,
    });
    await fs.promises.writeFile(result.filePath, bytes);
    return { ok: true };
  });
  ipcMain.handle("vault:print", (event) => {
    trusted(event);
    mainWindow.webContents.print({ printBackground: true });
    return { ok: true };
  });
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f4f4f3",
    title: "Vault Store",
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Vault Store",
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
      db
        ?.request("_automaticBackup")
        .catch((e) => console.error("Backup:", e.message)),
    60_000,
  );
  timer.unref();
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
    dialog.showErrorBox("Vault Store could not start", e.message);
    app.exit(1);
  });
app.on("window-all-closed", () => {
  db?.close();
  app.quit();
});
