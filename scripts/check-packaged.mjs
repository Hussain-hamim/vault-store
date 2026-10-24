import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const target = process.argv[2] || process.platform;
if (target !== process.platform) {
  console.log(
    `Packaged runtime check requires ${target}; validate the installer on that OS before release.`,
  );
  process.exit(0);
}
const folders =
  target === "darwin"
    ? [`mac-${process.arch}`, "mac"]
    : target === "win32"
      ? ["win-unpacked", `win-${process.arch}-unpacked`]
      : [];
const directory = folders
  .map((name) => path.join(root, "release", name))
  .find((folder) =>
    existsSync(
      target === "darwin"
        ? path.join(
            folder,
            "Radefy TechMart.app",
            "Contents",
            "MacOS",
            "Radefy TechMart",
          )
        : path.join(folder, "Radefy TechMart.exe"),
    ),
  );
if (!directory)
  throw Error(
    "Packaged application not found. Build the platform package before checking it.",
  );
const executable =
  target === "darwin"
    ? path.join(
        directory,
        "Radefy TechMart.app",
        "Contents",
        "MacOS",
        "Radefy TechMart",
      )
    : path.join(directory, "Radefy TechMart.exe");
const resources =
  target === "darwin"
    ? path.join(directory, "Radefy TechMart.app", "Contents", "Resources")
    : path.join(directory, "resources");
const result = spawnSync(
  executable,
  [
    path.join(root, "tests", "native-smoke.mjs"),
    path.join(resources, "app.asar.unpacked", "server"),
  ],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    timeout: 60000,
    windowsHide: true,
  },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw Error(
    "Packaged database runtime check failed. Do not distribute this build.",
  );
