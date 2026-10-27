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
    error: "Insufficient stock for this product.",
  });
  await assert.rejects(
    api.request("purchase", {}),
    (e) => e.message === "Insufficient stock for this product.",
  );
});
test("desktop print bridge returns save results and readable print errors", async () => {
  const success = bridge({ ok: true, result: { saved: true } });
  assert.equal(
    (await success.renderPrint({ mode: "pdf" }, "test-session")).saved,
    true,
  );
  const failure = bridge({ ok: false, error: "Invalid print job." });
  await assert.rejects(
    failure.renderPrint({}, "test-session"),
    (e) => e.message === "Invalid print job.",
  );
});

test("WhatsApp errors retain their code for translated attachment/permission failures", async () => {
  const api = bridge({
    ok: false,
    error: "WHATSAPP_ATTACH_FAILED",
    code: "WHATSAPP_ATTACH_FAILED",
  });
  await assert.rejects(api.shareWhatsApp({}, "session"), {
    code: "WHATSAPP_ATTACH_FAILED",
  });
  const success = bridge({
    ok: true,
    result: { submitted: true, pdfPath: "/test.pdf" },
  });
  assert.equal((await success.shareWhatsApp({}, "session")).submitted, true);
});
