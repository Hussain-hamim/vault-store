import { parentPort, workerData } from "node:worker_threads";
import { Store } from "./store.mjs";
const store = new Store(workerData.file);
try {
  const result = workerData.automatic
    ? await store.automaticBackup()
    : await store.createBackup(workerData.user, workerData.args);
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.message });
} finally {
  store.close();
}
