import { readdirSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
/** Enumerate mounted data volumes; do not scan the filesystem or mount drives. */
export function discoverBackupTargets(
  file,
  {
    platform = process.platform,
    volumes = "/Volumes",
    run = execFileSync,
  } = {},
) {
  const targets = [path.dirname(path.resolve(file))]; // writable folder on the system disk
  if (platform === "darwin") {
    for (const name of readdirSync(volumes)) {
      const full = path.join(volumes, name);
      try {
        if (statSync(full).isDirectory() && realpathSync(full) !== "/")
          targets.push(full);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } else if (platform === "win32") {
    try {
      const output = run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,4 -and $_.Size -gt 0 } | Select-Object -ExpandProperty DeviceID",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      const systemRoot = path.win32.parse(file).root.toLowerCase();
      for (const drive of output.trim().split(/\r?\n/)) {
        if (
          /^[A-Z]:$/i.test(drive.trim()) &&
          `${drive.trim()}\\`.toLowerCase() !== systemRoot
        )
          targets.push(`${drive.trim()}\\`);
      }
    } catch {
      /* local system-disk copy still returned */
    }
  }
  return [...new Set(targets)];
}
export function backupDue(last, now = Date.now()) {
  const time = Date.parse(last);
  return !Number.isFinite(time) || time > now || now - time >= 86400_000;
}
