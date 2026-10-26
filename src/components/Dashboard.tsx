import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  PackageIcon,
  ShoppingBagIcon,
  ChartLineUpIcon,
  ArrowDownIcon,
  WarningCircleIcon,
  SlidersHorizontalIcon,
  CalendarBlankIcon,
  PlusIcon,
  CheckCircleIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { api, af, shortMoney, businessDate, Product, User } from "../api";
import { useI18n, useT, LOCALES } from "../i18n";
import { ProductName, Badge, Empty, Modal } from "./ui";

type PeriodId = "thisMonth" | "last7" | "today";
type CategoryId =
  "all" | "Computers" | "Mobiles" | "Tablets" | "Storage" | "Accessories";

const DEFAULT_WIDGETS = [
  "stock",
  "sales",
  "profit",
  "low",
  "chart",
  "inventory",
  "recent",
  "restock",
  "categories",
];
const metricIds = [
  "stock",
  "sales",
  "profit",
  "low",
  "net",
  "expenses",
  "cash",
  "receivables",
  "payables",
];
const allWidgetIds = [
  ...DEFAULT_WIDGETS,
  "net",
  "expenses",
  "cash",
  "receivables",
  "payables",
];
const PERIOD_IDS: PeriodId[] = ["thisMonth", "last7", "today"];
const CATEGORY_TABS: CategoryId[] = [
  "all",
  "Computers",
  "Mobiles",
  "Tablets",
  "Storage",
];

const CATEGORY_I18N: Record<CategoryId, string> = {
  all: "inventory.allProducts",
  Computers: "inventory.computers",
  Mobiles: "inventory.mobiles",
  Tablets: "inventory.tablets",
  Storage: "inventory.storage",
  Accessories: "inventory.accessories",
};

const API_CATEGORY_NAMES: Record<string, string> = {
  Computers: "inventory.computers",
  Mobiles: "inventory.mobiles",
  Tablets: "inventory.tablets",
  Storage: "inventory.storage",
  Accessories: "inventory.accessories",
};

function categoryForApi(cat: CategoryId): string {
  return cat === "all" ? "All products" : cat;
}

