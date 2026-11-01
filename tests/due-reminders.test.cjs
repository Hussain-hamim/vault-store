const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { mkdtempSync, rmSync } = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createDueReminders } = require("../electron/due-reminders.cjs");
test("desktop reminders are once per day, per user and profile; clicks recheck sessions and permission", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-due-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let user = { id: "a", permissions: ["people"] },
    day = "2026-10-31",
    count = 0,
    opened = 0,
    last;
  class N extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
      last = this;
    }
    show() {
      count++;
      this.emit("show");
    }
  }
  const options = {
    directory: root,
    Notification: N,
    getToken: () => user.id,
    day: () => day,
    request: async (cmd) =>
      cmd === "me" ? user : { summary: { dueInvoices: 2 } },
    open: () => opened++,
  };
  let r = createDueReminders(options);
  r.setLocale("ps");
  await r.check();
  assert.equal(count, 1);
  assert.match(last.options.title, /پور/);
  await r.check();
  r = createDueReminders(options);
  await r.check();
  assert.equal(count, 1);
  last.emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  user = { id: "b", permissions: [] };
  last.emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  await r.check();
  assert.equal(count, 1);
  user = { id: "b", permissions: ["people"] };
  await r.check();
  assert.equal(count, 2);
  day = "2026-11-01";
  await r.check();
  assert.equal(count, 3);
  const other = mkdtempSync(path.join(root, "shop-"));
  await createDueReminders({ ...options, directory: other }).check();
  assert.equal(count, 4);
  assert.throws(() => r.setLocale("invalid"), /Invalid/);
});
test("unsupported notifications and failures leave in-app data accessible and avoid overlapping reminders", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-due-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let count = 0,
    last;
  class N extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor() {
      super();
      last = this;
    }
    show() {
      count++;
    }
  }
  const r = createDueReminders({
    directory: root,
    Notification: N,
    getToken: () => "a",
    request: async (cmd) =>
      cmd === "me"
        ? { id: "a", permissions: ["people"] }
        : { summary: { dueInvoices: 1 } },
    open: () => {},
  });
  await r.check();
  await r.check();
  assert.equal(count, 1);
  last.emit("failed");
  await r.check();
  assert.equal(count, 2);
});

test("denied permissions and unsupported desktop notifications never expose customer data", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radefy-due-permissions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let reads = 0;
  class N {
    static isSupported() {
      return false;
    }
    constructor() {
      throw Error("Must not create notification");
    }
  }
  const options = {
    directory: root,
    Notification: N,
    getToken: () => "user",
    request: async (cmd) => {
      if (cmd === "notifications") reads++;
      return { id: "user", permissions: [] };
    },
    open: () => {},
  };
  await createDueReminders(options).check();
  N.isSupported = () => true;
  await createDueReminders(options).check();
  assert.equal(reads, 0);
});
