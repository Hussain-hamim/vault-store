import {
  useNotificationSummary,
  NotificationButton,
  NotificationsDialog,
} from "./components/Notifications";
import { BrandMark, BrandWordmark } from "./components/Brand";
import {
  CompanyPage,
  CommandPalette,
  HelpContent,
  isMac,
} from "./components/CompanyPages";
import {
  shortcutAction,
  shortcutLabel,
  availableActions,
} from "./shortcuts.mjs";
import {
  CustomerResalePage,
  ResaleReceiveDialog,
  ResaleSettlementDialog,
  ResaleReturnDialog,
} from "./components/CustomerResale";
import { ExpenseAccountsDialog } from "./components/ExpenseAccountsDialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  InfoIcon,
  LifebuoyIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  PackageIcon,
  ShoppingCartSimpleIcon,
  TruckIcon,
  UsersIcon,
  BuildingsIcon,
  ChartBarIcon,
  BookOpenTextIcon,
  ReceiptIcon,
  GearSixIcon,
  SignOutIcon,
  ArrowUpRightIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  BellIcon,
  EnvelopeSimpleIcon,
  CheckCircleIcon,
  XIcon,
  ArrowRightIcon,
  WifiSlashIcon,
  ShieldCheckIcon,
  CommandIcon,
} from "@phosphor-icons/react";
import { api, setToken, Product, User } from "./api";
import { useI18n, LOCALES, type Locale } from "./i18n";
import { Dashboard } from "./components/Dashboard";
import {
  ProductsPage,
  DocumentsPage,
  PeoplePage,
  DayBookPage,
  ReportsPage,
  SettingsPage,
  AlertsDialogContent,
} from "./components/Pages";
import {
  ProductForm,
  TradeForm,
  PartyForm,
  ExpenseForm,
  PaymentForm,
  InvoiceDialog,
  ProductDetail,
  PartyDetailDialog,
  UserForm,
  OwnerMovement,
  OpeningBalanceForm,
  DeleteInvoiceDialog,
} from "./components/Dialogs";
import { GlobalSearch, GlobalSearchHit } from "./components/GlobalSearch";
import { Modal, ErrorMessage, Field } from "./components/ui";
import { StoreDecor } from "./components/StoreDecor";
type AppModal = {
  name: string;
  data?: any;
  returnTo?: { name: string; data?: any };
};
type PageId =
  | "dashboard"
  | "inventory"
  | "sales"
  | "purchases"
  | "customers"
  | "suppliers"
  | "reports"
  | "dailyBook"
  | "capital"
  | "expenses"
  | "backups"
  | "settings"
  | "about"
  | "support"
  | "help";

const PAGE_ALIASES: Record<string, PageId> = {
  Dashboard: "dashboard",
  Inventory: "inventory",
  Products: "inventory",
  Sales: "sales",
  Purchases: "purchases",
  Customers: "customers",
  Suppliers: "suppliers",
  Reports: "reports",
  "Daily book": "dailyBook",
  Capital: "capital",
  Expenses: "expenses",
  Backups: "backups",
  Settings: "settings",
  help: "help",
  about: "about",
  support: "support",
  dashboard: "dashboard",
  inventory: "inventory",
  sales: "sales",
  purchases: "purchases",
  customers: "customers",
  suppliers: "suppliers",
  reports: "reports",
  dailyBook: "dailyBook",
  capital: "capital",
  expenses: "expenses",
  backups: "backups",
  settings: "settings",
};

