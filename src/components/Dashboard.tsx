import { useEffect, useState } from "react";
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
import { ProductName, Badge, Empty } from "./ui";

type PeriodId = "thisMonth" | "last7" | "today";
type CategoryId =
  | "all"
  | "Computers"
  | "Mobiles"
  | "Tablets"
  | "Storage"
  | "Accessories";

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
  const dateLocale =
    LOCALES.find((l) => l.id === locale)?.htmlLang || "en";
  const [data, setData] = useState<any>(null),
    [products, setProducts] = useState<Product[]>([]),
    [category, setCategory] = useState<CategoryId>("all"),
    [period, setPeriod] = useState<PeriodId>("thisMonth"),
    [error, setError] = useState("");
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
  }, [category, refresh]);
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
  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <div className="breadcrumb">
          <span>{t("dashboard.glance")}</span>
          <span className="live-dot" /> <span>{t("dashboard.updatedNow")}</span>
        </div>
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
      <div className="stat-grid">
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
            <span>
              {t("dashboard.acrossProducts", { n: stock.products })}
            </span>
          </div>
        </div>
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
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-icon lime">
              <ChartLineUpIcon size={22} weight="duotone" />
            </span>
            <button
              className="circle-link"
              aria-label={
                costs ? t("dashboard.grossProfit") : t("dashboard.stockCategories")
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
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-icon coral">
              <WarningCircleIcon size={22} weight="duotone" />
            </span>
            <button
              className="circle-link"
              aria-label={t("dashboard.lowStock")}
              onClick={() => open("lowStock")}
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
      </div>
      <div className="dashboard-middle">
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
                        className={
                          p.stock <= p.reorder_level ? "stock-low" : ""
                        }
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
      </div>
      <div className="dashboard-bottom">
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
              <strong>
                {t("sales.productsCount", { n: stock.low })}
              </strong>
            </div>
            <div>
              <span>{t("dashboard.keepBestsellers")}</span>
              <Badge tone="gray">{t("dashboard.stockAlerts")}</Badge>
            </div>
          </div>
          <div className="card-buttons">
            <button
              className="button button-dark"
              onClick={() => open("lowStock")}
            >
              {t("dashboard.seeAll")} <ArrowRightIcon size={13} />
            </button>
            <button className="button" onClick={() => open("purchase")}>
              {t("dashboard.restockNow")}
            </button>
          </div>
        </section>
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
          <div className="receivable-line">
            <span>{t("dashboard.customerReceivables")}</span>
            <strong>{af(receivable)}</strong>
          </div>
          <button
            className="button button-dark full"
            onClick={() => navigate("Customers")}
          >
            {t("dashboard.viewBalances")} <ArrowRightIcon size={13} />
          </button>
        </section>
      </div>
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
