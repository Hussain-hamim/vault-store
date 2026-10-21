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
import { api, af, exportCSV, businessDate, Product, Party, User } from "../api";
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
  return (
    <div className="loading-state">
      <ArrowClockwiseIcon size={22} className="spin" />
      Loading your records…
    </div>
  );
}
export function ProductsPage({
  refresh,
  open,
  toast,
  globalSearch = "",
  initialCategory = "All products",
  user,
}: PageProps & { initialFilter?: string; initialCategory?: string }) {
  const [q, setQ] = useState(globalSearch),
    [category, setCategory] = useState(initialCategory),
    [filter, setFilter] = useState("all"),
    [after, setAfter] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setQ(globalSearch);
    setAfter("");
    setHistory([]);
  }, [globalSearch]);
  useEffect(() => {
    setCategory(initialCategory);
    setAfter("");
    setHistory([]);
  }, [initialCategory]);
  const { data, error } = useLoad<{ rows: Product[]; next: string | null }>(
    "products",
    { q, category, filter, after },
    refresh,
  );
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Your catalog"
        title="Every product. One place."
        description="Manage models, specifications and stock levels."
        action={
          <button
            className="button button-dark"
            onClick={() => open("product")}
          >
            <PlusIcon size={16} />
            Add product
          </button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <Search
            value={q}
            onChange={(v) => {
              setQ(v);
              setAfter("");
              setHistory([]);
            }}
          />
          <div className="toolbar-right">
            <select
              aria-label="Product category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setAfter("");
                setHistory([]);
              }}
            >
              {[
                "All products",
                "Computers",
                "Mobiles",
                "Tablets",
                "Storage",
                "Accessories",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Stock filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setAfter("");
                setHistory([]);
              }}
            >
              <option value="all">All stock levels</option>
              <option value="low">Low stock</option>
            </select>
            <ExportButton
              onClick={() => {
                exportCSV(
                  "vault-products",
                  data?.rows.map(
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
                      location,
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
                      location,
                    }),
                  ) || [],
                );
                toast("Current product page exported.");
              }}
            />
          </div>
        </div>
        <ErrorMessage error={error} />
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Company</th>
                    <th>Model</th>
                    <th>Qty</th>
                    {user.permissions.includes("view_costs") && (
                      <th>Unit cost</th>
                    )}
                    <th>Selling price</th>
                    <th>Location</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.id} onClick={() => open("productDetail", p)}>
                      <td>
                        <ProductName product={p} />
                      </td>
                      <td>{p.category}</td>
                      <td>{p.brand}</td>
                      <td>{p.model}</td>
                      <td>
                        <Badge
                          tone={
                            p.stock === 0
                              ? "red"
                              : p.stock <= p.reorder_level
                                ? "yellow"
                                : "green"
                          }
                        >
                          {p.stock} units
                        </Badge>
                      </td>
                      {user.permissions.includes("view_costs") && (
                        <td>
                          <strong>
                            {af(
                              p.stock
                                ? (p.cost || 0) / p.stock
                                : p.unit_cost || 0,
                              2,
                            )}
                          </strong>
                          <small className="block muted">
                            {p.stock ? "Average stock cost" : "Catalog cost"}
                          </small>
                        </td>
                      )}
                      <td>{af(p.price, 2)}</td>
                      <td>{p.location || "—"}</td>
                      <td>
                        <ArrowUpRightIcon size={15} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && (
              <Empty
                title="No matching products"
                text="Try a different search, or add a new product."
              />
            )}
            <div className="pagination">
              <span>{data.rows.length} products on this page</span>
              <button
                className="button"
                disabled={!history.length}
                onClick={() => {
                  setAfter(history.at(-1) || "");
                  setHistory((h) => h.slice(0, -1));
                }}
              >
                Previous
              </button>
              <button
                className="button"
                disabled={!data.next}
                onClick={() => {
                  setHistory((h) => [...h, after]);
                  setAfter(data.next || "");
                }}
              >
                Next <ArrowRightIcon size={13} />
              </button>
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
  const [q, setQ] = useState(globalSearch),
    [after, setAfter] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setQ(globalSearch);
    setAfter("");
  }, [globalSearch]);
  const { data, error } = useLoad<any>(
    "documents",
    { kind, q, after },
    refresh,
  );
  const label =
    kind === "sale" ? "Sales" : kind === "purchase" ? "Purchases" : "Expenses";
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Transactions"
        title={kind === "sale" ? "Invoice history" : label}
        description={
          kind === "sale"
            ? "Invoices, payments and returns, with stock and profit kept in sync."
            : kind === "purchase"
              ? "Receive products, track costs and manage supplier credit."
              : "Keep a clear record of what it costs to run your store."
        }
        action={
          <button className="button button-dark" onClick={() => open(kind)}>
            <PlusIcon size={16} />
            {kind === "sale"
              ? "New sale"
              : kind === "purchase"
                ? "Receive purchase"
                : "Record expense"}
          </button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <Search
            value={q}
            onChange={(s) => {
              setQ(s);
              setAfter("");
            }}
            placeholder="Search invoice number or contact…"
          />
          <ExportButton
            onClick={() => {
              exportCSV(
                `vault-${label.toLowerCase()}`,
                data?.rows.map((d: any) => ({
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
                })) || [],
              );
              toast("Current page exported.");
            }}
          />
        </div>
        <ErrorMessage error={error} />
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>
                      {kind === "expense"
                        ? "Category"
                        : kind === "sale"
                          ? "Customer"
                          : "Supplier"}
                    </th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((d: any) => (
                    <tr key={d.id} onClick={() => open("invoice", d)}>
                      <td>
                        <strong>{d.number}</strong>
                        {d.returned > 0 && (
                          <small className="block muted">
                            {af(d.returned)} returned
                          </small>
                        )}
                      </td>
                      <td>{d.date}</td>
                      <td>{kind === "expense" ? d.category : d.party_name}</td>
                      <td>{af(d.total)}</td>
                      <td>{af(d.paid)}</td>
                      <td>{af(Math.max(0, d.total - d.paid - d.returned))}</td>
                      <td>
                        <Badge
                          tone={
                            d.returned === d.total
                              ? "gray"
                              : d.paid + d.returned >= d.total
                                ? "green"
                                : d.paid
                                  ? "yellow"
                                  : "red"
                          }
                        >
                          {d.returned === d.total
                            ? "Returned"
                            : d.paid + d.returned >= d.total
                              ? "Paid"
                              : d.paid
                                ? "Partial"
                                : "Unpaid"}
                        </Badge>
                      </td>
                      <td>
                        {kind === "sale" ? (
                          <div
                            className="invoice-row-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="text-button"
                              onClick={() => open("invoice", d)}
                            >
                              View / download
                            </button>
                            {["Owner", "Manager"].includes(user.role) && (
                              <>
                                <button
                                  className="text-button"
                                  onClick={() => open("saleEdit", d)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-button danger-text"
                                  onClick={() => open("saleDelete", d)}
                                >
                                  Hard delete
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <ArrowUpRightIcon size={15} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && (
              <Empty
                title={`No ${label.toLowerCase()} yet`}
                text="Your posted transactions will appear here."
              />
            )}
            <div className="pagination">
              <span>{data.rows.length} records on this page</span>
              <button
                className="button"
                disabled={!history.length}
                onClick={() => {
                  setAfter(history.at(-1) || "");
                  setHistory((h) => h.slice(0, -1));
                }}
              >
                Previous
              </button>
              <button
                className="button"
                disabled={!data.next}
                onClick={() => {
                  setHistory((h) => [...h, after]);
                  setAfter(data.next);
                }}
              >
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
export function PeoplePage({
  kind,
  refresh,
  open,
  toast,
  user,
}: PageProps & { kind: "customer" | "supplier" }) {
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [after, setAfter] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const { data, error } = useLoad<{ rows: Party[]; next: string | null }>(
    "parties",
    { kind, q, after },
    refresh,
  );
  const { data: detail, error: detailError } = useLoad<any>(
    selected ? "partyDetail" : "status",
    selected ? { id: selected } : {},
    refresh,
  );
  const signed = (e: any) =>
    kind === "customer" ? e.debit - e.credit : e.credit - e.debit;
  let running =
    (detail?.party?.balance || 0) -
    (detail?.entries || []).reduce((sum: number, e: any) => sum + signed(e), 0);
  const ledgerRows = (detail?.entries || []).map((e: any) => ({
    ...e,
    running: (running += signed(e)),
  }));
  const total = data?.rows.reduce((s, p) => s + p.balance, 0) || 0;
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="People & balances"
        title={kind === "customer" ? "Customers" : "Suppliers"}
        description={
          kind === "customer"
            ? "From walk-in sales to regular customers. Every balance has a history."
            : "Your purchasing partners, payments and outstanding balances."
        }
        action={
          <button className="button button-dark" onClick={() => open(kind)}>
            <PlusIcon size={16} />
            Add {kind}
          </button>
        }
      />
      <div className="metrics-row">
        <Metric
          label={
            kind === "customer"
              ? "Customers on this page"
              : "Suppliers on this page"
          }
          value={String(data?.rows.length || 0)}
        />
        <Metric
          label={
            kind === "customer"
              ? "Receivables on this page"
              : "Payables on this page"
          }
          value={af(total)}
        />
        <Metric label="Currency" value="AFN" detail="Afghan afghani · No tax" />
      </div>
      <div className={`people-layout ${selected ? "has-detail" : ""}`}>
        <section className="panel">
          <div className="list-toolbar">
            <Search
              value={q}
              onChange={(v) => {
                setQ(v);
                setAfter("");
              }}
              placeholder={`Search ${kind}s by name…`}
            />
            <ExportButton
              onClick={() => {
                exportCSV(
                  `vault-${kind}s`,
                  data?.rows.map((p) => ({
                    name: p.name,
                    phone: p.phone,
                    email: p.email,
                    balance_AF: p.balance / 100,
                    credit_limit_AF: p.credit_limit / 100,
                  })) || [],
                );
                toast("Contacts exported.");
              }}
            />
          </div>
          <ErrorMessage error={error} />
          {!data ? (
            <Loading />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{kind === "customer" ? "Customer" : "Supplier"}</th>
                      <th>Phone</th>
                      <th>Outstanding</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((p) => (
                      <tr
                        key={p.id}
                        className={selected === p.id ? "selected-row" : ""}
                        onClick={() => setSelected(p.id)}
                      >
                        <td>
                          <span className="customer-name">
                            <span className="customer-initial large">
                              {p.name.slice(0, 1)}
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>
                                {p.walk_in
                                  ? "Walk-in account"
                                  : p.email || kind}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td>{p.phone || "—"}</td>
                        <td>
                          <span
                            className={p.balance > 0 ? "stock-low" : "muted"}
                          >
                            {af(p.balance)}
                          </span>
                        </td>
                        <td>
                          <ArrowUpRightIcon size={15} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.rows.length && (
                <Empty
                  title={`No ${kind}s found`}
                  text="Add a contact or try a different search."
                />
              )}
              <div className="pagination">
                <span>Up to 100 contacts per page</span>
                <button
                  className="button"
                  disabled={!history.length}
                  onClick={() => {
                    setAfter(history.at(-1) || "");
                    setHistory((h) => h.slice(0, -1));
                  }}
                >
                  Previous
                </button>
                <button
                  className="button"
                  disabled={!data.next}
                  onClick={() => {
                    setHistory((h) => [...h, after]);
                    setAfter(data.next || "");
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
        {selected && (
          <section className="panel contact-detail">
            <div className="panel-heading">
              <h3>Contact & ledger</h3>
              <button className="text-button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <ErrorMessage error={detailError} />
            {detail?.party ? (
              <>
                <div className="contact-summary">
                  <span className="customer-initial avatar-lg">
                    {detail.party.name.slice(0, 1)}
                  </span>
                  <h2>{detail.party.name}</h2>
                  <p>{detail.party.phone || "No phone number"}</p>
                  <p>{detail.party.address || "No address saved"}</p>
                  {user.role === "Owner" && !detail.party.walk_in && (
                    <button
                      className="text-button"
                      onClick={() => open("openingBalance", detail.party)}
                    >
                      Enter opening balance
                    </button>
                  )}
                  <div className="contact-balance">
                    <span>Outstanding balance</span>
                    <strong>{af(detail.party.balance)}</strong>
                  </div>
                  {detail.party.balance > 0 &&
                    user.permissions.includes("finance") && (
                      <button
                        className="button button-dark full"
                        onClick={() => open("payment", detail.party)}
                      >
                        {kind === "customer"
                          ? "Receive payment"
                          : "Pay supplier"}
                        <ArrowRightIcon size={15} />
                      </button>
                    )}
                </div>
                <div className="contact-ledger">
                  <h3>Account ledger</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date / reference</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((e: any) => (
                        <tr
                          key={e.id}
                          onClick={() => open("invoice", { id: e.document_id })}
                        >
                          <td>
                            {e.date}
                            <small className="block muted">{e.number}</small>
                          </td>
                          <td>{af(e.debit)}</td>
                          <td>{af(e.credit)}</td>
                          <td>{af(e.running)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.entries.length && (
                    <p className="muted">
                      No credit activity for this account.
                    </p>
                  )}
                  <p className="subtle">
                    Latest 500 ledger entries. Balance includes all entries.
                  </p>
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
export function DayBookPage({ refresh, open, toast, user }: PageProps) {
  const [day, setDay] = useState(businessDate()),
    [counted, setCounted] = useState("");
  const { data, error } = useLoad<any>("dayBook", { date: day }, refresh);
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Finance"
        title="Daily book"
        description="Sales, trading profit, expenses and cash, all for one day."
        action={
          <div className="inline-actions">
            <input
              aria-label="Daily book date"
              type="date"
              value={day}
              max={businessDate()}
              onChange={(e) => setDay(e.target.value)}
            />
            <button className="button" onClick={() => open("owner")}>
              Owner cash movement
            </button>
            <button
              className="button button-dark"
              onClick={() => open("expense")}
            >
              <PlusIcon size={16} />
              Record expense
            </button>
          </div>
        }
      />
      <ErrorMessage error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="metrics-row four">
            <Metric label="Daily sales" value={af(data.totals.sales)} />
            {user.permissions.includes("view_costs") && (
              <Metric
                label="Gross trading profit"
                value={af(data.totals.gross)}
              />
            )}
            <Metric label="Expenses" value={af(data.totals.expenses)} />
            {user.permissions.includes("view_costs") && (
              <Metric label="Net profit" value={af(data.totals.net)} dark />
            )}
          </div>
          <section className="panel cash-reconciliation">
            <div>
              <span>Opening cash</span>
              <strong>{af(data.opening)}</strong>
            </div>
            <ArrowRightIcon size={18} />
            <div>
              <span>Net cash movement</span>
              <strong>{af(data.totals.cash)}</strong>
            </div>
            <ArrowRightIcon size={18} />
            <div>
              <span>Expected closing cash</span>
              <strong>{af(data.closing)}</strong>
            </div>
            <Field label="Counted cash (AF)">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter counted amount"
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
                Difference:{" "}
                {af(Math.round(Number(counted) * 100) - data.closing, 2)}
              </Badge>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading padded">
              <h3>
                Daily transactions <span>{day}</span>
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
                  toast("Daily book exported.");
                }}
              />
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Contact / description</th>
                    <th>Amount</th>
                    <th>Cash in</th>
                    <th>Cash out</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((d: any) => (
                    <tr key={d.id} onClick={() => open("invoice", d)}>
                      <td>
                        <strong>{d.number}</strong>
                      </td>
                      <td>
                        <Badge
                          tone={
                            d.kind === "sale"
                              ? "green"
                              : d.kind === "expense"
                                ? "red"
                                : "gray"
                          }
                        >
                          {d.kind.replaceAll("_", " ")}
                        </Badge>
                      </td>
                      <td>{d.party_name || d.note}</td>
                      <td>{af(d.total)}</td>
                      <td>{d.cash_change > 0 ? af(d.cash_change) : "—"}</td>
                      <td>{d.cash_change < 0 ? af(-d.cash_change) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.entries.length && (
              <Empty
                title="A quiet day so far"
                text="Sales, payments and expenses for this date will appear here."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
const accountName = (s: string) =>
  ({
    cash: "Cash",
    receivables: "Customer receivables",
    payables: "Supplier payables",
    inventory: "Inventory",
    equity: "Owner equity",
    sales: "Sales revenue",
    cost_of_goods: "Cost of goods sold",
    expenses: "Operating expenses",
    other_income: "Other income",
  })[s] || s;
export function ReportsPage({ refresh, open, toast }: PageProps) {
  const [from, setFrom] = useState(businessDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(businessDate()),
    [tab, setTab] = useState("Profit & loss");
  const { data, error } = useLoad<any>("reports", { from, to }, refresh);
  const { data: inventoryReport, error: inventoryError } = useLoad<any>(
    "inventoryReports",
    {},
    refresh,
  );
  const tabs = [
    "Profit & loss",
    "Daily performance",
    "Product profitability",
    "Trial balance",
    "Balance sheet",
    "Expense breakdown",
    "Inventory valuation",
    "Stock aging",
    "Receivables",
    "Payables",
  ];
  function exportReport() {
    let rows: any[] = [];
    if (["Inventory valuation", "Stock aging"].includes(tab)) {
      exportCSV(
        "vault-" + tab.toLowerCase().replaceAll(" ", "-"),
        inventoryReport?.stock.map((p: any) => ({
          name: p.name,
          sku: p.sku,
          stock: p.stock,
          value_AF: p.value / 100,
          oldest_receipt: p.oldest || "",
        })) || [],
      );
      toast("Current inventory report exported.");
      return;
    }
    if (["Receivables", "Payables"].includes(tab)) {
      exportCSV(
        "vault-" + tab.toLowerCase(),
        (tab === "Receivables"
          ? inventoryReport?.customers
          : inventoryReport?.suppliers
        )?.map((p: any) => ({
          name: p.name,
          phone: p.phone,
          balance_AF: p.balance / 100,
          overdue_AF: p.overdue / 100,
        })) || [],
      );
      toast("Current balance report exported.");
      return;
    }
    if (tab === "Profit & loss")
      rows = [
        { metric: "Net sales", amount_AF: data.totals.sales / 100 },
        { metric: "Cost of goods sold", amount_AF: data.totals.cogs / 100 },
        { metric: "Gross profit", amount_AF: data.totals.gross / 100 },
        { metric: "Expenses", amount_AF: data.totals.expenses / 100 },
        { metric: "Other income", amount_AF: data.totals.other / 100 },
        { metric: "Net profit", amount_AF: data.totals.net / 100 },
      ];
    else if (tab === "Daily performance")
      rows = data.days.map((d: any) => ({
        date: d.date,
        sales_AF: d.sales / 100,
        cost_AF: d.cogs / 100,
        expenses_AF: d.expenses / 100,
        net_profit_AF: (d.sales - d.cogs - d.expenses + d.other) / 100,
      }));
    else if (tab === "Product profitability")
      rows = data.best.map((p: any) => ({
        product: p.name,
        quantity: p.quantity,
        revenue_AF: p.revenue / 100,
        cost_AF: p.cost / 100,
        profit_AF: (p.revenue - p.cost) / 100,
      }));
    else if (tab === "Expense breakdown")
      rows = data.expenses.map((r: any) => ({
        category: r.category,
        amount_AF: r.amount / 100,
      }));
    else
      rows = data.trial.map((r: any) => ({
        account: accountName(r.account),
        debit_AF: r.debit / 100,
        credit_AF: r.credit / 100,
        balance_AF: r.balance / 100,
      }));
    exportCSV("vault-" + tab.toLowerCase().replaceAll(" ", "-"), rows);
    toast("Report exported.");
  }
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Know your numbers"
        title="Reports"
        description="Reconciled reports from posted stock and accounting entries."
        action={
          <div className="date-range">
            <input
              aria-label="Report start date"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>to</span>
            <input
              aria-label="Report end date"
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
            <Metric label="Net sales" value={af(data.totals.sales)} />
            <Metric label="Cost of goods sold" value={af(data.totals.cogs)} />
            <Metric label="Gross profit" value={af(data.totals.gross)} />
            <Metric label="Net profit" value={af(data.totals.net)} dark />
          </div>
          <section className="panel report-panel">
            <div className="report-tabs">
              {tabs.map((t) => (
                <button
                  key={t}
                  className={t === tab ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="panel-heading padded">
              <div>
                <h3>{tab}</h3>
                <p className="subtle">
                  {tab === "Balance sheet" || tab === "Trial balance"
                    ? `As of ${to}`
                    : `${from} — ${to}`}{" "}
                  · Afghan afghani
                </p>
              </div>
              <ExportButton onClick={exportReport} />
            </div>
            {["Inventory valuation", "Stock aging"].includes(tab) && (
              <>
                <ErrorMessage error={inventoryError} />
                <p className="table-note">
                  Current stock · up to 100 products with the highest inventory
                  value. The date range applies to financial reports.
                </p>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Inventory value</th>
                        <th>Oldest available receipt</th>
                        <th>Age</th>
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
                          <td>{p.oldest || "—"}</td>
                          <td>
                            {p.oldest
                              ? Math.max(
                                  0,
                                  Math.floor(
                                    (Date.parse(businessDate()) -
                                      Date.parse(p.oldest)) /
                                      86400000,
                                  ),
                                ) + " days"
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {["Receivables", "Payables"].includes(tab) && (
              <>
                <ErrorMessage error={inventoryError} />
                <p className="table-note">
                  Current outstanding debt · up to 100 contacts with the highest
                  balance. Overdue means an unpaid invoice past its due date.
                </p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Contact</th>
                      <th>Phone</th>
                      <th>Outstanding</th>
                      <th>Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "Receivables"
                      ? inventoryReport?.customers
                      : inventoryReport?.suppliers
                    )?.map((p: any) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.phone || "—"}</td>
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
            {tab === "Profit & loss" && (
              <div className="profit-report">
                <div>
                  <span>Net sales revenue</span>
                  <strong>{af(data.totals.sales, 2)}</strong>
                </div>
                <div>
                  <span>Less: cost of goods sold</span>
                  <strong>({af(data.totals.cogs, 2)})</strong>
                </div>
                <div className="subtotal">
                  <span>Gross trading profit</span>
                  <strong>{af(data.totals.gross, 2)}</strong>
                </div>
                <div>
                  <span>Other income / stock gains</span>
                  <strong>{af(data.totals.other, 2)}</strong>
                </div>
                <div>
                  <span>Operating expenses & stock losses</span>
                  <strong>({af(data.totals.expenses, 2)})</strong>
                </div>
                <div className="total">
                  <span>Net profit</span>
                  <strong>{af(data.totals.net, 2)}</strong>
                </div>
                <p>
                  Customer collections and supplier payments affect cash and
                  balances. Profit uses the revenue and cost recognized on
                  posted transactions.
                </p>
              </div>
            )}
            {tab === "Daily performance" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sales</th>
                      <th>Cost of goods</th>
                      <th>Gross profit</th>
                      <th>Expenses</th>
                      <th>Net profit</th>
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
            {tab === "Product profitability" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Units sold, net</th>
                      <th>Revenue</th>
                      <th>Cost of goods</th>
                      <th>Gross profit</th>
                      <th>Margin</th>
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
                <p className="table-note">
                  Top 100 products by net revenue for this period.
                </p>
              </div>
            )}
            {tab === "Trial balance" && (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Total debits</th>
                      <th>Total credits</th>
                      <th>Net balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trial.map((r: any) => (
                      <tr key={r.account}>
                        <td>{accountName(r.account)}</td>
                        <td>{af(r.debit, 2)}</td>
                        <td>{af(r.credit, 2)}</td>
                        <td>{af(r.balance, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
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
            {tab === "Balance sheet" && (
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
                        <h3>Assets</h3>
                        {["cash", "receivables", "inventory"].map((a) => (
                          <div key={a}>
                            <span>{accountName(a)}</span>
                            <strong>{af(bal(a), 2)}</strong>
                          </div>
                        ))}
                        <div className="subtotal">
                          <span>Total assets</span>
                          <strong>{af(assets, 2)}</strong>
                        </div>
                        <h3>Liabilities & equity</h3>
                        <div>
                          <span>Supplier payables</span>
                          <strong>{af(liabilities, 2)}</strong>
                        </div>
                        <div>
                          <span>Owner equity</span>
                          <strong>{af(-bal("equity"), 2)}</strong>
                        </div>
                        <div>
                          <span>Cumulative earnings</span>
                          <strong>{af(profit, 2)}</strong>
                        </div>
                        <div className="total">
                          <span>Total liabilities & equity</span>
                          <strong>{af(liabilities + equity, 2)}</strong>
                        </div>
                        <Badge
                          tone={
                            assets === liabilities + equity ? "green" : "red"
                          }
                        >
                          {assets === liabilities + equity
                            ? "Balanced"
                            : "Reconciliation needed"}
                        </Badge>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {tab === "Expense breakdown" && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Amount</th>
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
      toast("Backup destinations saved.");
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
      else toast("Backup verified and copied to all destinations.");
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
        throw new Error(
          "Open the desktop application to install the operating system backup schedule.",
        );
      await window.vault.installSchedule(
        sessionStorage.getItem("vault-session") || "",
      );
      toast("Daily backup schedule installed for this desktop account.");
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
        `Verified: ${result.products} products and ${result.documents} documents.`,
      );
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  async function restore() {
    setLocalError("");
    try {
      if (!window.vault)
        throw new Error(
          "Restoration is available in the desktop application, where the database can be closed safely.",
        );
      const backup = await window.vault.pickBackup();
      if (!backup) return;
      const result = await window.vault.restore(
        backup,
        sessionStorage.getItem("vault-session") || "",
      );
      if (!result.cancelled) toast("Backup restored. Restarting…");
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Protect your store"
        title="Backups & recovery"
        description="A daily recovery copy, verified before old backups are rotated."
        action={
          <button
            className="button button-dark"
            disabled={busy || !destinations.length}
            onClick={run}
          >
            <ArrowClockwiseIcon size={16} className={busy ? "spin" : ""} />
            {busy ? "Backing up…" : "Back up now"}
          </button>
        }
      />
      <ErrorMessage error={error || localError} />
      <div className="metrics-row">
        <Metric
          label="Automatic schedule"
          value="Every 24 hours"
          detail="Runs on wake if the computer was off"
        />
        <Metric
          label="Daily history"
          value="30 days"
          detail="One automatic snapshot per day per destination"
        />
        <Metric
          label="Last fully successful copy"
          value={
            data?.config.lastSuccess
              ? new Date(data.config.lastSuccess).toLocaleDateString()
              : "Not yet"
          }
          detail="All configured destinations must verify"
        />
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <h3>
              <HardDrivesIcon size={18} />
              Backup destinations
            </h3>
            <Badge tone="gray">{destinations.length} folders</Badge>
          </div>
          <p className="muted">
            Add folders on this computer or a connected external drive.
            Disconnected destinations are retried.
          </p>
          <div className="destination-list">
            {destinations.map((d, i) => (
              <div key={d}>
                <FolderIcon size={21} />
                <span>{d}</span>
                <button
                  className="text-button"
                  onClick={() => save(destinations.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {window.vault ? (
            <button className="button" onClick={pick}>
              <PlusIcon size={15} />
              Choose a folder
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
                aria-label="Backup folder path"
                placeholder="Absolute folder path on this computer"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
              />
              <button className="button" type="submit">
                <PlusIcon size={15} />
                Add folder
              </button>
            </form>
          )}
          <div className="info-box">
            <ShieldCheckIcon size={18} />
            <p>
              Use a separate physical drive for protection against disk failure.
              Backups contain store data; protect access to the destination.
            </p>
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <h3>
              <ClockIcon size={18} />
              Scheduling & restore
            </h3>
          </div>
          <p className="muted">
            The desktop scheduler runs backups even when the app window is
            closed. The computer and destination drives must be available.
          </p>
          <button className="button full" disabled={busy} onClick={schedule}>
            Install daily desktop schedule <ArrowRightIcon size={15} />
          </button>
          <div className="divider" />
          <h3>Restore a recovery copy</h3>
          <p className="muted">
            Restore checks the database, creates a safety copy, closes the
            current database, and restarts the app. The desktop app asks for
            final confirmation.
          </p>
          <button className="button full" onClick={restore}>
            <DatabaseIcon size={16} />
            Choose backup to restore
          </button>
          <small className="subtle">
            Backup files are currently unencrypted SQLite snapshots. Full-disk
            or destination encryption is recommended.
          </small>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading padded">
          <h3>Backup history</h3>
          <span className="subtle">Latest 60 attempts</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Destination</th>
                <th>Size</th>
                <th>Status</th>
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
                    {r.size ? (r.size / 1024 / 1024).toFixed(2) + " MB" : "—"}
                  </td>
                  <td>
                    <Badge tone={r.status === "verified" ? "green" : "red"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td>
                    {r.status === "verified" && (
                      <button className="text-button" onClick={() => verify(r)}>
                        Verify
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
            title="No recovery copies yet"
            text="Add a destination, then create your first backup."
          />
        )}
      </section>
    </div>
  );
}
export function SettingsPage({ refresh, open, toast, user }: PageProps) {
  const { data, error } = useLoad<any>("settings", {}, refresh),
    { data: users } = useLoad<any[]>(
      user.permissions.includes("users") ? "users" : "status",
      {},
      refresh,
    );
  const [tab, setTab] = useState("Store"),
    [localError, setLocalError] = useState(""),
    [busy, setBusy] = useState(false),
    [audit, setAudit] = useState<any[]>([]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await api("saveSettings", {
        name: f.get("name"),
        phone: f.get("phone"),
        address: f.get("address"),
      });
      toast("Store settings saved.");
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(u: any) {
    try {
      await api("userUpdate", { id: u.id, active: !u.active });
      toast(u.active ? "User disabled." : "User enabled.");
    } catch (e: any) {
      setLocalError(e.message);
    }
  }
  return (
    <div className="page-content">
      <PageIntro
        eyebrow="Administration"
        title="Store settings"
        description="Your store details, team access, and accounting controls."
      />
      <ErrorMessage error={error || localError} />
      <section className="panel">
        <div className="report-tabs">
          {[
            "Store",
            ...(user.permissions.includes("users")
              ? ["Users & access", "Audit history"]
              : []),
            "Accounting",
          ].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                if (t === "Audit history")
                  api<any[]>("audit")
                    .then(setAudit)
                    .catch((e) => setLocalError(e.message));
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Store" && data && (
          <form className="settings-form" onSubmit={save}>
            <h3>Store information</h3>
            <Field label="Store name">
              <input
                name="name"
                defaultValue={data.store.name}
                required
                minLength={2}
              />
            </Field>
            <div className="form-grid">
              <Field label="Phone">
                <input name="phone" defaultValue={data.store.phone} />
              </Field>
              <Field label="Currency">
                <input value="Afghan afghani · AFN (AF)" readOnly />
              </Field>
            </div>
            <Field label="Address">
              <textarea
                name="address"
                defaultValue={data.store.address}
                rows={2}
              />
            </Field>
            <div className="info-box">
              <CheckCircleIcon size={18} />
              <p>
                Tax is disabled. Business dates use Asia/Kabul. All application
                data is stored on this computer.
              </p>
            </div>
            <button className="button button-dark" disabled={busy}>
              {busy ? "Saving…" : "Save store details"}
            </button>
          </form>
        )}
        {tab === "Users & access" && (
          <>
            <div className="panel-heading padded">
              <h3>Your team</h3>
              <button
                className="button button-dark"
                onClick={() => open("user")}
              >
                <PlusIcon size={15} />
                Create user
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Permissions</th>
                    <th>Status</th>
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
                            <small className="block muted">You</small>
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
                            {u.active ? "Active" : "Disabled"}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => open("user", u)}
                          >
                            Edit access
                          </button>
                          {u.id !== user.id && (
                            <button
                              className="text-button"
                              onClick={() => toggle(u)}
                            >
                              {u.active ? "Disable" : "Enable"}
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
        {tab === "Audit history" && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.user_name || "Scheduler"}</td>
                    <td>{a.action}</td>
                    <td className="permissions-cell">
                      {JSON.stringify(JSON.parse(a.details))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="table-note">
              Latest 200 audit records. Passwords are never recorded here.
            </p>
          </div>
        )}
        {tab === "Accounting" && (
          <div className="settings-form">
            <h3>Accounting period lock</h3>
            <p className="muted">
              Transactions dated on or before the locked date cannot be posted.
              Corrections can be recorded as reversals in an open period.
            </p>
            <p>
              Closed through:{" "}
              <strong>{data?.closedThrough || "No periods locked"}</strong>
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("closePeriod", {
                    date: new FormData(e.currentTarget).get("date"),
                  });
                  toast("Accounting period locked.");
                } catch (e: any) {
                  setLocalError(e.message);
                }
              }}
            >
              <Field label="Lock through date">
                <input type="date" name="date" max={businessDate()} required />
              </Field>
              <button className="button button-dark">
                <LockIcon size={15} />
                Lock period
              </button>
            </form>
            <div className="divider" />
            <h3>Accounting policies</h3>
            <p className="muted">
              FIFO costing for stock. Purchases create inventory assets. Only
              sold stock becomes cost of goods sold. Money is stored in
              hundredths of an afghani.
            </p>
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
  const { data, error } = useLoad<{ rows: Product[] }>(
    "catalog",
    { filter: "low", limit: 100 },
    refresh,
  );
  return (
    <div className="form-body">
      <p className="muted">
        Products at or below their configured reorder level.
      </p>
      <ErrorMessage error={error} />
      {data?.rows.map((p) => (
        <div className="alert-row" key={p.id}>
          <ProductName product={p} />
          <Badge tone={p.stock === 0 ? "red" : "yellow"}>
            {p.stock} left · reorder {p.reorder_level}
          </Badge>
          <button
            className="text-button"
            onClick={() => open("productDetail", p)}
          >
            View <ArrowUpRightIcon size={14} />
          </button>
        </div>
      ))}
      {data && !data.rows.length && (
        <Empty
          title="Stock levels look good"
          text="No products are currently below their reorder level."
        />
      )}
    </div>
  );
}