const nav = [
  {
    id: "dashboard" as PageId,
    labelKey: "nav.dashboard",
    icon: SquaresFourIcon,
    permission: "",
  },
  {
    id: "inventory" as PageId,
    labelKey: "nav.inventory",
    icon: PackageIcon,
    permission: "inventory",
  },
  {
    id: "sales" as PageId,
    labelKey: "nav.sales",
    icon: ShoppingCartSimpleIcon,
    permission: "sales",
  },
  {
    id: "purchases" as PageId,
    labelKey: "nav.purchases",
    icon: TruckIcon,
    permission: "purchases",
  },
  {
    id: "customers" as PageId,
    labelKey: "nav.customers",
    icon: UsersIcon,
    permission: "people",
  },
  {
    id: "suppliers" as PageId,
    labelKey: "nav.suppliers",
    icon: BuildingsIcon,
    permission: "people",
  },
  {
    id: "reports" as PageId,
    labelKey: "nav.reports",
    icon: ChartBarIcon,
    permission: "reports",
  },
];
const general = [
  {
    id: "dailyBook" as PageId,
    labelKey: "nav.dailyBook",
    icon: BookOpenTextIcon,
    permission: "finance",
  },
  {
    id: "expenses" as PageId,
    labelKey: "nav.expenses",
    icon: ReceiptIcon,
    permission: "finance",
  },
  {
    id: "settings" as PageId,
    labelKey: "nav.settings",
    icon: GearSixIcon,
    permission: "",
  },
];

function normalizePage(name: string): PageId {
  return PAGE_ALIASES[name] || "inventory";
}

