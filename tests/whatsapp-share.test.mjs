import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const {
  createWhatsAppSender,
  saveSharePdf,
} = require("../electron/whatsapp-share.cjs");

async function fixture(t, platform = "win32") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "radefy-wa-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "احمد bill ' & $test.pdf");
  await fs.writeFile(pdfPath, "%PDF-1.7\nfixture");
  const urls = [],
    calls = [];
  const sender = createWhatsAppSender({
    app: { getPath: () => root },
    platform,
    shell: { openExternal: async (url) => urls.push(url) },
    run: (executable, args, options, callback) =>
      calls.push({ executable, args, options, callback }),
  });
  const input = {
    phone: "93700000000",
    pdfPath,
    text: "سلام احمد\nInvoice SAL-1",
  };
  async function started() {
    for (let n = 0; n < 100 && !calls.length; n++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(calls.length, 1);
    return calls[0];
  }
  return { root, sender, urls, calls, input, started };
}

test("Windows share waits for native completion and passes Unicode file data without shell interpolation", async (t) => {
  const f = await fixture(t);
  let settled = false;
  const pending = f.sender(f.input).then((result) => {
    settled = true;
    return result;
  });
  const call = await f.started();
  assert.equal(settled, false, "launching PowerShell must not mean sent");
  const url = new URL(f.urls[0]);
  assert.equal(url.protocol, "whatsapp:");
  assert.equal(url.search, "", "no text or customer details in launch URL");
  assert.equal(
    await fs.readFile(call.args[call.args.indexOf("-RoutePath") + 1], "utf8"),
    f.input.phone,
  );
  assert.equal(call.args[call.args.indexOf("-PdfPath") + 1], f.input.pdfPath);
  assert.ok(call.args.includes("-STA"));
  assert.ok(!call.args.includes("-Command"));
  const script = call.args[call.args.indexOf("-File") + 1];
  assert.equal((await fs.readFile(script, "utf8"))[0], "\ufeff");
  assert.equal(
    await fs.readFile(call.args[call.args.indexOf("-CaptionPath") + 1], "utf8"),
    f.input.text,
  );
  call.callback(null, "RADEFY_WHATSAPP_SUBMITTED\r\n", "");
  assert.equal((await pending).submitted, true);
  await assert.rejects(fs.stat(path.dirname(script)), { code: "ENOENT" });
  assert.equal(
    (await fs.readFile(f.input.pdfPath, "utf8")).startsWith("%PDF-"),
    true,
  );
});

for (const scenario of [
  {
    name: "attachment failure",
    error: new Error("exit 1"),
    stdout: "",
    stderr: "WHATSAPP_ATTACH_FAILED",
    code: "WHATSAPP_ATTACH_FAILED",
  },
  {
    name: "silent helper exit",
    error: null,
    stdout: "",
    stderr: "",
    code: "WHATSAPP_SEND_UNCONFIRMED",
  },
  {
    name: "timeout after possible send",
    error: new Error("timed out"),
    stdout: "",
    stderr: "",
    code: "WHATSAPP_SEND_UNCONFIRMED",
  },
  {
    name: "macOS permission failure",
    error: new Error("exit 1"),
    stdout: "",
    stderr: "osascript is not allowed assistive access (-1719)",
    code: "WHATSAPP_AUTOMATION_DENIED",
  },
])
  test(`Native ${scenario.name} is never reported as success or retried`, async (t) => {
    const f = await fixture(t);
    const pending = f.sender(f.input);
    const rejected = assert.rejects(pending, { code: scenario.code });
    const call = await f.started();
    call.callback(scenario.error, scenario.stdout, scenario.stderr);
    await rejected;
    assert.equal(f.calls.length, 1);
    assert.equal(f.urls.length, 1);
    assert.deepEqual(
      (await fs.readdir(f.root)).filter((x) =>
        x.startsWith("radefy-whatsapp-"),
      ),
      [],
    );
  });

test("Concurrent shares are blocked and the lock releases after failure", async (t) => {
  const f = await fixture(t);
  const pending = f.sender(f.input);
  const rejected = assert.rejects(pending, { code: "WHATSAPP_ATTACH_FAILED" });
  const call = await f.started();
  await assert.rejects(f.sender(f.input), { code: "WHATSAPP_BUSY" });
  call.callback(new Error("failure"), "", "WHATSAPP_ATTACH_FAILED");
  await rejected;
  f.calls.length = 0;
  const next = f.sender(f.input);
  (await f.started()).callback(null, "RADEFY_WHATSAPP_SUBMITTED", "");
  assert.equal((await next).submitted, true);
});

