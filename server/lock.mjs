import {
  openSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  closeSync,
} from "node:fs";
export function acquireMaintenanceLock(database) {
  const file = database + ".backup.lock";
  let fd;
  try {
    fd = openSync(file, "wx", 0o600);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let lock;
    try {
      lock = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(
        "A backup or recovery lock needs inspection before retrying.",
      );
    }
    let alive = true;
    try {
      process.kill(lock.pid, 0);
    } catch {
      alive = false;
    }
    if (alive && Date.now() - Date.parse(lock.createdAt) < 12 * 3600000)
      throw new Error("Another backup or restore is already running.");
    unlinkSync(file);
    fd = openSync(file, "wx", 0o600);
  }
  writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
  );
  return () => {
    closeSync(fd);
    if (existsSync(file)) unlinkSync(file);
  };
}
