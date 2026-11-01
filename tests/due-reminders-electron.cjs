// Real native notification API probe, isolated from all shop profiles.
const { app, Notification } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createDueReminders } = require("../electron/due-reminders.cjs");
const root = mkdtempSync(path.join(tmpdir(), "radefy-native-due-"));
app.setPath("userData", root);
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    if (!Notification.isSupported()) {
      console.log("Native reminders unsupported on " + process.platform);
      app.exit(2);
      return;
    }
    let shown = false;
    const real = [];
    class Probe extends Notification {
      constructor(options) {
        super({
          ...options,
          body: "Radefy reminder test — no customer data. " + options.body,
        });
        real.push(this);
        this.on("show", () => {
          shown = true;
          console.log(
            "Native reminder show event received on " + process.platform,
          );
        });
        this.on("failed", (_event, error) =>
          console.log("Native reminder failed: " + error),
        );
      }
    }
    const r = createDueReminders({
      directory: root,
      Notification: Probe,
      getToken: () => "test",
      request: async (command) =>
        command === "me"
          ? { id: "isolated-test", permissions: ["people"] }
          : { summary: { dueInvoices: 1, overdue: 0 } },
      open: () => {},
    });
    await r.check();
    setTimeout(async () => {
      await r.check();
      console.log(
        JSON.stringify({
          platform: process.platform,
          nativeShow: shown,
          notificationCount: real.length,
          dailyDeduplication: real.length === 1,
        }),
      );
      real.forEach((n) => n.close());
      rmSync(root, { recursive: true, force: true });
      app.exit(shown && real.length === 1 ? 0 : 2);
    }, 8000);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
