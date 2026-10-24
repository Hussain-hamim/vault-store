import { Worker } from "node:worker_threads";
export function createWorker(file, demo = false, options = {}) {
  const worker = new Worker(
    options.workerUrl || new URL("./worker.mjs", import.meta.url),
    {
      workerData: { file, demo },
    },
  );
  let next = 0,
    failure = null,
    readyResolve,
    readyReject;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // An initialization error may happen before the first caller sends a request.
  // Retain it for all future callers instead of losing it with an empty queue.
  ready.catch(() => {});
  const fail = (error) => {
    failure ||= error;
    clearTimeout(startupTimer);
    readyReject(failure);
    for (const p of pending.values()) p.reject(failure);
    pending.clear();
  };
  const startupTimer = setTimeout(() => {
    fail(
      new Error(
        "The local database did not start in time. Restart the application.",
      ),
    );
    worker.terminate();
  }, options.startupTimeout ?? 15000);
  startupTimer.unref();
  worker.on("message", (m) => {
    if (m.ready === true) {
      clearTimeout(startupTimer);
      readyResolve();
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  });
  worker.on("error", fail);
  worker.on("exit", () =>
    fail(new Error("Database worker stopped. Restart the application.")),
  );
  return {
    async request(command, args = {}, token) {
      await ready;
      if (failure) throw failure;
      return new Promise((resolve, reject) => {
        const mid = ++next;
        pending.set(mid, { resolve, reject });
        try {
          worker.postMessage({ id: mid, command, args, token });
        } catch (error) {
          pending.delete(mid);
          reject(error);
        }
      });
    },
    close: () => {
      fail(new Error("Database worker stopped. Restart the application."));
      return worker.terminate();
    },
  };
}
