import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = "http://127.0.0.1:4173/";
const electronDir = path.join(root, "electron");

async function waitForUi(ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(ui);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    "Vite is not running on 127.0.0.1:4173. Start it with npm run dev, then retry.",
  );
}

let child = null;
let shuttingDown = false;
let relaunchTimer = null;

function launch() {
  if (shuttingDown) return;
  console.log("Vault UI ready — launching desktop with live reload.");
  child = spawn(electronPath, ["."], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VAULT_DESKTOP_DEV: "1",
    },
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown) process.exit(code ?? 0);
    if (signal) return;
    // Unexpected exit — keep the launcher alive so electron/ edits can restart it.
    if (code) console.warn(`[vault-desktop] Electron exited with code ${code}.`);
  });
}

function relaunch(reason) {
  clearTimeout(relaunchTimer);
  relaunchTimer = setTimeout(() => {
    console.log(
      `[vault-desktop] Restarting Electron (${reason}) so main-process edits apply…`,
    );
    if (child && !child.killed) {
      child.once("exit", () => launch());
      child.kill();
      setTimeout(() => {
        if (child) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }, 2500);
    } else {
      launch();
    }
  }, 400);
}

function watchElectron() {
  let timer;
  try {
    fs.watch(electronDir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith("~")) return;
      if (!/\.(cjs|js|mjs|json)$/i.test(filename)) return;
      clearTimeout(timer);
      timer = setTimeout(() => relaunch(filename), 350);
    });
    console.log(
      "[vault-desktop] Watching electron/ — edits restart the desktop app.",
    );
  } catch (error) {
    console.warn("[vault-desktop] Could not watch electron/:", error.message);
  }
}

await waitForUi();
watchElectron();
launch();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    if (child) child.kill(signal);
    else process.exit(0);
  });
}
