import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChartLineUpIcon,
  CalendarDotsIcon,
  PackageIcon,
  ScalesIcon,
  BankIcon,
  CoinsIcon,
  ReceiptIcon,
  StackIcon,
  ClockIcon,
  UsersIcon,
  TruckIcon,
  WarningCircleIcon,
  DownloadSimpleIcon,
  CheckCircleIcon,
  ArrowClockwiseIcon,
  InvoiceIcon,
  HandshakeIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { api, af, businessDate, exportCSV } from "../api";
import { collectReorderReport } from "../reports/reorder.mjs";
import { useI18n } from "../i18n";
import { reportPrintModel, reportCSVRows } from "../printing/models.mjs";
import { ReportPrintButton } from "../printing/PrintDialog";
import type { PrintDocument } from "../printing/types";
import type { PageProps } from "./Pages";
import { Empty, ErrorMessage } from "./ui";
import "./reports.css";

const TABS = [
  ["profitLoss", ChartLineUpIcon],
  ["daily", CalendarDotsIcon],
  ["invoiceProfit", InvoiceIcon],
  ["productProfit", PackageIcon],
  ["resaleProfit", HandshakeIcon],
  ["cashMoney", WalletIcon],
  ["expenseBreak", ReceiptIcon],
  ["trialBalance", ScalesIcon],
  ["balanceSheet", BankIcon],
  ["capitalNet", CoinsIcon],
  ["inventoryVal", StackIcon],
  ["stockAging", ClockIcon],
  ["reorder", WarningCircleIcon],
  ["zeroStock", PackageIcon],
  ["availableStock", StackIcon],
  ["receivables", UsersIcon],
  ["payables", TruckIcon],
] as const;
type Tab = (typeof TABS)[number][0];
const CURRENT = new Set<Tab>([
  "inventoryVal",
  "stockAging",
  "reorder",
  "zeroStock",
  "availableStock",
  "receivables",
  "payables",
]);
const AS_OF = new Set<Tab>(["trialBalance", "balanceSheet", "capitalNet"]);
type ReportModel = PrintDocument & {
  metrics: { label: string; value: string | number; tone: string }[];
  reconciled?: boolean;
};

function isReportTab(value: string | undefined): value is Tab {
  return !!value && TABS.some(([id]) => id === value);
}

