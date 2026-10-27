import { DatabaseSync, backup } from "./sqlite.mjs";
import {
  existsSync,
  readFileSync,
  copyFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileChecksum } from "./files.mjs";
import { acquireMaintenanceLock } from "./lock.mjs";
export function validateRestore(file) {
  if (!existsSync(file) || !file.endsWith(".sqlite"))
    throw new Error("Choose an existing .sqlite recovery copy.");
  const manifest = file + ".json";
  if (!existsSync(manifest)) throw new Error("Backup manifest is missing.");
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  if (m.application !== "Vault Store" || m.schema !== 1)
    throw new Error("Backup format is unsupported.");
  const hash = fileChecksum(file);
  if (hash !== m.checksum)
    throw new Error("Backup checksum does not match its manifest.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (![1, 2].includes(db.prepare("PRAGMA user_version").get().user_version))
      throw new Error("Database schema is unsupported.");
    if (
      Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Backup database failed integrity checks.");
    return {
      products: db.prepare("SELECT COUNT(*) n FROM products").get().n,
      documents: db.prepare("SELECT COUNT(*) n FROM documents").get().n,
    };
  } finally {
    db.close();
  }
}
export async function restoreDatabase(file, target) {
  validateRestore(file);
  const release = acquireMaintenanceLock(target);
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    if (existsSync(target)) {
      const db = new DatabaseSync(target);
      try {
        const safe = path.join(path.dirname(target), "restore-safety");
        mkdirSync(safe, { recursive: true });
        const safetyFile = path.join(
          safe,
          `before-restore-${Date.now()}.sqlite`,
        );
        await backup(db, safetyFile);
        writeFileSync(
          safetyFile + ".json",
          JSON.stringify({
            application: "Vault Store",
            schema: 1,
            createdAt: new Date().toISOString(),
            checksum: fileChecksum(safetyFile),
            size: statSync(safetyFile).size,
          }),
          { mode: 0o600 },
        );
        validateRestore(safetyFile);
      } finally {
        db.close();
      }
    }
    const temporary = target + ".restore-" + randomUUID();
    copyFileSync(file, temporary);
    if (fileChecksum(temporary) !== fileChecksum(file)) {
      unlinkSync(temporary);
      throw new Error("Restore copy checksum mismatch.");
    }
    const fd = openSync(temporary, "r");
    fsyncSync(fd);
    closeSync(fd);
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(target + suffix)) unlinkSync(target + suffix);
    renameSync(temporary, target);
    return { ok: true };
  } finally {
    release();
  }
}
