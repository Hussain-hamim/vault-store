import { OwnerRecovery } from "./OwnerRecovery";
import { AppearanceSettings } from "../appearance";
import { ProductPhoto } from "./ProductPhoto";
import { CurrencyPicker, CurrencyFlag } from "./CurrencyPicker";
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
  BarcodeIcon,
  WhatsappLogoIcon,
  LockIcon,
  DatabaseIcon,
  HardDrivesIcon,
  TrashIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import {
  api,
  af,
  foreignMoney,
  afnFromAed,
  fxRateLabel,
  exportCSV,
  businessDate,
  getToken,
  productSpecEntries,
  Product,
  Party,
  User,
} from "../api";
import { useI18n, useT, LOCALES, type Locale } from "../i18n";
import { ReportPrintButton } from "../printing/PrintDialog";
import type { PrintDocument } from "../printing/types";
import { BarcodeLabelPrintModal } from "./BarcodeLabelPrint";
import { partyLedgerPrintDocument } from "../printing/party-ledger.mjs";
import { canWhatsApp, shareViaWhatsApp } from "../whatsapp-share";

import { CompanyPage, HelpContent } from "./CompanyPages";
import { expenseAccountName } from "../expense-accounts";

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
  FilterSelect,
  NumericInput,
} from "./ui";
export type PageProps = {
  refresh: number;
  open: (name: string, data?: any) => void;
  toast: (s: string, opts?: { reload?: boolean }) => void;
  user: User;
  globalSearch?: string;
};
function useDebouncedValue<T>(value: T, ms = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
function useLoad<T = any>(command: string, args: unknown, refresh: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [resolved, setResolved] = useState("");
  const key = JSON.stringify(args);
  const signature = JSON.stringify([command, key, refresh]);
  useEffect(() => {
    let active = true;
    setError("");
    api<T>(command, args)
      .then((d) => {
        if (active) {
          setData(d);
          setResolved(signature);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [command, key, refresh]);
  return { data, error, pending: resolved !== signature };
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
  ["Cameras", "cameras"],
  ["Storage", "storage"],
  ["Accessories", "accessories"],
] as const;
export function ProductsPage({
  refresh,
  open,
  toast,
  globalSearch = "",
  initialCategory = "All products",
  user,
}: PageProps & { initialFilter?: string; initialCategory?: string }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState(globalSearch),
    [category, setCategory] = useState(initialCategory),
    [filter, setFilter] = useState("all"),
    [rows, setRows] = useState<Product[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [barcodePrint, setBarcodePrint] = useState(false);
  const searchQ = useDebouncedValue(q, 200);
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
      q: searchQ,
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
  }, [searchQ, category, filter, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Product[]; next: string | null }>(
        "products",
        { q: searchQ, category, filter, after: next, limit: LIST_PAGE },
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
      Cameras: "cat-cameras",
      Storage: "cat-storage",
      Accessories: "cat-accessories",
    })[c] || "cat-default";
  const stockTone = (p: Product) =>
    p.stock === 0 ? "red" : p.stock <= p.reorder_level ? "yellow" : "green";
  function productSpecs(p: Product) {
    return productSpecEntries(p);
  }
  function productUnitCost(p: Product) {
    return p.stock ? (p.cost || 0) / p.stock : p.unit_cost || 0;
  }
  function productPurchaseRate(p: Product) {
    if (!p.fx_rate || (p.currency || "AED") === "AFN") return "";
    return fxRateLabel(p.fx_rate, p.currency || "AED");
  }
  function inventoryDocument() {
    const totalUnits = rows.reduce((sum, p) => sum + (p.stock || 0), 0);
    const stockValue = showCost
      ? rows.reduce((sum, p) => sum + (p.cost || 0), 0)
      : 0;
    const categoryLabel =
      INVENTORY_CATEGORIES.find(([value]) => value === category)?.[1] ||
      "allProducts";
    return {
      kind: "report" as const,
      locale,
      title: t("inventory.title"),
      source: { type: "report" as const, permission: "inventory" as const },
      subtitle: [
        t("printing.loadedRows", { n: rows.length }),
        t(`inventory.${categoryLabel}`),
        filter === "low" ? t("inventory.lowStock") : t("inventory.allStock"),
      ].join(" · "),
      emptyLabel: t("reports.noRows"),
      summary: [
        { label: t("inventory.showingProducts", { n: rows.length }), value: rows.length },
        { label: t("inventory.qty"), value: totalUnits },
        ...(showCost
          ? [
              {
                label: t("reports.colInventoryValue"),
                value: af(stockValue, 2),
              },
            ]
          : []),
      ],
      sections: [
        {
          note: t("printing.loadedOnly"),
          columns: [
            { label: t("invoice.product") },
            { label: t("inventory.category") },
            { label: t("invoice.quantity"), numeric: true },
            ...(showCost
              ? [
                  { label: t("invoice.unitCostAf"), numeric: true },
                  { label: t("inventory.purchaseRate") },
                ]
              : []),
            { label: t("product.sellingPrice"), numeric: true },
          ],
          rows: rows.map((p) => [
            [
              p.name,
              [p.brand, p.model, p.sku].filter(Boolean).join(" · "),
              productSpecEntries(p)
                .map((s) => `${s.key}: ${s.value}`)
                .join(" · "),
            ]
              .filter(Boolean)
              .join("\n"),
            p.category,
            p.stock,
            ...(showCost
              ? [af(productUnitCost(p), 2), productPurchaseRate(p) || EM_DASH]
              : []),
            af(p.price, 2),
          ]),
        },
      ],
    };
  }
  return (
    <div className="page-content inventory-page">
      <PageIntro
        compact
        eyebrow={t("inventory.eyebrow")}
        title={t("inventory.title")}
        description={t("inventory.description")}
        action={
          <div className="page-intro-actions">
            {user.permissions.includes("inventory") && (
              <button
                className="button"
                type="button"
                onClick={() => setBarcodePrint(true)}
              >
                <BarcodeIcon size={16} />
                {t("barcode.printStation")}
              </button>
            )}
            <button
              className="button button-dark"
              onClick={() => open("product")}
            >
              <PlusIcon size={16} />
              {t("inventory.addProduct")}
            </button>
          </div>
        }
      />
      {barcodePrint && (
        <BarcodeLabelPrintModal onClose={() => setBarcodePrint(false)} />
      )}
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
              <FilterSelect
                aria-label={t("inventory.category")}
                value={category}
                onChange={setCategory}
              >
                {INVENTORY_CATEGORIES.map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(`inventory.${key}`)}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                aria-label={t("inventory.stockFilter")}
                value={filter}
                onChange={setFilter}
              >
                <option value="all">{t("inventory.allStock")}</option>
                <option value="low">{t("inventory.lowStock")}</option>
              </FilterSelect>
              <ReportPrintButton
                disabled={loading || !!error}
                getDocument={() => inventoryDocument()}
              />
              <ReportPrintButton
                disabled={loading || !!error}
                intent="pdf"
                getDocument={() => inventoryDocument()}
              />
              <ExportButton
                onClick={() => {
                  exportCSV(
                    "radefy-techmart-products",
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
                        currency,
                        fx_rate,
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
                              purchase_rate:
                                fx_rate && (currency || "AED") !== "AFN"
                                  ? fxRateLabel(fx_rate, currency || "AED")
                                  : "",
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
                          <ProductPhoto product={p} />
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
                        {!!p.consignment_stock && (
                          <small>
                            {t("resale.customerOwnedCount", {
                              n: p.consignment_stock,
                            })}
                          </small>
                        )}
                      </div>
                      {showCost && (
                        <div className="inventory-row-meta inventory-row-cost">
                          <strong>{af(unitCost, 2)}</strong>
                          {productPurchaseRate(p) ? (
                            <small className="inventory-cost-rate">
                              {productPurchaseRate(p)}
                            </small>
                          ) : null}
                          <small>
                            {p.stock
                              ? t("inventory.fifoAvg")
                              : t("inventory.lastBuy")}
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
              <span>{t("inventory.showingProducts", { n: rows.length })}</span>
              {next ? (
                <button
                  className="button button-dark"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? t("common.loading") : t("pagination.loadMore")}
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
  const { t, locale } = useI18n();
  const [q, setQ] = useState(globalSearch),
    [accountId, setAccountId] = useState(""),
    [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [monthTotal, setMonthTotal] = useState<number | null>(null),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState("");
  const searchQ = useDebouncedValue(q, 200);
  useEffect(() => {
    setQ(globalSearch);
  }, [globalSearch]);
  useEffect(() => {
    if (kind !== "expense") {
      setAccounts([]);
      setAccountId("");
      setMonthTotal(null);
      return;
    }
    let active = true;
    api<{ rows: { id: string; name: string }[] }>("expenseAccounts")
      .then((d) => {
        if (active) setAccounts(d.rows);
      })
      .catch(() => {
        if (active) setAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [kind, refresh]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    api<any>("documents", {
      kind,
      q: searchQ,
      limit: LIST_PAGE,
      ...(kind === "expense" && accountId
        ? { expense_account_id: accountId }
        : {}),
    })
      .then((d) => {
        if (!active) return;
        setRows(d.rows);
        setNext(d.next);
        if (kind === "expense") setMonthTotal(Number(d.month_total) || 0);
        else setMonthTotal(null);
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
  }, [kind, searchQ, accountId, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<any>("documents", {
        kind,
        q: searchQ,
        after: next,
        limit: LIST_PAGE,
        ...(kind === "expense" && accountId
          ? { expense_account_id: accountId }
          : {}),
      });
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...d.rows.filter((r: any) => !seen.has(r.id))];
      });
      setNext(d.next);
      if (kind === "expense" && d.month_total !== undefined)
        setMonthTotal(Number(d.month_total) || 0);
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
          <div className="inline-actions">
            {kind === "expense" && (
              <button
                className="button"
                onClick={() => open("expenseAccounts")}
              >
                {t("expenseAccounts.title")}
              </button>
            )}
            <button className="button button-dark" onClick={() => open(kind)}>
              <PlusIcon size={16} />
              {kind === "sale"
                ? t("documents.newSale")
                : kind === "purchase"
                  ? t("documents.receivePurchase")
                  : t("documents.recordExpense")}
            </button>
          </div>
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
            <div className="toolbar-right">
              {kind === "expense" && (
                <>
                  <div
                    className="docs-month-total"
                    aria-label={t("expenses.monthTotal")}
                  >
                    <span>{t("expenses.monthTotal")}</span>
                    <strong>{af(monthTotal || 0)}</strong>
                  </div>
                  <FilterSelect
                    aria-label={t("expenses.accountFilter")}
                    value={accountId}
                    onChange={setAccountId}
                  >
                    <option value="">{t("expenses.allAccounts")}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {expenseAccountName(a.name, t)}
                      </option>
                    ))}
                  </FilterSelect>
                </>
              )}
              <ReportPrintButton
                disabled={loading || !!error}
                getDocument={() => ({
                  kind: "report",
                  locale,
                  title: label,
                  source: {
                    type: "report",
                    permission:
                      kind === "sale"
                        ? "sales"
                        : kind === "purchase"
                          ? "purchases"
                          : "finance",
                  },
                  subtitle: t("printing.loadedRows", { n: rows.length }),
                  emptyLabel: t("reports.noRows"),
                  sections: [
                    {
                      note: t("printing.loadedOnly"),
                      columns: [
                        {
                          label:
                            kind === "expense"
                              ? t("expenses.note")
                              : t("documents.reference"),
                        },
                        { label: t("common.date") },
                        { label: partyLabel },
                        { label: t("common.total"), numeric: true },
                        ...(kind === "expense"
                          ? []
                          : [
                              { label: t("common.paid"), numeric: true },
                              {
                                label: t("common.outstanding"),
                                numeric: true,
                              },
                            ]),
                      ],
                      rows: rows.map((d) => [
                        kind === "expense" ? d.note || "" : d.number,
                        d.date,
                        kind === "expense" ? d.category : d.party_name,
                        af(d.total, 2),
                        ...(kind === "expense"
                          ? []
                          : [
                              af(d.paid, 2),
                              af(
                                Math.max(0, d.total - d.paid - d.returned),
                                2,
                              ),
                            ]),
                      ]),
                    },
                  ],
                })}
              />
              <ExportButton
                onClick={() => {
                  exportCSV(
                    `radefy-techmart-${label.toLowerCase()}`,
                    rows.map((d: any) =>
                      kind === "expense"
                        ? {
                            description: d.note || "",
                            date: d.date,
                            category: d.category,
                            total_AF: d.total / 100,
                          }
                        : {
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
                          },
                    ),
                  );
                  toast(t("documents.exported"));
                }}
              />
            </div>
          </div>
          <div className="docs-list-cols" role="row">
            <span>
              {kind === "expense"
                ? t("expenses.note")
                : t("documents.reference")}
            </span>
            <span>{t("common.date")}</span>
            <span>{partyLabel}</span>
            <span>{t("common.total")}</span>
            {kind !== "expense" && <span>{t("common.outstanding")}</span>}
            {kind === "sale" && <span>{t("sales.newBalance")}</span>}
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
                      {kind === "expense" ? (
                        d.note ? (
                          <strong>{d.note}</strong>
                        ) : null
                      ) : (
                        <>
                          <strong>{d.number}</strong>
                          {d.note ? <small>{d.note}</small> : null}
                          {d.returned > 0 && (
                            <small className="docs-return-note">
                              {t("invoiceActions.returnedQty", {
                                n: af(d.returned),
                              })}
                            </small>
                          )}
                        </>
                      )}
                    </div>
                    <div className="docs-row-meta">
                      <span className="docs-row-date">{d.date}</span>
                    </div>
                    <div className="docs-row-meta">
                      <span className="docs-row-party">
                        {kind === "expense" ? (
                          d.category || t("expenses.title")
                        ) : (
                          <strong>{d.party_name || EM_DASH}</strong>
                        )}
                      </span>
                      {kind !== "expense" && d.party_phone ? (
                        <small>
                          <bdi dir="ltr">{d.party_phone}</bdi>
                        </small>
                      ) : null}
                    </div>
                    <div className="docs-row-meta docs-row-money">
                      <strong>{af(d.total)}</strong>
                      {kind !== "expense" && (
                        <small>
                          {t("documents.paidAmount", { amount: af(d.paid) })}
                        </small>
                      )}
                      {kind === "sale" &&
                      d.currency &&
                      d.currency !== "AFN" &&
                      d.fx_rate ? (
                        <small>
                          <bdi dir="ltr">
                            {d.currency} ·{" "}
                            {(d.fx_rate / 10000).toLocaleString("en-US", {
                              maximumFractionDigits: 4,
                            })}
                          </bdi>
                        </small>
                      ) : null}
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
                    {kind === "sale" && (
                      <div className="docs-row-meta docs-row-money">
                        <strong
                          className={
                            (d.party_balance || 0) > 0 ? "text-red" : "text-green"
                          }
                        >
                          {af(d.party_balance || 0)}
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
              <span>{t("ui.showing", { n: rows.length })}</span>
              {next ? (
                <button
                  className="button button-dark"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? t("common.loading") : t("pagination.loadMore")}
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
    consignment_receipt: "resale.receive",
    consignment_return: "resale.returnOwner",
    consignment_payment: "resale.payOwner",
    consignment_recovery: "resale.recover",
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
  const { t, locale } = useI18n();
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [rows, setRows] = useState<Party[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [detailActionError, setDetailActionError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState<string | false>(false),
    [busy, setBusy] = useState(false),
    [ledgerAfter, setLedgerAfter] = useState(""),
    [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  const searchQ = useDebouncedValue(q, 200);
  const canManage = user.permissions.includes("people");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    api<{ rows: Party[]; next: string | null }>("parties", {
      kind,
      q: searchQ,
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
  }, [kind, searchQ, refresh]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Party[]; next: string | null }>("parties", {
        kind,
        q: searchQ,
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
  const {
    data: detail,
    error: detailError,
    pending: detailPending,
  } = useLoad<any>(
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
    setConfirmDelete(false);
    setDetailActionError("");
  }
  const balanceTone = (balance: number) =>
    balance > 0 ? "owed" : balance < 0 ? "credit" : "settled";
  const statusLabel = (balance: number) => {
    const tone = balanceTone(balance);
    if (tone === "owed")
      return kind === "customer" ? t("people.owesYou") : t("people.youOwe");
    if (tone === "credit") return t("people.credit");
    return t("people.settled");
  };
  function contactsDocument(): PrintDocument {
    return {
      kind: "report",
      locale,
      title:
        kind === "customer"
          ? t("people.customersTitle")
          : t("people.suppliersTitle"),
      subtitle: t("people.showingContacts", { n: rows.length }),
      source: { type: "report", permission: "people" },
      emptyLabel: t("reports.noRows"),
      summary: [
        {
          label:
            kind === "customer"
              ? t("people.receivablesLoaded")
              : t("people.payablesLoaded"),
          value: af(total, 2),
        },
      ],
      sections: [
        {
          note: t("printing.loadedOnly"),
          columns: [
            {
              label:
                kind === "customer" ? t("sales.customer") : t("sales.supplier"),
            },
            { label: t("common.phone") },
            { label: t("common.status") },
            { label: t("common.outstanding"), numeric: true },
          ],
          rows: rows.map((p) => [
            p.name,
            p.phone || t("people.noPhone"),
            statusLabel(p.balance),
            af(p.balance, 2),
          ]),
          tones: rows.map((p) => [
            "neutral",
            "neutral",
            balanceTone(p.balance) === "owed"
              ? "negative"
              : balanceTone(p.balance) === "credit"
                ? "positive"
                : "neutral",
            balanceTone(p.balance) === "owed"
              ? "negative"
              : balanceTone(p.balance) === "credit"
                ? "positive"
                : "neutral",
          ]),
        },
      ],
    };
  }
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
          <div className="inline-actions">
            {kind === "customer" &&
              user.permissions.includes("finance") &&
              user.permissions.includes("view_costs") && (
                <button
                  className="button"
                  onClick={() => open("customerResale")}
                >
                  {t("resale.title")}
                </button>
              )}
            <button className="button button-dark" onClick={() => open(kind)}>
              <PlusIcon size={16} />
              {kind === "customer"
                ? t("people.addCustomer")
                : t("people.addSupplier")}
            </button>
          </div>
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
              <div className="toolbar-right">
                <ReportPrintButton
                  disabled={loading || !!error || !rows.length}
                  getDocument={() => contactsDocument()}
                />
                <ReportPrintButton
                  disabled={loading || !!error || !rows.length}
                  intent="pdf"
                  getDocument={() => contactsDocument()}
                />
                <ExportButton
                  onClick={() => {
                    exportCSV(
                      `radefy-techmart-${kind}s`,
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
              <span>{canManage ? t("common.actions") : ""}</span>
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
                  const confirming = confirmDelete === p.id;
                  return (
                    <article
                      key={p.id}
                      role="listitem"
                      className={`people-row balance-${tone}${selected === p.id ? " selected" : ""}${p.walk_in ? " walk-in" : ""}`}
                      onClick={() => selectParty(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectParty(p.id);
                        }
                      }}
                      tabIndex={0}
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
                      <div
                        className="people-row-actions"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {canManage && !p.walk_in ? (
                          confirming ? (
                            <>
                              <button
                                type="button"
                                className="button"
                                disabled={busy}
                                onClick={() => setConfirmDelete(false)}
                              >
                                {t("common.cancel")}
                              </button>
                              <button
                                type="button"
                                className="button button-danger"
                                disabled={busy}
                                onClick={async () => {
                                  setBusy(true);
                                  setDetailActionError("");
                                  try {
                                    await api("partyDelete", { id: p.id });
                                    if (selected === p.id) setSelected(null);
                                    setConfirmDelete(false);
                                    toast(
                                      kind === "customer"
                                        ? t("partyDetail.customerDeleted")
                                        : t("partyDetail.supplierDeleted"),
                                      { reload: true },
                                    );
                                  } catch (e: any) {
                                    setDetailActionError(e.message);
                                    setConfirmDelete(false);
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                <TrashIcon size={14} />
                                {t("common.delete")}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button"
                                disabled={busy}
                                onClick={() => open(kind, p)}
                              >
                                {t("common.edit")}
                              </button>
                              <button
                                type="button"
                                className="button button-danger"
                                disabled={busy}
                                onClick={() => {
                                  if (p.balance !== 0) {
                                    setConfirmDelete(false);
                                    toast(
                                      kind === "customer"
                                        ? t(
                                            "partyDetail.deleteBalanceCustomer",
                                          )
                                        : t(
                                            "partyDetail.deleteBalanceSupplier",
                                          ),
                                    );
                                    return;
                                  }
                                  setDetailActionError("");
                                  setConfirmDelete(p.id);
                                }}
                              >
                                <TrashIcon size={14} />
                                {t("common.delete")}
                              </button>
                            </>
                          )
                        ) : (
                          <span className="people-row-go" aria-hidden="true">
                            <ArrowUpRightIcon size={16} />
                          </span>
                        )}
                      </div>
                    </article>
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
                <span>{t("people.showingContacts", { n: rows.length })}</span>
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
          <section className="panel contact-detail people-detail people-ledger-only">
            <div className="panel-heading">
              <h3>{t("ledger.title")}</h3>
              <div className="inline-actions">
                <ReportPrintButton
                  disabled={!detail?.party || detailPending || !!detailError}
                  getDocument={() =>
                    partyLedgerPrintDocument({
                      party: detail.party,
                      entries: detail.entries,
                      pageStartBalance: detail.page_start_balance,
                      kind,
                      locale,
                      t,
                      money: af,
                      foreignMoney,
                      labelFor: (e: any) => ledgerLabel(e, t),
                    }) as PrintDocument
                  }
                />
                <ReportPrintButton
                  intent="pdf"
                  disabled={!detail?.party || detailPending || !!detailError}
                  getDocument={() =>
                    partyLedgerPrintDocument({
                      party: detail.party,
                      entries: detail.entries,
                      pageStartBalance: detail.page_start_balance,
                      kind,
                      locale,
                      t,
                      money: af,
                      foreignMoney,
                      labelFor: (e: any) => ledgerLabel(e, t),
                    }) as PrintDocument
                  }
                />
                {detail?.party && canWhatsApp(detail.party.phone) && (
                  <button
                    type="button"
                    className="button"
                    disabled={detailPending || !!detailError}
                    onClick={async () => {
                      try {
                        const doc = partyLedgerPrintDocument({
                          party: detail.party,
                          entries: detail.entries,
                          pageStartBalance: detail.page_start_balance,
                          kind,
                          locale,
                          t,
                          money: af,
                          foreignMoney,
                          labelFor: (e: any) => ledgerLabel(e, t),
                        }) as PrintDocument;
                        const result = await shareViaWhatsApp({
                          phone: detail.party.phone,
                          text: t("whatsapp.ledgerText", {
                            name: detail.party.name,
                            balance: af(detail.party.balance, 2),
                          }),
                          document: doc,
                          fileBase: `${detail.party.name}-ledger`,
                          t,
                        });
                        toast(result.message);
                      } catch (e: any) {
                        setDetailActionError(e.message);
                      }
                    }}
                  >
                    <WhatsappLogoIcon size={15} />
                    {t("whatsapp.sendLedger")}
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => setSelected(null)}
                >
                  {t("common.close")}
                </button>
              </div>
            </div>
            <ErrorMessage error={detailError || detailActionError} />
            {!detailPending &&
            !detailError &&
            detail?.party?.id === selected &&
            detail.party.kind === kind ? (
              <div className="contact-ledger">
                <div className="people-ledger-bar">
                  <div
                    className={`people-ledger-balance balance-${balanceTone(detail.party.balance)}`}
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
                  <div className="inline-actions">
                    {detail.party.balance > 0 &&
                      user.permissions.includes("finance") && (
                        <button
                          className="button button-dark"
                          onClick={() => open("payment", detail.party)}
                        >
                          {kind === "customer"
                            ? t("people.receivePayment")
                            : t("people.paySupplier")}
                          <ArrowRightIcon size={15} />
                        </button>
                      )}
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table ledger-table">
                    <thead>
                      <tr>
                        <th className="ledger-col-date">{t("common.date")}</th>
                        <th className="ledger-col-ref">
                          {t("ledger.reference")}
                        </th>
                        <th className="numeric ledger-col-debit">
                          {t("ledger.debit")}
                        </th>
                        <th className="numeric ledger-col-credit">
                          {t("ledger.credit")}
                        </th>
                        <th className="numeric ledger-col-balance">
                          {t("ledger.balance")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((e: any) => (
                        <tr
                          key={e.id}
                          onClick={() =>
                            open("invoice", {
                              id: e.document_id,
                              kind: e.kind,
                            })
                          }
                        >
                          <td className="ledger-col-date">
                            <bdi dir="ltr">{e.date}</bdi>
                          </td>
                          <td className="ledger-col-ref">
                            <strong>{e.label}</strong>
                            {e.number ? (
                              <small className="block muted">
                                <bdi dir="ltr">{e.number}</bdi>
                              </small>
                            ) : null}
                            {["payment", "receipt"].includes(e.kind) &&
                              e.paid_foreign != null && (
                                <small className="block ledger-foreign-payment">
                                  <bdi dir="ltr">
                                    {foreignMoney(e.paid_foreign, e.currency)} →{" "}
                                    {af(
                                      afnFromAed(e.paid_foreign, e.fx_rate),
                                      2,
                                    )}
                                  </bdi>
                                </small>
                              )}
                          </td>
                          <td
                            className={`money ledger-col-debit ${e.debit ? (kind === "customer" ? "text-red" : "text-green") : "muted"}`}
                          >
                            <strong>
                              {e.debit ? af(e.debit) : EM_DASH}
                            </strong>
                          </td>
                          <td
                            className={`money ledger-col-credit ${e.credit ? (kind === "customer" ? "text-green" : "text-red") : "muted"}`}
                          >
                            <strong>
                              {e.credit ? af(e.credit) : EM_DASH}
                            </strong>
                          </td>
                          <td
                            className={`money ledger-col-balance ${e.running > 0 ? "text-red" : "text-green"}`}
                          >
                            <strong>{af(e.running)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              <strong className={c.earnings >= 0 ? "amt-up" : "amt-down"}>
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
                {!!c.consignment_recoverable && (
                  <div className="capital-sit-row">
                    <span>{t("resale.recoverable")}</span>
                    <strong className="amt-recv">
                      {af(c.consignment_recoverable, 2)}
                    </strong>
                  </div>
                )}
                <div className="capital-sit-row sub">
                  <span>{t("capital.totalAssets")}</span>
                  <strong className="amt-worth">{af(c.assets, 2)}</strong>
                </div>
                <div className="capital-sit-row">
                  <span>{t("capital.supplierPayables")}</span>
                  <strong className="amt-down">{af(c.payables, 2)}</strong>
                </div>
                {!!c.consignment_payables && (
                  <div className="capital-sit-row">
                    <span>{t("resale.owedToOwners")}</span>
                    <strong className="amt-down">
                      {af(c.consignment_payables, 2)}
                    </strong>
                  </div>
                )}
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
                <ReportPrintButton
                  getDocument={() => ({
                    kind: "report",
                    locale,
                    title: t("capital.monthlyNetWorth"),
                    subtitle: t("ui.asOf", { date: businessDate() }),
                    source: { type: "report", permission: "finance" },
                    emptyLabel: t("reports.noRows"),
                    summary: [
                      {
                        label: t("reports.ownerCapital"),
                        value: af(c.capital, 2),
                      },
                      {
                        label: t("reports.earningsKept"),
                        value: af(c.earnings, 2),
                      },
                      {
                        label: t("capital.netWorth"),
                        value: af(c.net_worth, 2),
                      },
                    ],
                    sections: [
                      {
                        columns: [
                          { label: t("capital.month") },
                          ...[
                            "capital.colIn",
                            "capital.colOut",
                            "capital.profit",
                            "capital.netWorth",
                            "capital.change",
                          ].map((key) => ({ label: t(key), numeric: true })),
                        ],
                        rows: data.months.map((m: any) => [
                          m.month,
                          af(m.invested, 2),
                          af(m.withdrawn, 2),
                          af(m.profit, 2),
                          af(m.net_worth, 2),
                          af(m.change, 2),
                        ]),
                      },
                    ],
                  })}
                />
                <ExportButton
                  onClick={() => {
                    exportCSV(
                      "radefy-techmart-capital-months",
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
                          <strong className="amt-worth">
                            {af(m.net_worth)}
                          </strong>
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
  const { t, locale } = useI18n();
  const [day, setDay] = useState(businessDate()),
    [counted, setCounted] = useState("");
  const { data, error, pending } = useLoad<any>(
    "dayBook",
    { date: day },
    refresh,
  );
  return (
    <div className="page-content daybook-page">
      <PageIntro
        compact
        eyebrow={t("daybook.eyebrow")}
        title={t("daybook.title")}
        description={t("daybook.description")}
        action={
          <div className="inline-actions">
            <ReportPrintButton
              disabled={!data || pending || !!error}
              getDocument={() => ({
                kind: "report",
                locale,
                title: t("daybook.title"),
                subtitle: day,
                source: { type: "report", permission: "finance" },
                emptyLabel: t("reports.noRows"),
                metadata: [
                  {
                    label: t("daybook.openingCash"),
                    value: af(data.opening, 2),
                    numeric: true,
                  },
                  {
                    label: t("daybook.expectedClosing"),
                    value: af(data.closing, 2),
                    numeric: true,
                  },
                ],
                summary: [
                  {
                    label: t("daybook.dailySales"),
                    value: af(data.totals.sales, 2),
                  },
                  ...(user.permissions.includes("view_costs")
                    ? [
                        {
                          label: t("daybook.grossTrading"),
                          value: af(data.totals.gross, 2),
                        },
                        {
                          label: t("reports.netProfit"),
                          value: af(data.totals.net, 2),
                        },
                      ]
                    : []),
                  {
                    label: t("daybook.expenses"),
                    value: af(data.totals.expenses, 2),
                  },
                  {
                    label: t("daybook.netCashMovement"),
                    value: af(data.totals.cash, 2),
                  },
                ],
                sections: [
                  {
                    columns: [
                      { label: t("documents.reference") },
                      { label: t("documents.party") },
                      { label: t("common.total"), numeric: true },
                      { label: t("daybook.netCashMovement"), numeric: true },
                    ],
                    rows: data.entries.map((d: any) => [
                      d.number,
                      d.party_name || d.note || "—",
                      af(d.total, 2),
                      af(d.cash_change, 2),
                    ]),
                  },
                ],
              })}
            />
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
                  className={data.totals.gross >= 0 ? "amt-up" : "amt-down"}
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
              <strong className={data.totals.cash >= 0 ? "amt-up" : "amt-down"}>
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
                    `radefy-techmart-daily-book-${day}`,
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
                    <strong className="daybook-tx-party">
                      {d.party_name || d.note || EM_DASH}
                    </strong>
                    <small className="daybook-tx-invoice">{d.number}</small>
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
export { ReportsPage } from "./ReportsPage";
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
      if (!window.vault) throw new Error(t("backups.scheduleDesktop"));
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
      if (!window.vault) throw new Error(t("backups.restoreDesktop"));
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
export function SettingsPage({
  refresh,
  open,
  toast,
  user,
  initialTab,
  onSignOut,
  onLanguageChange,
}: PageProps & {
  initialTab?: "about" | "support" | "help" | "backups" | "account";
  onSignOut?: () => void;
  onLanguageChange?: (locale: Locale) => void;
}) {
  const canManage = user.permissions.includes("settings");
  const { t, locale, setLocale } = useI18n();
  const { data, error } = useLoad<any>(
      canManage ? "settings" : "status",
      {},
      refresh,
    ),
    { data: users } = useLoad<any[]>(
      user.permissions.includes("users") ? "users" : "status",
      {},
      refresh,
    );
  const [managedCurrency, setManagedCurrency] = useState("AFN");
  const requestedTab =
    initialTab === "backups" && !user.permissions.includes("backups")
      ? undefined
      : initialTab;
  const [tab, setTab] = useState<string>(requestedTab || "account"),
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
      toast(t("settings.saved"), { reload: true });
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
      toast(u.active ? t("toast.userDisabled") : t("toast.userEnabled"), {
        reload: true,
      });
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  const settingsTabs = [
    { id: "account", label: t("settings.tabAccount") },
    ...(user.role === "Owner" && window.vault?.recovery
      ? [{ id: "recovery", label: t("recovery.title") }]
      : []),
    { id: "appearance", label: t("appearance.title") },
    ...(canManage ? [{ id: "store", label: t("settings.tabStore") }] : []),
    ...(user.permissions.includes("users")
      ? [
          { id: "users", label: t("settings.tabUsers") },
          { id: "audit", label: t("settings.tabAudit") },
        ]
      : []),
    ...(canManage
      ? [{ id: "accounting", label: t("settings.tabAccounting") }]
      : []),
    ...(user.permissions.includes("backups")
      ? [{ id: "backups", label: t("nav.backups") }]
      : []),
    { id: "help", label: t("nav.help") },
    { id: "about", label: t("nav.about") },
    { id: "support", label: t("nav.support") },
  ];
  return (
    <div className={"page-content settings-page settings-section-" + tab}>
      <ErrorMessage error={error || localError} />
      <section className="panel settings-shell">
        <nav
          className="report-tabs settings-navigation"
          aria-label={t("nav.settings")}
        >
          {settingsTabs.map((tabItem) => (
            <button
              key={tabItem.id}
              aria-current={tab === tabItem.id ? "page" : undefined}
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
        </nav>
        <div className="settings-detail">
          {tab === "account" && (
            <div className="settings-form settings-account">
              <div className="settings-account-user">
                <span className="settings-account-avatar">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <small>
                    {user.username} · {user.role}
                  </small>
                </div>
              </div>
              <Field label={t("language.label")} hint={t("language.hint")}>
                <select
                  value={locale}
                  onChange={(e) => {
                    const next = e.target.value as Locale;
                    setLanguage(next);
                    if (onLanguageChange) onLanguageChange(next);
                    else setLocale(next);
                  }}
                  aria-label={t("language.label")}
                >
                  {LOCALES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nativeLabel} — {t(`language.${l.id}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {onSignOut && (
                <div className="settings-account-actions">
                  <button
                    type="button"
                    className="button button-dark"
                    onClick={onSignOut}
                  >
                    <SignOutIcon size={16} />
                    {t("nav.signOut")}
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === "recovery" && user.role === "Owner" && (
            <OwnerRecovery settings />
          )}
          {tab === "appearance" && (
            <AppearanceSettings key={user.id} userId={user.id} />
          )}
          {tab === "backups" && user.permissions.includes("backups") && (
            <BackupsPage
              user={user}
              refresh={refresh}
              open={open}
              toast={toast}
            />
          )}
          {tab === "help" && <HelpContent permissions={user.permissions} />}
          {(tab === "about" || tab === "support") && (
            <CompanyPage
              kind={tab}
              navigate={(id) => setTab(id as "about" | "support")}
              help={() => setTab("help")}
            />
          )}
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
                  <span className="currency-rate-label">
                    <CurrencyFlag code="AFN" />
                    {t("common.afn")}
                  </span>
                </Field>
              </div>
              <Field
                label={t("currencies.manage")}
                hint={t("currencies.baseHint")}
              >
                <CurrencyPicker
                  value={managedCurrency}
                  onChange={setManagedCurrency}
                />
              </Field>
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
                              <small className="block muted">
                                {t("ui.you")}
                              </small>
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
                    toast(t("toast.periodLocked"), { reload: true });
                  } catch (e: any) {
                    setLocalError(e.message);
                  }
                }}
              >
                <Field label={t("settings.lockThroughDate")}>
                  <input
                    type="date"
                    name="date"
                    max={businessDate()}
                    required
                  />
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
        </div>
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
        <Empty title={t("alerts.allGood")} text={t("alerts.allGoodText")} />
      )}
    </div>
  );
}
