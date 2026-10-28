import { OwnerRecovery } from "./components/OwnerRecovery";
import { CompanyCredit } from "./components/CompanyCredit";
import { useUserTheme } from "./appearance";
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
  CoinsIcon,
  GearSixIcon,
  CheckCircleIcon,
  XIcon,
  ArrowRightIcon,
  WifiSlashIcon,
  ShieldCheckIcon,
  CommandIcon,
} from "@phosphor-icons/react";
import { api, setToken, Product, User, normalizeDigits } from "./api";
import { useI18n, type Locale } from "./i18n";
import { Dashboard } from "./components/Dashboard";
import {
  ProductsPage,
  DocumentsPage,
  PeoplePage,
  DayBookPage,
  ReportsPage,
  CapitalPage,
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
import { attachBarcodeWedge } from "./barcodeWedge";
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
    id: "capital" as PageId,
    labelKey: "nav.capital",
    icon: CoinsIcon,
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
    [reportTab, setReportTab] = useState<string | undefined>(),
    [billEpoch, setBillEpoch] = useState(0),
    [purchaseEpoch, setPurchaseEpoch] = useState(0),
    [modal, setModal] = useState<AppModal | null>(null),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState(""),
    [search, setSearch] = useState(""),
    [categoryFilter, setCategoryFilter] = useState("All products"),
    [collapsed, setCollapsed] = useState(false),
    [globalOpen, setGlobalOpen] = useState(false),
    [palette, setPalette] = useState(false),
    [saleSeed, setSaleSeed] = useState<Product | undefined>();
  useUserTheme(user?.id);
  const notifications = useNotificationSummary(user, refresh);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    Promise.resolve(window.vault?.accounts?.("resume"))
      .catch(() => "")
      .then((token) => {
        if (typeof token === "string") setToken(token);
        return api("status");
      })
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
  const toast = useCallback((s: string, opts?: { reload?: boolean }) => {
    setMessage(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 5000);
    if (opts?.reload) setRefresh((v) => v + 1);
  }, []);
  const done = useCallback(
    (s: string, result?: unknown) => {
      // Save & New passes keepOpen so the form can clear and stay mounted.
      const keepOpen =
        result !== null &&
        typeof result === "object" &&
        "keepOpen" in result &&
        result.keepOpen === true;
      if (!keepOpen) setModal((m) => (m?.returnTo ? { ...m.returnTo } : null));
      toast(s, { reload: true });
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
    const [pageName, tab] = name.split(":");
    const id = normalizePage(pageName);
    setPage(id);
    if (id === "reports") setReportTab(tab || undefined);
    else setReportTab(undefined);
    if (id === "inventory") setCategoryFilter("All products");
    setSearch("");
  }, []);
  async function changeLanguage(next: Locale) {
    const previous = locale;
    setLocale(next);
    try {
      if (status?.store && user?.permissions.includes("settings")) {
        await api("saveSettings", {
          name: status.store.name,
          name_ps: status.store.name_ps || "",
          phone: status.store.phone || "",
          address: status.store.address || "",
          address_ps: status.store.address_ps || "",
          email: status.store.email || "",
          services: status.store.services || "",
          owner1_name: status.store.owner1_name || "",
          owner1_phone: status.store.owner1_phone || "",
          owner2_name: status.store.owner2_name || "",
          owner2_phone: status.store.owner2_phone || "",
          logo: status.store.logo_left || status.store.logo || "",
          logo_left: status.store.logo_left || status.store.logo || "",
          logo_right: status.store.logo_right || "",
          watermark: status.store.watermark || "",
          bill_footer: status.store.bill_footer || "",
          language: next,
        });
        setStatus((s: any) =>
          s ? { ...s, store: { ...s.store, language: next } } : s,
        );
      }
    } catch (error: any) {
      setLocale(previous);
      toast(error?.message || t("settings.languageSaveFailed"));
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
  useEffect(() => {
    if (!user) return;
    const canCatalog = user.permissions.some((p) =>
      ["inventory", "sales", "purchases"].includes(p),
    );
    if (!canCatalog) return;
    const billOpen =
      (page === "sales" && saleTab === "bill") ||
      (page === "purchases" && purchaseTab === "bill");
    const dashboardOpen = page === "dashboard";
    if (!billOpen && !dashboardOpen) return;
    let busy = false;
    return attachBarcodeWedge({
      enabled: true,
      shouldIgnore: (event) => {
        if (modal || globalOpen || palette) return true;
        if (document.querySelector('[role="dialog"]')) return true;
        const target = event.target;
        if (!(target instanceof Element)) return false;
        // Focused inputs handle their own typing (sale/purchase barcode field
        // auto-adds on Enter / scanner burst). Wedge only when nothing is focused.
        return !!target.closest(
          'input,textarea,select,[contenteditable="true"]',
        );
      },
      onScan: async (raw) => {
        const code = normalizeDigits(raw).trim();
        if (!code || busy) return;
        if (billOpen) {
          window.dispatchEvent(
            new CustomEvent("vault:barcode", { detail: { code } }),
          );
          return;
        }
        busy = true;
        try {
          const d = await api<{ rows: Product[] }>("catalog", {
            barcode: code,
            limit: 1,
          });
          const product = d.rows[0];
          if (!product) {
            toast(t("sales.errBarcode", { code }));
            return;
          }
          open("productDetail", product);
        } catch (e: any) {
          toast(e.message || t("sales.errBarcode", { code }));
        } finally {
          busy = false;
        }
      },
    });
  }, [
    user,
    page,
    saleTab,
    purchaseTab,
    modal,
    globalOpen,
    palette,
    open,
    toast,
    t,
  ]);
  async function signOut() {
    await api("logout");
    setToken("");
    setUser(null);
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
        ownerUsername={status.ownerUsername}
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
  const current = ["about", "support", "help", "backups"].includes(page)
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
      </aside>
      <main className="main-workspace">
        <StoreDecor />
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
                    setSaleTab("bill");
                    setSaleEditId(undefined);
                    setSaleSeed(undefined);
                    setBillEpoch((v) => v + 1);
                  }}
                  done={(s, result: any) => {
                    toast(s, { reload: true });
                    setSaleTab("bill");
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
              {saleTab === "history" && (
                <div
                  role="tabpanel"
                  id="history-panel"
                  aria-labelledby="history-tab"
                >
                  <DocumentsPage {...props} kind="sale" />
                </div>
              )}
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
              className={`sales-workspace purchase-workspace${purchaseTab === "bill" ? " is-bill" : ""}`}
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
                    setPurchaseTab("bill");
                    setPurchaseEditId(undefined);
                    setPurchaseEpoch((v) => v + 1);
                  }}
                  done={(s, result: any) => {
                    toast(s, { reload: true });
                    setPurchaseTab("bill");
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
              {purchaseTab === "history" && (
                <div
                  role="tabpanel"
                  id="purchase-history-panel"
                  aria-labelledby="purchase-history-tab"
                >
                  <DocumentsPage {...props} kind="purchase" />
                </div>
              )}
            </div>
          ) : page === "customers" ? (
            <PeoplePage key="customer" {...props} kind="customer" />
          ) : page === "suppliers" ? (
            <PeoplePage key="supplier" {...props} kind="supplier" />
          ) : page === "dailyBook" ? (
            <DayBookPage {...props} />
          ) : page === "expenses" ? (
            <DocumentsPage {...props} kind="expense" />
          ) : page === "capital" ? (
            user.permissions.includes("finance") ? (
              <CapitalPage {...props} />
            ) : (
              <div className="page-content">
                <h2>{t("nav.capital")}</h2>
              </div>
            )
          ) : page === "reports" ? (
            cost || user.permissions.includes("reports") ? (
              <ReportsPage
                key={reportTab || "reports"}
                {...props}
                initialTab={reportTab}
              />
            ) : (
              <div className="page-content">
                <h2>{t("reports.title")}</h2>
              </div>
            )
          ) : (
            <SettingsPage
              {...props}
              key={page}
              onSignOut={signOut}
              onLanguageChange={changeLanguage}
              initialTab={
                page === "about" ||
                page === "support" ||
                page === "help" ||
                page === "backups"
                  ? page
                  : page === "settings"
                    ? "account"
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
        <ProductForm
          product={modal.data}
          close={close}
          done={(s) => toast(s, { reload: true })}
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
      {["customer", "supplier"].includes(modal?.name || "") && (
        <PartyForm
          kind={modal!.name as "customer" | "supplier"}
          party={modal?.data || null}
          user={user}
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
      {["saleDelete", "purchaseDelete", "paymentDelete"].includes(
        modal?.name || "",
      ) &&
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
          edit={async () => {
            if (
              ["consignment_payment", "consignment_recovery"].includes(
                modal.data.kind,
              )
            ) {
              try {
                const doc = await api<any>("document", { id: modal.data.id });
                const detail = await api<any>("partyDetail", {
                  id: doc.party_id,
                  view: "resale",
                  limit: 1,
                });
                open("consignmentSettlement", {
                  id: doc.party_id,
                  name: doc.party_name,
                  balance: detail.party?.consignment_balance ?? 0,
                  payment: doc,
                });
              } catch (e: any) {
                toast(e.message);
              }
              return;
            }
            open(
              modal.data.kind === "purchase" ? "purchaseEdit" : "saleEdit",
              modal.data,
            );
          }}
          remove={() =>
            open(
              modal.data.kind === "purchase"
                ? "purchaseDelete"
                : modal.data.kind === "sale"
                  ? "saleDelete"
                  : "paymentDelete",
              modal.data,
            )
          }
        />
      )}
      {modal?.name === "partyDetail" && (
        <PartyDetailDialog
          party={modal.data}
          user={user}
          close={close}
          open={open}
          refresh={refresh}
          done={done}
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
  ownerUsername,
  onSuccess,
}: {
  setup: boolean;
  storeName: string;
  ownerUsername?: string;
  onSuccess: (s: any) => void;
}) {
  const { t, dir } = useI18n();
  const [remembered, setRemembered] = useState<any>(null);
  const [selectedUsername, setSelectedUsername] = useState(ownerUsername || "");
  const [recover, setRecover] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.vault
      ?.accounts?.("list")
      .then((saved) => {
        setRemembered(saved);
        if (saved.recovery) setRecover(true);
      })
      .catch((e) => {
        setError(e?.message || t("auth.rememberedLoadFailed"));
      });
  }, [t]);
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
        {remembered && remembered.profiles.length > 1 && (
          <Field label={t("rememberedAccounts.shop")}>
            <select
              value={remembered.current}
              onChange={async (e) => {
                try {
                  await window.vault!.accounts!(
                    recover ? "profile-recovery" : "profile",
                    e.target.value,
                  );
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            >
              {remembered.profiles.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.username}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorMessage error={recover ? error : ""} />
        {recover ? (
          <OwnerRecovery
            storeName={storeName}
            onClose={() => setRecover(false)}
            onSuccess={onSuccess}
          />
        ) : (
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
            {remembered &&
              (remembered.users.length > 1 ||
                remembered.profiles.length > 1) && (
                <div className="remembered-accounts">
                  {remembered.profiles.length > 1 && (
                    <div>
                      <small>{t("rememberedAccounts.removeHint")}</small>
                      {remembered.profiles.map((p: any) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
                          <span>
                            {p.name} · {p.username}
                          </span>
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await window.vault!.accounts!(
                                  "remove-profile",
                                  p.id,
                                );
                                setRemembered(
                                  await window.vault!.accounts!("list"),
                                );
                              } catch (error: any) {
                                setError(error.message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {t("rememberedAccounts.remove")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!setup && remembered.users.length > 1 && (
                    <Field label={t("rememberedAccounts.user")}>
                      <select
                        value={selectedUsername}
                        onChange={async (e) => {
                          const account = remembered.users.find(
                            (u: any) => u.username === e.target.value,
                          );
                          setSelectedUsername(e.target.value);
                          if (account?.signedIn) {
                            try {
                              await window.vault!.accounts!(
                                "select",
                                account.id,
                              );
                              location.reload();
                            } catch (error: any) {
                              setError(error.message);
                            }
                          }
                        }}
                      >
                        <option value="">
                          {t("rememberedAccounts.other")}
                        </option>
                        {remembered.users.map((u: any) => (
                          <option key={u.id} value={u.username}>
                            {u.name} · {u.username} {u.signedIn ? "✓" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {!setup &&
                    remembered.users.length > 1 &&
                    remembered.users.some(
                      (u: any) => u.username === selectedUsername && u.signedIn,
                    ) && (
                      <button
                        type="button"
                        className="button full"
                        onClick={async () => {
                          const account = remembered.users.find(
                            (u: any) => u.username === selectedUsername,
                          );
                          try {
                            await window.vault!.accounts!("select", account.id);
                            location.reload();
                          } catch (error: any) {
                            setError(error.message);
                          }
                        }}
                      >
                        {t("recovery.openStore")}
                      </button>
                    )}
                </div>
              )}
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
                value={setup ? undefined : selectedUsername}
                onChange={(e) => setSelectedUsername(e.target.value)}
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
                type={showPassword ? "text" : "password"}
                required
                minLength={setup ? 10 : 1}
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />{" "}
              {t("recovery.showPassword")}
            </label>
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
            {!setup && window.vault?.recovery && (
              <button
                type="button"
                className="button full"
                onClick={() => setRecover(true)}
              >
                {t("recovery.forgot")}
              </button>
            )}
          </form>
        )}
        <CompanyCredit />
      </div>
    </div>
  );
}
