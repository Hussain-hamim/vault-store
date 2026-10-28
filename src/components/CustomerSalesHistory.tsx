import "./customer-history.css";
import { useEffect, useState } from "react";
import { api, af, User } from "../api";
import { useI18n } from "../i18n";
import { ReportPrintButton } from "../printing/PrintDialog";
import type { PrintDocument } from "../printing/types";
import { Badge } from "./ui";

type Row = {
  id: string;
  number: string;
  date: string;
  total: number;
  paid: number;
  returned: number;
  remaining: number;
  lines: {
    name: string;
    brand: string;
    model: string;
    sku: string;
    quantity: number;
  }[];
};
type Result = {
  party: { name: string; phone: string; balance: number; kind?: string };
  rows: Row[];
  totals: { total: number; paid: number; returned: number; remaining: number };
};

/** Sale or purchase invoice list for a customer/supplier detail panel. */
export function CustomerSalesHistory({
  id,
  kind = "customer",
  refresh,
  open,
  user,
}: {
  id: string;
  kind?: "customer" | "supplier";
  refresh: number;
  open: (name: string, data?: any) => void;
  user: User;
}) {
  const { t, locale } = useI18n();
  const catalog = kind === "supplier" ? "supplierHistory" : "customerHistory";
  const docKind = kind === "supplier" ? "purchase" : "sale";
  const canMutate = ["Owner", "Manager"].includes(user.role);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [count, setCount] = useState(10);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setCount(10);
    api<Result>("partyInvoiceHistory", {
      id,
      start: start || undefined,
      end: end || undefined,
    })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, start, end, refresh]);

  function statusOf(row: Row) {
    if (row.returned === row.total && row.total > 0)
      return { tone: "gray" as const, label: t("documents.returned") };
    if (row.paid + row.returned >= row.total)
      return { tone: "green" as const, label: t("common.paid") };
    if (row.paid) return { tone: "yellow" as const, label: t("common.partial") };
    return { tone: "red" as const, label: t("common.unpaid") };
  }

  function openInvoice(row: Row) {
    open("invoice", { id: row.id, kind: docKind, number: row.number });
  }

  const columns = [
    "date",
    "invoice",
    "products",
    "total",
    "returned",
    "paid",
    "remaining",
  ].map((key, i) => ({ label: t(`${catalog}.${key}`), numeric: i >= 3 }));
  const cells = (row: Row) => [
    row.date,
    row.number,
    row.lines
      .map(
        (line) =>
          [line.name, line.brand, line.model, line.sku]
            .filter(Boolean)
            .join(" · ") +
          " × " +
          line.quantity,
      )
      .join("\n"),
    af(row.total, 2),
    af(row.returned, 2),
    af(row.paid, 2),
    af(row.remaining, 2),
  ];
  const summary = data
    ? [
        {
          label: t(`${catalog}.currentBalance`),
          value: af(data.party.balance, 2),
          tone: "negative",
        },
        ...(["total", "returned", "paid", "remaining"] as const).map((key) => ({
          label: t(`${catalog}.${key}`),
          value: af(data.totals[key], 2),
        })),
      ]
    : [];
  const report = (): PrintDocument => ({
    kind: "report",
    preferenceGroup:
      kind === "supplier" ? "supplier-ledger" : "customer-ledger",
    locale,
    title: t(`${catalog}.title`),
    subtitle: [data?.party.name, data?.party.phone].filter(Boolean).join(" · "),
    source: { type: "report", permission: "people" },
    metadata: [
      {
        label: t(`${catalog}.start`),
        value: start || t(`${catalog}.allDates`),
      },
      {
        label: t(`${catalog}.end`),
        value: end || t(`${catalog}.allDates`),
      },
    ],
    note: t(`${catalog}.scope`),
    summary,
    sections: [{ columns, rows: (data?.rows || []).map(cells) }],
    emptyLabel: t(`${catalog}.empty`),
  });
  const visible = data?.rows.slice(0, count) || [];
  return (
    <section
      className={`customer-sales-history docs-page docs-${docKind}`}
      role="tabpanel"
    >
      <div className="customer-history-toolbar">
        <label>
          {t(`${catalog}.start`)}{" "}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {t(`${catalog}.end`)}{" "}
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        {(start || end) && (
          <button
            className="button"
            onClick={() => {
              setStart("");
              setEnd("");
            }}
          >
            {t(`${catalog}.allDates`)}
          </button>
        )}
        {data && (
          <div className="customer-history-actions">
            <ReportPrintButton getDocument={report} />
            <ReportPrintButton intent="pdf" getDocument={report} />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red">
          {error}
        </p>
      )}
      {!data && !error && <p>{t("partyDetail.loadingLedger")}</p>}
      {data && (
        <>
          <div className="customer-history-metrics">
            {summary.slice(1).map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>
                  <bdi dir="ltr">{item.value}</bdi>
                </strong>
              </div>
            ))}
          </div>

          <div className="customer-history-list-cols" role="row">
            <span>{t(`${catalog}.invoice`)}</span>
            <span>{t(`${catalog}.date`)}</span>
            <span>{t(`${catalog}.total`)}</span>
            <span>{t(`${catalog}.remaining`)}</span>
            <span>{t("common.status")}</span>
            <span aria-hidden="true" />
          </div>
          <div className="customer-history-list" role="list">
            {visible.map((row) => {
              const status = statusOf(row);
              const outstanding = row.remaining;
              const productHint = row.lines
                .slice(0, 2)
                .map((line) =>
                  [line.name, line.quantity > 1 ? `×${line.quantity}` : ""]
                    .filter(Boolean)
                    .join(" "),
                )
                .join(" · ");
              const extra = row.lines.length > 2 ? ` +${row.lines.length - 2}` : "";
              return (
                <button
                  type="button"
                  key={row.id}
                  role="listitem"
                  className={`docs-row customer-history-row status-${status.tone}`}
                  onClick={() => openInvoice(row)}
                >
                  <div className="docs-row-ref">
                    <strong>{row.number}</strong>
                    {productHint ? (
                      <small>
                        {productHint}
                        {extra}
                      </small>
                    ) : null}
                    {row.returned > 0 && (
                      <small className="docs-return-note">
                        {t("invoiceActions.returnedQty", {
                          n: af(row.returned),
                        })}
                      </small>
                    )}
                  </div>
                  <div className="docs-row-meta">
                    <span className="docs-row-date">{row.date}</span>
                  </div>
                  <div className="docs-row-meta docs-row-money">
                    <strong>{af(row.total)}</strong>
                    <small>
                      {t("documents.paidAmount", { amount: af(row.paid) })}
                    </small>
                  </div>
                  <div className="docs-row-meta docs-row-money">
                    <strong
                      className={outstanding > 0 ? "text-red" : "text-green"}
                    >
                      {af(outstanding)}
                    </strong>
                  </div>
                  <div className="docs-row-meta">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div
                    className="docs-row-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openInvoice(row)}
                    >
                      {t("common.view")}
                    </button>
                    {canMutate && (
                      <>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            open(
                              docKind === "purchase"
                                ? "purchaseEdit"
                                : "saleEdit",
                              { id: row.id, kind: docKind, number: row.number },
                            )
                          }
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          className="text-button danger-text"
                          onClick={() =>
                            open(
                              docKind === "purchase"
                                ? "purchaseDelete"
                                : "saleDelete",
                              { id: row.id, kind: docKind, number: row.number },
                            )
                          }
                        >
                          {t("common.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
            {!data.rows.length && <p>{t(`${catalog}.empty`)}</p>}
          </div>
          <div className="customer-history-pager">
            <span>{t("ui.showing", { n: visible.length })}</span>
            {count < data.rows.length && (
              <button
                className="button button-dark"
                onClick={() => setCount((n) => n + 10)}
              >
                {t(`${catalog}.more`)}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
