import { DatabaseSync } from "node:sqlite";

export { DatabaseSync };

// `backup` shipped in Node 22.16 and 23.8. Older 22.x builds only export DatabaseSync.
export async function backup(sourceDb, destination, options = {}) {
  const sqlite = await import("node:sqlite");
  if (typeof sqlite.backup === "function")
    return sqlite.backup(sourceDb, destination, options);
  const path = String(destination).replaceAll("'", "''");
  sourceDb.exec(`VACUUM INTO '${path}'`);
}
