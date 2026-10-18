import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const processes = [
  spawn(
    process.execPath,
    ["--watch", "--watch-path=server", "server/dev.mjs"],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
      ...args,
    ],
    { stdio: "inherit" },
  ),
];
for (const p of processes)
  p.on("exit", (code) => {
    if (code) process.exitCode = code;
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    processes.forEach((p) => p.kill(signal));
  });
