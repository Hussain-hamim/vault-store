import "./customer-history.css";
import { WhatsappLogoIcon } from "@phosphor-icons/react";
import { canWhatsApp, shareViaWhatsApp } from "../whatsapp-share";
import { useEffect, useState, useRef } from "react";
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
  party: { name: string; phone: string; balance: number };
  rows: Row[];
  totals: { total: number; paid: number; returned: number; remaining: number };
};
export function CustomerSalesHistory({
  id,
  refresh,
  onOpenInvoice,
}: {
  id: string;
  refresh: number;
  onOpenInvoice: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const sharingLock = useRef(false);
  const [notice, setNotice] = useState("");
  const [count, setCount] = useState(10);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setNotice("");
    setCount(10);
    api<Result>("customerSalesHistory", {
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
  ].map((key, i) => ({ label: t("customerHistory." + key), numeric: i >= 3 }));
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
          label: t("customerHistory.currentBalance"),
          value: af(data.party.balance, 2),
          tone: "negative",
        },
        ...(["total", "returned", "paid", "remaining"] as const).map((key) => ({
          label: t("customerHistory." + key),
          value: af(data.totals[key], 2),
        })),
      ]
    : [];
  const report = (): PrintDocument => ({
    kind: "report",
    preferenceGroup: "customer-ledger",
    locale,
    title: t("customerHistory.title"),
    subtitle: [data?.party.name, data?.party.phone].filter(Boolean).join(" · "),
    source: { type: "report", permission: "people" },
    metadata: [
      {
        label: t("customerHistory.start"),
        value: start || t("customerHistory.allDates"),
      },
      {
        label: t("customerHistory.end"),
        value: end || t("customerHistory.allDates"),
      },
    ],
    note: t("customerHistory.scope"),
    summary,
    sections: [{ columns, rows: (data?.rows || []).map(cells) }],
    emptyLabel: t("customerHistory.empty"),
  });
  async function shareReport() {
    if (!data || sharingLock.current) return;
    sharingLock.current = true;
    setSharing(true);
    setError("");
    setNotice("");
    const snapshot = report();
    const recipient = data.party;
    try {
      const status = await api<{ store: PrintDocument["store"] }>("status");
      const result = await shareViaWhatsApp({
        phone: recipient.phone,
        text: t("customerHistory.shareText", {
          name: recipient.name,
          start: start || t("customerHistory.allDates"),
          end: end || t("customerHistory.allDates"),
        }),
        document: { ...snapshot, store: status.store },
        fileBase: `${recipient.name}-sales-${start || "all"}-${end || "all"}`,
        t,
      });
      setNotice(result.message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      sharingLock.current = false;
      setSharing(false);
    }
  }
  return (
    <section className="customer-sales-history" role="tabpanel">
      <div className="customer-history-toolbar">
        <label>
          {t("customerHistory.start")}{" "}
          <input
            type="date"
            disabled={sharing}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {t("customerHistory.end")}{" "}
          <input
            type="date"
            disabled={sharing}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        {(start || end) && (
          <button
            className="button"
            disabled={sharing}
            onClick={() => {
              setStart("");
              setEnd("");
            }}
          >
            {t("customerHistory.allDates")}
          </button>
        )}
        {data && (
          <div className="customer-history-actions">
            <ReportPrintButton getDocument={report} />
            <ReportPrintButton intent="pdf" getDocument={report} />
            <button
              className="button"
              disabled={sharing || !canWhatsApp(data.party.phone)}
              title={
                !canWhatsApp(data.party.phone)
                  ? t("whatsapp.needPhone")
                  : undefined
              }
              onClick={shareReport}
            >
              <WhatsappLogoIcon size={16} />
              {t(sharing ? "whatsapp.sending" : "customerHistory.share")}
            </button>
          </div>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
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
          {!data.rows.length && <p>{t("customerHistory.empty")}</p>}
          {count < data.rows.length && (
            <button className="button" onClick={() => setCount((n) => n + 10)}>
              {t("customerHistory.more")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
