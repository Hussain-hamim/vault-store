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
      if (m.command === "_recoveryOwner") {
        const owner = store.one(
          "SELECT id,name,username FROM users WHERE role='Owner' AND active=1 ORDER BY created_at,id LIMIT 1",
        );
        send(
          m.id,
          owner ? { ...owner, storeName: store.setting("store").name } : null,
        );
        return;
      }
      if (m.command === "_recoverySignIn") {
        const a = m.args;
        if (
          !a ||
          typeof a.ownerId !== "string" ||
          typeof a.requestId !== "string"
        )
          throw Error("INVALID_REQUEST");
        const result = store.transaction(() => {
          const owner = store.one(
            "SELECT * FROM users WHERE id=? AND role='Owner' AND active=1",
            a.ownerId,
          );
          if (!owner) throw Error("OWNER_UNAVAILABLE");
          store.run("DELETE FROM sessions");
          store.audit(owner, "Owner recovery sign in", owner.id);
          return store.session(owner);
        });
        store.sessions.clear();
        send(m.id, result);
        return;
      }
      if (m.command === "_recoveryApply") {
        const a = m.args;
        if (
          !a ||
          !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(a.hash) ||
          typeof a.requestId !== "string"
        )
          throw Error("INVALID_REQUEST");
        let username;
        const session = store.transaction(() => {
          const owner = store.one(
            "SELECT * FROM users WHERE id=? AND role='Owner' AND active=1",
            a.ownerId,
          );
          if (!owner) throw Error("OWNER_UNAVAILABLE");
          username = owner.username;
          const applied = store.setting("ownerRecoveryApplied") || [];
          if (!applied.includes(a.requestId)) {
            store.run(
              "UPDATE users SET password=? WHERE id=?",
              a.hash,
              owner.id,
            );
            store.saveSetting("ownerRecoveryApplied", [
              ...applied,
              a.requestId,
            ]);
            store.audit(owner, "Owner password recovered", owner.id);
          }
          store.run("DELETE FROM sessions");
          return typeof a.verifyPassword === "string"
            ? store.login({
                username: owner.username,
                password: a.verifyPassword,
              })
            : store.session(owner);
        });
        store.sessions.clear();
        send(m.id, { username, ...session });
        return;
      }
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

// Signal only after imports, database migrations and the message handler are ready.
parentPort.postMessage({ ready: true });
