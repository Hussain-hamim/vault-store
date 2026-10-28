import "./customer-history.css";
import { useEffect, useState } from "react";
import { api, af } from "../api";
import { useI18n } from "../i18n";
import { ReportPrintButton } from "../printing/PrintDialog";
import type { PrintDocument } from "../printing/types";

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
  onOpenInvoice,
}: {
  id: string;
  kind?: "customer" | "supplier";
  refresh: number;
  onOpenInvoice: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const catalog = kind === "supplier" ? "supplierHistory" : "customerHistory";
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
  return (
    <section className="customer-sales-history" role="tabpanel">
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

          <div className="customer-history-table">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.label}
                      className={c.numeric ? "numeric" : undefined}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, count).map((row) => (
                  <tr key={row.id}>
                    {cells(row).map((value, i) => (
                      <td
                        key={i}
                        className={i >= 3 ? "numeric" : undefined}
                        style={{ whiteSpace: i === 2 ? "pre-line" : "nowrap" }}
                      >
                        {i >= 3 ? (
                          <bdi
                            dir="ltr"
                            className={
                              i === 6 && row.remaining > 0
                                ? "text-red"
                                : i === 5 && row.paid > 0
                                  ? "text-green"
                                  : undefined
                            }
                          >
                            {value}
                          </bdi>
                        ) : i === 1 ? (
                          <button
                            className="text-button"
                            onClick={() => onOpenInvoice(row.id)}
                          >
                            {value}
                          </button>
                        ) : i === 2 ? (
                          row.lines.map((line, index) => (
                            <div
                              className="customer-history-product"
                              key={index}
                            >
                              <strong>
                                {line.name}{" "}
                                <bdi dir="ltr">× {line.quantity}</bdi>
                              </strong>
                              <small>
                                {[line.brand, line.model, line.sku]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </div>
                          ))
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>{t(`${catalog}.empty`)}</p>}
          {count < data.rows.length && (
            <button className="button" onClick={() => setCount((n) => n + 10)}>
              {t(`${catalog}.more`)}
            </button>
          )}
        </>
      )}
    </section>
  );
}
