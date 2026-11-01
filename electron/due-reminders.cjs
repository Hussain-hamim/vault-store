const fs = require("node:fs");
const path = require("node:path");
const messages = {
  en: ["Payments due", "{n} unpaid invoices are due. Open the due list."],
  ps: [
    "د پور د وصول وخت",
    "د {n} ناتادیه بلونو د وصول وخت رسېدلی. د پورونو لېست وګورئ.",
  ],
  prs: [
    "موعد دریافت قرض",
    "موعد پرداخت {n} بل نپرداخته رسیده است. فهرست قرض‌ها را باز کنید.",
  ],
};
function createDueReminders({
  directory,
  Notification,
  request,
  getToken,
  open,
  active = () => true,
  day = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kabul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
}) {
  const file = path.join(directory, "due-reminders-v1.json");
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  let locale = "en",
    busy = false;
  const pending = new Set();
  const live = new Set();
  async function check(token = getToken()) {
    if (busy || !token || !active() || !Notification?.isSupported()) return;
    busy = true;
    try {
      const user = await request("me", {}, token);
      if (
        !user.permissions.includes("people") ||
        state[user.id] === day() ||
        pending.has(user.id + day())
      )
        return;
      const data = await request("notifications", { summaryOnly: true }, token);
      if (!data.summary.dueInvoices || getToken() !== token) return;
      const current = await request("me", {}, token);
      if (!current.permissions.includes("people")) return;
      const [title, body] = messages[locale];
      const n = new Notification({
        title,
        body: body.replace("{n}", data.summary.dueInvoices),
        silent: false,
      });
      n.on("click", async () => {
        try {
          const current = getToken();
          const who = await request("me", {}, current);
          if (
            current &&
            who.id === user.id &&
            who.permissions.includes("people")
          )
            open(data.summary.overdue ? "overdue" : "due");
        } catch {}
      });
      const pendingKey = user.id + day();
      pending.add(pendingKey);
      live.add(n);
      n.on("close", () => live.delete(n));
      n.on("failed", () => {
        pending.delete(pendingKey);
        live.delete(n);
      });
      n.on("show", () => {
        state[user.id] = day();
        pending.delete(pendingKey);
        try {
          fs.writeFileSync(file + ".tmp", JSON.stringify(state), {
            mode: 0o600,
          });
          fs.renameSync(file + ".tmp", file);
        } catch {}
      });
      try {
        n.show();
      } catch (e) {
        pending.delete(pendingKey);
        live.delete(n);
        throw e;
      }
    } catch {
    } finally {
      busy = false;
    }
  }
  return {
    check,
    setLocale(value) {
      if (!Object.hasOwn(messages, value)) throw Error("Invalid locale.");
      locale = value;
    },
  };
}
module.exports = { createDueReminders };