type Props = {
  user: User;
  refresh: number;
  open: (name: string, data?: any) => void;
  navigate: (page: string) => void;
};
export function Dashboard({ user, refresh, open, navigate }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const dateLocale = LOCALES.find((l) => l.id === locale)?.htmlLang || "en";
  const [data, setData] = useState<any>(null),
    [products, setProducts] = useState<Product[]>([]),
    [category, setCategory] = useState<CategoryId>("all"),
    [period, setPeriod] = useState<PeriodId>("thisMonth"),
    [error, setError] = useState("");
  const storageKey = `dashboard-widgets-v1:${user.id}`;
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      return Array.isArray(saved)
        ? [
            ...new Set(
              saved.filter(
                (id): id is string =>
                  typeof id === "string" && allWidgetIds.includes(id),
              ),
            ),
          ]
        : DEFAULT_WIDGETS;
    } catch {
      return DEFAULT_WIDGETS;
    }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(selected);
  const [saveError, setSaveError] = useState("");
  function moveWidget(id: string, direction: number) {
    setDraft((current) => {
      const result = [...current],
        i = result.indexOf(id),
        next = i + direction;
      if (i < 0 || next < 0 || next >= result.length) return current;
      [result[i], result[next]] = [result[next], result[i]];
      return result;
    });
  }
  function saveWidgets() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setSelected(draft);
      setEditing(false);
      setSaveError("");
    } catch {
      setSaveError(t("widgets.saveError"));
    }
  }
  const costs = user.permissions.includes("view_costs");
  useEffect(() => {
    let active = true;
    const from =
      period === "today"
        ? businessDate()
        : period === "last7"
          ? new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
          : businessDate().slice(0, 7) + "-01";
    api("overview", { from, to: businessDate() })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [refresh, period]);
  useEffect(() => {
    let active = true;
    if (
      !user.permissions.some((p) =>
        ["inventory", "sales", "purchases"].includes(p),
      )
    ) {
      setProducts([]);
      return;
    }
    api<{ rows: Product[] }>("catalog", {
      category: categoryForApi(category),
      limit: 6,
    })
      .then((d) => {
        if (active) setProducts(d.rows);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [category, refresh, user.permissions]);
  if (error)
    return (
      <Empty
        title={t("dashboard.loadError")}
        text={error}
        action={
          <button className="button" onClick={() => location.reload()}>
            {t("app.tryAgain")}
          </button>
        }
      />
    );
  if (!data)
    return (
      <div className="dashboard-skeleton" aria-label={t("dashboard.loading")}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} />
        ))}
      </div>
    );
  const { totals, stock, daily, recent, categories } = data;
  const chart = daily.map((d: any) => ({
    ...d,
    day: Number(d.date.slice(-2)),
    sales: d.sales / 100,
    cost: d.cost / 100,
  }));
  const margin = totals.sales
    ? Math.round((totals.gross / totals.sales) * 100)
    : 0;
  const lowPercent = stock.products
    ? Math.round((stock.low / stock.products) * 100)
    : 0;
  const maxCategory = Math.max(...categories.map((c: any) => c.stock), 1);
  const receivable =
    data.outstanding.find((r: any) => r.account === "receivables")?.n || 0;
  const widgets: Record<string, ReactNode> = {
    stock: (
      <div className="stat-card dark-card">
        <div className="stat-top">
          <span className="stat-icon">
            <PackageIcon size={22} weight="duotone" />
          </span>
          <button
            className="circle-link"
            aria-label={
              costs ? t("dashboard.stockValue") : t("dashboard.productsInStock")
            }
            onClick={() => navigate(costs ? "Reports" : "Products")}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <span className="stat-label">
          {costs ? t("dashboard.stockValue") : t("dashboard.productsInStock")}
        </span>
        <strong className="stat-value">
          {costs ? af(data.inventory) : stock.units.toLocaleString()}
        </strong>
        <div className="stat-foot">
          <span className="trend positive">
            <ArrowUpRightIcon size={12} />
            {stock.units} {t("dashboard.units")}
          </span>
          <span>{t("dashboard.acrossProducts", { n: stock.products })}</span>
        </div>
      </div>
    ),
    sales: (
      <div className="stat-card">
        <div className="stat-top">
          <span className="stat-icon lime">
            <ShoppingBagIcon size={22} weight="duotone" />
          </span>
          <button
            className="circle-link"
            aria-label={t("dashboard.totalSales")}
            onClick={() => navigate("Sales")}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <span className="stat-label">{t("dashboard.totalSales")}</span>
        <strong className="stat-value">{af(totals.sales)}</strong>
        <div className="stat-foot">
          <span className="trend positive">
            <CheckCircleIcon size={12} />
            {t("dashboard.nSales", { n: data.salesCount })}
          </span>
          <span>{t(`periods.${period}`)}</span>
        </div>
      </div>
    ),
    profit: (
      <div className="stat-card">
        <div className="stat-top">
          <span className="stat-icon lime">
            <ChartLineUpIcon size={22} weight="duotone" />
          </span>
          <button
            className="circle-link"
            aria-label={
              costs
                ? t("dashboard.grossProfit")
                : t("dashboard.stockCategories")
            }
            onClick={() => navigate("Reports")}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <span className="stat-label">
          {costs ? t("dashboard.grossProfit") : t("dashboard.stockCategories")}
        </span>
        <strong className="stat-value">
          {costs ? af(totals.gross) : categories.length}
        </strong>
        <div className="stat-foot">
          <span className="trend yellow">
            <ArrowUpRightIcon size={12} />
            {costs ? margin + "%" : t("dashboard.fiveCategories")}
          </span>
          <span>
            {costs ? t("dashboard.tradingMargin") : t("dashboard.inInventory")}
          </span>
        </div>
        <div className="mini-gauge lime-gauge">
          <Gauge coral={false} value={costs ? margin : 100} />
          <span>
            <b>{costs ? margin + "%" : stock.products}</b>
            <small>
              {costs ? t("dashboard.margin") : t("dashboard.products")}
            </small>
          </span>
        </div>
      </div>
    ),
    low: (
      <div className="stat-card">
        <div className="stat-top">
          <span className="stat-icon coral">
            <WarningCircleIcon size={22} weight="duotone" />
          </span>
          <button
            className="circle-link"
            aria-label={t("dashboard.lowStock")}
            onClick={() => navigate("reports:reorder")}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <span className="stat-label">{t("dashboard.lowStock")}</span>
        <strong className="stat-value">
          {stock.low}
          <small> / {stock.products}</small>
        </strong>
        <div className="stat-foot">
          <span className="trend negative">
            <ArrowDownIcon size={12} />
            {lowPercent}%
          </span>
          <span>{t("dashboard.needAttention")}</span>
        </div>
        <div className="mini-gauge coral-gauge">
          <Gauge coral value={lowPercent} />
          <span>
            <b>{stock.low}</b>
            <small>{t("dashboard.products")}</small>
          </span>
        </div>
      </div>
    ),
    chart: (
      <section className="panel chart-panel">
        <div className="panel-heading">
          <h3>{t("dashboard.chartTitle")}</h3>
          <div className="chart-legend">
            <span>
              <i className="legend-dot lime-dot" />
              {t("dashboard.chartSales")}
            </span>
            {costs && (
              <span>
                <i className="legend-dot pale-dot" />
                {t("dashboard.chartCost")}
              </span>
            )}
          </div>
        </div>
        <div className="chart-subhead">
          <span>{t("dashboard.chartHint")}</span>
          <div className="period-picker">
            <CalendarBlankIcon size={12} />
            <select
              aria-label={t("dashboard.period")}
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodId)}
            >
              {PERIOD_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`periods.${id}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="main-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chart}
              margin={{ top: 24, right: 10, bottom: 0, left: -10 }}
            >
              <CartesianGrid
                stroke="#ededeb"
                vertical={false}
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#969696", fontSize: 10 }}
                minTickGap={16}
                tickFormatter={(v) =>
                  `${v} ${new Date().toLocaleString(dateLocale, { month: "short" })}`
                }
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={51}
                tick={{ fill: "#969696", fontSize: 10 }}
                tickFormatter={(v) =>
                  v >= 1000 ? `${Math.round(v / 1000)}K` : v
                }
              />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="chart-tooltip">
                      <small>
                        {label}{" "}
                        {new Date().toLocaleString(dateLocale, {
                          month: "long",
                        })}
                      </small>
                      <strong>
                        AF {Number(payload[0].value).toLocaleString()}
                      </strong>
                    </div>
                  ) : null
                }
              />
              {costs && (
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="cost"
                  stroke="#e0e9ab"
                  fill="#f6f9e7"
                  fillOpacity={0.7}
                  strokeWidth={1.5}
                />
              )}
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="sales"
                stroke="#adbf61"
                fill="#edf3c6"
                fillOpacity={0.4}
                strokeWidth={2}
                activeDot={{
                  r: 4,
                  fill: "#c9ed41",
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-bottom">
          <span>
            <span className="live-dot" />
            {t("dashboard.chartFoot")}
          </span>
          <button
            aria-label={t("nav.reports")}
            onClick={() => navigate("Reports")}
          >
            <ArrowUpRightIcon size={14} />
          </button>
        </div>
      </section>
    ),
    inventory: (
      <section className="panel inventory-panel">
        <div className="panel-heading">
          <h3>
            {t("dashboard.inventoryOverview")}{" "}
            <span>{t("dashboard.organized")}</span>
          </h3>
          <button
            className="icon-button small"
            aria-label={t("inventory.title")}
            onClick={() => navigate("Products")}
          >
            <SlidersHorizontalIcon size={15} />
          </button>
        </div>
        <div className="category-tabs">
          {CATEGORY_TABS.map((c) => (
            <button
              key={c}
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {t(CATEGORY_I18N[c])}
            </button>
          ))}
          <button
            className="add-category"
            aria-label={t("inventory.addProduct")}
            onClick={() => open("product")}
          >
            <PlusIcon size={13} />
          </button>
        </div>
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>{t("dashboard.productDetails")}</th>
                <th>{t("dashboard.stock")}</th>
                <th>{t("dashboard.price")}</th>
                <th aria-label={t("common.actions")} />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => open("productDetail", p)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open("productDetail", p);
                  }}
                >
                  <td>
                    <ProductName product={p} />
                  </td>
                  <td>
                    <span
                      className={p.stock <= p.reorder_level ? "stock-low" : ""}
                    >
                      {p.stock}
                    </span>
                  </td>
                  <td>{af(p.price)}</td>
                  <td>
                    <button
                      className="table-action"
                      aria-label={`${t("common.view")} ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        open("productDetail", p);
                      }}
                    >
                      <ArrowUpRightIcon size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!products.length && (
            <Empty
              title={t("dashboard.noInCategory")}
              text={t("dashboard.addFirst")}
            />
          )}
        </div>
        <button
          className="panel-footer-link"
          onClick={() => navigate("Products")}
        >
          {t("dashboard.viewAllInventory")} <ArrowRightIcon size={13} />
        </button>
      </section>
    ),
    recent: (
      <section className="panel recent-panel">
        <div className="panel-heading">
          <h3>{t("dashboard.salesOrders")}</h3>
          <div className="heading-actions">
            <span className="subtle">{t("dashboard.latestTx")}</span>
            <button
              className="icon-button small"
              aria-label={t("dashboard.salesOrders")}
              onClick={() => navigate("Sales")}
            >
              <ArrowUpRightIcon size={14} />
            </button>
          </div>
        </div>
        <table className="compact-table recent-table">
          <thead>
            <tr>
              <th>{t("dashboard.customerInvoice")}</th>
              <th>{t("dashboard.amount")}</th>
              <th>{t("dashboard.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((r: any) => (
              <tr key={r.id} onClick={() => open("invoice", r)}>
                <td>
                  <span className="customer-name">
                    <span className="customer-initial">
                      {r.party_name?.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{r.party_name}</strong>
                      <small>{r.number}</small>
                    </span>
                  </span>
                </td>
                <td>{af(r.total)}</td>
                <td>
                  <Badge tone={r.paid >= r.total ? "green" : "yellow"}>
                    {r.paid >= r.total ? t("common.paid") : t("common.partial")}
                  </Badge>
                </td>
                <td>
                  <ArrowUpRightIcon size={13} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!recent.length && (
          <Empty
            title={t("dashboard.firstSale")}
            text={t("dashboard.createInvoice")}
          />
        )}
      </section>
    ),
    restock: (
      <section className="panel restock-panel">
        <div className="panel-heading">
          <h3>{t("dashboard.restockTitle")}</h3>
          <span className="tiny-label">{t("dashboard.basedOnStock")}</span>
        </div>
        <div className="restock-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={daily.slice(-12)}
              margin={{ top: 12, right: 4, bottom: 4, left: 4 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#eff3ee"
                strokeDasharray="3 4"
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="sales"
                stroke="#55b99a"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="restock-detail">
          <div>
            <span>{t("dashboard.belowReorder")}</span>
            <strong>{t("sales.productsCount", { n: stock.low })}</strong>
          </div>
          <div>
            <span>{t("dashboard.keepBestsellers")}</span>
            <Badge tone="gray">{t("dashboard.stockAlerts")}</Badge>
          </div>
        </div>
        <div className="card-buttons">
          <button
            className="button button-dark"
            onClick={() => navigate("reports:reorder")}
          >
            {t("dashboard.seeAll")} <ArrowRightIcon size={13} />
          </button>
          <button className="button" onClick={() => open("purchase")}>
            {t("dashboard.restockNow")}
          </button>
        </div>
      </section>
    ),
    categories: (
      <section className="panel balances-panel">
        <div className="panel-heading">
          <h3>{t("dashboard.stockByCategory")}</h3>
          <button
            className="icon-button small"
            aria-label={t("topbar.viewInventory")}
            onClick={() => navigate("Products")}
          >
            <ArrowUpRightIcon size={14} />
          </button>
        </div>
        <div className="category-list">
          {categories.map((c: any, i: number) => (
            <button
              key={c.category}
              onClick={() => open("category", c.category)}
            >
              <span className={`category-icon category-${i}`}>
                <PackageIcon size={16} />
              </span>
              <span className="category-detail">
                <span>
                  {API_CATEGORY_NAMES[c.category]
                    ? t(API_CATEGORY_NAMES[c.category])
                    : c.category}
                  <b>{c.stock}</b>
                </span>
                <span className="category-track">
                  <i style={{ width: `${(c.stock / maxCategory) * 100}%` }} />
                </span>
              </span>
            </button>
          ))}
        </div>
        {user.permissions.includes("people") && (
          <div className="receivable-line">
            <span>{t("dashboard.customerReceivables")}</span>
            <strong>{af(receivable)}</strong>
          </div>
        )}
        {user.permissions.includes("people") && (
          <button
            className="button button-dark full"
            onClick={() => navigate("Customers")}
          >
            {t("dashboard.viewBalances")} <ArrowRightIcon size={13} />
          </button>
        )}
      </section>
    ),
  };
  const extraMetrics = [
    { id: "net", value: totals.net, page: "Reports" },
    { id: "expenses", value: totals.expenses, page: "Expenses" },
    { id: "cash", value: totals.cash, page: "Daily book" },
    { id: "receivables", value: receivable, page: "Customers" },
    {
      id: "payables",
      value: -(
        data.outstanding.find((r: any) => r.account === "payables")?.n || 0
      ),
      page: "Suppliers",
    },
  ];
  const widgetKeys: Record<string, string> = {
    stock: costs ? "dashboard.stockValue" : "dashboard.productsInStock",
    sales: "dashboard.totalSales",
    profit: costs ? "dashboard.grossProfit" : "dashboard.stockCategories",
    low: "dashboard.lowStock",
    chart: "dashboard.chartTitle",
    inventory: "dashboard.inventoryOverview",
    recent: "dashboard.salesOrders",
    restock: "dashboard.restockTitle",
    categories: "dashboard.stockByCategory",
  };
  const widgetLabel = (id: string) => t(widgetKeys[id] || `widgets.${id}`);
  for (const metric of extraMetrics)
    widgets[metric.id] = (
      <section className="stat-card">
        <div className="stat-top">
          <span className="stat-icon lime">
            <ChartLineUpIcon size={22} />
          </span>
          <button
            className="circle-link"
            aria-label={widgetLabel(metric.id)}
            onClick={() => navigate(metric.page)}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </div>
        <span className="stat-label">{widgetLabel(metric.id)}</span>
        <strong className="stat-value">{af(metric.value)}</strong>
        <div className="stat-foot">
          <span>
            {t(
              ["receivables", "payables"].includes(metric.id)
                ? "widgets.currentBalance"
                : `periods.${period}`,
            )}
          </span>
        </div>
      </section>
    );
  const canCatalog = user.permissions.some((p) =>
    ["inventory", "sales", "purchases"].includes(p),
  );
  const canSales = user.permissions.includes("sales");
  const canFinance = user.permissions.includes("finance");
  const canPeople = user.permissions.includes("people");
  const canReports = user.permissions.includes("reports");
  const allowed: Record<string, boolean> = {
    stock: canCatalog,
    sales: canSales || canReports,
    profit: costs && (canFinance || canReports),
    low: canCatalog,
    chart: canSales || canReports,
    inventory: canCatalog,
    recent: canSales,
    restock: canCatalog,
    categories: canCatalog,
    net: costs && (canFinance || canReports),
    expenses: costs && canFinance,
    cash: costs && canFinance,
    receivables: canPeople,
    payables: canPeople && costs,
  };
  const availableWidgets = allWidgetIds.filter((id) => allowed[id]);
  const visibleWidgets = selected.filter((id) => availableWidgets.includes(id));
  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <div className="breadcrumb">
          <span>{t("dashboard.glance")}</span>
          <span className="live-dot" /> <span>{t("dashboard.updatedNow")}</span>
        </div>
        <button
          className="button"
          onClick={() => {
            setDraft(selected);
            setSaveError("");
            setEditing(true);
          }}
        >
          <SlidersHorizontalIcon size={16} />
          {t("widgets.customize")}
        </button>
        <span className="widget-visible-count">
          {t("widgets.visibleCount", {
            n: visibleWidgets.length,
            total: availableWidgets.length,
          })}
        </span>
        <div className="period-picker">
          <CalendarBlankIcon size={14} />
          <select
            aria-label={t("dashboard.period")}
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodId)}
          >
            {PERIOD_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`periods.${id}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="widget-board">
        {visibleWidgets.map((id) => (
          <div
            key={id}
            data-widget={id}
            className={`dashboard-widget ${metricIds.includes(id) ? "widget-metric" : "widget-panel"}`}
          >
            {widgets[id]}
          </div>
        ))}
      </div>
      {!visibleWidgets.length && (
        <Empty
          title={t("widgets.empty")}
          text={t("widgets.hint")}
          action={
            <button className="button" onClick={() => setEditing(true)}>
              {t("widgets.customize")}
            </button>
          }
        />
      )}
      {editing && (
        <Modal
          title={t("widgets.customize")}
          onClose={() => setEditing(false)}
          wide
        >
          <div className="form-body widget-picker">
            <p className="muted">{t("widgets.hint")}</p>
            <div className="widget-picker-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDraft(availableWidgets)}
              >
                {t("widgets.showAll")}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setDraft([])}
              >
                {t("widgets.hideAll")}
              </button>
              <span>
                {t("widgets.selectedCount", {
                  n: draft.filter((id) => availableWidgets.includes(id)).length,
                })}
              </span>
            </div>
            <div className="widget-options">
              {availableWidgets.map((id) => (
                <label key={id} className="widget-option">
                  <input
                    type="checkbox"
                    data-widget-option={id}
                    checked={draft.includes(id)}
                    onChange={(e) =>
                      setDraft(
                        e.target.checked
                          ? [...draft, id]
                          : draft.filter((v) => v !== id),
                      )
                    }
                  />
                  <span>{widgetLabel(id)}</span>
                </label>
              ))}
            </div>
            <h3 className="widget-order-title">{t("widgets.arrange")}</h3>
            <div className="widget-order">
              {draft
                .filter((id) => availableWidgets.includes(id))
                .map((id, i, list) => (
                  <div key={id}>
                    <span>{widgetLabel(id)}</span>
                    <button
                      className="button"
                      disabled={!i}
                      aria-label={`${t("widgets.up")} ${widgetLabel(id)}`}
                      onClick={() => moveWidget(id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="button"
                      disabled={i === list.length - 1}
                      aria-label={`${t("widgets.down")} ${widgetLabel(id)}`}
                      onClick={() => moveWidget(id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setDraft(draft.filter((v) => v !== id))}
                    >
                      {t("widgets.remove")}
                    </button>
                  </div>
                ))}
            </div>
            {saveError && <p role="alert">{saveError}</p>}
            <div className="inline-actions">
              <button
                className="button"
                onClick={() => setDraft(DEFAULT_WIDGETS)}
              >
                {t("widgets.reset")}
              </button>
              <button className="button" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
              <button className="button button-dark" onClick={saveWidgets}>
                {t("widgets.save")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <div className="workspace-footer">
        <span>
          <CheckCircleIcon size={13} />
          {t("dashboard.footerSaved")}
        </span>
        <span>
          {t("dashboard.footerMeta", { year: new Date().getFullYear() })}
        </span>
      </div>
    </div>
  );
}

function Gauge({ coral, value }: { coral: boolean; value: number }) {
  const [radius, setRadius] = useState(30);
  return (
    <div className="gauge-chart">
      <ResponsiveContainer
        width="100%"
        height="100%"
        onResize={(width, height) =>
          setRadius(Math.max(12, Math.min(width / 2 - 1, height - 3)))
        }
      >
        <PieChart>
          <Pie
            data={[
              { value: Math.max(0, Math.min(100, value)) },
              { value: 100 - Math.max(0, Math.min(100, value)) },
            ]}
            dataKey="value"
            startAngle={180}
            endAngle={0}
            cx="50%"
            cy="95%"
            innerRadius={radius - 8}
            outerRadius={radius}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={coral ? "#ee8e9b" : "#d8f52f"} />
            <Cell fill={coral ? "#fbe7ea" : "#f0f6db"} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
