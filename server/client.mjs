import { Worker } from "node:worker_threads";
export function createWorker(file, demo = false) {
  const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: { file, demo },
  });
  let next = 0;
  const pending = new Map();
  worker.on("message", (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  });
  worker.on("error", (e) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  });
  worker.on("exit", () => {
    for (const p of pending.values())
      p.reject(new Error("Database worker stopped. Restart the application."));
    pending.clear();
  });
  return {
    request(command, args = {}, token) {
      return new Promise((resolve, reject) => {
        const mid = ++next;
        pending.set(mid, { resolve, reject });
        worker.postMessage({ id: mid, command, args, token });
      });
    },
    close: () => worker.terminate(),
  };
}
