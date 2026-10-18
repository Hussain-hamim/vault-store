import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function bridge(reply) {
  let api;
  vm.runInNewContext(
    readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    {
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            assert.equal(name, "vault");
            api = value;
          },
        },
        ipcRenderer: { invoke: async () => reply },
      }),
    },
  );
  return api;
}
test("desktop preload unwraps successful commands and keeps the public API narrow", async () => {
  const api = bridge({ ok: true, result: { setup: true } });
  assert.equal((await api.request("status", {})).setup, true);
  assert.equal(api.send, undefined);
  assert.equal(Object.isFrozen(api), true);
});
test("desktop validation errors stay readable without Electron protocol details", async () => {
  const api = bridge({
    ok: false,
    error: "Enter one serial number for each device.",
  });
  await assert.rejects(
    api.request("purchase", {}),
    (e) => e.message === "Enter one serial number for each device.",
  );
});
