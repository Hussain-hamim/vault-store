import { useEffect, useState } from "react";
import {
  PlusIcon,
  ArrowUpRightIcon,
  DownloadSimpleIcon,
  FolderIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  ClockIcon,
  WarningCircleIcon,
  ArrowClockwiseIcon,
  UsersIcon,
  PackageIcon,
  ArrowRightIcon,
  PrinterIcon,
  LockIcon,
  DatabaseIcon,
  HardDrivesIcon,
} from "@phosphor-icons/react";
import {
  api,
  af,
  exportCSV,
  businessDate,
  getToken,
  productSpecEntries,
  Product,
  Party,
  User,
} from "../api";
import { useI18n, useT, LOCALES, type Locale } from "../i18n";

const EM_DASH = "—";
import {
  Search,
  PageIntro,
  ProductName,
  Badge,
  Empty,
  ErrorMessage,
  Metric,
  Field,
  ExportButton,
  NumericInput,
} from "./ui";
export type PageProps = {
  refresh: number;
  open: (name: string, data?: any) => void;
  toast: (s: string) => void;
  user: User;
  globalSearch?: string;
};
function useLoad<T = any>(command: string, args: unknown, refresh: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const key = JSON.stringify(args);
  useEffect(() => {
    let active = true;
    setError("");
    api<T>(command, args)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [command, key, refresh]);
  return { data, error };
}
function Loading() {
  const t = useT();
  return (
    <div className="loading-state">
      <ArrowClockwiseIcon size={22} className="spin" />
      {t("ui.loadingRecords")}
    </div>
  );
}
const LIST_PAGE = 10;
const INVENTORY_CATEGORIES = [
  ["All products", "allProducts"],
  ["Computers", "computers"],
  ["Mobiles", "mobiles"],
  ["Tablets", "tablets"],
  ["Storage", "storage"],
  ["Accessories", "accessories"],
] as const;
const REPORT_TAB_IDS = [
  "profitLoss",
  "daily",
  "productProfit",
  "trialBalance",
  "balanceSheet",
  "capitalNet",
  "expenseBreak",
  "inventoryVal",
  "stockAging",
  "receivables",
  "payables",
] as const;
type ReportTabId = (typeof REPORT_TAB_IDS)[number];
function localizedAccountName(
  s: string,
  t: ReturnType<typeof useT>,
): string {
  const keys: Record<string, string> = {
    cash: "accounts.cash",
    receivables: "accounts.receivables",
    payables: "accounts.payables",
    inventory: "accounts.inventory",
    equity: "accounts.equity",
    sales: "accounts.sales",
    cost_of_goods: "accounts.cogs",
    expenses: "accounts.expenses",
    other_income: "accounts.otherIncome",
  };
  const key = keys[s];
  return key ? t(key) : s;
}
export function ProductsPage({
  refresh,
  open,
  toast,
  globalSearch = "",
  initialCategory = "All products",
  user,
}: PageProps & { initialFilter?: string; initialCategory?: string }) {
  const t = useT();
  const [q, setQ] = useState(globalSearch),
    [category, setCategory] = useState(initialCategory),
    [filter, setFilter] = useState("all"),
    [rows, setRows] = useState<Product[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setQ(globalSearch);
  }, [globalSearch]);
  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    api<{ rows: Product[]; next: string | null }>("products", {
      q,
      category,
      filter,
      limit: LIST_PAGE,
    })
      .then((d) => {
        if (!active) return;
        setRows(d.rows);
        setNext(d.next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, category, filter, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Product[]; next: string | null }>(
        "products",
        { q, category, filter, after: next, limit: LIST_PAGE },
      );
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...d.rows.filter((p) => !seen.has(p.id))];
      });
      setNext(d.next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }
  const showCost = user.permissions.includes("view_costs");
  const categoryClass = (c: string) =>
    ({
      Computers: "cat-computers",
      Mobiles: "cat-mobiles",
      Tablets: "cat-tablets",
      Storage: "cat-storage",
      Accessories: "cat-accessories",
    })[c] || "cat-default";
  const stockTone = (p: Product) =>
    p.stock === 0 ? "red" : p.stock <= p.reorder_level ? "yellow" : "green";
  function productSpecs(p: Product) {
    return productSpecEntries(p);
  }
  return (
    <div className="page-content inventory-page">
      <PageIntro
        compact
        eyebrow={t("inventory.eyebrow")}
        title={t("inventory.title")}
        description={t("inventory.description")}
        action={
          <button
            className="button button-dark"
            onClick={() => open("product")}
          >
            <PlusIcon size={16} />
            {t("inventory.addProduct")}
          </button>
        }
      />
      <section
        className={`panel inventory-list${showCost ? " with-cost" : ""}`}
      >
        <div className="inventory-list-sticky">
          <div className="list-toolbar">
            <Search
              value={q}
              onChange={setQ}
              placeholder={t("inventory.searchPh")}
            />
            <div className="toolbar-right">
              <select
                aria-label={t("inventory.category")}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {INVENTORY_CATEGORIES.map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(`inventory.${key}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("inventory.stockFilter")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{t("inventory.allStock")}</option>
                <option value="low">{t("inventory.lowStock")}</option>
              </select>
              <ExportButton
                onClick={() => {
                  exportCSV(
                    "vault-products",
                    rows.map(
                      ({
                        name,
                        sku,
                        brand,
                        model,
                        category,
                        stock,
                        price,
                        cost,
                        unit_cost,
                        attributes,
                      }) => ({
                        name,
                        sku,
                        brand,
                        model,
                        category,
                        stock,
                        price_AF: price / 100,
                        ...(cost !== undefined
                          ? {
                              unit_cost_AF:
                                (stock ? cost / stock : unit_cost || 0) / 100,
                            }
                          : {}),
                        ...Object.fromEntries(
                          Object.entries(attributes || {}).map(([k, v]) => [
                            k.toLowerCase(),
                            v,
                          ]),
                        ),
                      }),
                    ),
                  );
                  toast(t("inventory.exported"));
                }}
              />
            </div>
          </div>
          <div className="inventory-list-cols" role="row">
            <span>{t("inventory.productSpecs")}</span>
            <span>{t("inventory.qty")}</span>
            {showCost && <span>{t("inventory.unitCost")}</span>}
            <span>{t("inventory.sellingPrice")}</span>
            <span aria-hidden="true" />
          </div>
        </div>
        <ErrorMessage error={error} />
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="inventory-list-scroll" role="list">
              {rows.map((p) => {
                const tone = stockTone(p);
                const unitCost = p.stock
                  ? (p.cost || 0) / p.stock
                  : p.unit_cost || 0;
                const specs = productSpecs(p);
                return (
                  <button
                    type="button"
                    key={p.id}
                    role="listitem"
                    className={`inventory-row ${categoryClass(p.category)} stock-${tone}`}
                    onClick={() => open("productDetail", p)}
                  >
                    <div className="inventory-row-main">
                      <div className="inventory-row-product">
                        <span className="inventory-row-image">
                          {p.image ? (
                            <img src={p.image} alt="" />
                          ) : (
                            <PackageIcon size={22} />
                          )}
                        </span>
                        <span className="inventory-row-copy">
                          <strong>{p.name}</strong>
                          <small>
                            {[p.brand, p.model, p.sku]
                              .filter(Boolean)
                              .join(" · ") || t("inventory.noBrand")}
                            {p.barcode ? ` · ⌗ ${p.barcode}` : ""}
                          </small>
                          <span className="inventory-chip category-chip">
                            {p.category}
                            {p.condition ? ` · ${p.condition}` : ""}
                            {p.warranty ? ` · ${p.warranty}` : ""}
                          </span>
                        </span>
                      </div>
                      <div className="inventory-row-meta">
                        <Badge tone={tone}>
                          {p.stock} {t("dashboard.units")}
                        </Badge>
                      </div>
                      {showCost && (
                        <div className="inventory-row-meta inventory-row-cost">
                          <strong>{af(unitCost, 2)}</strong>
                          <small>
                            {p.stock ? t("inventory.fifoAvg") : t("inventory.lastBuy")}
                          </small>
                        </div>
                      )}
                      <div className="inventory-row-meta inventory-row-price">
                        <strong>{af(p.price, 2)}</strong>
                      </div>
                      <div className="inventory-row-go" aria-hidden="true">
                        <ArrowUpRightIcon size={16} />
                      </div>
                    </div>
                    {specs.length > 0 && (
                      <div className="inventory-row-specs">
                        {specs.map((s) => (
                          <span key={s.key} className="inventory-spec">
                            <em>{s.key}</em>
                            <strong>{s.value}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
              {!rows.length && (
                <Empty
                  title={t("inventory.noMatchTitle")}
                  text={t("inventory.noMatchText")}
                />
              )}
            </div>
            <div className="pagination inventory-list-pager">
              <span>
                {t("inventory.showingProducts", { n: rows.length })}
              </span>
              {next ? (
                <button
                  className="button button-dark"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore
                    ? t("common.loading")
                    : t("pagination.loadMore")}
                </button>
              ) : (
                rows.length > 0 && (
                  <span className="subtle">{t("ui.allLoaded")}</span>
                )
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
export function DocumentsPage({
  kind,
  refresh,
  open,
  toast,
  globalSearch = "",
  user,
}: PageProps & { kind: "sale" | "purchase" | "expense" }) {
  const t = useT();
  const [q, setQ] = useState(globalSearch),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setQ(globalSearch);
  }, [globalSearch]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    api<any>("documents", { kind, q, limit: LIST_PAGE })
      .then((d) => {
        if (!active) return;
        setRows(d.rows);
        setNext(d.next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, q, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<any>("documents", {
        kind,
        q,
        after: next,
        limit: LIST_PAGE,
      });
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...d.rows.filter((r: any) => !seen.has(r.id))];
      });
      setNext(d.next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }
  const label =
    kind === "sale"
      ? t("nav.sales")
      : kind === "purchase"
        ? t("nav.purchases")
        : t("nav.expenses");
  const partyLabel =
    kind === "expense"
      ? t("expenses.category")
      : kind === "sale"
        ? t("sales.customer")
        : t("sales.supplier");
  function docStatus(d: any) {
    if (kind === "expense") {
      return { tone: "green" as const, label: t("common.save") };
    }
    if (d.returned === d.total)
      return { tone: "gray" as const, label: t("documents.returned") };
    if (d.paid + d.returned >= d.total)
      return { tone: "green" as const, label: t("common.paid") };
    if (d.paid) return { tone: "yellow" as const, label: t("common.partial") };
    return { tone: "red" as const, label: t("common.unpaid") };
  }
  return (
    <div className={`page-content docs-page docs-${kind}`}>
      <PageIntro
        compact
        eyebrow={label}
        title={
          kind === "sale"
            ? t("documents.saleHistory")
            : kind === "purchase"
              ? t("documents.purchaseHistory")
              : t("documents.expenseHistory")
        }
        description={
          kind === "sale"
            ? t("documents.saleHistory")
            : kind === "purchase"
              ? t("documents.purchaseHistory")
              : t("expenses.description")
        }
        action={
          <button className="button button-dark" onClick={() => open(kind)}>
            <PlusIcon size={16} />
            {kind === "sale"
              ? t("documents.newSale")
              : kind === "purchase"
                ? t("documents.receivePurchase")
                : t("documents.recordExpense")}
          </button>
        }
      />
      <section className="panel docs-list">
        <div className="docs-list-sticky">
          <div className="list-toolbar">
            <Search
              value={q}
              onChange={setQ}
              placeholder={
                kind === "expense"
                  ? t("documents.searchExpense")
                  : kind === "purchase"
                    ? t("documents.searchPurchase")
                    : t("documents.searchSale")
              }
            />
            <ExportButton
              onClick={() => {
                exportCSV(
                  `vault-${label.toLowerCase()}`,
                  rows.map((d: any) => ({
                    invoice: d.number,
                    date: d.date,
                    contact: d.party_name || "",
                    category: d.category,
                    total_AF: d.total / 100,
                    paid_AF: d.paid / 100,
                    returned_AF: d.returned / 100,
                    outstanding_AF:
                      Math.max(0, d.total - d.paid - d.returned) / 100,
                    note: d.note,
                  })),
                );
                toast(t("documents.exported"));
              }}
            />
          </div>
          <div className="docs-list-cols" role="row">
            <span>{t("documents.reference")}</span>
            <span>{t("common.date")}</span>
            <span>{partyLabel}</span>
            <span>{t("common.total")}</span>
            {kind !== "expense" && <span>{t("common.outstanding")}</span>}
            <span>{t("common.status")}</span>
            <span aria-hidden="true" />
          </div>
        </div>
        <ErrorMessage error={error} />
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="docs-list-scroll" role="list">
              {rows.map((d: any) => {
                const status = docStatus(d);
                const outstanding = Math.max(0, d.total - d.paid - d.returned);
                return (
                  <button
                    type="button"
                    key={d.id}
                    role="listitem"
                    className={`docs-row status-${status.tone}`}
                    onClick={() => open("invoice", d)}
                  >
                    <div className="docs-row-ref">
                      <strong>{d.number}</strong>
                      {d.note ? <small>{d.note}</small> : null}
                      {d.returned > 0 && (
                        <small className="docs-return-note">
                          {t("invoiceActions.returnedQty", {
                            n: af(d.returned),
                          })}
                        </small>
                      )}
                    </div>
                    <div className="docs-row-meta">
                      <span className="docs-row-date">{d.date}</span>
                    </div>
                    <div className="docs-row-meta">
                      <span className="docs-row-party">
                        {kind === "expense"
                          ? d.category || t("expenses.title")
                          : d.party_name || EM_DASH}
                      </span>
                    </div>
                    <div className="docs-row-meta docs-row-money">
                      <strong>{af(d.total)}</strong>
                      {kind !== "expense" && (
                        <small>
                          {t("documents.paidAmount", { amount: af(d.paid) })}
                        </small>
                      )}
                    </div>
                    {kind !== "expense" && (
                      <div className="docs-row-meta docs-row-money">
                        <strong
                          className={
                            outstanding > 0 ? "text-red" : "text-green"
                          }
                        >
                          {af(outstanding)}
                        </strong>
                      </div>
                    )}
                    <div className="docs-row-meta">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div
                      className="docs-row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {["sale", "purchase"].includes(kind) ? (
                        <>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => open("invoice", d)}
                          >
                            {t("common.view")}
                          </button>
                          {["Owner", "Manager"].includes(user.role) && (
                            <>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  open(
                                    kind === "purchase"
                                      ? "purchaseEdit"
                                      : "saleEdit",
                                    d,
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
                                    kind === "purchase"
                                      ? "purchaseDelete"
                                      : "saleDelete",
                                    d,
                                  )
                                }
                              >
                                {t("common.delete")}
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="docs-row-go" aria-hidden="true">
                          <ArrowUpRightIcon size={16} />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {!rows.length && (
                <Empty
                  title={
                    kind === "sale"
                      ? t("empty.sales")
                      : kind === "purchase"
                        ? t("empty.purchases")
                        : t("empty.expenses")
                  }
                  text={t("documents.emptyText")}
                />
              )}
            </div>
            <div className="pagination docs-list-pager">
              <span>
                {t("ui.showing", { n: rows.length })}
              </span>
              {next ? (
                <button
                  className="button button-dark"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore
                    ? t("common.loading")
                    : t("pagination.loadMore")}
                </button>
              ) : (
                rows.length > 0 && (
                  <span className="subtle">{t("ui.allLoaded")}</span>
                )
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
function ledgerLabel(
  e: {
    category?: string;
    kind?: string;
    note?: string;
    number?: string;
  },
  t: ReturnType<typeof useT>,
) {
  if (e.category === "Opening balance" || /opening balance/i.test(e.note || ""))
    return t("ledger.opening");
  const keys: Record<string, string> = {
    sale: "ledger.sale",
    purchase: "ledger.purchase",
    receipt: "ledger.paymentIn",
    payment: "ledger.paymentOut",
    sale_return: "ledger.returnSale",
    purchase_return: "ledger.returnPurchase",
  };
  const key = keys[e.kind || ""];
  return key ? t(key) : e.kind || t("ledger.entry");
}
function daybookKindLabel(kind: string, t: ReturnType<typeof useT>) {
  const keys: Record<string, string> = {
    sale: "ledger.sale",
    purchase: "ledger.purchase",
    expense: "ledger.expense",
    payment: "ledger.paymentOut",
    receipt: "ledger.paymentIn",
    sale_return: "ledger.returnSale",
    purchase_return: "ledger.returnPurchase",
    capital_in: "ledger.capitalIn",
    capital_out: "ledger.capitalOut",
  };
  const key = keys[kind];
  return key ? t(key) : kind.replaceAll("_", " ");
}
function backupStatusLabel(status: string, t: ReturnType<typeof useT>) {
  if (status === "verified") return t("backups.statusVerified");
  if (status === "failed") return t("backups.statusFailed");
  return status;
}
export function PeoplePage({
  kind,
  refresh,
  open,
  toast,
  user,
}: PageProps & { kind: "customer" | "supplier" }) {
  const t = useT();
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [rows, setRows] = useState<Party[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [ledgerAfter, setLedgerAfter] = useState(""),
    [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    api<{ rows: Party[]; next: string | null }>("parties", {
      kind,
      q,
      limit: LIST_PAGE,
    })
      .then((d) => {
        if (!active) return;
        setRows(d.rows);
        setNext(d.next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, q, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Party[]; next: string | null }>("parties", {
        kind,
        q,
        after: next,
        limit: LIST_PAGE,
      });
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...d.rows.filter((p) => !seen.has(p.id))];
      });
      setNext(d.next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }
  const { data: detail, error: detailError } = useLoad<any>(
    selected ? "partyDetail" : "status",
    selected ? { id: selected, after: ledgerAfter, limit: 25 } : {},
    refresh,
  );
  const signed = (e: any) =>
    kind === "customer" ? e.debit - e.credit : e.credit - e.debit;
  let running = detail?.page_start_balance ?? detail?.party?.balance ?? 0;
  const ledgerRows = (detail?.entries || []).map((e: any) => {
    const row = { ...e, running, label: ledgerLabel(e, t) };
    running -= signed(e);
    return row;
  });
  const total = rows.reduce((s, p) => s + p.balance, 0);
  function selectParty(id: string) {
    setSelected(id);
    setLedgerAfter("");
    setLedgerHistory([]);
  }
  const balanceTone = (balance: number) =>
    balance > 0 ? "owed" : balance < 0 ? "credit" : "settled";
  return (
    <div className={`page-content people-page people-${kind}`}>
      <PageIntro
        compact
        eyebrow={
          kind === "customer"
            ? t("people.customersEyebrow")
            : t("people.suppliersEyebrow")
        }
        title={
          kind === "customer"
            ? t("people.customersTitle")
            : t("people.suppliersTitle")
        }
        description={
          kind === "customer"
            ? t("people.customersDesc")
            : t("people.suppliersDesc")
        }
        action={
          <button className="button button-dark" onClick={() => open(kind)}>
            <PlusIcon size={16} />
            {kind === "customer"
              ? t("people.addCustomer")
              : t("people.addSupplier")}
          </button>
        }
      />
      <div className="metrics-row people-metrics">
        <Metric
          label={
            kind === "customer"
              ? t("people.customersLoaded")
              : t("people.suppliersLoaded")
          }
          value={String(rows.length)}
        />
        <Metric
          label={
            kind === "customer"
              ? t("people.receivablesLoaded")
              : t("people.payablesLoaded")
          }
          value={af(total)}
        />
        <Metric
          label={t("people.currency")}
          value="AFN"
          detail={t("people.currencyDetail")}
        />
      </div>
      <div className={`people-layout ${selected ? "has-detail" : ""}`}>
        <section className="panel people-list">
          <div className="people-list-sticky">
            <div className="list-toolbar">
              <Search
                value={q}
                onChange={setQ}
                placeholder={
                  kind === "customer"
                    ? t("people.searchCustomers")
                    : t("people.searchSuppliers")
                }
              />
              <ExportButton
                onClick={() => {
                  exportCSV(
                    `vault-${kind}s`,
                    rows.map((p) => ({
                      name: p.name,
                      phone: p.phone,
                      email: p.email,
                      balance_AF: p.balance / 100,
                    })),
                  );
                  toast(t("people.contactsExported"));
                }}
              />
            </div>
            <div className="people-list-cols" role="row">
              <span>
                {kind === "customer"
                  ? t("sales.customer")
                  : t("sales.supplier")}
              </span>
              <span>{t("common.phone")}</span>
              <span>{t("common.status")}</span>
              <span>{t("common.outstanding")}</span>
              <span aria-hidden="true" />
            </div>
          </div>
          <ErrorMessage error={error} />
          {loading ? (
            <Loading />
          ) : (
            <>
              <div className="people-list-scroll" role="list">
                {rows.map((p) => {
                  const tone = balanceTone(p.balance);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      role="listitem"
                      className={`people-row balance-${tone}${selected === p.id ? " selected" : ""}${p.walk_in ? " walk-in" : ""}`}
                      onClick={() => selectParty(p.id)}
                    >
                      <div className="people-row-identity">
                        <span className="people-row-avatar">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="people-row-copy">
                          <strong>{p.name}</strong>
                          <small>
                            {p.walk_in
                              ? t("people.walkIn")
                              : p.email ||
                                (kind === "customer"
                                  ? t("people.customerAccount")
                                  : t("people.supplierAccount"))}
                          </small>
                        </span>
                      </div>
                      <div className="people-row-meta">
                        <span className="people-row-phone">
                          {p.phone || t("people.noPhone")}
                        </span>
                      </div>
                      <div className="people-row-meta">
                        <span className={`people-status status-${tone}`}>
                          {tone === "owed"
                            ? kind === "customer"
                              ? t("people.owesYou")
                              : t("people.youOwe")
                            : tone === "credit"
                              ? t("people.credit")
                              : t("people.settled")}
                        </span>
                      </div>
                      <div className="people-row-meta people-row-balance">
                        <strong className={`money balance-${tone}`}>
                          {af(p.balance)}
                        </strong>
                      </div>
                      <div className="people-row-go" aria-hidden="true">
                        <ArrowUpRightIcon size={16} />
                      </div>
                    </button>
                  );
                })}
                {!rows.length && (
                  <Empty
                    title={
                      kind === "customer"
                        ? t("empty.customers")
                        : t("empty.suppliers")
                    }
                    text={t("people.emptyText")}
                  />
                )}
              </div>
              <div className="pagination people-list-pager">
                <span>
                  {t("people.showingContacts", { n: rows.length })}
                </span>
                {next ? (
                  <button
                    className="button button-dark"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore
                      ? t("common.loading")
                      : t("pagination.loadMore")}
                  </button>
                ) : (
                  rows.length > 0 && (
                    <span className="subtle">{t("ui.allLoaded")}</span>
                  )
                )}
              </div>
            </>
          )}
        </section>
        {selected && (
          <section className="panel contact-detail people-detail">
            <div className="panel-heading">
              <h3>{t("people.contactLedger")}</h3>
              <button className="text-button" onClick={() => setSelected(null)}>
                {t("common.close")}
              </button>
            </div>
            <ErrorMessage error={detailError} />
            {detail?.party ? (
              <>
                <div className="contact-summary">
                  <span className="customer-initial avatar-lg people-detail-avatar">
                    {detail.party.name.slice(0, 1)}
                  </span>
                  <h2>{detail.party.name}</h2>
                  <p>{detail.party.phone || t("people.noPhone")}</p>
                  <p>{detail.party.address || t("people.noAddress")}</p>
                  {user.role === "Owner" && !detail.party.walk_in && (
                    <button
                      className="text-button"
                      onClick={() => open("openingBalance", detail.party)}
                    >
                      {t("people.enterOpeningBalance")}
                    </button>
                  )}
                  <div
                    className={`contact-balance balance-${balanceTone(detail.party.balance)}`}
                  >
                    <span>{t("people.outstandingBalance")}</span>
                    <strong
                      className={
                        detail.party.balance > 0 ? "text-red" : "text-green"
                      }
                    >
                      {af(detail.party.balance)}
                    </strong>
                  </div>
                  {detail.party.balance > 0 &&
                    user.permissions.includes("finance") && (
                      <button
                        className="button button-dark full"
                        onClick={() => open("payment", detail.party)}
                      >
                        {kind === "customer"
                          ? t("people.receivePayment")
                          : t("people.paySupplier")}
                        <ArrowRightIcon size={15} />
                      </button>
                    )}
                </div>
                <div className="contact-ledger">
                  <h3>{t("ledger.title")}</h3>
                  <p className="subtle ledger-hint">{t("ledger.hint")}</p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t("ledger.dateReference")}</th>
                        <th>{t("ledger.debit")}</th>
                        <th>{t("ledger.credit")}</th>
                        <th>{t("ledger.balance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((e: any) => (
                        <tr
                          key={e.id}
                          onClick={() =>
                            open("invoice", { id: e.document_id })
                          }
                        >
                          <td>
                            {e.date}
                            <small className="block muted">
                              {e.label}
                              {e.number ? ` · ${e.number}` : ""}
                            </small>
                          </td>
                          <td
                            className={`money ${e.debit ? (kind === "customer" ? "text-red" : "text-green") : "muted"}`}
                          >
                            {e.debit ? af(e.debit) : EM_DASH}
                          </td>
                          <td
                            className={`money ${e.credit ? (kind === "customer" ? "text-green" : "text-red") : "muted"}`}
                          >
                            {e.credit ? af(e.credit) : EM_DASH}
                          </td>
                          <td
                            className={`money ${e.running > 0 ? "text-red" : "text-green"}`}
                          >
                            {af(e.running)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.entries.length && (
                    <p className="muted">{t("people.noLedgerActivity")}</p>
                  )}
                  <div className="pagination ledger-pagination">
                    <span>{t("ui.perPage", { n: 25 })}</span>
                    <button
                      className="button"
                      disabled={!ledgerHistory.length}
                      onClick={() => {
                        setLedgerAfter(ledgerHistory.at(-1) || "");
                        setLedgerHistory((h) => h.slice(0, -1));
                      }}
                    >
                      {t("ui.newer")}
                    </button>
                    <button
                      className="button"
                      disabled={!detail.next}
                      onClick={() => {
                        setLedgerHistory((h) => [...h, ledgerAfter]);
                        setLedgerAfter(detail.next || "");
                      }}
                    >
                      {t("ui.older")}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <Loading />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
function monthLabel(ym: string, locale: Locale) {
  const [y, m] = ym.split("-").map(Number);
  const tag = locale === "en" ? "en" : locale === "ps" ? "ps-AF" : "fa-AF";
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(tag, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function CapitalPage({ refresh, open, toast, user }: PageProps) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [historyAfter, setHistoryAfter] = useState(""),
    [historyStack, setHistoryStack] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setError("");
    api("capitalReport", { after: historyAfter, limit: 25 })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh, historyAfter]);
  useEffect(() => {
    setHistoryAfter("");
    setHistoryStack([]);
  }, [refresh]);
  const c = data?.current;
  return (
    <div className="page-content capital-page">
      <PageIntro
        compact
        eyebrow={t("capital.eyebrow")}
        title={t("capital.title")}
        description={t("capital.description")}
        action={
          user.permissions.includes("finance") ? (
            <button
              className="button button-dark"
              onClick={() => open("owner")}
            >
              <PlusIcon size={16} />
              {t("capital.record")}
            </button>
          ) : (
            <Badge tone="yellow">{t("ui.viewOnly")}</Badge>
          )
        }
      />
      <ErrorMessage error={error} />
      {!data || !c ? (
        <Loading />
      ) : (
        <>
          <div className="capital-hero-metrics">
            <div className="capital-hero-card tone-worth">
              <span>{t("capital.netWorth")}</span>
              <strong className="amt-worth">{af(c.net_worth)}</strong>
            </div>
            <div className="capital-hero-card tone-capital">
              <span>{t("reports.ownerCapital")}</span>
              <strong className="amt-capital">{af(c.capital)}</strong>
            </div>
            <div className="capital-hero-card tone-earn">
              <span>{t("reports.earningsKept")}</span>
              <strong
                className={c.earnings >= 0 ? "amt-up" : "amt-down"}
              >
                {af(c.earnings)}
              </strong>
            </div>
            <div className="capital-hero-card tone-cash">
              <span>{t("capital.cashOnHand")}</span>
              <strong className="amt-cash">{af(c.cash)}</strong>
            </div>
          </div>
          <div className="capital-split">
            <section className="panel capital-sits">
              <div className="panel-heading padded">
                <div>
                  <h3>{t("capital.whereSits")}</h3>
                  <p className="subtle">{t("capital.whereSitsSub")}</p>
                </div>
              </div>
              <div className="capital-sits-list">
                <div className="capital-sit-row">
                  <span>{t("capital.cash")}</span>
                  <strong className="amt-cash">{af(c.cash, 2)}</strong>
                </div>
                <div className="capital-sit-row">
                  <span>{t("dashboard.customerReceivables")}</span>
                  <strong className="amt-recv">{af(c.receivables, 2)}</strong>
                </div>
                <div className="capital-sit-row">
                  <span>{t("capital.inventory")}</span>
                  <strong className="amt-inv">{af(c.inventory, 2)}</strong>
                </div>
                <div className="capital-sit-row sub">
                  <span>{t("capital.totalAssets")}</span>
                  <strong className="amt-worth">{af(c.assets, 2)}</strong>
                </div>
                <div className="capital-sit-row">
                  <span>{t("capital.supplierPayables")}</span>
                  <strong className="amt-down">{af(c.payables, 2)}</strong>
                </div>
                <div className="capital-sit-row total">
                  <span>{t("capital.netWorth")}</span>
                  <strong className="amt-worth">{af(c.net_worth, 2)}</strong>
                </div>
                <p className="subtle capital-sits-note">
                  {t("capital.netWorthNote")}
                </p>
              </div>
            </section>
            <section className="panel capital-months">
              <div className="panel-heading padded">
                <div>
                  <h3>{t("capital.monthlyNetWorth")}</h3>
                  <p className="subtle">{t("capital.monthlyNetWorthSub")}</p>
                </div>
                <ExportButton
                  onClick={() => {
                    exportCSV(
                      "vault-capital-months",
                      data.months.map((m: any) => ({
                        month: m.month,
                        invested_AF: m.invested / 100,
                        withdrawn_AF: m.withdrawn / 100,
                        profit_AF: m.profit / 100,
                        capital_AF: m.capital / 100,
                        earnings_AF: m.earnings / 100,
                        net_worth_AF: m.net_worth / 100,
                        change_AF: m.change / 100,
                        cash_AF: m.cash / 100,
                      })),
                    );
                    toast(t("capital.exported"));
                  }}
                />
              </div>
              <div className="table-wrap capital-months-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("capital.month")}</th>
                      <th>{t("capital.colIn")}</th>
                      <th>{t("capital.colOut")}</th>
                      <th>{t("capital.profit")}</th>
                      <th>{t("capital.netWorth")}</th>
                      <th>{t("capital.change")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((m: any) => (
                      <tr key={m.month}>
                        <td>{monthLabel(m.month, locale)}</td>
                        <td className="money amt-up">
                          {m.invested ? af(m.invested) : EM_DASH}
                        </td>
                        <td className="money amt-down">
                          {m.withdrawn ? af(m.withdrawn) : EM_DASH}
                        </td>
                        <td
                          className={`money ${m.profit >= 0 ? "amt-up" : "amt-down"}`}
                        >
                          {af(m.profit)}
                        </td>
                        <td>
                          <strong className="amt-worth">{af(m.net_worth)}</strong>
                        </td>
                        <td
                          className={`money ${m.change > 0 ? "amt-up" : m.change < 0 ? "amt-down" : ""}`}
                        >
                          {m.change > 0 ? "+" : ""}
                          {af(m.change)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.months.length && (
                <Empty
                  title={t("capital.noHistoryTitle")}
                  text={t("capital.noHistoryText")}
                />
              )}
            </section>
          </div>
          <section className="panel capital-history">
            <div className="panel-heading padded">
              <div>
                <h3>{t("capital.movementHistory")}</h3>
                <p className="subtle">{t("capital.movementHistorySub")}</p>
              </div>
            </div>
            <div className="capital-history-list">
              {data.movements.map((m: any) => (
                <button
                  type="button"
                  key={m.id}
                  className={`capital-history-row ${m.direction}`}
                  onClick={() => open("invoice", { id: m.id })}
                >
                  <span className="capital-history-date">{m.date}</span>
                  <span className="capital-history-type">
                    {m.direction === "deposit"
                      ? t("capital.investment")
                      : t("capital.withdrawal")}
                  </span>
                  <span className="capital-history-ref">{m.number}</span>
                  <span className="capital-history-note">
                    {m.note || EM_DASH}
                  </span>
                  <strong
                    className={
                      m.direction === "deposit" ? "amt-up" : "amt-down"
                    }
                  >
                    {m.direction === "deposit" ? "+" : "−"}
                    {af(m.amount)}
                  </strong>
                </button>
              ))}
            </div>
            {!data.movements.length && (
              <Empty
                title={t("capital.noCashTitle")}
                text={t("capital.noCashText")}
              />
            )}
            <div className="pagination">
              <span>{t("ui.perPage", { n: 25 })}</span>
              <button
                className="button"
                disabled={!historyStack.length}
                onClick={() => {
                  setHistoryAfter(historyStack.at(-1) || "");
                  setHistoryStack((h) => h.slice(0, -1));
                }}
              >
                {t("ui.newer")}
              </button>
              <button
                className="button"
                disabled={!data.next}
                onClick={() => {
                  setHistoryStack((h) => [...h, historyAfter]);
                  setHistoryAfter(data.next || "");
                }}
              >
                {t("ui.older")}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
export function DayBookPage({ refresh, open, toast, user }: PageProps) {
  const t = useT();
  const [day, setDay] = useState(businessDate()),
    [counted, setCounted] = useState("");
  const { data, error } = useLoad<any>("dayBook", { date: day }, refresh);
  return (
    <div className="page-content daybook-page">
      <PageIntro
        compact
        eyebrow={t("daybook.eyebrow")}
        title={t("daybook.title")}
        description={t("daybook.description")}
        action={
          <div className="inline-actions">
            <input
              aria-label={t("daybook.dateLabel")}
              type="date"
              value={day}
              max={businessDate()}
              onChange={(e) => setDay(e.target.value)}
            />
            <button className="button" onClick={() => open("owner")}>
              {t("daybook.ownerCash")}
            </button>
            <button
              className="button button-dark"
              onClick={() => open("expense")}
            >
              <PlusIcon size={16} />
              {t("documents.recordExpense")}
            </button>
          </div>
        }
      />
      <ErrorMessage error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="daybook-metrics">
            <div className="daybook-metric tone-sales">
              <span>{t("daybook.dailySales")}</span>
              <strong className="amt-up">{af(data.totals.sales)}</strong>
            </div>
            {user.permissions.includes("view_costs") && (
              <div className="daybook-metric tone-gross">
                <span>{t("daybook.grossTrading")}</span>
                <strong
                  className={
                    data.totals.gross >= 0 ? "amt-up" : "amt-down"
                  }
                >
                  {af(data.totals.gross)}
                </strong>
              </div>
            )}
            <div className="daybook-metric tone-expense">
              <span>{t("daybook.expenses")}</span>
              <strong className="amt-down">{af(data.totals.expenses)}</strong>
            </div>
            {user.permissions.includes("view_costs") && (
              <div className="daybook-metric tone-net">
                <span>{t("reports.netProfit")}</span>
                <strong
                  className={data.totals.net >= 0 ? "amt-worth" : "amt-down"}
                >
                  {af(data.totals.net)}
                </strong>
              </div>
            )}
          </div>
          <section className="panel cash-reconciliation daybook-cash">
            <div>
              <span>{t("daybook.openingCash")}</span>
              <strong className="amt-cash">{af(data.opening)}</strong>
            </div>
            <ArrowRightIcon size={18} />
            <div>
              <span>{t("daybook.netCashMovement")}</span>
              <strong
                className={
                  data.totals.cash >= 0 ? "amt-up" : "amt-down"
                }
              >
                {af(data.totals.cash)}
              </strong>
            </div>
            <ArrowRightIcon size={18} />
            <div>
              <span>{t("daybook.expectedClosing")}</span>
              <strong className="amt-cash">{af(data.closing)}</strong>
            </div>
            <Field label={t("daybook.countedCash")}>
              <NumericInput
                min="0"
                step="0.01"
                placeholder={t("daybook.countedPh")}
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </Field>
            {counted !== "" && (
              <Badge
                tone={
                  Math.round(Number(counted) * 100) === data.closing
                    ? "green"
                    : "red"
                }
              >
                {t("daybook.difference")}:{" "}
                {af(Math.round(Number(counted) * 100) - data.closing, 2)}
              </Badge>
            )}
          </section>
          <section className="panel daybook-tx">
            <div className="panel-heading padded">
              <h3>
                {t("daybook.dailyTransactions")} <span>{day}</span>
              </h3>
              <ExportButton
                onClick={() => {
                  exportCSV(
                    `vault-daily-book-${day}`,
                    data.entries.map((d: any) => ({
                      reference: d.number,
                      type: d.kind,
                      contact: d.party_name || "",
                      total_AF: d.total / 100,
                      cash_change_AF: d.cash_change / 100,
                      note: d.note,
                    })),
                  );
                  toast(t("daybook.exported"));
                }}
              />
            </div>
            <div className="daybook-tx-list">
              {data.entries.map((d: any) => (
                <button
                  type="button"
                  key={d.id}
                  className={`daybook-tx-row kind-${d.kind}`}
                  onClick={() => open("invoice", d)}
                >
                  <span className="daybook-tx-ref">
                    <strong>{d.number}</strong>
                    <small>{d.party_name || d.note || EM_DASH}</small>
                  </span>
                  <Badge
                    tone={
                      d.kind === "sale"
                        ? "green"
                        : d.kind === "expense"
                          ? "red"
                          : "gray"
                    }
                  >
                    {daybookKindLabel(d.kind, t)}
                  </Badge>
                  <strong className="daybook-tx-total">{af(d.total)}</strong>
                  <span
                    className={`daybook-tx-cash ${d.cash_change > 0 ? "amt-up" : d.cash_change < 0 ? "amt-down" : ""}`}
                  >
                    {d.cash_change > 0
                      ? `+${af(d.cash_change)}`
                      : d.cash_change < 0
                        ? `−${af(-d.cash_change)}`
                        : EM_DASH}
                  </span>
                </button>
              ))}
            </div>
            {!data.entries.length && (
              <Empty
                title={t("daybook.quietTitle")}
                text={t("daybook.quietText")}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
export function ReportsPage({ refresh, open, toast }: PageProps) {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(businessDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(businessDate()),
    [tab, setTab] = useState<ReportTabId>("profitLoss");
  const { data, error } = useLoad<any>("reports", { from, to }, refresh);
  const { data: inventoryReport, error: inventoryError } = useLoad<any>(
    "inventoryReports",
    {},
    refresh,
  );
  const { data: capitalReport, error: capitalError } = useLoad<any>(
    tab === "capitalNet" ? "capitalReport" : "status",
    tab === "capitalNet" ? { to } : {},
    refresh,
  );
  function exportReport() {
    let rows: any[] = [];
    if (tab === "inventoryVal" || tab === "stockAging") {
      exportCSV(
        "vault-" + tab,
        inventoryReport?.stock.map((p: any) => ({
          name: p.name,
          sku: p.sku,
          stock: p.stock,
          value_AF: p.value / 100,
          oldest_receipt: p.oldest || "",
        })) || [],
      );
      toast(t("reports.inventoryExported"));
      return;
    }
    if (tab === "receivables" || tab === "payables") {
      exportCSV(
        "vault-" + tab,
        (tab === "receivables"
          ? inventoryReport?.customers
          : inventoryReport?.suppliers
        )?.map((p: any) => ({
          name: p.name,
          phone: p.phone,
          balance_AF: p.balance / 100,
          overdue_AF: p.overdue / 100,
        })) || [],
      );
      toast(t("reports.balanceExported"));
      return;
    }
    if (tab === "profitLoss")
      rows = [
        { metric: "Net sales", amount_AF: data.totals.sales / 100 },
        { metric: "Cost of goods sold", amount_AF: data.totals.cogs / 100 },
        { metric: "Gross profit", amount_AF: data.totals.gross / 100 },
        { metric: "Expenses", amount_AF: data.totals.expenses / 100 },
        { metric: "Other income", amount_AF: data.totals.other / 100 },
        { metric: "Net profit", amount_AF: data.totals.net / 100 },
      ];
    else if (tab === "daily")
      rows = data.days.map((d: any) => ({
        date: d.date,
        sales_AF: d.sales / 100,
        cost_AF: d.cogs / 100,
        expenses_AF: d.expenses / 100,
        net_profit_AF: (d.sales - d.cogs - d.expenses + d.other) / 100,
      }));
    else if (tab === "productProfit")
      rows = data.best.map((p: any) => ({
        product: p.name,
        quantity: p.quantity,
        revenue_AF: p.revenue / 100,
        cost_AF: p.cost / 100,
        profit_AF: (p.revenue - p.cost) / 100,
      }));
    else if (tab === "expenseBreak")
      rows = data.expenses.map((r: any) => ({
        category: r.category,
        amount_AF: r.amount / 100,
      }));
    else if (tab === "capitalNet") {
      exportCSV(
        "vault-capital-net-worth",
        capitalReport?.months.map((m: any) => ({
          month: m.month,
          invested_AF: m.invested / 100,
          withdrawn_AF: m.withdrawn / 100,
          profit_AF: m.profit / 100,
          capital_AF: m.capital / 100,
          net_worth_AF: m.net_worth / 100,
          change_AF: m.change / 100,
        })) || [],
      );
      toast(t("reports.capitalExported"));
      return;
    } else
      rows = data.trial.map((r: any) => ({
        account: localizedAccountName(r.account, t),
        debit_AF: r.debit / 100,
        credit_AF: r.credit / 100,
        balance_AF: r.balance / 100,
      }));
    exportCSV("vault-" + tab, rows);
    toast(t("reports.exported"));
  }
  return (
    <div className="page-content">
      <PageIntro
        eyebrow={t("reports.title")}
        title={t("reports.title")}
        description={t("reports.description")}
        action={
          <div className="date-range">
            <input
              aria-label={t("reports.startDate")}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>{t("ui.to")}</span>
            <input
              aria-label={t("reports.endDate")}
              type="date"
              value={to}
              max={businessDate()}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        }
      />
      <ErrorMessage error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="metrics-row four">
            <Metric
              label={t("reports.netSales")}
              value={af(data.totals.sales)}
            />
            <Metric label={t("reports.cogs")} value={af(data.totals.cogs)} />
            <Metric
              label={t("reports.grossProfit")}
              value={af(data.totals.gross)}
            />
            <Metric
              label={t("reports.netProfit")}
              value={af(data.totals.net)}
              dark
            />
          </div>
          <section className="panel report-panel">
            <div className="report-tabs">
              {REPORT_TAB_IDS.map((tabId) => (
                <button
                  key={tabId}
                  className={tabId === tab ? "active" : ""}
                  onClick={() => setTab(tabId)}
                >
                  {t(`reports.${tabId}`)}
                </button>
              ))}
            </div>
            <div className="panel-heading padded">
              <div>
                <h3>{t(`reports.${tab}`)}</h3>
                <p className="subtle">
                  {tab === "balanceSheet" ||
                  tab === "trialBalance" ||
                  tab === "capitalNet"
                    ? t("ui.asOf", { date: to })
                    : `${from} — ${to}`}{" "}
                  · {t("common.afn")}
                </p>
              </div>
              <ExportButton onClick={exportReport} />
            </div>
            {(tab === "inventoryVal" || tab === "stockAging") && (
              <>
                <ErrorMessage error={inventoryError} />
                <p className="table-note">{t("reports.stockNote")}</p>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t("reports.colProduct")}</th>
                        <th>{t("reports.colQuantity")}</th>
                        <th>{t("reports.colInventoryValue")}</th>
                        <th>{t("reports.colOldestReceipt")}</th>
                        <th>{t("reports.colAge")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryReport?.stock.map((p: any) => (
                        <tr key={p.id}>
                          <td>
                            <ProductName product={p} />
                          </td>
                          <td>{p.stock}</td>
                          <td>{af(p.value, 2)}</td>
                          <td>{p.oldest || EM_DASH}</td>
                          <td>
                            {p.oldest
                              ? t("reports.ageDays", {
                                  n: Math.max(
                                    0,
                                    Math.floor(
                                      (Date.parse(businessDate()) -
                                        Date.parse(p.oldest)) /
                                        86400000,
                                    ),
                                  ),
                                })
                              : EM_DASH}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {(tab === "receivables" || tab === "payables") && (
              <>
                <ErrorMessage error={inventoryError} />
                <p className="table-note">{t("reports.debtNote")}</p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("reports.colContact")}</th>
                      <th>{t("common.phone")}</th>
                      <th>{t("common.outstanding")}</th>
                      <th>{t("reports.colOverdue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "receivables"
                      ? inventoryReport?.customers
                      : inventoryReport?.suppliers
                    )?.map((p: any) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.phone || EM_DASH}</td>
                        <td>{af(p.balance, 2)}</td>
                        <td className={p.overdue ? "text-red" : ""}>
                          {af(p.overdue, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {tab === "profitLoss" && (
              <div className="profit-report">
                <div>
                  <span>{t("reports.plNetSalesRevenue")}</span>
                  <strong>{af(data.totals.sales, 2)}</strong>
                </div>
                <div>
                  <span>{t("reports.plLessCogs")}</span>
                  <strong>({af(data.totals.cogs, 2)})</strong>
                </div>
                <div className="subtotal">
                  <span>{t("reports.plGrossTrading")}</span>
                  <strong>{af(data.totals.gross, 2)}</strong>
                </div>
                <div>
                  <span>{t("reports.plOtherIncomeStock")}</span>
                  <strong>{af(data.totals.other, 2)}</strong>
                </div>
                <div>
                  <span>{t("reports.plOpExpensesStock")}</span>
                  <strong>({af(data.totals.expenses, 2)})</strong>
                </div>
                <div className="total">
                  <span>{t("reports.netProfit")}</span>
                  <strong>{af(data.totals.net, 2)}</strong>
                </div>
                <p>{t("reports.plFootnote")}</p>
              </div>
            )}
            {tab === "daily" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("common.date")}</th>
                      <th>{t("reports.colSales")}</th>
                      <th>{t("reports.colCogsShort")}</th>
                      <th>{t("reports.grossProfit")}</th>
                      <th>{t("reports.operatingExpenses")}</th>
                      <th>{t("reports.netProfit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d: any) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td>{af(d.sales)}</td>
                        <td>{af(d.cogs)}</td>
                        <td>{af(d.sales - d.cogs)}</td>
                        <td>{af(d.expenses)}</td>
                        <td>
                          <strong>
                            {af(d.sales - d.cogs - d.expenses + d.other)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === "productProfit" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("reports.colProduct")}</th>
                      <th>{t("reports.colUnitsSoldNet")}</th>
                      <th>{t("reports.colRevenue")}</th>
                      <th>{t("reports.colCogsShort")}</th>
                      <th>{t("reports.grossProfit")}</th>
                      <th>{t("reports.colMargin")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.best.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          <ProductName product={p} sub={p.category} />
                        </td>
                        <td>{p.quantity}</td>
                        <td>{af(p.revenue)}</td>
                        <td>{af(p.cost)}</td>
                        <td>{af(p.revenue - p.cost)}</td>
                        <td>
                          {p.revenue
                            ? (
                                ((p.revenue - p.cost) / p.revenue) *
                                100
                              ).toFixed(1)
                            : "0"}
                          %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="table-note">{t("reports.topProductsNote")}</p>
              </div>
            )}
            {tab === "trialBalance" && (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("reports.colAccount")}</th>
                      <th>{t("reports.colTotalDebits")}</th>
                      <th>{t("reports.colTotalCredits")}</th>
                      <th>{t("reports.colNetBalance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trial.map((r: any) => (
                      <tr key={r.account}>
                        <td>{localizedAccountName(r.account, t)}</td>
                        <td>{af(r.debit, 2)}</td>
                        <td>{af(r.credit, 2)}</td>
                        <td>{af(r.balance, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("common.total")}</td>
                      <td>
                        {af(
                          data.trial.reduce(
                            (s: number, r: any) => s + r.debit,
                            0,
                          ),
                          2,
                        )}
                      </td>
                      <td>
                        {af(
                          data.trial.reduce(
                            (s: number, r: any) => s + r.credit,
                            0,
                          ),
                          2,
                        )}
                      </td>
                      <td>
                        {af(
                          data.trial.reduce(
                            (s: number, r: any) => s + r.balance,
                            0,
                          ),
                          2,
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
            {tab === "balanceSheet" && (
              <div className="balance-sheet">
                {(() => {
                  const bal = (a: string) =>
                    data.trial.find((r: any) => r.account === a)?.balance || 0;
                  const profit = -[
                    "sales",
                    "cost_of_goods",
                    "expenses",
                    "other_income",
                  ].reduce((s, a) => s + bal(a), 0);
                  const assets =
                      bal("cash") + bal("receivables") + bal("inventory"),
                    liabilities = -bal("payables"),
                    equity = -bal("equity") + profit;
                  return (
                    <>
                      <div className="profit-report">
                        <h3>{t("reports.bsAssets")}</h3>
                        {["cash", "receivables", "inventory"].map((a) => (
                          <div key={a}>
                            <span>{localizedAccountName(a, t)}</span>
                            <strong>{af(bal(a), 2)}</strong>
                          </div>
                        ))}
                        <div className="subtotal">
                          <span>{t("capital.totalAssets")}</span>
                          <strong>{af(assets, 2)}</strong>
                        </div>
                        <h3>{t("reports.bsLiabilitiesEquity")}</h3>
                        <div>
                          <span>{t("reports.bsSupplierPayables")}</span>
                          <strong>{af(liabilities, 2)}</strong>
                        </div>
                        <div>
                          <span>{t("reports.bsOwnerEquity")}</span>
                          <strong>{af(-bal("equity"), 2)}</strong>
                        </div>
                        <div>
                          <span>{t("reports.bsCumulativeEarnings")}</span>
                          <strong>{af(profit, 2)}</strong>
                        </div>
                        <div className="total">
                          <span>{t("reports.bsTotalLiabEquity")}</span>
                          <strong>{af(liabilities + equity, 2)}</strong>
                        </div>
                        <Badge
                          tone={
                            assets === liabilities + equity ? "green" : "red"
                          }
                        >
                          {assets === liabilities + equity
                            ? t("reports.balanced")
                            : t("reports.reconNeeded")}
                        </Badge>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {tab === "capitalNet" && (
              <>
                <ErrorMessage error={capitalError} />
                {!capitalReport?.current ? (
                  <Loading />
                ) : (
                  <>
                    <div className="metrics-row four report-inline-metrics">
                      <Metric
                        label={t("capital.netWorth")}
                        value={af(capitalReport.current.net_worth)}
                        dark
                      />
                      <Metric
                        label={t("reports.ownerCapital")}
                        value={af(capitalReport.current.capital)}
                      />
                      <Metric
                        label={t("reports.earningsKept")}
                        value={af(capitalReport.current.earnings)}
                      />
                      <Metric
                        label={t("capital.cash")}
                        value={af(capitalReport.current.cash)}
                      />
                    </div>
                    <p className="table-note">{t("reports.capitalNetNote")}</p>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t("capital.month")}</th>
                            <th>{t("reports.colInvested")}</th>
                            <th>{t("reports.colWithdrawn")}</th>
                            <th>{t("capital.profit")}</th>
                            <th>{t("capital.netWorth")}</th>
                            <th>{t("capital.change")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {capitalReport.months.map((m: any) => (
                            <tr key={m.month}>
                              <td>{monthLabel(m.month, locale)}</td>
                              <td>{m.invested ? af(m.invested) : EM_DASH}</td>
                              <td>{m.withdrawn ? af(m.withdrawn) : EM_DASH}</td>
                              <td>{af(m.profit)}</td>
                              <td>
                                <strong>{af(m.net_worth)}</strong>
                              </td>
                              <td
                                className={
                                  m.change > 0
                                    ? "text-green"
                                    : m.change < 0
                                      ? "text-red"
                                      : ""
                                }
                              >
                                {m.change > 0 ? "+" : ""}
                                {af(m.change)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
            {tab === "expenseBreak" && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("expenses.category")}</th>
                    <th>{t("dashboard.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((r: any) => (
                    <tr key={r.category}>
                      <td>{r.category}</td>
                      <td>{af(r.amount, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export function BackupsPage({ refresh, toast }: PageProps) {
  const t = useT();
  const { data, error } = useLoad<any>("backups", {}, refresh);
  const [destinations, setDestinations] = useState<string[]>([]),
    [path, setPath] = useState(""),
    [localError, setLocalError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [runs, setRuns] = useState<any[]>([]);
  useEffect(() => {
    if (data) {
      setDestinations(data.config.destinations);
      setRuns(data.runs);
    }
  }, [data]);
  useEffect(() => {
    if (version) api("backups").then((d) => setRuns(d.runs));
  }, [version]);
  async function save(list: string[]) {
    setLocalError("");
    try {
      await api("backupSettings", { destinations: list });
      setDestinations(list);
      toast(t("backups.destinationsSaved"));
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  async function run() {
    setBusy(true);
    setLocalError("");
    try {
      const result = await api("backupCreate");
      const failed = result.results.filter((r: any) => r.status === "failed");
      if (failed.length)
        setLocalError(
          failed.map((r: any) => `${r.path}: ${r.message}`).join(" · "),
        );
      else toast(t("backups.verified"));
      setVersion((v) => v + 1);
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function pick() {
    try {
      const dir = await window.vault?.pickFolder();
      if (dir) await save([...destinations, dir]);
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  async function schedule() {
    setBusy(true);
    try {
      if (!window.vault)
        throw new Error(t("backups.scheduleDesktop"));
      await window.vault.installSchedule(getToken());
      toast(t("backups.scheduleInstalled"));
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(r: any) {
    try {
      const result = await api("backupVerify", { path: r.path });
      toast(
        t("backups.verifyDetail", {
          products: result.products,
          documents: result.documents,
        }),
      );
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  async function restore() {
    setLocalError("");
    try {
      if (!window.vault)
        throw new Error(t("backups.restoreDesktop"));
      const backup = await window.vault.pickBackup();
      if (!backup) return;
      const result = await window.vault.restore(backup, getToken());
      if (!result.cancelled) toast(t("toast.backupRestored"));
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  return (
    <div className="page-content">
      <PageIntro
        eyebrow={t("backups.eyebrow")}
        title={t("backups.title")}
        description={t("backups.description")}
        action={
          <button
            className="button button-dark"
            disabled={busy || !destinations.length}
            onClick={run}
          >
            <ArrowClockwiseIcon size={16} className={busy ? "spin" : ""} />
            {busy ? t("common.loading") : t("backups.runNow")}
          </button>
        }
      />
      <ErrorMessage error={error || localError} />
      <div className="metrics-row">
        <Metric
          label={t("backups.schedule")}
          value={t("backups.every24")}
          detail={t("backups.scheduleDetail")}
        />
        <Metric
          label={t("backups.dailyHistory")}
          value={t("backups.retentionDays")}
          detail={t("backups.oneSnapshot")}
        />
        <Metric
          label={t("backups.lastFullCopy")}
          value={
            data?.config.lastSuccess
              ? new Date(data.config.lastSuccess).toLocaleDateString()
              : t("backups.never")
          }
          detail={t("backups.destinationsVerifyHint")}
        />
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <h3>
              <HardDrivesIcon size={18} />
              {t("backups.destinations")}
            </h3>
            <Badge tone="gray">
              {t("backups.foldersCount", { n: destinations.length })}
            </Badge>
          </div>
          <p className="muted">{t("backups.destinationsIntro")}</p>
          <div className="destination-list">
            {destinations.map((d, i) => (
              <div key={d}>
                <FolderIcon size={21} />
                <span>{d}</span>
                <button
                  className="text-button"
                  onClick={() => save(destinations.filter((_, j) => j !== i))}
                >
                  {t("common.remove")}
                </button>
              </div>
            ))}
          </div>
          {window.vault ? (
            <button className="button" onClick={pick}>
              <PlusIcon size={15} />
              {t("backups.chooseFolder")}
            </button>
          ) : (
            <form
              className="inline-actions"
              onSubmit={(e) => {
                e.preventDefault();
                if (path.trim()) {
                  save([...destinations, path.trim()]);
                  setPath("");
                }
              }}
            >
              <input
                aria-label={t("backups.folderPathAria")}
                placeholder={t("backups.folderPathPh")}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
              />
              <button className="button" type="submit">
                <PlusIcon size={15} />
                {t("backups.addFolder")}
              </button>
            </form>
          )}
          <div className="info-box">
            <ShieldCheckIcon size={18} />
            <p>{t("backups.securityTip")}</p>
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <h3>
              <ClockIcon size={18} />
              {t("backups.scheduleRestore")}
            </h3>
          </div>
          <p className="muted">{t("backups.scheduleRestoreHint")}</p>
          <button className="button full" disabled={busy} onClick={schedule}>
            {t("backups.installScheduleBtn")} <ArrowRightIcon size={15} />
          </button>
          <div className="divider" />
          <h3>{t("backups.restoreSectionTitle")}</h3>
          <p className="muted">{t("backups.restoreSectionHint")}</p>
          <button className="button full" onClick={restore}>
            <DatabaseIcon size={16} />
            {t("backups.chooseBackupRestore")}
          </button>
          <small className="subtle">{t("backups.encryptionTip")}</small>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading padded">
          <h3>{t("backups.historyTitle")}</h3>
          <span className="subtle">{t("backups.historyLatest")}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("backups.colCreated")}</th>
                <th>{t("backups.colDestination")}</th>
                <th>{t("backups.colSize")}</th>
                <th>{t("common.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td className="path-cell" title={r.path}>
                    {r.path}
                    <small className="block muted">{r.message}</small>
                  </td>
                  <td>
                    {r.size
                      ? t("backups.sizeMb", {
                          size: (r.size / 1024 / 1024).toFixed(2),
                        })
                      : EM_DASH}
                  </td>
                  <td>
                    <Badge tone={r.status === "verified" ? "green" : "red"}>
                      {backupStatusLabel(r.status, t)}
                    </Badge>
                  </td>
                  <td>
                    {r.status === "verified" && (
                      <button className="text-button" onClick={() => verify(r)}>
                        {t("backups.verifyBtn")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!runs.length && (
          <Empty
            title={t("backups.emptyRecoveryTitle")}
            text={t("backups.emptyRecoveryText")}
          />
        )}
      </section>
    </div>
  );
}
export function SettingsPage({ refresh, open, toast, user }: PageProps) {
  const { t, locale, setLocale } = useI18n();
  const { data, error } = useLoad<any>("settings", {}, refresh),
    { data: users } = useLoad<any[]>(
      user.permissions.includes("users") ? "users" : "status",
      {},
      refresh,
    );
  const [tab, setTab] = useState("store"),
    [localError, setLocalError] = useState(""),
    [busy, setBusy] = useState(false),
    [audit, setAudit] = useState<any[]>([]),
    [logo, setLogo] = useState(""),
    [language, setLanguage] = useState<Locale>(locale);
  useEffect(() => {
    setLogo(data?.store?.logo || "");
    const lang = data?.store?.language;
    if (lang === "en" || lang === "ps" || lang === "prs") setLanguage(lang);
  }, [data?.store?.logo, data?.store?.language, refresh]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      const f = new FormData(e.currentTarget);
      await api("saveSettings", {
        name: f.get("name"),
        phone: f.get("phone"),
        address: f.get("address"),
        email: f.get("email"),
        bill_footer: f.get("bill_footer"),
        logo,
        language,
      });
      setLocale(language);
      toast(t("settings.saved"));
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function onLogoFile(file: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      setLocalError(t("settings.logoFileType"));
      return;
    }
    if (file.size > 600_000) {
      setLocalError(t("settings.logoTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (result.length > 900_000) {
        setLocalError(t("settings.logoEncodeLarge"));
        return;
      }
      setLocalError("");
      setLogo(result);
    };
    reader.onerror = () => setLocalError(t("settings.logoReadFailed"));
    reader.readAsDataURL(file);
  }
  async function toggle(u: any) {
    try {
      await api("userUpdate", { id: u.id, active: !u.active });
      toast(u.active ? t("toast.userDisabled") : t("toast.userEnabled"));
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  const settingsTabs = [
    { id: "store", label: t("settings.tabStore") },
    ...(user.permissions.includes("users")
      ? [
          { id: "users", label: t("settings.tabUsers") },
          { id: "audit", label: t("settings.tabAudit") },
        ]
      : []),
    { id: "accounting", label: t("settings.tabAccounting") },
  ];
  return (
    <div className="page-content">
      <PageIntro
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        description={t("settings.description")}
      />
      <ErrorMessage error={error || localError} />
      <section className="panel">
        <div className="report-tabs">
          {settingsTabs.map((tabItem) => (
            <button
              key={tabItem.id}
              className={tab === tabItem.id ? "active" : ""}
              onClick={() => {
                setTab(tabItem.id);
                if (tabItem.id === "audit")
                  api<any[]>("audit")
                    .then(setAudit)
                    .catch((e) => setLocalError(e.message));
              }}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
        {tab === "store" && data && (
          <form className="settings-form" onSubmit={save} key={refresh}>
            <Field label={t("language.label")} hint={t("language.hint")}>
              <select
                value={language}
                onChange={(e) => {
                  const next = e.target.value as Locale;
                  setLanguage(next);
                  setLocale(next);
                }}
              >
                {LOCALES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nativeLabel} — {t(`language.${l.id}`)}
                  </option>
                ))}
              </select>
            </Field>
            <h3>{t("settings.billDesign")}</h3>
            <p className="muted">{t("settings.billDesignHint")}</p>
            <Field label={t("settings.businessName")}>
              <input
                name="name"
                defaultValue={data.store.name}
                required
                minLength={2}
              />
            </Field>
            <Field label={t("settings.logo")}>
              <div className="bill-logo-preview">
                {logo ? (
                  <img src={logo} alt="" />
                ) : (
                  <span className="muted">{t("settings.noLogo")}</span>
                )}
              </div>
              <div className="bill-logo-actions">
                <label className="button">
                  {t("settings.chooseImage")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      onLogoFile(e.target.files?.[0] || null);
                      e.target.value = "";
                    }}
                  />
                </label>
                {logo ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setLogo("")}
                  >
                    {t("settings.removeLogo")}
                  </button>
                ) : null}
              </div>
            </Field>
            <div className="form-grid">
              <Field label={t("common.phone")}>
                <input name="phone" defaultValue={data.store.phone || ""} />
              </Field>
              <Field label={t("common.email")}>
                <input
                  name="email"
                  type="email"
                  defaultValue={data.store.email || ""}
                />
              </Field>
            </div>
            <Field label={t("common.address")}>
              <textarea
                name="address"
                defaultValue={data.store.address || ""}
                rows={2}
              />
            </Field>
            <Field
              label={t("settings.billFooter")}
              hint={t("settings.billFooterHint")}
            >
              <textarea
                name="bill_footer"
                defaultValue={data.store.bill_footer || ""}
                rows={2}
                placeholder={t("settings.billFooterPh")}
              />
            </Field>
            <div className="form-grid">
              <Field label={t("common.currency")}>
                <input value={t("common.afn")} readOnly />
              </Field>
            </div>
            <div className="info-box">
              <CheckCircleIcon size={18} />
              <p>{t("settings.taxNote")}</p>
            </div>
            <button className="button button-dark" disabled={busy}>
              {busy ? t("common.saving") : t("settings.saveBill")}
            </button>
          </form>
        )}
        {tab === "users" && (
          <>
            <div className="panel-heading padded">
              <h3>{t("settings.team")}</h3>
              <button
                className="button button-dark"
                onClick={() => open("user")}
              >
                <PlusIcon size={15} />
                {t("settings.createUser")}
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("common.name")}</th>
                    <th>{t("settings.username")}</th>
                    <th>{t("settings.role")}</th>
                    <th>{t("settings.permissions")}</th>
                    <th>{t("common.status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(users) &&
                    users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          {u.id === user.id && (
                            <small className="block muted">{t("ui.you")}</small>
                          )}
                        </td>
                        <td>{u.username}</td>
                        <td>
                          <Badge tone="gray">{u.role}</Badge>
                        </td>
                        <td className="permissions-cell">
                          {u.permissions.join(", ").replaceAll("_", " ")}
                        </td>
                        <td>
                          <Badge tone={u.active ? "green" : "gray"}>
                            {u.active
                              ? t("settings.active")
                              : t("settings.disabled")}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => open("user", u)}
                          >
                            {t("common.edit")}
                          </button>
                          {u.id !== user.id && (
                            <button
                              className="text-button"
                              onClick={() => toggle(u)}
                            >
                              {u.active
                                ? t("settings.disabled")
                                : t("settings.active")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "audit" && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("settings.auditTime")}</th>
                  <th>{t("settings.auditUser")}</th>
                  <th>{t("settings.auditAction")}</th>
                  <th>{t("settings.auditDetails")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.user_name || t("settings.schedulerUser")}</td>
                    <td>{a.action}</td>
                    <td className="permissions-cell">
                      {JSON.stringify(JSON.parse(a.details))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="table-note">{t("settings.auditFootnote")}</p>
          </div>
        )}
        {tab === "accounting" && (
          <div className="settings-form">
            <h3>{t("settings.periodLockTitle")}</h3>
            <p className="muted">{t("settings.periodLockHint")}</p>
            <p>
              {t("settings.closedThroughLabel")}:{" "}
              <strong>
                {data?.closedThrough || t("settings.noPeriodsLocked")}
              </strong>
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("closePeriod", {
                    date: new FormData(e.currentTarget).get("date"),
                  });
                  toast(t("toast.periodLocked"));
                } catch (e: any) {
                  setLocalError(e.message);
                }
              }}
            >
              <Field label={t("settings.lockThroughDate")}>
                <input type="date" name="date" max={businessDate()} required />
              </Field>
              <button className="button button-dark">
                <LockIcon size={15} />
                {t("settings.lockPeriodBtn")}
              </button>
            </form>
            <div className="divider" />
            <h3>{t("settings.policiesTitle")}</h3>
            <p className="muted">{t("settings.policiesHint")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
export function AlertsDialogContent({
  refresh,
  open,
}: {
  refresh: number;
  open: (name: string, data?: any) => void;
}) {
  const t = useT();
  const { data, error } = useLoad<{ rows: Product[] }>(
    "catalog",
    { filter: "low", limit: 100 },
    refresh,
  );
  return (
    <div className="form-body">
      <p className="muted">{t("alerts.dialogSubtitle")}</p>
      <ErrorMessage error={error} />
      {data?.rows.map((p) => (
        <div className="alert-row" key={p.id}>
          <ProductName product={p} />
          <Badge tone={p.stock === 0 ? "red" : "yellow"}>
            {t("alerts.leftReorder", {
              left: p.stock,
              reorder: p.reorder_level,
            })}
          </Badge>
          <button
            className="text-button"
            onClick={() => open("productDetail", p)}
          >
            {t("common.view")} <ArrowUpRightIcon size={14} />
          </button>
        </div>
      ))}
      {data && !data.rows.length && (
        <Empty
          title={t("alerts.allGood")}
          text={t("alerts.allGoodText")}
        />
      )}
    </div>
  );
}
