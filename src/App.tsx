import { useCallback, useEffect, useRef, useState } from "react";
import {
  HandbagIcon,
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
  BankIcon,
  HardDrivesIcon,
  GearSixIcon,
  QuestionIcon,
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
import { Dashboard } from "./components/Dashboard";
import {
  ProductsPage,
  DocumentsPage,
  PeoplePage,
  DayBookPage,
  CapitalPage,
  ReportsPage,
  BackupsPage,
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
import {
  GlobalSearch,
  GlobalSearchHit,
} from "./components/GlobalSearch";
import { Modal, ErrorMessage, Field } from "./components/ui";
import { StoreDecor } from "./components/StoreDecor";
type AppModal = {
  name: string;
  data?: any;
  returnTo?: { name: string; data?: any };
};
const nav = [
  { name: "Dashboard", icon: SquaresFourIcon, permission: "" },
  { name: "Inventory", icon: PackageIcon, permission: "inventory" },
  { name: "Sales", icon: ShoppingCartSimpleIcon, permission: "sales" },
  { name: "Purchases", icon: TruckIcon, permission: "purchases" },
  { name: "Customers", icon: UsersIcon, permission: "people" },
  { name: "Suppliers", icon: BuildingsIcon, permission: "people" },
  { name: "Reports", icon: ChartBarIcon, permission: "reports" },
];
const general = [
  { name: "Daily book", icon: BookOpenTextIcon, permission: "finance" },
  { name: "Capital", icon: BankIcon, permission: "finance" },
  { name: "Expenses", icon: ReceiptIcon, permission: "finance" },
  { name: "Backups", icon: HardDrivesIcon, permission: "backups" },
  { name: "Settings", icon: GearSixIcon, permission: "settings" },
];
export function App() {
  const [status, setStatus] = useState<any>(null),
    [user, setUser] = useState<User | null>(null),
    [page, setPage] = useState("Inventory"),
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
    [saleSeed, setSaleSeed] = useState<Product | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
              if (!u.permissions.includes("inventory")) setPage("Dashboard");
            }
          } catch {
            setToken("");
          }
        }
      })
      .catch((e) => {
        if (active) setFatal(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const expired = () => {
      setToken("");
      setUser(null);
      setModal(null);
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
      setPage("Sales");
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
      setPage("Purchases");
      setPurchaseTab(name === "purchaseHistory" ? "history" : "bill");
      if (name !== "purchaseHistory") {
        setPurchaseEditId(name === "purchaseEdit" ? data.id : undefined);
        setPurchaseEpoch((v) => v + 1);
      }
      return;
    }
    if (name === "category") {
      setPage("Products");
      setSearch("");
      setCategoryFilter(data);
      return;
    }
    setModal((current) => {
      const stackFrom =
        current &&
        ["partyDetail", "productDetail"].includes(current.name) &&
        ["payment", "invoice", "openingBalance", "product"].includes(name);
      return {
        name,
        data,
        returnTo: stackFrom
          ? { name: current.name, data: current.data }
          : undefined,
      };
    });
  }, []);
  const navigate = useCallback((name: string) => {
    setPage(name);
    if (["Inventory", "Products"].includes(name))
      setCategoryFilter("All products");
    setSearch("");
    setProfile(false);
  }, []);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setGlobalOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && page === "Dashboard") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setProfile(false);
        setGlobalOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [page]);
  async function signOut() {
    await api("logout");
    setToken("");
    setUser(null);
    setProfile(false);
  }
  if (fatal)
    return (
      <div className="boot-screen">
        <div className="brand">
          <HandbagIcon weight="fill" />
          <span>vault</span>
        </div>
        <h2>Couldn’t open your store</h2>
        <p>{fatal}</p>
        <button
          className="button button-dark"
          onClick={() => location.reload()}
        >
          Try again
        </button>
      </div>
    );
  if (!status)
    return (
      <div className="boot-screen">
        <HandbagIcon size={36} weight="fill" />
        <p>Opening your store…</p>
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
          setPage("Inventory");
        }}
      />
    );
  const props = { user, refresh, open, toast, globalSearch: search };
  const cost = user.permissions.includes("view_costs");
  const current = page === "Products" ? "Inventory" : page;
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a
            href="#"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate("Inventory");
            }}
            aria-label="Vault inventory"
          >
            <HandbagIcon weight="fill" size={27} />
            <span>vault</span>
            <span className="brand-dot">®</span>
          </a>
          <button
            className="sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            <SidebarSimpleIcon size={18} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <span className="nav-label">MENU</span>
          <nav aria-label="Main navigation">
            {nav
              .filter(
                (n) => !n.permission || user.permissions.includes(n.permission),
              )
              .map((n) => (
                <button
                  key={n.name}
                  className={`nav-item ${current === n.name ? "active" : ""}`}
                  onClick={() => navigate(n.name)}
                  title={n.name}
                >
                  <n.icon
                    size={19}
                    weight={current === n.name ? "duotone" : "regular"}
                  />
                  <span>{n.name}</span>
                </button>
              ))}
          </nav>
          <div className="nav-divider" />
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="Workspace navigation">
            {general
              .filter((n) => user.permissions.includes(n.permission))
              .map((n) => (
                <button
                  key={n.name}
                  className={`nav-item ${current === n.name ? "active" : ""}`}
                  onClick={() => navigate(n.name)}
                  title={n.name}
                >
                  <n.icon size={18} />
                  <span>{n.name}</span>
                </button>
              ))}
            <button
              className="nav-item"
              onClick={() => open("help")}
              title="Help"
            >
              <QuestionIcon size={18} />
              <span>Help & shortcuts</span>
            </button>
          </nav>
          <div className="sidebar-spacer" />
          <div className="backup-promo">
            <span className="promo-icon">
              <ShieldCheckIcon size={21} weight="duotone" />
            </span>
            <h3>Your store. Protected.</h3>
            <p>Keep your business safe with automatic daily backups.</p>
            <button
              onClick={() =>
                navigate(
                  user.permissions.includes("backups")
                    ? "Backups"
                    : "Dashboard",
                )
              }
            >
              Manage backups <ArrowUpRightIcon size={13} />
            </button>
          </div>
          <div className="offline-status">
            <span className="live-dot" />
            <span>Working offline</span>
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
                {status.store.demo ? " · Demo workspace" : ""}
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
              <button onClick={signOut}>
                <SignOutIcon size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main-workspace">
        <StoreDecor />
        {page === "Dashboard" && (
          <header className="topbar">
            <div className="page-title">
              <h1>Dashboard</h1>
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                if (search.trim()) {
                  if (user.permissions.includes("inventory"))
                    setPage("Products");
                  else if (user.permissions.includes("sales")) setPage("Sales");
                }
              }}
            >
              <MagnifyingGlassIcon size={18} />
              <input
                ref={searchRef}
                aria-label="Search your store"
                placeholder="Search here"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </form>
            <div className="topbar-actions">
              <button
                className="header-icon filter-icon"
                aria-label="View inventory"
                title="View inventory"
                onClick={() =>
                  navigate(
                    user.permissions.includes("inventory")
                      ? "Products"
                      : "Dashboard",
                  )
                }
              >
                <SlidersHorizontalIcon size={19} />
              </button>
              <span className="header-divider" />
              <button
                className="header-icon"
                aria-label="Stock alerts"
                title="Stock alerts"
                onClick={() => open("lowStock")}
              >
                <BellIcon size={20} />
              </button>
              <button
                className="header-icon messages-icon"
                aria-label="Backup status"
                title="Backup status"
                onClick={() =>
                  navigate(
                    user.permissions.includes("backups")
                      ? "Backups"
                      : "Dashboard",
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
          className={`workspace-scroll${
            (page === "Sales" && saleTab === "bill") ||
            (page === "Purchases" && purchaseTab === "bill")
              ? " no-page-scroll"
              : ""
          }`}
        >
          {page === "Dashboard" ? (
            <Dashboard
              user={user}
              refresh={refresh}
              open={open}
              navigate={navigate}
            />
          ) : ["Products", "Inventory"].includes(page) ? (
            <ProductsPage {...props} initialCategory={categoryFilter} />
          ) : page === "Sales" ? (
            <div
              className={`sales-workspace${saleTab === "bill" ? " is-bill" : ""}`}
            >
              <div
                className="sales-tabs"
                role="tablist"
                aria-label="Sales workspace"
              >
                <button
                  role="tab"
                  id="bill-tab"
                  aria-controls="bill-panel"
                  aria-selected={saleTab === "bill"}
                  onClick={() => setSaleTab("bill")}
                >
                  {saleEditId ? "Edit bill" : "New bill"}
                </button>
                <button
                  role="tab"
                  id="history-tab"
                  aria-controls="history-panel"
                  aria-selected={saleTab === "history"}
                  onClick={() => setSaleTab("history")}
                >
                  Invoice history
                </button>
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
                    if (result?.print && result?.id)
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
            </div>
          ) : page === "Purchases" ? (
            <div
              className={`sales-workspace${purchaseTab === "bill" ? " is-bill" : ""}`}
            >
              <div
                className="sales-tabs"
                role="tablist"
                aria-label="Purchases workspace"
              >
                <button
                  role="tab"
                  id="purchase-bill-tab"
                  aria-controls="purchase-bill-panel"
                  aria-selected={purchaseTab === "bill"}
                  onClick={() => setPurchaseTab("bill")}
                >
                  {purchaseEditId ? "Edit purchase" : "New purchase"}
                </button>
                <button
                  role="tab"
                  id="purchase-history-tab"
                  aria-controls="purchase-history-panel"
                  aria-selected={purchaseTab === "history"}
                  onClick={() => setPurchaseTab("history")}
                >
                  Purchase history
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
                    if (result?.print && result?.id)
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
          ) : page === "Customers" ? (
            <PeoplePage {...props} kind="customer" />
          ) : page === "Suppliers" ? (
            <PeoplePage {...props} kind="supplier" />
          ) : page === "Daily book" ? (
            <DayBookPage {...props} />
          ) : page === "Capital" ? (
            <CapitalPage {...props} />
          ) : page === "Expenses" ? (
            <DocumentsPage {...props} kind="expense" />
          ) : page === "Reports" ? (
            cost ? (
              <ReportsPage {...props} />
            ) : (
              <div className="page-content">
                <h2>Profit reports require permission to view costs.</h2>
              </div>
            )
          ) : page === "Backups" ? (
            <BackupsPage {...props} />
          ) : (
            <SettingsPage {...props} />
          )}
        </div>
      </main>
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
      {modal?.name === "expense" && <ExpenseForm close={close} done={done} />}
      {modal?.name === "payment" && (
        <PaymentForm party={modal.data} close={close} done={done} />
      )}
      {["saleDelete", "purchaseDelete"].includes(modal?.name || "") && (
        <DeleteInvoiceDialog
          documentId={modal.data.id}
          close={close}
          done={done}
        />
      )}
      {modal?.name === "invoice" && (
        <InvoiceDialog
          documentId={modal.data.id}
          user={user}
          close={close}
          done={done}
          autoPrint={!!modal.data.autoPrint}
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
      {modal?.name === "lowStock" && (
        <Modal
          title="Low stock alerts"
          subtitle="Keep the products your customers need on the shelf."
          onClose={close}
          wide
        >
          <AlertsDialogContent refresh={refresh} open={open} />
          <div className="modal-actions">
            <button className="button" onClick={close}>
              Close
            </button>
            {user.permissions.includes("purchases") && (
              <button
                className="button button-dark"
                onClick={() => open("purchase")}
              >
                Receive a purchase <ArrowRightIcon size={15} />
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal?.name === "categoryInfo" && (
        <Modal title={`${modal.data} inventory`} onClose={close}>
          <div className="form-body">
            <p>
              Use the category filter on the inventory screen to view{" "}
              {String(modal.data).toLowerCase()}.
            </p>
            <button className="button button-dark" onClick={close}>
              View inventory
            </button>
          </div>
        </Modal>
      )}
      {modal?.name === "help" && (
        <Modal
          title="A little help, right here."
          subtitle="Everything you need to run your store, even without internet."
          onClose={close}
        >
          <div className="form-body help-content">
            <h3>Start with your products</h3>
            <p>
              Add products with their cost and opening stock in Inventory.
              Receive purchases to add more stock at actual costs.
            </p>
            <h3>Make a sale</h3>
            <p>
              Search for products, review their details, then add them to the
              bill. Add or choose a named customer for credit or partial
              payment; walk-in customers must pay in full.
            </p>
            <h3>Understand your profit</h3>
            <p>
              Reports use the recorded cost of sold items. Customer debt
              collections affect cash, not sales profit.
            </p>
            <h3>Protect your data</h3>
            <p>
              Add backup folders on a connected drive. Install the daily
              schedule from the desktop app and test a recovery copy regularly.
            </p>
            <div className="shortcut-row">
              <span>Search your store</span>
              <kbd>⌘ / Ctrl + K</kbd>
            </div>
            <div className="shortcut-row">
              <span>Close a dialog</span>
              <kbd>Esc</kbd>
            </div>
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
    <div className="auth-screen">
      <div className="auth-story">
        <div className="brand">
          <HandbagIcon size={35} weight="fill" />
          <span>vault</span>
        </div>
        <div>
          <span className="auth-eyebrow">BUILT FOR YOUR EVERYDAY</span>
          <h1>
            A clear view.
            <br />A better business.
          </h1>
          <p>
            Your products, customers and numbers.
            <br />
            Together, on your computer.
          </p>
          <span className="auth-offline">
            <WifiSlashIcon size={17} />
            Always available. Completely offline.
          </span>
        </div>
        <small>Vault Store · Inventory & accounting</small>
      </div>
      <div className="auth-form-container">
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-form-icon">
            <ShieldCheckIcon size={30} />
          </span>
          <h2>{setup ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {setup
              ? "Set up your store and create the owner account."
              : `Sign in to ${storeName}.`}
          </p>
          {setup && (
            <>
              <Field label="Store name">
                <input
                  name="storeName"
                  placeholder="Your store name"
                  required
                  minLength={2}
                />
              </Field>
              <Field label="Your full name">
                <input name="name" required minLength={2} />
              </Field>
            </>
          )}
          <Field label="Username">
            <input
              name="username"
              required
              minLength={3}
              autoComplete="username"
            />
          </Field>
          <Field
            label="Password"
            hint={setup ? "Use at least 10 characters." : ""}
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
            {busy ? "Opening…" : setup ? "Create your store" : "Sign in"}
            <ArrowRightIcon size={16} />
          </button>
          <p className="auth-note">
            <ShieldCheckIcon size={14} />
            Your data stays on this computer.
          </p>
        </form>
      </div>
    </div>
  );
}