export function ReportsPage({
  refresh,
  initialTab,
}: PageProps & { initialTab?: string }) {
  const { t, locale, dir } = useI18n();
  const [tab, setTab] = useState<Tab>(
    isReportTab(initialTab) ? initialTab : "profitLoss",
  );
  const [from, setFrom] = useState(businessDate().slice(0, 7) + "-01");
  const [to, setTo] = useState(businessDate());
  const [result, setResult] = useState<{ key: string; data: any } | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [moreBusy, setMoreBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [visible, setVisible] = useState(10);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (isReportTab(initialTab)) setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    setSearch("");
    setVisible(10);
  }, [tab]);
  const current = CURRENT.has(tab),
    asOf = AS_OF.has(tab);
  const invalid =
    !current && (!to || (!asOf && (!from || from > to)) || to > businessDate());
  const stockAlert =
    tab === "reorder" || tab === "zeroStock" || tab === "availableStock";
  const command = stockAlert
    ? "reorderReport"
    : current
      ? "inventoryReports"
      : tab === "capitalNet"
        ? "capitalReport"
        : "reports";
  const args = stockAlert
    ? {
        zeroOnly: tab === "zeroStock",
        availableOnly: tab === "availableStock",
      }
    : current
      ? {}
      : asOf
        ? { from: to, to }
        : { from, to };
  const key = JSON.stringify([command, args, refresh, reload]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    setActionError("");
    setNotice("");
    setMoreBusy(false);
    if (!invalid)
      api(command, args)
        .then((data) => {
          if (active) setResult({ key, data });
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [key, invalid]);
  useEffect(() => {
    setVisible(10);
    setNotice("");
    setActionError("");
  }, [tab, key]);
  const pending = !invalid && !error && result?.key !== key;
  const ready = !invalid && !error && result?.key === key;
  const data = ready ? result.data : null;
  const friendlyError = (message: string) =>
    message === "REPORT_CHANGED" ? t("reports.changed") : message;
  const account = (name: string) => {
    const keys: Record<string, string> = {
      cash: "cash",
      receivables: "receivables",
      payables: "payables",
      inventory: "inventory",
      equity: "equity",
      sales: "sales",
      cost_of_goods: "cogs",
      expenses: "expenses",
      other_income: "otherIncome",
      consignment_payables: "consignmentPayables",
    };
    return keys[name] ? t(`accounts.${keys[name]}`) : name;
  };
  function model(payload: any = data): ReportModel {
    return reportPrintModel(tab, payload, payload, payload, {
      t,
      locale,
      money: (n: number) => af(n, 2),
      account,
      from,
      to,
      today: businessDate(),
      reorder: payload,
    }) as ReportModel;
  }
  const report = ready ? model() : null;
  const section = report?.sections?.[0];
  const searchQuery = search.trim().toLowerCase();
  const matched = (section?.rows || [])
    .map((row, index) => ({
      row,
      tones: section?.tones?.[index],
      index,
    }))
    .filter(({ row }) =>
      !searchQuery
        ? true
        : row.some((cell: unknown) =>
            String(cell ?? "")
              .toLowerCase()
              .includes(searchQuery),
          ),
    );
  const count = matched.length;
  const rows = matched.slice(0, visible);
  const canExport =
    ready && (section?.rows.length || 0) > 0 && !exportBusy && !moreBusy;
  async function loadMore() {
    if (!stockAlert || !data.next) {
      setVisible((v) => v + 10);
      return;
    }
    const requestKey = key;
    setMoreBusy(true);
    setActionError("");
    try {
      const page = await api("reorderReport", {
        cursor: data.next,
        revision: data.revision,
        zeroOnly: tab === "zeroStock",
        availableOnly: tab === "availableStock",
      });
      if (mounted.current && keyRef.current === requestKey) {
        setResult((previous) =>
          previous?.key === requestKey
            ? {
                key: requestKey,
                data: {
                  ...previous.data,
                  rows: [...previous.data.rows, ...page.rows],
                  next: page.next,
                },
              }
            : previous,
        );
        setVisible((v) => v + 10);
      }
    } catch (e: any) {
      if (mounted.current && keyRef.current === requestKey)
        setActionError(friendlyError(e.message));
    } finally {
      if (mounted.current && keyRef.current === requestKey) setMoreBusy(false);
    }
  }
  async function exportDocument(): Promise<PrintDocument> {
    if (!ready) throw new Error(t("reports.notReady"));
    const requestKey = key;
    // Reorder exports include every matching product, not just the visible ten.
    if (!stockAlert) return model();
    setExportBusy(true);
    setActionError("");
    try {
      const all = await collectReorderReport(
        (args: any) =>
          api("reorderReport", {
            ...args,
            zeroOnly: tab === "zeroStock",
            availableOnly: tab === "availableStock",
          }),
        data.revision,
        () => mounted.current && keyRef.current === requestKey,
      );
      return model(all);
    } catch (e: any) {
      throw new Error(friendlyError(e.message));
    } finally {
      if (mounted.current) setExportBusy(false);
    }
  }
  async function csv() {
    setActionError("");
    setNotice("");
    try {
      const document = await exportDocument();
      exportCSV(
        `radefy-techmart-${tab}-${current ? businessDate() : asOf ? to : `${from}_${to}`}`,
        reportCSVRows(document),
      );
      if (mounted.current) setNotice(t("reports.exported"));
    } catch (e: any) {
      if (mounted.current) setActionError(friendlyError(e.message));
    }
  }
  function choose(next: Tab) {
    setTab(next);
  }
  return (
    <div className="page-content reports-page reports-workspace">
      <div
        className="reports-top-tabs"
        role="tablist"
        aria-label={t("reports.title")}
        aria-orientation="horizontal"
      >
        {TABS.map(([id, TabIcon], index) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`report-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`report-screen-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "selected" : ""}
            onClick={() => choose(id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "Home") next = 0;
              else if (event.key === "End") next = TABS.length - 1;
              else if (event.key === "ArrowRight")
                next =
                  (index + (dir === "rtl" ? -1 : 1) + TABS.length) %
                  TABS.length;
              else if (event.key === "ArrowLeft")
                next =
                  (index + (dir === "rtl" ? 1 : -1) + TABS.length) %
                  TABS.length;
              else return;
              event.preventDefault();
              choose(TABS[next][0]);
              tabRefs.current[next]?.focus();
            }}
          >
            <TabIcon size={17} weight={tab === id ? "fill" : "regular"} />
            {t(`reports.${id}`)}
          </button>
        ))}
      </div>
      <section
        className={`report-screen report-screen-${tab}`}
        id={`report-screen-${tab}`}
        role="tabpanel"
        aria-labelledby={`report-tab-${tab}`}
        tabIndex={0}
        aria-busy={pending}
      >
        <div className="report-toolbar">
          {current ? (
            <span className="report-scope-current">
              <span />
              {t("reports.currentStockDate", { date: businessDate() })}
            </span>
          ) : (
            <div className="report-date-range">
              {!asOf && (
                <label>
                  <span>{t("reports.startDate")}</span>
                  <input
                    type="date"
                    value={from}
                    max={to || businessDate()}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
              )}
              <label>
                <span>{t("reports.endDate")}</span>
                <input
                  type="date"
                  value={to}
                  min={asOf ? undefined : from}
                  max={businessDate()}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="report-toolbar-actions">
            <input
              type="search"
              className="report-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisible(10);
              }}
              placeholder={t("reports.search")}
              aria-label={t("reports.search")}
            />
            <button
              className="button button-icon"
              aria-label={t("reports.refresh")}
              title={t("reports.refresh")}
              disabled={pending || exportBusy}
              onClick={() => setReload((v) => v + 1)}
            >
              <ArrowClockwiseIcon size={16} />
            </button>
            <ReportPrintButton
              key={`${key}-${tab}-print`}
              disabled={!canExport}
              getDocument={exportDocument}
            />
            <ReportPrintButton
              key={`${key}-${tab}-pdf`}
              disabled={!canExport}
              getDocument={exportDocument}
              intent="pdf"
            />
            <button className="button" disabled={!canExport} onClick={csv}>
              <DownloadSimpleIcon size={16} />
              {t("reports.csv")}
            </button>
          </div>
        </div>
        <ErrorMessage
          error={invalid ? t("reports.invalidRange") : friendlyError(error)}
        />
        {pending && (
          <div className="loading-state">
            <ArrowClockwiseIcon className="spin" size={22} />
            {t("ui.loadingRecords")}
          </div>
        )}
        {report && (
          <>
            <div className="report-overview">
              {report.metrics.map((metric) => (
                <article
                  className={`report-overview-card report-tone-${metric.tone}`}
                  key={metric.label}
                >
                  <span>{metric.label}</span>
                  <strong>
                    <bdi dir="ltr">{metric.value}</bdi>
                  </strong>
                </article>
              ))}
            </div>
            {report.reconciled !== undefined && (
              <p
                className={`report-reconciliation report-tone-${report.reconciled ? "positive" : "negative"}`}
              >
                {report.reconciled ? (
                  <CheckCircleIcon size={18} weight="fill" />
                ) : (
                  <WarningCircleIcon size={18} />
                )}
                {t(
                  report.reconciled
                    ? "reports.balanced"
                    : "reports.reconNeeded",
                )}
              </p>
            )}
            {report.note && (
              <p className="report-unpriced">
                <WarningCircleIcon size={17} />
                {report.note}
              </p>
            )}
            {section && count > 0 ? (
              <div
                className={`report-list report-list-${section.columns.length}`}
                role="table"
                aria-label={report.title}
                aria-rowcount={count + 1}
                style={
                  {
                    "--report-columns": `minmax(180px, 1.8fr) repeat(${section.columns.length - 1}, minmax(90px, 1fr))`,
                  } as CSSProperties
                }
              >
                <div role="rowgroup" className="report-list-head">
                  <div className="report-list-row" role="row">
                    {section.columns.map((column, i) => (
                      <span
                        role="columnheader"
                        className={column.numeric ? "report-number" : ""}
                        key={i}
                      >
                        {column.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div role="rowgroup" className="report-list-body">
                  {rows.map(({ row, tones, index }, shown) => (
                    <div
                      role="row"
                      aria-rowindex={shown + 2}
                      className="report-list-row"
                      key={index}
                    >
                      {section.columns.map((column, cell) => (
                        <div
                          role="cell"
                          key={cell}
                          data-label={column.label}
                          className={`${column.numeric ? "report-number" : ""} report-tone-${tones?.[cell] || "neutral"}`}
                        >
                          {column.numeric ? (
                            <bdi dir="ltr">{row[cell]}</bdi>
                          ) : (
                            <span>{row[cell]}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty
                title={t(
                  searchQuery ? "reports.noSearchMatch" : "reports.noRows",
                )}
              />
            )}
            <div className="report-list-footer">
              <span>
                {t("reports.showingRows", {
                  shown: rows.length,
                  total: searchQuery
                    ? count
                    : stockAlert
                      ? data.summary.products
                      : section?.rows.length || 0,
                })}
              </span>
              {(visible < count ||
                (!searchQuery && stockAlert && data.next)) && (
                <button
                  className="button"
                  disabled={moreBusy || exportBusy}
                  onClick={loadMore}
                >
                  {moreBusy ? t("common.loading") : t("pagination.loadMore")}
                </button>
              )}
            </div>
          </>
        )}
        <ErrorMessage error={actionError} />
        {notice && (
          <p
            className="report-reconciliation report-tone-positive"
            role="status"
          >
            <CheckCircleIcon size={17} />
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
