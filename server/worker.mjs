import { parentPort, workerData, Worker } from "node:worker_threads";
import { Store } from "./store.mjs";
const store = new Store(workerData.file, { demo: workerData.demo });
let queue = Promise.resolve(),
  backupRunning = false;
function send(id, result, error) {
  parentPort.postMessage({ id, result, error });
}
parentPort.on("message", (m) => {
  queue = queue.then(async () => {
    try {
      if (backupRunning && m.command === "backupSettings")
        throw new Error(
          "Wait for the current backup before changing its destinations.",
        );
      if (m.command === "backupCreate" || m.command === "_automaticBackup") {
        if (backupRunning) {
          if (m.command === "_automaticBackup") {
            send(m.id, { skipped: true });
            return;
          }
          throw new Error("A backup is already running.");
        }
        const automatic = m.command === "_automaticBackup",
          user = automatic ? null : store.auth(m.token, "backups");
        const config = store.setting("backups");
        if (
          automatic &&
          (!config.destinations.length ||
            (config.lastAutomatic &&
              Date.now() - Date.parse(config.lastAutomatic) < 86400000) ||
            (config.retryAfter && Date.now() < Date.parse(config.retryAfter)))
        ) {
          send(m.id, { skipped: true });
          return;
        }
        backupRunning = true;
        const job = new Worker(new URL("./backup-job.mjs", import.meta.url), {
          workerData: { file: workerData.file, automatic, user, args: m.args },
        });
        let responded = false;
        job.on("message", (r) => {
          responded = true;
          send(m.id, r.result, r.error);
        });
        job.on("error", (e) => {
          responded = true;
          send(m.id, null, e.message);
        });
        job.on("exit", () => {
          backupRunning = false;
          if (!responded)
            send(m.id, null, "Backup process stopped unexpectedly.");
        });
        return;
      }
      if (m.command === "canRestore") {
        store.auth(m.token, "backups");
        if (backupRunning)
          throw new Error(
            "Wait for the current backup to finish before restoring.",
          );
        send(m.id, { ok: true });
        return;
      }
      send(m.id, await store.dispatch(m.command, m.args, m.token));
    } catch (e) {
      send(
        m.id,
        null,
        e.message.includes("UNIQUE constraint failed")
          ? "That SKU, barcode or username already exists."
          : e.issues?.map((issue) => issue.message).join("; ") || e.message,
      );
    }
  });
});
