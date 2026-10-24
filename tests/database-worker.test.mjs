import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorker } from "../server/client.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(t, source) {
  const dir = mkdtempSync(join(tmpdir(), "radefy-worker-"));
  writeFileSync(join(dir, "worker.mjs"), source);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, workerUrl: pathToFileURL(join(dir, "worker.mjs")) };
}
test("a worker dependency failure before the first request remains observable", async (t) => {
  const f = fixture(t, "import './missing-shared-module.mjs';");
  const worker = createWorker(join(f.dir, "store.sqlite"), false, {
    workerUrl: f.workerUrl,
  });
  t.after(() => worker.close());
  await delay(150);
  await assert.rejects(worker.request("status"), /missing-shared-module/);
  await assert.rejects(worker.request("status"), /missing-shared-module/);
});
test("startup waits for readiness and times out rather than hanging", async (t) => {
  const f = fixture(
    t,
    "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>{});",
  );
  const worker = createWorker(join(f.dir, "store.sqlite"), false, {
    workerUrl: f.workerUrl,
    startupTimeout: 100,
  });
  t.after(() => worker.close());
  await assert.rejects(worker.request("status"), /did not start in time/);
  await assert.rejects(worker.request("setup", {}), /did not start in time/);
});
test("a ready worker initializes real SQLite and reports a later stop to future callers", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "radefy-ready-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = createWorker(join(dir, "store.sqlite"));
  t.after(() => worker.close());
  assert.equal((await worker.request("status")).setup, true);
  await worker.close();
  await assert.rejects(worker.request("status"), /worker stopped/);
});
test("packaged database workers include shared modules beside unpacked server code", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.ok(pkg.build.asarUnpack.includes("server/**/*"));
  assert.ok(pkg.build.asarUnpack.includes("shared/**/*"));
  assert.ok(pkg.build.asarUnpack.includes("node_modules/zod/**/*"));
});