export function App() {
  const { t, locale, setLocale, dir } = useI18n();
  const [status, setStatus] = useState<any>(null),
    [user, setUser] = useState<User | null>(null),
    [page, setPage] = useState<PageId>("inventory"),
    [saleTab, setSaleTab] = useState("bill"),
    [saleEditId, setSaleEditId] = useState<string | undefined>(),
    [purchaseTab, setPurchaseTab] = useState("bill"),
    [purchaseEditId, setPurchaseEditId] = useState<string | undefined>(),
    [billEpoch, setBillEpoch] = useState(0),
    [purchaseEpoch, setPurchaseEpoch] = useState(0),
    [modal, setModal] = useState<AppModal | null>(null),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState(""),
    [search, setSearch] = useState(""),
    [categoryFilter, setCategoryFilter] = useState("All products"),
    [collapsed, setCollapsed] = useState(false),
    [profile, setProfile] = useState(false),
    [globalOpen, setGlobalOpen] = useState(false),
    [palette, setPalette] = useState(false),
    [saleSeed, setSaleSeed] = useState<Product | undefined>();
  const notifications = useNotificationSummary(user, refresh);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = workspaceRef.current?.animate(
      [
        { opacity: 0.5, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 190, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [page, user?.id]);
  useEffect(() => {
    let active = true;
    api("status")
      .then(async (s) => {
        if (!active) return;
        setStatus(s);
        if (!s.setup) {
          try {
            let u;
            try {
              u = await api<User>("me");
            } catch {
              if (s.store.demo) {
                const session = await api("demoSession");
                setToken(session.token);
                u = session.user;
              } else throw new Error("Sign in");
            }
            if (active) {
              setUser(u);
              if (!u.permissions.includes("inventory")) setPage("dashboard");
            }
          } catch {
            setToken("");
          }
        }
        const lang = s.store?.language;
        if (lang === "en" || lang === "ps" || lang === "prs") setLocale(lang);
      })
      .catch((e) => {
        if (active) setFatal(e.message);
      });
    return () => {
      active = false;
    };
  }, [setLocale]);
  useEffect(() => {
    const expired = () => {
      setToken("");
      setUser(null);
      setModal(null);
      setPalette(false);
      setGlobalOpen(false);
    };
    window.addEventListener("vault-session-expired", expired);
    return () => window.removeEventListener("vault-session-expired", expired);
  }, []);
  const close = useCallback(
    () => setModal((m) => (m?.returnTo ? { ...m.returnTo } : null)),
    [],
  );
  const toast = useCallback((s: string) => {
    setMessage(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 5000);
    setRefresh((v) => v + 1);
  }, []);
  const done = useCallback(
    (s: string) => {
      setModal((m) => (m?.returnTo ? { ...m.returnTo } : null));
      toast(s);
    },
    [toast],
  );
  const open = useCallback((name: string, data?: any) => {
    if (["sale", "saleEdit", "saleHistory"].includes(name)) {
      setModal(null);
      setGlobalOpen(false);
      setPage("sales");
      setSaleTab(name === "saleHistory" ? "history" : "bill");
      if (name !== "saleHistory") {
        setSaleEditId(name === "saleEdit" ? data?.id : undefined);
        setSaleSeed(
          name === "sale" && data?.product ? data.product : undefined,
        );
        setBillEpoch((v) => v + 1);
      }
      return;
    }
    if (["purchase", "purchaseEdit", "purchaseHistory"].includes(name)) {
      setModal(null);
      setGlobalOpen(false);
      setPage("purchases");
      setPurchaseTab(name === "purchaseHistory" ? "history" : "bill");
      if (name !== "purchaseHistory") {
        setPurchaseEditId(name === "purchaseEdit" ? data.id : undefined);
        setPurchaseEpoch((v) => v + 1);
      }
      return;
    }
    if (name === "customerResale") {
      setPage("sales");
      setSaleTab("resale");
      return;
    }
    if (name === "category") {
      setPage("inventory");
      setSearch("");
      setCategoryFilter(data);
      return;
    }
    setModal((current) => {
      const stackFrom =
        current &&
        ["partyDetail", "productDetail"].includes(current.name) &&
        [
          "payment",
          "invoice",
          "openingBalance",
          "product",
          "consignmentReceive",
          "consignmentSettlement",
        ].includes(name);
      return {
        name,
        data,
        returnTo: stackFrom
          ? {
              name: current.name,
              data:
                name === "consignmentSettlement" &&
                current.name === "partyDetail"
                  ? { ...current.data, ledgerView: "resale" }
                  : current.data,
            }
          : undefined,
      };
    });
  }, []);
  const navigate = useCallback((name: string) => {
    const id = normalizePage(name);
    setPage(id);
    if (id === "inventory") setCategoryFilter("All products");
    setSearch("");
    setProfile(false);
  }, []);
  async function changeLanguage(next: Locale) {
    setLocale(next);
    try {
      if (status?.store && user?.permissions.includes("settings")) {
        await api("saveSettings", {
          name: status.store.name,
          phone: status.store.phone || "",
          address: status.store.address || "",
          email: status.store.email || "",
          logo: status.store.logo || "",
          bill_footer: status.store.bill_footer || "",
          language: next,
        });
        setStatus((s: any) =>
          s ? { ...s, store: { ...s.store, language: next } } : s,
        );
      }
    } catch {
      /* local preference still applied */
    }
  }
  const pickGlobalHit = useCallback(
    (hit: GlobalSearchHit) => {
      setGlobalOpen(false);
      if (hit.type === "product" && hit.product) {
        open("productDetail", hit.product);
        return;
      }
      if (hit.party) open("partyDetail", hit.party);
    },
    [open],
  );
  const runAction = useCallback(
    (id: string) => {
      if (!user) return;
      if (
        id !== "palette" &&
        !availableActions(user.permissions).some((a) => a.id === id)
      )
        return;
      setPalette(false);
      setProfile(false);
      if (id === "palette") {
        setPalette(true);
        return;
      }
      if (id === "search") {
        setGlobalOpen(true);
        return;
      }
      if (id === "sale") {
        setPage("sales");
        setSaleTab("bill");
        return;
      }
      if (id === "purchase") {
        setPage("purchases");
        setPurchaseTab("bill");
        return;
      }
      if (id === "history") {
        setPage("sales");
        setSaleTab("history");
        return;
      }
      if (["product", "customer", "supplier", "expense"].includes(id)) {
        open(id);
        return;
      }
      navigate(id);
    },
    [user, open, navigate],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProfile(false);
        setGlobalOpen(false);
        setPalette(false);
      }
      if (!user) return;
      const action = shortcutAction(e, {
        permissions: user.permissions,
        overlay:
          !!modal ||
          globalOpen ||
          palette ||
          !!document.querySelector('[role="dialog"]'),
        editable:
          e.target instanceof Element &&
          !!e.target.closest('input,textarea,select,[contenteditable="true"]'),
      });
      if (action) {
        e.preventDefault();
        runAction(action);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [user, modal, globalOpen, palette, runAction]);
  async function signOut() {
    await api("logout");
    setToken("");
    setUser(null);
    setProfile(false);
    setPalette(false);
    setGlobalOpen(false);
  }
  if (fatal)
    return (
      <div className="boot-screen" dir={dir}>
        <div className="brand">
          <BrandWordmark />
        </div>
        <h2>{t("app.fatalTitle")}</h2>
        <p>{fatal}</p>
        <button
          className="button button-dark"
          onClick={() => location.reload()}
        >
          {t("app.tryAgain")}
        </button>
      </div>
    );
  if (!status)
    return (
      <div className="boot-screen" dir={dir}>
        <BrandMark />
        <p>{t("app.opening")}</p>
      </div>
    );
  if (!user)
    return (
      <Auth
        setup={status.setup}
        storeName={status.store.name}
        onSuccess={(s) => {
          setToken(s.token);
          setUser(s.user);
          setStatus({ ...status, setup: false });
          setPage("inventory");
        }}
      />
    );
  const props = { user, refresh, open, toast, globalSearch: search };
  const cost = user.permissions.includes("view_costs");
  const current = ["about", "support", "help", "capital", "backups"].includes(
    page,
  )
    ? "settings"
    : page;
  return (
    <div
      className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}
      dir={dir}
    >
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a
            href="#"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate("inventory");
            }}
            aria-label={t("nav.inventory")}
          >
            <BrandWordmark />
          </a>
          <button
            className="sidebar-toggle"
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            onClick={() => setCollapsed(!collapsed)}
          >
            <SidebarSimpleIcon size={18} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <NotificationButton
            sidebar
            data={notifications.data}
            error={notifications.error}
            open={() => open("notifications")}
          />
          <button
            className="sidebar-command"
            onClick={() => setPalette(true)}
            title={t("shortcuts.palette")}
          >
            <CommandIcon size={18} />
            <span>{t("shortcuts.quickActions")}</span>
            <kbd>{shortcutLabel("Ctrl + K", isMac())}</kbd>
          </button>
          <span className="nav-label">{t("app.menu")}</span>
          <nav aria-label={t("app.menu")}>
            {nav
              .filter(
                (n) => !n.permission || user.permissions.includes(n.permission),
              )
              .map((n) => (
                <button
                  key={n.id}
                  className={`nav-item ${current === n.id ? "active" : ""}`}
                  onClick={() => navigate(n.id)}
                  title={t(n.labelKey)}
                >
                  <n.icon
                    size={19}
                    weight={current === n.id ? "duotone" : "regular"}
                  />
                  <span>{t(n.labelKey)}</span>
                </button>
              ))}
          </nav>
          <div className="nav-divider" />
          <span className="nav-label">{t("app.workspace")}</span>
          <nav aria-label={t("app.workspace")}>
            {general
              .filter(
                (n) => !n.permission || user.permissions.includes(n.permission),
              )
              .map((n) => (
                <button
                  key={n.id}
                  className={`nav-item ${current === n.id ? "active" : ""}`}
                  onClick={() => navigate(n.id)}
                  title={t(n.labelKey)}
                >
                  <n.icon size={18} />
                  <span>{t(n.labelKey)}</span>
                </button>
              ))}
          </nav>
          <div className="sidebar-spacer" />
          <div className="offline-status">
            <span className="live-dot" />
            <span>{t("app.offline")}</span>
            <WifiSlashIcon size={13} />
          </div>
        </div>
        <div className="profile-container">
          <button
            className="profile-button"
            onClick={() => setProfile(!profile)}
            aria-expanded={profile}
          >
            <span className="profile-avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="profile-info">
              <strong>{user.name}</strong>
              <small>
                {user.role}
                {status.store.demo ? ` · ${t("app.demoWorkspace")}` : ""}
              </small>
            </span>
            <span className="profile-menu-dots">···</span>
          </button>
          {profile && (
            <div className="profile-popover">
              <strong>{user.name}</strong>
              <small>
                {user.username} · {user.role}
              </small>
              <label className="profile-lang">
                <span>{t("language.label")}</span>
                <select
                  value={locale}
                  onChange={(e) => changeLanguage(e.target.value as Locale)}
                  aria-label={t("language.label")}
                >
                  {LOCALES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nativeLabel}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={signOut}>
                <SignOutIcon size={16} />
                {t("nav.signOut")}
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main-workspace">
        <StoreDecor />
        {page === "dashboard" && (
          <header className="topbar">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                if (search.trim()) {
                  if (user.permissions.includes("inventory"))
                    setPage("inventory");
                  else if (user.permissions.includes("sales")) setPage("sales");
                }
              }}
            >
              <MagnifyingGlassIcon size={18} />
              <input
                ref={searchRef}
                aria-label={t("topbar.searchStore")}
                placeholder={t("topbar.searchHere")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>{shortcutLabel("Ctrl + F", isMac())}</kbd>
            </form>
            <div className="topbar-actions">
              <button
                className="header-icon filter-icon"
                aria-label={t("topbar.viewInventory")}
                title={t("topbar.viewInventory")}
                onClick={() =>
                  navigate(
                    user.permissions.includes("inventory")
                      ? "inventory"
                      : "dashboard",
                  )
                }
              >
                <SlidersHorizontalIcon size={19} />
              </button>
              <span className="header-divider" />
              <NotificationButton
                data={notifications.data}
                error={notifications.error}
                open={() => open("notifications")}
              />
              <button
                className="header-icon messages-icon"
                aria-label={t("topbar.backupStatus")}
                title={t("topbar.backupStatus")}
                onClick={() =>
                  navigate(
                    user.permissions.includes("backups")
                      ? "backups"
                      : "dashboard",
                  )
                }
              >
                <EnvelopeSimpleIcon size={21} />
                <i />
              </button>
            </div>
          </header>
        )}
        <div
          ref={workspaceRef}
          className={`workspace-scroll${
            (page === "sales" && saleTab === "bill") ||
            (page === "purchases" && purchaseTab === "bill")
              ? " no-page-scroll"
              : ""
          }`}
        >
          {page === "dashboard" ? (
            <Dashboard
              user={user}
              refresh={refresh}
              open={open}
              navigate={navigate}
            />
          ) : page === "inventory" ? (
            <ProductsPage {...props} initialCategory={categoryFilter} />
          ) : page === "sales" ? (
            <div
              className={`sales-workspace${saleTab === "bill" ? " is-bill" : ""}`}
            >
              <div
                className="sales-tabs"
                role="tablist"
                aria-label={t("nav.sales")}
              >
                <button
                  role="tab"
                  id="bill-tab"
                  aria-controls="bill-panel"
                  aria-selected={saleTab === "bill"}
                  onClick={() => setSaleTab("bill")}
                >
                  {saleEditId ? t("sales.editBill") : t("sales.newBill")}
                </button>
                <button
                  role="tab"
                  id="history-tab"
                  aria-controls="history-panel"
                  aria-selected={saleTab === "history"}
                  onClick={() => setSaleTab("history")}
                >
                  {t("sales.invoiceHistory")}
                </button>
                {user.permissions.includes("finance") &&
                  user.permissions.includes("view_costs") && (
                    <button
                      role="tab"
                      id="resale-tab"
                      aria-controls="resale-panel"
                      aria-selected={saleTab === "resale"}
                      onClick={() => setSaleTab("resale")}
                    >
                      {t("resale.title")}
                    </button>
                  )}
              </div>
              <div
                role="tabpanel"
                id="bill-panel"
                aria-labelledby="bill-tab"
                hidden={saleTab !== "bill"}
              >
                <TradeForm
                  key={billEpoch}
                  kind="sale"
                  inline
                  documentId={saleEditId}
                  seedProduct={saleSeed}
                  close={() => {
                    setSaleTab("history");
                    setSaleEditId(undefined);
                    setSaleSeed(undefined);
                    setBillEpoch((v) => v + 1);
                  }}
                  done={(s, result: any) => {
                    toast(s);
                    setSaleTab("history");
                    setSaleEditId(undefined);
                    setSaleSeed(undefined);
                    setBillEpoch((v) => v + 1);
                    if (result?.print === true && result?.id)
                      open("invoice", {
                        id: result.id,
                        kind: result.kind || "sale",
                        autoPrint: true,
                      });
                  }}
                />
              </div>
              <div
                role="tabpanel"
                id="history-panel"
                aria-labelledby="history-tab"
                hidden={saleTab !== "history"}
              >
                <DocumentsPage {...props} kind="sale" />
              </div>
              {saleTab === "resale" &&
                user.permissions.includes("finance") &&
                user.permissions.includes("view_costs") && (
                  <div
                    role="tabpanel"
                    id="resale-panel"
                    aria-labelledby="resale-tab"
                  >
                    <CustomerResalePage {...props} />
                  </div>
                )}
            </div>
          ) : page === "purchases" ? (
            <div
              className={`sales-workspace${purchaseTab === "bill" ? " is-bill" : ""}`}
            >
              <div
                className="sales-tabs"
                role="tablist"
                aria-label={t("nav.purchases")}
              >
                <button
                  role="tab"
                  id="purchase-bill-tab"
                  aria-controls="purchase-bill-panel"
                  aria-selected={purchaseTab === "bill"}
                  onClick={() => setPurchaseTab("bill")}
                >
                  {purchaseEditId
                    ? t("sales.editPurchase")
                    : t("sales.newPurchase")}
                </button>
                <button
                  role="tab"
                  id="purchase-history-tab"
                  aria-controls="purchase-history-panel"
                  aria-selected={purchaseTab === "history"}
                  onClick={() => setPurchaseTab("history")}
                >
                  {t("sales.purchaseHistory")}
                </button>
              </div>
              <div
                role="tabpanel"
                id="purchase-bill-panel"
                aria-labelledby="purchase-bill-tab"
                hidden={purchaseTab !== "bill"}
              >
                <TradeForm
                  key={purchaseEpoch}
                  kind="purchase"
                  inline
                  documentId={purchaseEditId}
                  close={() => {
                    setPurchaseTab("history");
                    setPurchaseEditId(undefined);
                    setPurchaseEpoch((v) => v + 1);
                  }}
                  done={(s, result: any) => {
                    toast(s);
                    setPurchaseTab("history");
                    setPurchaseEditId(undefined);
                    setPurchaseEpoch((v) => v + 1);
                    if (result?.print === true && result?.id)
                      open("invoice", {
                        id: result.id,
                        kind: result.kind || "purchase",
                        autoPrint: true,
                      });
                  }}
                />
              </div>
              <div
                role="tabpanel"
                id="purchase-history-panel"
                aria-labelledby="purchase-history-tab"
                hidden={purchaseTab !== "history"}
              >
                <DocumentsPage {...props} kind="purchase" />
              </div>
            </div>
          ) : page === "customers" ? (
            <PeoplePage key="customer" {...props} kind="customer" />
          ) : page === "suppliers" ? (
            <PeoplePage key="supplier" {...props} kind="supplier" />
          ) : page === "dailyBook" ? (
            <DayBookPage {...props} />
          ) : page === "expenses" ? (
            <DocumentsPage {...props} kind="expense" />
          ) : page === "reports" ? (
            cost ? (
              <ReportsPage {...props} />
            ) : (
              <div className="page-content">
                <h2>{t("reports.title")}</h2>
              </div>
            )
          ) : (
            <SettingsPage
              {...props}
              key={page}
              initialTab={
                page === "about" ||
                page === "support" ||
                page === "help" ||
                page === "capital" ||
                page === "backups"
                  ? page
                  : undefined
              }
            />
          )}
        </div>
      </main>
      {palette && (
        <CommandPalette
          permissions={user.permissions}
          close={() => setPalette(false)}
          run={runAction}
        />
      )}
      {message && (
        <div className="toast" role="status">
          <CheckCircleIcon size={20} weight="fill" />
          <span>{message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
      {modal?.name === "product" && (
        <ProductForm product={modal.data} close={close} done={done} />
      )}
      {["customer", "supplier"].includes(modal?.name || "") && (
        <PartyForm
          kind={modal!.name as "customer" | "supplier"}
          close={close}
          done={done}
        />
      )}
      {modal?.name === "consignmentReceive" && (
        <ResaleReceiveDialog
          user={user}
          party={modal.data}
          close={close}
          done={done}
        />
      )}
      {modal?.name === "consignmentSettlement" && (
        <ResaleSettlementDialog owner={modal.data} close={close} done={done} />
      )}
      {modal?.name === "consignmentReturn" && (
        <ResaleReturnDialog batch={modal.data} close={close} done={done} />
      )}
      {modal?.name === "expense" && <ExpenseForm close={close} done={done} />}
      {modal?.name === "expenseAccounts" && (
        <ExpenseAccountsDialog
          close={close}
          changed={() => setRefresh((v) => v + 1)}
        />
      )}
      {modal?.name === "payment" && (
        <PaymentForm party={modal.data} close={close} done={done} />
      )}
      {["saleDelete", "purchaseDelete"].includes(modal?.name || "") &&
        modal && (
          <DeleteInvoiceDialog
            documentId={modal.data.id}
            close={close}
            done={done}
          />
        )}
      {modal?.name === "invoice" && (
        <InvoiceDialog
          key={modal.data.id}
          documentId={modal.data.id}
          user={user}
          close={close}
          done={(message, result: any) => {
            done(message);
            if (result?.print === true && result?.id)
              open("invoice", {
                id: result.id,
                kind: result.kind,
                autoPrint: true,
              });
          }}
          autoPrint={modal.data.autoPrint === true}
          edit={() =>
            open(
              modal.data.kind === "purchase" ? "purchaseEdit" : "saleEdit",
              modal.data,
            )
          }
          remove={() =>
            open(
              modal.data.kind === "purchase" ? "purchaseDelete" : "saleDelete",
              modal.data,
            )
          }
        />
      )}
      {modal?.name === "productDetail" && (
        <ProductDetail
          edit={() => open("product", modal.data)}
          sell={() => open("sale", { product: modal.data })}
          product={modal.data}
          user={user}
          close={close}
          done={done}
        />
      )}
      {modal?.name === "partyDetail" && (
        <PartyDetailDialog
          party={modal.data}
          user={user}
          close={close}
          open={open}
          refresh={refresh}
        />
      )}
      {globalOpen && (
        <GlobalSearch
          onClose={() => setGlobalOpen(false)}
          onSelect={pickGlobalHit}
        />
      )}
      {modal?.name === "user" && (
        <UserForm user={modal.data} close={close} done={done} />
      )}
      {modal?.name === "owner" && <OwnerMovement close={close} done={done} />}
      {modal?.name === "openingBalance" && (
        <OpeningBalanceForm party={modal.data} close={close} done={done} />
      )}
      {modal?.name === "notifications" && (
        <NotificationsDialog
          user={user}
          refresh={refresh}
          close={close}
          open={open}
          changed={notifications.reload}
        />
      )}
      {modal?.name === "lowStock" && (
        <Modal
          title={t("alerts.lowStockTitle")}
          subtitle={t("alerts.lowStockSubtitle")}
          onClose={close}
          wide
        >
          <AlertsDialogContent refresh={refresh} open={open} />
          <div className="modal-actions">
            <button className="button" onClick={close}>
              {t("common.close")}
            </button>
            {user.permissions.includes("purchases") && (
              <button
                className="button button-dark"
                onClick={() => open("purchase")}
              >
                {t("alerts.receivePurchase")} <ArrowRightIcon size={15} />
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal?.name === "categoryInfo" && (
        <Modal
          title={t("alerts.categoryInventory", {
            category: String(modal.data),
          })}
          onClose={close}
        >
          <div className="form-body">
            <p>
              {t("alerts.categoryHint", {
                category: String(modal.data).toLowerCase(),
              })}
            </p>
            <button className="button button-dark" onClick={close}>
              {t("alerts.viewInventory")}
            </button>
          </div>
        </Modal>
      )}
      {modal?.name === "help" && (
        <Modal
          title={t("help.title")}
          subtitle={t("help.subtitle")}
          onClose={close}
        >
          <div className="form-body">
            <HelpContent permissions={user.permissions} />
          </div>
        </Modal>
      )}
    </div>
  );
}
function Auth({
  setup,
  storeName,
  onSuccess,
}: {
  setup: boolean;
  storeName: string;
  onSuccess: (s: any) => void;
}) {
  const { t, dir } = useI18n();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await api(
        setup ? "setup" : "login",
        Object.fromEntries(f),
      );
      onSuccess(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen" dir={dir}>
      <div className="auth-story">
        <div className="brand">
          <BrandWordmark />
        </div>
        <div>
          <span className="auth-eyebrow">{t("auth.eyebrow")}</span>
          <h1>
            {t("auth.headline1")}
            <br />
            {t("auth.headline2")}
          </h1>
          <p>
            {t("auth.story")}
            <br />
            {t("auth.story2")}
          </p>
          <span className="auth-offline">
            <WifiSlashIcon size={17} />
            {t("auth.alwaysOffline")}
          </span>
        </div>
        <small>{t("auth.footer")}</small>
      </div>
      <div className="auth-form-container">
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-form-icon">
            <ShieldCheckIcon size={30} />
          </span>
          <h2>{setup ? t("auth.makeHome") : t("auth.welcomeBack")}</h2>
          <p>
            {setup
              ? t("auth.setupHint")
              : t("auth.signInHint", { store: storeName })}
          </p>
          {setup && (
            <>
              <Field label={t("auth.storeName")}>
                <input
                  name="storeName"
                  placeholder={t("auth.storeNamePh")}
                  required
                  minLength={2}
                />
              </Field>
              <Field label={t("auth.fullName")}>
                <input name="name" required minLength={2} />
              </Field>
            </>
          )}
          <Field label={t("auth.username")}>
            <input
              name="username"
              required
              minLength={3}
              autoComplete="username"
            />
          </Field>
          <Field
            label={t("auth.password")}
            hint={setup ? t("auth.passwordHint") : ""}
          >
            <input
              name="password"
              type="password"
              required
              minLength={setup ? 10 : 1}
              autoComplete={setup ? "new-password" : "current-password"}
            />
          </Field>
          <ErrorMessage error={error} />
          <button className="button button-dark full" disabled={busy}>
            {busy
              ? t("common.opening")
              : setup
                ? t("auth.createStore")
                : t("auth.signIn")}
            <ArrowRightIcon size={16} />
          </button>
          <p className="auth-note">
            <ShieldCheckIcon size={14} />
            {t("auth.dataStays")}
          </p>
        </form>
      </div>
    </div>
  );
}
