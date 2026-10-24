import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAdminToken } from "../scripts/licensing/credentials.mjs";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "radefy-admin-credentials-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "token");
}
test("administrator commands read a protected local credential without needing an exported variable", (t) => {
  const file = fixture(t),
    token = "test_" + "a".repeat(40);
  writeFileSync(file, token + "\n", { mode: 0o600 });
  assert.equal(readAdminToken({ env: {}, file }), token);
  assert.equal(
    readAdminToken({
      env: { CLOUDFLARE_API_TOKEN: "test_" + "b".repeat(40) },
      file,
    }),
    "test_" + "b".repeat(40),
  );
});
test("missing or malformed credentials give instructions without exposing the credential", (t) => {
  const file = fixture(t);
  assert.throws(
    () => readAdminToken({ env: {}, file }),
    /Set CLOUDFLARE_API_TOKEN/,
  );
  const token = "secret with bad spaces";
  assert.throws(
    () => readAdminToken({ env: { CLOUDFLARE_API_TOKEN: token }, file }),
    (error) =>
      !error.message.includes(token) &&
      error.message.includes("invalid format"),
  );
});
test(
  "local credential symlinks and shared-readable files are rejected",
  { skip: process.platform === "win32" },
  (t) => {
    const file = fixture(t);
    writeFileSync(file, "test_" + "a".repeat(40), { mode: 0o600 });
    chmodSync(file, 0o644);
    assert.throws(() => readAdminToken({ env: {}, file }), /permissions 600/);
    chmodSync(file, 0o600);
    const link = file + "-link";
    symlinkSync(file, link);
    assert.throws(
      () => readAdminToken({ env: {}, file: link }),
      /permissions 600/,
    );
  },
);
