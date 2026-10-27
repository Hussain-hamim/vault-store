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
  statfsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileChecksum } from "./files.mjs";
import { acquireMaintenanceLock } from "./lock.mjs";

/** Full integrity_check + FK scan is multi-minute on multi‑GB load-test DBs. */
const DEEP_CHECK_MAX_BYTES = 500 * 1024 * 1024;

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function freeDiskBytes(dir) {
  mkdirSync(dir, { recursive: true });
  const s = statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export function requiredRestoreBytes(file, target) {
  const backupSize = statSync(file).size;
  const currentSize = existsSync(target) ? statSync(target).size : 0;
  // Safety copy of the live DB + temp restore copy + 100 MB margin.
  return backupSize + currentSize + 100 * 1024 * 1024;
}

export function assertRestoreDiskSpace(file, target) {
  const need = requiredRestoreBytes(file, target);
  const free = freeDiskBytes(path.dirname(target));
  if (free < need)
    throw new Error(
      `Not enough free disk space to restore. Need about ${formatBytes(need)} free on the store drive; only ${formatBytes(free)} is available. Free space and try again.`,
    );
}

function runDatabaseChecks(db, { deep }) {
  if (![1, 2].includes(db.prepare("PRAGMA user_version").get().user_version))
    throw new Error("Database schema is unsupported.");
  if (deep) {
    if (
      Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Backup database failed integrity checks.");
    return;
  }
  if (Object.values(db.prepare("PRAGMA quick_check").get())[0] !== "ok")
    throw new Error("Backup database failed integrity checks.");
}

/**
 * @param {string} file
 * @param {{ deep?: boolean }} [options]
 *  deep defaults to true for backups under ~500 MB; large load-test files use quick_check.
 */
export function validateRestore(file, options = {}) {
  if (!existsSync(file) || !file.endsWith(".sqlite"))
    throw new Error("Choose an existing .sqlite recovery copy.");
  const manifest = file + ".json";
  if (!existsSync(manifest)) throw new Error("Backup manifest is missing.");
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  if (m.application !== "Vault Store" || m.schema !== 1)
    throw new Error("Backup format is unsupported.");
  const size = statSync(file).size;
  const hash = fileChecksum(file);
  if (hash !== m.checksum)
    throw new Error("Backup checksum does not match its manifest.");
  const deep = options.deep ?? size < DEEP_CHECK_MAX_BYTES;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    runDatabaseChecks(db, { deep });
    return {
      products: db.prepare("SELECT COUNT(*) n FROM products").get().n,
      documents: db.prepare("SELECT COUNT(*) n FROM documents").get().n,
      checksum: hash,
      size,
      deep,
    };
  } finally {
    db.close();
  }
}

function writeSafetyManifest(safetyFile) {
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
}

/**
 * @param {string} file
 * @param {string} target
 * @param {{ validated?: { checksum: string, size?: number } }} [options]
 */
export async function restoreDatabase(file, target, options = {}) {
  assertRestoreDiskSpace(file, target);
  const valid =
    options.validated?.checksum &&
    (!options.validated.size || options.validated.size === statSync(file).size)
      ? options.validated
      : validateRestore(file);
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
        writeSafetyManifest(safetyFile);
        // Verify the safety copy quickly — do not re-run a multi‑minute deep scan.
        validateRestore(safetyFile, { deep: false });
      } finally {
        db.close();
      }
    }
    const temporary = target + ".restore-" + randomUUID();
    try {
      copyFileSync(file, temporary);
    } catch (error) {
      if (error?.code === "ENOSPC")
        throw new Error(
          `Not enough free disk space to copy the backup onto the store drive (${formatBytes(statSync(file).size)} needed). Free space and try again.`,
        );
      throw error;
    }
    if (
      statSync(temporary).size !== statSync(file).size ||
      fileChecksum(temporary) !== valid.checksum
    ) {
      unlinkSync(temporary);
      throw new Error("Restore copy checksum mismatch.");
    }
    const fd = openSync(temporary, "r");
    try {
      fsyncSync(fd);
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    } finally {
      closeSync(fd);
    }
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(target + suffix)) unlinkSync(target + suffix);
    if (existsSync(target)) unlinkSync(target);
    renameSync(temporary, target);
    return { ok: true };
  } finally {
    release();
  }
}
