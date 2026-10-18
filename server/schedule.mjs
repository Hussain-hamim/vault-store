import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function scheduleDefinition(
  { executable, appPath, userData },
  platform = process.platform,
) {
  const args = [...(appPath ? [appPath] : []), "--backup-mode"];
  if (platform === "darwin") {
    const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.vault.store.backup</string><key>ProgramArguments</key><array>${[executable, ...args].map((a) => `<string>${xml(a)}</string>`).join("")}</array><key>StartInterval</key><integer>3600</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${xml(path.join(userData, "backup.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(userData, "backup-errors.log"))}</string></dict></plist>`;
    return { contents: plist, args };
  }
  if (platform === "win32") {
    const quoted = args
      .map((a) => '"' + a.replaceAll('"', '\\"') + '"')
      .join(" ");
    const task = `<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><CalendarTrigger><StartBoundary>2026-01-01T18:00:00</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT1H</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT6H</ExecutionTimeLimit></Settings><Actions><Exec><Command>${xml(executable)}</Command><Arguments>${xml(quoted)}</Arguments></Exec></Actions></Task>`;
    return { contents: task, args };
  }
  throw new Error("Automatic desktop scheduling supports Windows and macOS.");
}
export function installSchedule(options) {
  const definition = scheduleDefinition(options);
  if (process.platform === "darwin") {
    const folder = path.join(os.homedir(), "Library", "LaunchAgents");
    mkdirSync(folder, { recursive: true });
    const file = path.join(folder, "com.vault.store.backup.plist");
    writeFileSync(file, definition.contents, { mode: 0o600 });
    const domain = `gui/${process.getuid()}`;
    try {
      execFileSync(
        "/bin/launchctl",
        ["bootout", `${domain}/com.vault.store.backup`],
        { stdio: "ignore" },
      );
    } catch {}
    execFileSync("/bin/launchctl", ["bootstrap", domain, file]);
    return { ok: true, path: file };
  }
  const file = path.join(options.userData, "vault-backup-task.xml");
  writeFileSync(file, "\uFEFF" + definition.contents, "utf16le");
  execFileSync(
    "schtasks.exe",
    ["/Create", "/TN", "Vault Store Daily Backup", "/XML", file, "/F"],
    { windowsHide: true },
  );
  return { ok: true, path: file };
}
