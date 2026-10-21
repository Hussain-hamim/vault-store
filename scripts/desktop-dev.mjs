import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const ui = "http://127.0.0.1:4173/";

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

await waitForUi();
console.log("Vault UI ready — launching desktop with live reload.");
const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VAULT_DESKTOP_DEV: "1",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
