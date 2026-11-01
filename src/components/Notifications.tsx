import { useCallback, useEffect, useRef, useState } from "react";
import {
  BellIcon,
  PackageIcon,
  WalletIcon,
  ArrowClockwiseIcon,
  ArrowRightIcon,
  WarningCircleIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { api, af, User } from "../api";
import { useI18n } from "../i18n";
import { Modal, Empty, ErrorMessage } from "./ui";
import "./notifications.css";
type Data = {
  summary: {
    due: number;
    overdue: number;
    stock: number;
    zero: number;
    customers: number;
    amount: number;
    total: number;
  };
  permissions: { stock: boolean; customers: boolean };
  revision: number;
  asOf: string;
  rows: any[];
  next: string | null;
};
export function useNotificationSummary(user: User | null, refresh: number) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const userId = user?.id;
  useEffect(() => {
    setData(null);
    setError("");
    if (!userId) return;
    let active = true,
      pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const result = await api<Data>("notifications", { summaryOnly: true });
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e: any) {
        if (active) {
          setData(null);
          setError(e.message);
        }
      } finally {
        pending = false;
      }
    }
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, [userId, refresh, epoch]);
  return { data, error, reload: useCallback(() => setEpoch((v) => v + 1), []) };
}
export function NotificationButton({
  data,
  error,
  open,
  sidebar = false,
}: {
  data: Data | null;
  error: string;
  open: () => void;
  sidebar?: boolean;
}) {
  const { t } = useI18n();
  const count = data?.summary.total;
  return (
    <button
      className={
        sidebar
          ? "sidebar-command notifications-shortcut"
          : "header-icon notification-bell"
      }
      onClick={open}
      title={t("notifications.title")}
      aria-label={
        error
          ? t("notifications.unavailable")
          : count === undefined
            ? t("notifications.title")
            : t("notifications.count", { n: count })
      }
    >
      <BellIcon size={19} />
      {sidebar && <span>{t("notifications.title")}</span>}
      <span
        className={
          "notification-count" + (count === 0 && !error ? " is-clear" : "")
        }
        aria-live="polite"
        aria-atomic="true"
      >
        {error ? "!" : count === undefined ? "…" : count > 99 ? "99+" : count}
      </span>
    </button>
  );
}
export function NotificationsDialog({
  user,
  refresh,
  close,
  open,
  changed,
  initialTab,
}: {
  user: User;
  refresh: number;
  close: () => void;
  open: (name: string, data?: any) => void;
  changed: () => void;
  initialTab?: "due" | "overdue";
}) {
  const { t } = useI18n();
  const stockAllowed = user.permissions.some((p) =>
    ["inventory", "sales", "purchases"].includes(p),
  );
  const [tab, setTab] = useState<"stock" | "customers" | "due" | "overdue">(
    initialTab || (stockAllowed ? "stock" : "customers"),
  );
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const current = ++version.current;
    setData(null);
    setError("");
    setBusy(true);
    api<Data>("notifications", { kind: tab })
      .then((result) => {
        if (version.current === current) {
          setData(result);
          changed();
        }
      })
      .catch((e) => {
        if (version.current === current) setError(e.message);
      })
      .finally(() => {
        if (version.current === current) setBusy(false);
      });
    return () => {
      version.current++;
    };
  }, [tab, refresh, epoch, changed]);
  async function view(row: any) {
    setError("");
    try {
      if (tab !== "stock") {
        open("partyDetail", row);
        return;
      }
      const result = await api<{ rows: any[] }>("catalog", {
        id: row.id,
        limit: 1,
      });
      if (result.rows[0]) open("productDetail", result.rows[0]);
      else {
        changed();
        setEpoch((v) => v + 1);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function more() {
    if (!data?.next || busy) return;
    const current = version.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<Data>("notifications", {
        kind: tab,
        cursor: data.next,
        revision: data.revision,
        asOf: data.asOf,
      });
      if (version.current === current)
        setData((previous) =>
          previous
            ? { ...result, rows: [...previous.rows, ...result.rows] }
            : result,
        );
    } catch (e: any) {
      if (version.current === current) {
        if (e.message === "NOTIFICATIONS_CHANGED") setEpoch((v) => v + 1);
        else setError(e.message);
      }
    } finally {
      if (version.current === current) setBusy(false);
    }
  }
  return (
    <Modal
      title={t("notifications.title")}
      subtitle={t("notifications.subtitle")}
      onClose={close}
      wide
      className="notifications-modal"
    >
      <div className="notification-center">
        <div className="notification-summary">
          {stockAllowed && (
            <article>
              <PackageIcon size={23} />
              <span>
                {t("notifications.stock")}
                <strong>{data?.summary.stock ?? "—"}</strong>
              </span>
            </article>
          )}
          {user.permissions.includes("people") && (
            <article>
              <WalletIcon size={23} />
              <span>
                {t("notifications.customerBalances")}
                <strong>
                  <bdi dir="ltr">{data ? af(data.summary.amount, 2) : "—"}</bdi>
                </strong>
              </span>
            </article>
          )}
        </div>
        <div
          className="notification-tabs"
          role="tablist"
          aria-label={t("notifications.title")}
        >
          {stockAllowed && (
            <button
              role="tab"
              aria-selected={tab === "stock"}
              onClick={() => setTab("stock")}
            >
              {t("notifications.stock")}{" "}
              <span>{data?.summary.stock ?? "—"}</span>
            </button>
          )}
          {user.permissions.includes("people") && (
            <button
              role="tab"
              aria-selected={tab === "customers"}
              onClick={() => setTab("customers")}
            >
              {t("notifications.customerBalances")}{" "}
              <span>{data?.summary.customers ?? "—"}</span>
            </button>
          )}
          {user.permissions.includes("people") &&
            (["due", "overdue"] as const).map((kind) => (
              <button
                key={kind}
                role="tab"
                aria-selected={tab === kind}
                onClick={() => setTab(kind)}
              >
                {t(`client.${kind}`)} <span>{data?.summary[kind] ?? "—"}</span>
              </button>
            ))}
          <button
            className="notification-refresh"
            onClick={() => setEpoch((v) => v + 1)}
            disabled={busy}
            aria-label={t("notifications.refresh")}
            title={t("notifications.refresh")}
          >
            <ArrowClockwiseIcon size={18} />
          </button>
        </div>
        <ErrorMessage error={error} />
        <div
          className="notification-items"
          role="tabpanel"
          aria-label={t(
            tab === "stock"
              ? "notifications.stock"
              : tab === "customers"
                ? "notifications.customerBalances"
                : `client.${tab}`,
          )}
          aria-busy={busy}
        >
          {data?.rows.map((row) => (
            <article
              className={
                "notification-item " +
                (tab === "stock"
                  ? row.stock === 0
                    ? "is-zero"
                    : "is-low"
                  : "is-balance")
              }
              key={row.id}
            >
              <span className="notification-item-icon">
                {tab === "stock" ? (
                  <WarningCircleIcon size={22} />
                ) : (
                  <WalletIcon size={22} />
                )}
              </span>
              <div className="notification-item-copy">
                <strong>{row.name}</strong>
                <small>
                  {tab === "stock"
                    ? [row.brand, row.model, row.sku]
                        .filter(Boolean)
                        .join(" · ")
                    : row.phone || t("notifications.savedCustomer")}
                </small>
                <p>
                  {tab === "stock"
                    ? t(
                        row.stock === 0
                          ? "notifications.zeroStock"
                          : "notifications.lowStock",
                        { qty: row.stock, level: row.reorder_level },
                      )
                    : t("notifications.balanceHint")}
                </p>
                {row.invoices && (
                  <details>
                    <summary>
                      {t("client.dueInvoiceCount", { n: row.invoices.length })}
                    </summary>
                    {row.invoices.map((invoice: any) => (
                      <button
                        key={invoice.id}
                        className="button"
                        onClick={() => open("invoice", { id: invoice.id })}
                      >
                        {invoice.number} · {invoice.due_date} ·{" "}
                        <bdi dir="ltr">{af(invoice.balance, 2)}</bdi>
                      </button>
                    ))}
                  </details>
                )}
              </div>
              <div className="notification-item-action">
                {tab !== "stock" && (
                  <strong className="text-red">
                    <bdi dir="ltr">{af(row.balance, 2)}</bdi>
                  </strong>
                )}
                <button className="button" onClick={() => view(row)}>
                  {t(
                    tab === "stock"
                      ? "common.view"
                      : "notifications.openLedger",
                  )}
                  <ArrowRightIcon size={14} />
                </button>
              </div>
            </article>
          ))}
          {busy && !data && <p className="muted">{t("common.loading")}</p>}
          {data && !data.rows.length && (
            <Empty
              title={t("notifications.allClear")}
              text={t(
                tab === "stock"
                  ? "notifications.noStockAlerts"
                  : "notifications.noBalances",
              )}
              action={<CheckCircleIcon size={28} />}
            />
          )}
        </div>
        {data?.next && (
          <button
            className="button notification-more"
            disabled={busy}
            onClick={more}
          >
            {t(busy ? "common.loading" : "common.loadMore")}
          </button>
        )}
        <p className="notification-footnote">{t("notifications.liveHint")}</p>
      </div>
    </Modal>
  );
}
