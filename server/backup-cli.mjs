import { Store } from "./store.mjs";
import path from "node:path";
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run backup -- /absolute/path/to/vault.sqlite");
  process.exit(1);
}
const s = new Store(path.resolve(file));
try {
  console.log(JSON.stringify(await s.automaticBackup(), null, 2));
} finally {
  s.close();
}
