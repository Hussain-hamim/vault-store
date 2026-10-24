const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Accounts } = require("../electron/accounts.cjs");
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).map((x) => x ^ 83),
  decryptString: (b) =>
    Buffer.from(b)
      .map((x) => x ^ 83)
      .toString(),
};
test("desktop accounts survive restart, switch independently, and logout retains names only", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let a = new Accounts(dir, safe);
  a.remember({ id: "one", username: "hussain", name: "Hussain" }, "secret-one");
  a.remember(
    { id: "two", username: "employee", name: "Employee" },
    "secret-two",
  );
  a = new Accounts(dir, safe);
  assert.equal(a.token(), "secret-two");
  a.select("one");
  assert.equal(a.token(), "secret-one");
  a.logout("secret-one");
  a = new Accounts(dir, safe);
  assert.equal(a.token(), "");
  assert.equal(a.list()[0].username, "hussain");
  assert.equal(a.list()[0].signedIn, false);
  assert.equal(JSON.stringify(a.list()).includes("secret"), false);
  a.select("two");
  assert.equal(a.token(), "secret-two");
  assert.throws(() => a.select("unknown"));
  assert.equal(fs.readFileSync(a.file).includes("secret-two"), false);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-other-"));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  assert.equal(new Accounts(other, safe).token(), "");
});
