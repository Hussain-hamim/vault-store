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
test("desktop accounts keep names across restart but drop tokens; logout retains names only", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let a = new Accounts(dir, safe);
  a.remember({ id: "one", username: "hussain", name: "Hussain" }, "secret-one");
  a.remember(
    { id: "two", username: "employee", name: "Employee" },
    "secret-two",
  );
  assert.equal(a.token(), "secret-two");
  assert.equal(a.preferredUsername(), "employee");
  a.select("one");
  assert.equal(a.token(), "secret-one");
  // Simulates full app quit / PC restart: a new process must not resume login.
  a = new Accounts(dir, safe);
  assert.equal(a.token(), "");
  assert.equal(a.list()[0].username, "hussain");
  assert.equal(a.list()[0].signedIn, false);
  assert.equal(a.list()[1].username, "employee");
  assert.equal(a.list()[1].signedIn, false);
  assert.equal(JSON.stringify(a.list()).includes("secret"), false);
  a.select("two");
  a.remember(
    { id: "two", username: "employee", name: "Employee" },
    "secret-two",
  );
  assert.equal(a.token(), "secret-two");
  a.logout("secret-two");
  assert.equal(a.token(), "");
  assert.equal(a.list()[1].signedIn, false);
  assert.throws(() => a.select("unknown"));
  assert.equal(fs.readFileSync(a.file).includes("secret-two"), false);
  a.signOutLocal();
  assert.equal(a.token(), "");
  assert.equal(a.preferredUsername(), "employee");
  assert.equal(a.list().every((u) => !u.signedIn), true);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-other-"));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  assert.equal(new Accounts(other, safe).token(), "");
});