test("Invalid PDFs never open WhatsApp", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.input.pdfPath, "not a PDF");
  await assert.rejects(f.sender(f.input), /Invalid WhatsApp attachment/);
  assert.equal(f.urls.length, 0);
  assert.equal(f.calls.length, 0);
});

test("Missing protocol handler is reported and temporary captions are removed", async (t) => {
  const f = await fixture(t);
  const sender = createWhatsAppSender({
    app: { getPath: () => f.root },
    platform: "win32",
    shell: {
      openExternal: async () => {
        throw new Error("No protocol handler");
      },
    },
    run: () => assert.fail("must not launch automation"),
  });
  await assert.rejects(sender(f.input), { code: "WHATSAPP_NOT_INSTALLED" });
  assert.deepEqual(await fs.readdir(f.root), [path.basename(f.input.pdfPath)]);
});

test("macOS passes arguments separately and its attachment script compiles", async (t) => {
  const f = await fixture(t, "darwin");
  const pending = f.sender(f.input);
  const call = await f.started();
  assert.equal(call.executable, "/usr/bin/osascript");
  assert.equal(call.args[1], f.input.pdfPath);
  if (process.platform === "darwin")
    execFileSync("osacompile", [
      "-o",
      path.join(f.root, "check.scpt"),
      call.args[0],
    ]);
  call.callback(null, "RADEFY_WHATSAPP_SUBMITTED", "");
  await pending;
});

test("Repeated/concurrent PDF saves do not replace an earlier attachment", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "radefy-wa-save-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = await Promise.all(
    ["first", "second", "third"].map((content) =>
      saveSharePdf(root, "invoice.pdf", content),
    ),
  );
  assert.equal(new Set(files).size, 3);
  assert.deepEqual(
    await Promise.all(files.map((file) => fs.readFile(file, "utf8"))),
    ["first", "second", "third"],
  );
});

for (const platform of ["darwin", "win32"]) {
  test(`${platform} PNG attachment waits for verified native submission`, async (t) => {
    const f = await fixture(t, platform);
    f.input.pdfPath = path.join(f.root, "احمد invoice.png");
    f.input.format = "image";
    await fs.writeFile(
      f.input.pdfPath,
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const pending = f.sender(f.input);
    const call = await f.started();
    assert.ok(call.args.includes(f.input.pdfPath));
    call.callback(null, "RADEFY_WHATSAPP_SUBMITTED", "");
    assert.equal((await pending).submitted, true);
    await fs.writeFile(f.input.pdfPath, "%PDF-1.7 wrong format");
    await assert.rejects(f.sender(f.input), /Invalid WhatsApp attachment/);
    assert.equal(f.calls.length, 1);
  });
}

test("PNG recovery copies retain their extension without overwriting", async (t) => {
  const f = await fixture(t);
  const first = await saveSharePdf(f.root, "invoice.png", Buffer.from("first"));
  const second = await saveSharePdf(
    f.root,
    "invoice.png",
    Buffer.from("second"),
  );
  assert.notEqual(first, second);
  assert.ok(second.endsWith(".png"));
  assert.equal(await fs.readFile(first, "utf8"), "first");
});

test("Denied Accessibility permission never opens WhatsApp or creates a text draft", async (t) => {
  const f = await fixture(t, "darwin");
  const sender = createWhatsAppSender({
    app: { getPath: () => f.root },
    platform: "darwin",
    shell: { openExternal: () => assert.fail("must not open a chat") },
    run: () => assert.fail("must not start automation"),
    checkPermissions: async () => {
      throw Object.assign(new Error("denied"), {
        code: "WHATSAPP_AUTOMATION_DENIED",
      });
    },
  });
  await assert.rejects(sender(f.input), { code: "WHATSAPP_AUTOMATION_DENIED" });
  assert.deepEqual(
    (await fs.readdir(f.root)).filter((name) =>
      name.startsWith("radefy-whatsapp-"),
    ),
    [],
  );
});
