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
import { ProductName, Badge, Empty } from "./ui";
type Props = {
  user: User;
  refresh: number;
  open: (name: string, data?: any) => void;
  navigate: (page: string) => void;
};
export function Dashboard({ user, refresh, open, navigate }: Props) {
  const [data, setData] = useState<any>(null),
    [products, setProducts] = useState<Product[]>([]),
    [category, setCategory] = useState("All products"),
    [period, setPeriod] = useState("This month"),
    [error, setError] = useState("");
  const costs = user.permissions.includes("view_costs");
  useEffect(() => {
    let active = true;
    const from =
      period === "Today"
        ? businessDate()
        : period === "Last 7 days"
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
    api<{ rows: Product[] }>("catalog", { category, limit: 6 })
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
        title="Could not load your store"
        text={error}
        action={
          <button className="button" onClick={() => location.reload()}>
            Try again
          </button>
        }
      />
    );
  if (!data)
    return (
      <div className="dashboard-skeleton" aria-label="Loading dashboard">
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
          <span>Your store at a glance</span>
          <span className="live-dot" /> <span>Updated just now</span>
        </div>
        <div className="period-picker">
          <CalendarBlankIcon size={14} />
          <select
            aria-label="Dashboard period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {["This month", "Last 7 days", "Today"].map((x) => (
              <option key={x}>{x}</option>
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
              aria-label="View stock valuation"
              onClick={() => navigate(costs ? "Reports" : "Products")}
            >
              <ArrowUpRightIcon size={16} />
            </button>
          </div>
          <span className="stat-label">
            {costs ? "Total stock value" : "Products in stock"}
          </span>
          <strong className="stat-value">
            {costs ? af(data.inventory) : stock.units.toLocaleString()}
          </strong>
          <div className="stat-foot">
            <span className="trend positive">
              <ArrowUpRightIcon size={12} />
              {stock.units} units
            </span>
            <span>Across {stock.products} products</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-icon lime">
              <ShoppingBagIcon size={22} weight="duotone" />
            </span>
            <button
              className="circle-link"
              aria-label="View sales"
              onClick={() => navigate("Sales")}
            >
              <ArrowUpRightIcon size={16} />
            </button>
          </div>
          <span className="stat-label">Total sales</span>
          <strong className="stat-value">{af(totals.sales)}</strong>
          <div className="stat-foot">
            <span className="trend positive">
              <CheckCircleIcon size={12} />
              {data.salesCount} sales
            </span>
            <span>{period.toLowerCase()}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-icon lime">
              <ChartLineUpIcon size={22} weight="duotone" />
            </span>
            <button
              className="circle-link"
              aria-label="View profit report"
              onClick={() => navigate("Reports")}
            >
              <ArrowUpRightIcon size={16} />
            </button>
          </div>
          <span className="stat-label">
            {costs ? "Gross profit" : "Stock categories"}
          </span>
          <strong className="stat-value">
            {costs ? af(totals.gross) : categories.length}
          </strong>
          <div className="stat-foot">
            <span className="trend yellow">
              <ArrowUpRightIcon size={12} />
              {costs ? margin + "%" : "5 categories"}
            </span>
            <span>{costs ? "Trading margin" : "In your inventory"}</span>
          </div>
          <div className="mini-gauge lime-gauge">
            <Gauge coral={false} value={costs ? margin : 100} />
            <span>
              <b>{costs ? margin + "%" : stock.products}</b>
              <small>{costs ? "Margin" : "Products"}</small>
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
              aria-label="View low stock"
              onClick={() => open("lowStock")}
            >
              <ArrowUpRightIcon size={16} />
            </button>
          </div>
          <span className="stat-label">Low stock products</span>
          <strong className="stat-value">
            {stock.low}
            <small> / {stock.products}</small>
          </strong>
          <div className="stat-foot">
            <span className="trend negative">
              <ArrowDownIcon size={12} />
              {lowPercent}%
            </span>
            <span>Need your attention</span>
          </div>
          <div className="mini-gauge coral-gauge">
            <Gauge coral value={lowPercent} />
            <span>
              <b>{stock.low}</b>
              <small>Products</small>
            </span>
          </div>
        </div>
      </div>
      <div className="dashboard-middle">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <h3>Sales volume vs. cost</h3>
            <div className="chart-legend">
              <span>
                <i className="legend-dot lime-dot" />
                Sales
              </span>
              {costs && (
                <span>
                  <i className="legend-dot pale-dot" />
                  Cost of goods
                </span>
              )}
            </div>
          </div>
          <div className="chart-subhead">
            <span>Understand how your store is performing</span>
            <div className="period-picker">
              <CalendarBlankIcon size={12} />
              <select
                aria-label="Chart period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {["This month", "Last 7 days", "Today"].map((p) => (
                  <option key={p}>{p}</option>
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
                    `${v} ${new Date().toLocaleString("en", { month: "short" })}`
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
                          {new Date().toLocaleString("en", { month: "long" })}
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
              Sales and cost recorded from posted invoices
            </span>
            <button
              aria-label="Open sales report"
              onClick={() => navigate("Reports")}
            >
              <ArrowUpRightIcon size={14} />
            </button>
          </div>
        </section>
        <section className="panel inventory-panel">
          <div className="panel-heading">
            <h3>
              Inventory overview <span>Organized & in control</span>
            </h3>
            <button
              className="icon-button small"
              aria-label="Open inventory filters"
              onClick={() => navigate("Products")}
            >
              <SlidersHorizontalIcon size={15} />
            </button>
          </div>
          <div className="category-tabs">
            {["All products", "Computers", "Mobiles", "Tablets", "Storage"].map(
              (c) => (
                <button
                  key={c}
                  className={category === c ? "active" : ""}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ),
            )}
            <button
              className="add-category"
              aria-label="Add a product"
              onClick={() => open("product")}
            >
              <PlusIcon size={13} />
            </button>
          </div>
          <div className="table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Product details</th>
                  <th>Stock</th>
                  <th>Price</th>
                  <th aria-label="Actions" />
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
                        aria-label={`View ${p.name}`}
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
                title="No products in this category"
                text="Add your first product to get started."
              />
            )}
          </div>
          <button
            className="panel-footer-link"
            onClick={() => navigate("Products")}
          >
            View all inventory <ArrowRightIcon size={13} />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <h3>Sales & orders</h3>
            <div className="heading-actions">
              <span className="subtle">Latest transactions</span>
              <button
                className="icon-button small"
                aria-label="View all sales"
                onClick={() => navigate("Sales")}
              >
                <ArrowUpRightIcon size={14} />
              </button>
            </div>
          </div>
          <table className="compact-table recent-table">
            <thead>
              <tr>
                <th>Customer / invoice</th>
                <th>Amount</th>
                <th>Status</th>
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
                      {r.paid >= r.total ? "Paid" : "Partial"}
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
              title="Your first sale starts here"
              text="Create an invoice to see your sales."
            />
          )}
        </section>
        <section className="panel restock-panel">
          <div className="panel-heading">
            <h3>Restock recommendations</h3>
            <span className="tiny-label">Based on your stock</span>
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
              <span>Products below reorder level</span>
              <strong>{stock.low} products</strong>
            </div>
            <div>
              <span>Keep your bestsellers available</span>
              <Badge tone="gray">Stock alerts</Badge>
            </div>
          </div>
          <div className="card-buttons">
            <button
              className="button button-dark"
              onClick={() => open("lowStock")}
            >
              See all <ArrowRightIcon size={13} />
            </button>
            <button className="button" onClick={() => open("purchase")}>
              Restock now
            </button>
          </div>
        </section>
        <section className="panel balances-panel">
          <div className="panel-heading">
            <h3>Stock by category</h3>
            <button
              className="icon-button small"
              aria-label="View inventory"
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
                    {c.category}
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
            <span>Customer receivables</span>
            <strong>{af(receivable)}</strong>
          </div>
          <button
            className="button button-dark full"
            onClick={() => navigate("Customers")}
          >
            View customer balances <ArrowRightIcon size={13} />
          </button>
        </section>
      </div>
      <div className="workspace-footer">
        <span>
          <CheckCircleIcon size={13} />
          All changes saved on this computer
        </span>
        <span>AFN · No tax · {new Date().getFullYear()}</span>
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
