import { movementBalances } from "../product-movements.mjs";
import "./product-detail.css";
import { ProductPhoto } from "./ProductPhoto";
import { CurrencyPicker, CurrencyFlag } from "./CurrencyPicker";
import { expenseAccountName } from "../expense-accounts";
import { useEffect, useState, useRef } from "react";
import {
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
  PrinterIcon,
  ArrowCounterClockwiseIcon,
  PackageIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  DownloadSimpleIcon,
  BarcodeIcon,
} from "@phosphor-icons/react";
import {
  api,
  af,
  aed,
  foreignMoney,
  toMoney,
  toFxRate,
  afnFromAed,
  fxRateLabel,
  fxRateInput,
  moneyInput,
  sanitizeNumericInput,
  requestKey,
  businessDate,
  Product,
  Party,
  User,
  productSpecEntries,
} from "../api";
import { useT, useI18n } from "../i18n";
import { PrintDialog } from "../printing/PrintDialog";
import { invoicePrintModel } from "../printing/models.mjs";
import type { PrintDocument } from "../printing/types";
import {
  Modal,
  Field,
  Search,
  ProductName,
  Badge,
  Empty,
  ErrorMessage,
  NumericInput,
} from "./ui";
type DialogProps = {
  close: () => void;
  done: (message: string, result?: unknown) => void;
};
export {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  categoryLabel,
  specFieldLabel,
} from "./product-fields";
import { PRODUCT_CATEGORIES, categoryLabel } from "./product-fields";
import { ProductForm } from "./ProductForm";
export { ProductForm } from "./ProductForm";

type CartLine = {
  product: Product;
  quantity: number;
  price: string;
  discount: string;
  /** Per-unit supplier quote in the selected currency (major-unit string). */
  costAed?: string;
};
function BillFrame({
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return <section className="panel bill-editor">{children}</section>;
}
export function TradeForm({
  kind,
  close,
  done,
  inline = false,
  documentId,
  seedProduct,
}: {
  kind: "sale" | "purchase";
  inline?: boolean;
  documentId?: string;
  seedProduct?: Product;
} & DialogProps) {
  const t = useT();
  const PAGE = 8;
  const [q, setQ] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [next, setNext] = useState<string | null>(null),
    [parties, setParties] = useState<Party[]>([]),
    [party, setParty] = useState(""),
    [lines, setLines] = useState<CartLine[]>([]),
    [paid, setPaid] = useState(""),
    [paymentInForeign, setPaymentInForeign] = useState(true),
    [currency, setCurrency] = useState(kind === "purchase" ? "AED" : "AFN"),
    [fxRate, setFxRate] = useState(kind === "purchase" ? "" : "1"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [initial, setInitial] = useState<any>(null),
    [loading, setLoading] = useState(!!documentId),
    [addingParty, setAddingParty] = useState(false),
    [addingProduct, setAddingProduct] = useState(false),
    [searching, setSearching] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [scanCode, setScanCode] = useState(""),
    [scanBusy, setScanBusy] = useState(false),
    [customerMode, setCustomerMode] = useState<"new" | "existing">(
      documentId ? "existing" : "new",
    ),
    [customerName, setCustomerName] = useState(""),
    [printAfter, setPrintAfter] = useState(false);
  const key = useRef(requestKey());
  const barcodeRef = useRef<HTMLInputElement>(null);
  const Frame = inline ? BillFrame : Modal;
  const purchase = kind === "purchase";
  const selectedParty = parties.find((p) => p.id === party);
  const saleCustomerReady = purchase
    ? Boolean(party)
    : customerMode === "new"
      ? customerName.trim().length >= 2
      : Boolean(party);
  useEffect(() => {
    let active = true;
    setSearching(true);
    setNext(null);
    const query = q.trim();
    const timer = setTimeout(
      () =>
        api<{ rows: Product[]; next: string | null }>("catalog", {
          q: query,
          limit: PAGE,
        })
          .then((d) => {
            if (!active) return;
            setProducts(d.rows);
            setNext(d.next);
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setSearching(false);
          }),
      query ? 150 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q]);
  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Product[]; next: string | null }>("catalog", {
        q: q.trim(),
        after: next,
        limit: PAGE,
      });
      setProducts((rows) => {
        const seen = new Set(rows.map((p) => p.id));
        return [...rows, ...d.rows.filter((p) => !seen.has(p.id))];
      });
      setNext(d.next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    let active = true;
    api<{ rows: Party[] }>("parties", {
      kind: purchase ? "supplier" : "customer",
      limit: 100,
    })
      .then((d) => {
        if (!active) return;
        setParties(d.rows);
        if (!documentId && purchase) setParty(d.rows[0]?.id || "");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [purchase, documentId]);
  useEffect(() => {
    if (!documentId) return;
    let active = true;
    setLoading(true);
    api("document", { id: documentId })
      .then(async (doc) => {
        const loaded = await Promise.all(
          doc.lines.map(async (line: any) => {
            const catalog = await api("catalog", { id: line.product_id });
            const found = catalog.rows.find(
              (p: Product) => p.id === line.product_id,
            );
            if (!found)
              throw new Error(t("sales.errProductGone", { name: line.name }));
            return {
              product: { ...found, stock: found.stock + line.quantity },
              quantity: line.quantity,
              price: String(line.price / 100),
              discount: String(line.discount / 100),
              costAed:
                (line.cost_foreign ?? line.cost_aed)
                  ? moneyInput(line.cost_foreign ?? line.cost_aed)
                  : "0",
            };
          }),
        );
        if (active) {
          setInitial(doc);
          setParty(doc.party_id);
          setCustomerMode("existing");
          setCustomerName(doc.party_name || "");
          const hasForeignPayment = doc.paid_foreign != null;
          setPaymentInForeign(hasForeignPayment);
          setPaid(moneyInput(hasForeignPayment ? doc.paid_foreign : doc.paid));
          setCurrency(
            kind === "sale" && !hasForeignPayment
              ? "AFN"
              : doc.currency || "AED",
          );
          setFxRate(
            kind === "sale" && !hasForeignPayment
              ? "1"
              : doc.fx_rate
                ? fxRateInput(doc.fx_rate)
                : "",
          );
          setLines(loaded);
        }
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
  }, [documentId]);
  function afnPriceFromAed(aedMajor: string, rateMajor: string) {
    try {
      if (!aedMajor.trim() || !rateMajor.trim()) return "";
      return moneyInput(afnFromAed(toMoney(aedMajor), toFxRate(rateMajor)));
    } catch {
      return "";
    }
  }
  function add(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    const sourceCost =
      p.currency === currency || (!p.currency && currency === "AED")
        ? (p.cost_foreign ?? p.cost_aed ?? 0)
        : 0;
    const costAedMajor = sourceCost ? moneyInput(sourceCost) : "";
    setLines((ls) =>
      ls.some((l) => l.product.id === p.id)
        ? ls
        : [
            ...ls,
            {
              product: p,
              quantity: 1,
              price: purchase
                ? afnPriceFromAed(costAedMajor, fxRate) || ""
                : String(p.price / 100),
              discount: "0",
              ...(purchase ? { costAed: costAedMajor } : {}),
            },
          ],
    );
    if (q) setQ("");
  }
  async function scanBarcode() {
    const code = scanCode.trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setError("");
    try {
      const d = await api<{ rows: Product[] }>("catalog", {
        barcode: code,
        limit: 1,
      });
      const p = d.rows[0];
      if (!p) throw new Error(t("sales.errBarcode", { code }));
      if (!purchase && p.stock <= 0)
        throw new Error(t("sales.errOutOfStock", { name: p.name }));
      if (lines.some((l) => l.product.id === p.id))
        throw new Error(t("sales.errOnBill", { name: p.name }));
      add(p);
      setScanCode("");
      barcodeRef.current?.focus();
    } catch (e: any) {
      setError(e.message);
      barcodeRef.current?.select();
    } finally {
      setScanBusy(false);
    }
  }
  useEffect(() => {
    if (!seedProduct || documentId) return;
    add(seedProduct);
    // Seed once when the bill opens from global search / product detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedProduct?.id, documentId]);
  const update = (i: number, key: keyof CartLine, v: any) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (i !== j) return l;
        const next = { ...l, [key]: v };
        if (purchase && (key === "costAed" || key === "price")) {
          if (key === "costAed") {
            const afn = afnPriceFromAed(String(v), fxRate);
            if (afn) next.price = afn;
          }
        }
        return next;
      }),
    );
  function applyFxRate(rate: string) {
    setFxRate(rate);
    if (!purchase) return;
    setLines((ls) =>
      ls.map((l) => {
        const afn = afnPriceFromAed(l.costAed || "", rate);
        return afn ? { ...l, price: afn } : l;
      }),
    );
  }
  function changeCurrency(code: string) {
    setCurrency(code);
    setPaid("");
    setPaymentInForeign(true);
    const rate = code === "AFN" ? "1" : "";
    setFxRate(rate);
    setLines((current) =>
      current.map((l) => ({
        ...l,
        costAed: code === "AFN" ? l.price : "",
        price: code === "AFN" ? l.price : "",
      })),
    );
  }
  const total = lines.reduce(
    (s, l) =>
      s +
      Math.round(Number(l.price || 0) * 100) * l.quantity -
      Math.round(Number(l.discount || 0) * 100),
    0,
  );
  const payment = (() => {
    try {
      const amount = paid.trim() === "" ? 0 : toMoney(paid);
      return paymentInForeign
        ? afnFromAed(amount, fxRate.trim() ? toFxRate(fxRate) : 0)
        : amount;
    } catch {
      return 0;
    }
  })();
  const paymentHint = paymentInForeign
    ? t("currencies.paymentPreview", { amount: af(payment, 2) })
    : t("sales.amountPaidHint");
  async function resolveSalePartyId() {
    if (purchase) {
      if (!party) throw new Error(t("sales.errChooseSupplier"));
      return party;
    }
    if (customerMode === "existing") {
      if (!party) throw new Error(t("sales.errChooseCustomer"));
      return party;
    }
    const name = customerName.trim();
    if (name.length < 2) throw new Error(t("sales.errCustomerName"));
    const match = parties.find(
      (p) => !p.walk_in && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) return match.id;
    const created = await api<{ id: string }>("partyCreate", {
      kind: "customer",
      name,
      request_key: requestKey(),
    });
    const refreshed = await api<{ rows: Party[] }>("parties", {
      kind: "customer",
      limit: 100,
    });
    setParties(refreshed.rows);
    setParty(created.id);
    return created.id;
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const enteredPaid = paid.trim() === "" ? 0 : toMoney(paid);
      const rate = fxRate.trim() ? toFxRate(fxRate) : 0;
      if (paymentInForeign && !rate)
        throw new Error(t("currencies.rateRequired"));
      if (purchase && lines.some((l) => (l.costAed || "").trim()) && !rate)
        throw new Error(t("currencies.rateRequired"));
      const partyId = await resolveSalePartyId();
      const payload = lines.map((l) => {
        const cost_aed =
          purchase && (l.costAed || "").trim() ? toMoney(l.costAed!) : 0;
        const price = toMoney(l.price);
        if (purchase && cost_aed) {
          const expected = afnFromAed(cost_aed, rate);
          if (Math.abs(price - expected) > 1)
            throw new Error(
              t("currencies.costMismatch", { name: l.product.name }),
            );
        }
        return {
          product_id: l.product.id,
          quantity: l.quantity,
          price,
          discount: toMoney(l.discount),
          ...(purchase
            ? {
                currency,
                cost_foreign: cost_aed,
                cost_aed: currency === "AED" ? cost_aed : 0,
                fx_rate: rate,
              }
            : {}),
        };
      });
      const posted = await api<any>(
        documentId ? (purchase ? "purchaseEdit" : "saleEdit") : kind,
        {
          ...(documentId ? { id: documentId, revision: initial.revision } : {}),
          party_id: partyId,
          lines: payload,
          paid: payment,
          ...(paymentInForeign ? { paid_foreign: enteredPaid } : {}),
          date: f.get("date"),
          due_date: null,
          note: "",
          ...(purchase || paymentInForeign ? { currency, fx_rate: rate } : {}),
          request_key: key.current,
        },
      );
      done(
        purchase
          ? documentId
            ? t("sales.purchaseUpdated")
            : t("sales.purchasePosted")
          : documentId
            ? t("sales.saleUpdated")
            : t("sales.salePosted"),
        {
          id: posted?.id,
          kind: posted?.kind || kind,
          print: printAfter === true,
        },
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Frame
        title={
          purchase
            ? initial
              ? t("sales.editDoc", { number: initial.number })
              : t("sales.receivePurchase")
            : initial
              ? t("sales.editDoc", { number: initial.number })
              : t("sales.newBill")
        }
        subtitle={
          purchase ? t("sales.subtitlePurchase") : t("sales.subtitleSale")
        }
        onClose={close}
        wide
      >
        {loading ? (
          <div className="form-body">{t("sales.loadingInvoice")}</div>
        ) : (
          <form
            onSubmit={submit}
            className={inline ? "sale-fit-form" : undefined}
          >
            {inline ? (
              <div className={`sale-board${purchase ? " purchase-board" : ""}`}>
                <section className="sale-board-left">
                  <div className="sale-customer-panel">
                    {purchase ? (
                      <div className="sale-customer-fields purchase-party-fields">
                        <label className="sale-customer-name">
                          <span>{t("sales.supplier")}</span>
                          <div className="inline-actions party-picker">
                            <select
                              value={party}
                              onChange={(e) => setParty(e.target.value)}
                              required
                            >
                              <option value="">
                                {t("sales.chooseSupplier")}
                              </option>
                              {parties.map((p) => (
                                <option value={p.id} key={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="button"
                              onClick={() => setAddingParty(true)}
                            >
                              <PlusIcon size={15} />
                              {t("common.add")}
                            </button>
                          </div>
                        </label>
                        <label className="sale-customer-date">
                          <span>{t("common.date")}</span>
                          <input
                            type="date"
                            name="date"
                            defaultValue={initial?.date || businessDate()}
                            max={businessDate()}
                            required
                          />
                        </label>
                        <div className="sale-customer-name purchase-currency-field">
                          <span>{t("currencies.choose")}</span>
                          <CurrencyPicker
                            value={currency}
                            onChange={changeCurrency}
                            compact
                          />
                        </div>
                        <label className="sale-customer-name purchase-rate-field">
                          <span>
                            {t("currencies.rateShort", { code: currency })}
                          </span>
                          <NumericInput
                            aria-label={t("currencies.rate", {
                              code: currency,
                            })}
                            title={t("currencies.rateHint")}
                            min="0"
                            step="0.0001"
                            value={fxRate}
                            readOnly={currency === "AFN"}
                            onChange={(e) => applyFxRate(e.target.value)}
                            placeholder="0.00"
                            required
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <div className="sale-customer-row">
                          <div
                            className="sale-customer-modes"
                            role="tablist"
                            aria-label={t("sales.customerEntry")}
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={customerMode === "new"}
                              className={customerMode === "new" ? "active" : ""}
                              onClick={() => setCustomerMode("new")}
                            >
                              {t("sales.typeName")}
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={customerMode === "existing"}
                              className={
                                customerMode === "existing" ? "active" : ""
                              }
                              onClick={() => setCustomerMode("existing")}
                            >
                              {t("sales.existing")}
                            </button>
                          </div>
                          {customerMode === "new" ? (
                            <label className="sale-customer-name">
                              <span>{t("sales.customer")}</span>
                              <input
                                value={customerName}
                                onChange={(e) =>
                                  setCustomerName(e.target.value)
                                }
                                placeholder={t("sales.customerPh")}
                                minLength={2}
                                required
                                autoComplete="off"
                              />
                            </label>
                          ) : (
                            <label className="sale-customer-name">
                              <span>{t("sales.customer")}</span>
                              <div className="inline-actions party-picker">
                                <select
                                  value={party}
                                  onChange={(e) => setParty(e.target.value)}
                                  required
                                >
                                  <option value="">
                                    {t("sales.chooseCustomer")}
                                  </option>
                                  {parties.map((p) => (
                                    <option value={p.id} key={p.id}>
                                      {p.name}
                                      {p.walk_in
                                        ? t("sales.walkInCashOnly")
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="button"
                                  onClick={() => setAddingParty(true)}
                                >
                                  <PlusIcon size={15} />
                                  {t("common.add")}
                                </button>
                              </div>
                            </label>
                          )}
                          <label className="sale-customer-date">
                            <span>{t("common.date")}</span>
                            <input
                              type="date"
                              name="date"
                              defaultValue={initial?.date || businessDate()}
                              max={businessDate()}
                              required
                            />
                          </label>
                        </div>
                        {customerMode === "new" && (
                          <small className="sale-customer-hint">
                            {t("sales.customerHint")}
                          </small>
                        )}
                        {customerMode === "existing" &&
                          selectedParty?.walk_in &&
                          total - payment > 0 && (
                            <p className="credit-hint">
                              {t("sales.walkInMustPay")}
                            </p>
                          )}
                      </>
                    )}
                  </div>
                  <div className="sale-catalog-panel">
                    <div className="trade-panel-head">
                      <div>
                        <h3>{t("sales.productCatalog")}</h3>
                      </div>
                      <div className="trade-catalog-actions">
                        {purchase && (
                          <button
                            type="button"
                            className="button"
                            onClick={() => setAddingProduct(true)}
                          >
                            <PlusIcon size={15} />
                            {t("sales.newProduct")}
                          </button>
                        )}
                        <span className="subtle">
                          {next
                            ? t("sales.shownMore", { n: products.length })
                            : t("sales.shown", { n: products.length })}
                        </span>
                      </div>
                    </div>
                    <div className="trade-catalog-tools">
                      <div className="trade-barcode-scan">
                        <BarcodeIcon size={18} />
                        <input
                          ref={barcodeRef}
                          aria-label={t("sales.scanBarcode")}
                          placeholder={t("sales.scanPh")}
                          value={scanCode}
                          onChange={(e) => setScanCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              scanBarcode();
                            }
                          }}
                          inputMode="numeric"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="button"
                          disabled={scanBusy || !scanCode.trim()}
                          onClick={scanBarcode}
                        >
                          {scanBusy ? t("sales.looking") : t("common.add")}
                        </button>
                      </div>
                      <Search
                        value={q}
                        onChange={setQ}
                        placeholder={t("sales.searchCatalog")}
                      />
                    </div>
                    <div
                      className="product-browser-list sale-product-list"
                      role="listbox"
                      aria-label={t("sales.availableProducts")}
                    >
                      {searching ? (
                        <div className="product-browser-empty">
                          <span className="muted">
                            {t("sales.loadingProducts")}
                          </span>
                        </div>
                      ) : products.length ? (
                        <>
                          {products.map((p) => {
                            const detail = [
                              p.brand,
                              p.model,
                              p.sku,
                              p.barcode ? `⌗ ${p.barcode}` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ");
                            const added = lines.some(
                              (l) => l.product.id === p.id,
                            );
                            const out = !purchase && p.stock === 0;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                role="option"
                                className="product-pick-card"
                                disabled={added || out}
                                onClick={() => add(p)}
                              >
                                <span className="product-pick-image">
                                  <ProductPhoto product={p} />
                                </span>
                                <span className="product-pick-body">
                                  <strong>{p.name}</strong>
                                  {detail ? <small>{detail}</small> : null}
                                  <span className="product-pick-meta">
                                    <em>
                                      {purchase
                                        ? p.category || t("sales.catalogLabel")
                                        : af(p.price)}
                                    </em>
                                    <em>
                                      {purchase
                                        ? t("sales.inCatalog")
                                        : out
                                          ? t("sales.outOfStock")
                                          : t("productDetail.inStock", {
                                              n: p.stock,
                                            })}
                                    </em>
                                  </span>
                                </span>
                                <PlusIcon size={18} />
                              </button>
                            );
                          })}
                          {next && (
                            <button
                              type="button"
                              className="button product-load-more"
                              disabled={loadingMore}
                              onClick={loadMore}
                            >
                              {loadingMore
                                ? t("common.loading")
                                : t("sales.loadMoreProducts")}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="product-browser-empty">
                          <PackageIcon size={28} weight="light" />
                          <p>
                            {q.trim()
                              ? t("sales.noMatchSearch")
                              : purchase
                                ? t("sales.noProductsPurchase")
                                : t("sales.noProductsSale")}
                          </p>
                          {purchase && (
                            <button
                              type="button"
                              className="button button-dark"
                              onClick={() => setAddingProduct(true)}
                            >
                              <PlusIcon size={15} />
                              {t("sales.newProduct")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
                <section className="sale-board-right">
                  <div className="sale-bill-panel">
                    <div className="trade-panel-head">
                      <div>
                        <h3>{t("sales.billLines")}</h3>
                        <p>
                          {lines.length
                            ? t("sales.productsCount", { n: lines.length })
                            : t("sales.addFromCatalog")}
                        </p>
                      </div>
                    </div>
                    <div className="cart-lines">
                      {lines.map((l, i) => (
                        <div className="cart-line" key={l.product.id}>
                          <div className="cart-line-title">
                            <ProductName product={l.product} />
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("sales.removeProduct", {
                                name: l.product.name,
                              })}
                              onClick={() =>
                                setLines((ls) => ls.filter((_, j) => j !== i))
                              }
                            >
                              <TrashIcon size={17} />
                            </button>
                          </div>
                          <div className="form-grid three">
                            <Field label={t("common.quantity")}>
                              <NumericInput
                                kind="integer"
                                aria-label={t("sales.productQty", {
                                  name: l.product.name,
                                })}
                                min="1"
                                max={purchase ? 100000 : l.product.stock}
                                value={l.quantity}
                                onChange={(e) =>
                                  update(
                                    i,
                                    "quantity",
                                    Number(e.target.value) || 0,
                                  )
                                }
                                required
                              />
                            </Field>
                            {purchase ? (
                              <>
                                <Field
                                  label={t("currencies.costShort", {
                                    code: currency,
                                  })}
                                >
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.costAed ?? ""}
                                    onChange={(e) =>
                                      update(i, "costAed", e.target.value)
                                    }
                                    placeholder="0.00"
                                    required
                                  />
                                </Field>
                                <Field label={t("sales.costAf")}>
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.price}
                                    readOnly
                                    tabIndex={-1}
                                    placeholder={fxRate.trim() ? "0.00" : "—"}
                                    required
                                  />
                                </Field>
                                <Field label={t("currencies.discountShort")}>
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.discount}
                                    onChange={(e) =>
                                      update(i, "discount", e.target.value)
                                    }
                                    required
                                  />
                                </Field>
                              </>
                            ) : (
                              <>
                                <Field label={t("sales.unitPrice")}>
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.price}
                                    onChange={(e) =>
                                      update(i, "price", e.target.value)
                                    }
                                    required
                                  />
                                </Field>
                                <Field label={t("sales.lineDiscount")}>
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.discount}
                                    onChange={(e) =>
                                      update(i, "discount", e.target.value)
                                    }
                                    required
                                  />
                                </Field>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!lines.length && (
                      <div className="cart-empty">
                        <ShoppingIllustration />
                        <p>
                          {purchase
                            ? t("sales.emptyPurchase")
                            : t("sales.emptyBill")}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="sale-pay-panel">
                    {!purchase && (
                      <div className="sale-payment-currency">
                        <Field label={t("currencies.paymentCurrency")}>
                          <CurrencyPicker
                            compact
                            value={currency}
                            onChange={(code) => {
                              setCurrency(code);
                              setFxRate(code === "AFN" ? "1" : "");
                              setPaid("");
                              setPaymentInForeign(true);
                            }}
                          />
                        </Field>
                        <Field
                          label={t("currencies.rateShort", { code: currency })}
                        >
                          <NumericInput
                            name="payment_rate"
                            value={fxRate}
                            readOnly={currency === "AFN"}
                            onChange={(e) => applyFxRate(e.target.value)}
                            placeholder="0.00"
                            required
                          />
                        </Field>
                      </div>
                    )}
                    <div className="trade-totals">
                      {purchase && (
                        <div>
                          <span className="currency-rate-label">
                            {t("currencies.supplierSubtotal")}
                          </span>
                          <strong>
                            <bdi dir="ltr">
                              {foreignMoney(
                                lines.reduce(
                                  (sum, l) =>
                                    sum +
                                    Math.round(Number(l.costAed || 0) * 100) *
                                      l.quantity,
                                  0,
                                ),
                                currency,
                              )}
                            </bdi>
                          </strong>
                        </div>
                      )}
                      <div>
                        <span>{t("sales.invoiceTotal")}</span>
                        <strong>{af(total, 2)}</strong>
                      </div>
                      <div>
                        <span>{t("sales.balanceRemaining")}</span>
                        <strong>{af(Math.max(0, total - payment), 2)}</strong>
                      </div>
                      <Field
                        label={
                          paymentInForeign
                            ? t("currencies.amountPaid", { code: currency })
                            : t("sales.amountPaid")
                        }
                        hint={paymentHint}
                      >
                        <NumericInput
                          name="paid"
                          min="0"
                          max={paymentInForeign ? undefined : total / 100}
                          step="0.01"
                          value={paid}
                          placeholder="0.00"
                          onChange={(e) => setPaid(e.target.value)}
                        />
                      </Field>
                    </div>
                    {purchase && !paymentInForeign && (
                      <button
                        type="button"
                        className="text-button legacy-payment-switch"
                        onClick={() => {
                          setPaymentInForeign(true);
                          setPaid("");
                        }}
                      >
                        {t("currencies.usePaymentCurrency", { code: currency })}
                      </button>
                    )}
                    <ErrorMessage error={error} />
                    <div className="sale-actions">
                      <label className="sale-print-check">
                        <input
                          type="checkbox"
                          checked={printAfter}
                          onChange={(e) => setPrintAfter(e.target.checked)}
                        />
                        <PrinterIcon size={15} />
                        {t("sales.printAfter")}
                      </label>
                      <button type="button" className="button" onClick={close}>
                        {t("common.cancel")}
                      </button>
                      <button
                        className="button button-dark"
                        disabled={
                          busy ||
                          !lines.length ||
                          !saleCustomerReady ||
                          (!!documentId && !initial)
                        }
                      >
                        {busy
                          ? t("common.posting")
                          : purchase
                            ? documentId
                              ? t("sales.savePurchase")
                              : t("sales.receivePurchase")
                            : documentId
                              ? t("sales.saveInvoice")
                              : t("sales.createSale")}
                        <ArrowRightIcon size={16} />
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <>
                <div className="form-body trade-body">
                  <div className="trade-meta">
                    {purchase && (
                      <div className="purchase-rate-bar">
                        <Field label={t("currencies.choose")}>
                          <CurrencyPicker
                            value={currency}
                            onChange={changeCurrency}
                          />
                        </Field>
                        <Field
                          label={t("currencies.rate", { code: currency })}
                          hint={t("currencies.rateHint")}
                        >
                          <NumericInput
                            min="0"
                            step="0.0001"
                            value={fxRate}
                            readOnly={currency === "AFN"}
                            onChange={(e) => applyFxRate(e.target.value)}
                            placeholder={t("currencies.ratePlaceholder")}
                            required
                          />
                        </Field>
                        <p className="purchase-rate-note">
                          {fxRate.trim()
                            ? t("currencies.rateValue", {
                                code: currency,
                                rate: fxRate,
                              })
                            : t("currencies.rateHint")}
                        </p>
                      </div>
                    )}
                    <div className="form-grid three">
                      <Field label={t("sales.supplier")}>
                        <div className="inline-actions party-picker">
                          <select
                            value={party}
                            onChange={(e) => setParty(e.target.value)}
                            required
                          >
                            <option value="">
                              {t("sales.chooseSupplier")}
                            </option>
                            {parties.map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setAddingParty(true)}
                          >
                            <PlusIcon size={15} />
                            {t("common.add")}
                          </button>
                        </div>
                      </Field>
                      <Field label={t("sales.invoiceDate")}>
                        <input
                          type="date"
                          name="date"
                          defaultValue={initial?.date || businessDate()}
                          max={businessDate()}
                          required
                        />
                      </Field>
                      <Field label={t("sales.paymentDueOptional")}>
                        <input
                          type="date"
                          name="due_date"
                          defaultValue={initial?.due_date || ""}
                        />
                      </Field>
                    </div>
                  </div>
                  <div className="trade-workspace">
                    <section className="trade-catalog">
                      <div className="trade-panel-head">
                        <div>
                          <h3>{t("sales.productCatalog")}</h3>
                          <p>{t("sales.purchaseCatalogHint")}</p>
                        </div>
                        <div className="trade-catalog-actions">
                          <button
                            type="button"
                            className="button"
                            onClick={() => setAddingProduct(true)}
                          >
                            <PlusIcon size={15} />
                            {t("sales.newProduct")}
                          </button>
                          <span className="subtle">
                            {next
                              ? t("sales.shownMore", { n: products.length })
                              : t("sales.shown", { n: products.length })}
                          </span>
                        </div>
                      </div>
                      <div className="trade-catalog-tools">
                        <div className="trade-barcode-scan">
                          <BarcodeIcon size={18} />
                          <input
                            ref={barcodeRef}
                            aria-label={t("sales.scanBarcode")}
                            placeholder={t("sales.scanPh")}
                            value={scanCode}
                            onChange={(e) => setScanCode(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                scanBarcode();
                              }
                            }}
                            inputMode="numeric"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="button"
                            disabled={scanBusy || !scanCode.trim()}
                            onClick={scanBarcode}
                          >
                            {scanBusy ? t("sales.looking") : t("common.add")}
                          </button>
                        </div>
                        <Search
                          value={q}
                          onChange={setQ}
                          placeholder={t("sales.searchCatalog")}
                        />
                      </div>
                      <div
                        className="product-browser-list"
                        role="listbox"
                        aria-label={t("sales.availableProducts")}
                      >
                        {searching ? (
                          <div className="product-browser-empty">
                            <span className="muted">
                              {t("sales.loadingProducts")}
                            </span>
                          </div>
                        ) : products.length ? (
                          <>
                            {products.map((p) => {
                              const specs = Object.entries(p.attributes || {})
                                .filter(([, v]) => v)
                                .slice(0, 3)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ");
                              const added = lines.some(
                                (l) => l.product.id === p.id,
                              );
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="option"
                                  className="product-pick-card"
                                  disabled={added}
                                  onClick={() => add(p)}
                                >
                                  <span className="product-pick-image">
                                    <ProductPhoto product={p} />
                                  </span>
                                  <span className="product-pick-body">
                                    <strong>{p.name}</strong>
                                    <small>
                                      {[p.brand, p.model, p.sku]
                                        .filter(Boolean)
                                        .join(" · ")}
                                      {p.barcode ? ` · ⌗ ${p.barcode}` : ""}
                                    </small>
                                    {specs ? <small>{specs}</small> : null}
                                    <span className="product-pick-meta">
                                      <em>{af(p.price)}</em>
                                      <em>{t("sales.inCatalog")}</em>
                                    </span>
                                  </span>
                                  <PlusIcon size={18} />
                                </button>
                              );
                            })}
                            {next && (
                              <button
                                type="button"
                                className="button product-load-more"
                                disabled={loadingMore}
                                onClick={loadMore}
                              >
                                {loadingMore
                                  ? t("common.loading")
                                  : t("sales.loadMoreProducts")}
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="product-browser-empty">
                            <PackageIcon size={28} weight="light" />
                            <p>
                              {q.trim()
                                ? t("sales.noMatchSearch")
                                : t("sales.noProductsPurchaseFirst")}
                            </p>
                            <button
                              type="button"
                              className="button button-dark"
                              onClick={() => setAddingProduct(true)}
                            >
                              <PlusIcon size={15} />
                              {t("sales.newProduct")}
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                    <section className="trade-cart">
                      <div className="trade-panel-head">
                        <div>
                          <h3>{t("sales.billLines")}</h3>
                          <p>
                            {lines.length
                              ? t("sales.linesOnInvoice", { n: lines.length })
                              : t("sales.addedProductsHere")}
                          </p>
                        </div>
                      </div>
                      <div className="cart-lines">
                        {lines.map((l, i) => (
                          <div className="cart-line" key={l.product.id}>
                            <div className="cart-line-title">
                              <ProductName product={l.product} />
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={t("sales.removeProduct", {
                                  name: l.product.name,
                                })}
                                onClick={() =>
                                  setLines((ls) => ls.filter((_, j) => j !== i))
                                }
                              >
                                <TrashIcon size={17} />
                              </button>
                            </div>
                            <div className="form-grid three">
                              <Field label={t("common.quantity")}>
                                <NumericInput
                                  kind="integer"
                                  aria-label={t("sales.productQty", {
                                    name: l.product.name,
                                  })}
                                  min="1"
                                  max={100000}
                                  value={l.quantity}
                                  onChange={(e) =>
                                    update(
                                      i,
                                      "quantity",
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                  required
                                />
                              </Field>
                              <Field
                                label={
                                  <span className="currency-rate-label">
                                    <CurrencyFlag code={currency} />
                                    {t("currencies.unitCost", {
                                      code: currency,
                                    })}
                                  </span>
                                }
                              >
                                <NumericInput
                                  min="0"
                                  step="0.01"
                                  value={l.costAed ?? ""}
                                  onChange={(e) =>
                                    update(i, "costAed", e.target.value)
                                  }
                                  placeholder="0.00"
                                  required
                                />
                              </Field>
                              <Field label={t("sales.costAf")}>
                                <NumericInput
                                  min="0"
                                  step="0.01"
                                  value={l.price}
                                  readOnly
                                  tabIndex={-1}
                                  placeholder={
                                    fxRate.trim()
                                      ? t("sales.autoFromRate")
                                      : t("currencies.ratePlaceholder")
                                  }
                                  required
                                />
                              </Field>
                            </div>
                            <div className="form-grid" style={{ marginTop: 4 }}>
                              <Field label={t("sales.lineDiscountAf")}>
                                <NumericInput
                                  min="0"
                                  step="0.01"
                                  value={l.discount}
                                  onChange={(e) =>
                                    update(i, "discount", e.target.value)
                                  }
                                  required
                                />
                              </Field>
                            </div>
                          </div>
                        ))}
                      </div>
                      {!lines.length && (
                        <div className="cart-empty">
                          <ShoppingIllustration />
                          <p>{t("sales.emptyPurchaseBrowse")}</p>
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="trade-footer">
                    <div className="trade-totals">
                      <div>
                        <span>{t("sales.invoiceTotal")}</span>
                        <strong>{af(total, 2)}</strong>
                      </div>
                      <div>
                        <span>{t("sales.supplierBalance")}</span>
                        <strong>{af(Math.max(0, total - payment), 2)}</strong>
                      </div>
                      <Field
                        label={
                          paymentInForeign
                            ? t("currencies.amountPaid", { code: currency })
                            : t("sales.amountPaid")
                        }
                        hint={paymentHint}
                      >
                        <NumericInput
                          name="paid"
                          min="0"
                          max={paymentInForeign ? undefined : total / 100}
                          step="0.01"
                          value={paid}
                          placeholder={(total / 100).toFixed(2)}
                          onChange={(e) => setPaid(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label={t("sales.noteOptional")}>
                      <textarea
                        name="note"
                        defaultValue={initial?.note || ""}
                        rows={2}
                        placeholder={t("sales.notePh")}
                      />
                    </Field>
                    <ErrorMessage error={error} />
                  </div>
                </div>
                <div className="modal-actions">
                  <label className="sale-print-check">
                    <input
                      type="checkbox"
                      checked={printAfter}
                      onChange={(e) => setPrintAfter(e.target.checked)}
                    />
                    <PrinterIcon size={15} />
                    {t("sales.printAfter")}
                  </label>
                  <button type="button" className="button" onClick={close}>
                    {t("common.cancel")}
                  </button>
                  <button
                    className="button button-dark"
                    disabled={
                      busy ||
                      !lines.length ||
                      !party ||
                      (!!documentId && !initial)
                    }
                  >
                    {busy
                      ? t("common.posting")
                      : documentId
                        ? t("sales.savePurchaseChanges")
                        : t("sales.receivePurchase")}
                    <ArrowRightIcon size={16} />
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </Frame>
      {addingParty && (
        <PartyForm
          kind={purchase ? "supplier" : "customer"}
          close={() => setAddingParty(false)}
          done={(_message, result) => {
            setAddingParty(false);
            const created = result as { id?: string } | undefined;
            api<{ rows: Party[] }>("parties", {
              kind: purchase ? "supplier" : "customer",
            })
              .then((d) => {
                setParties(d.rows);
                if (created?.id) setParty(created.id);
              })
              .catch((e) => setError(e.message));
          }}
        />
      )}
      {addingProduct && purchase && (
        <ProductForm
          intent="purchase"
          close={() => setAddingProduct(false)}
          done={async (_message, result) => {
            const p = result.product;
            setProducts((rows) =>
              rows.some((r) => r.id === p.id)
                ? rows.map((r) => (r.id === p.id ? p : r))
                : [p, ...rows],
            );
            if (result.operation === "create") {
              setQ("");
              add(p);
            } else
              setLines((rows) =>
                rows.map((row) =>
                  row.product.id === p.id ? { ...row, product: p } : row,
                ),
              );
          }}
        />
      )}
    </>
  );
}
function ShoppingIllustration() {
  return <PackageIcon size={28} weight="light" />;
}
export function PartyForm({
  kind,
  close,
  done,
}: { kind: "customer" | "supplier" } & DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const created = await api<{ id: string }>("partyCreate", {
        kind,
        name: f.get("name"),
        phone: f.get("phone"),
        email: f.get("email"),
        address: f.get("address"),
        opening_balance: toMoney(f.get("opening_balance") || "0"),
        opening_date: f.get("opening_date") || businessDate(),
        request_key: key.current,
      });
      done(
        kind === "customer"
          ? t("partyForm.customerAdded")
          : t("partyForm.supplierAdded"),
        created,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "customer"
          ? t("partyForm.addCustomer")
          : t("partyForm.addSupplier")
      }
      subtitle={t("partyForm.subtitle")}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label={t("partyForm.nameBusiness")}>
            <input name="name" required minLength={2} />
          </Field>
          <div className="form-grid">
            <Field label={t("party.phone")}>
              <input name="phone" type="tel" />
            </Field>
            <Field label={t("partyForm.emailOptional")}>
              <input name="email" type="email" />
            </Field>
          </div>
          <Field label={t("party.address")}>
            <textarea name="address" rows={2} />
          </Field>
          <div className="form-grid">
            <Field
              label={
                kind === "customer"
                  ? t("partyForm.openingCustomer")
                  : t("partyForm.openingSupplier")
              }
              hint={
                kind === "customer"
                  ? t("partyForm.openingHintCustomer")
                  : t("partyForm.openingHintSupplier")
              }
            >
              <NumericInput
                name="opening_balance"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </Field>
            <Field
              label={t("partyForm.openingDate")}
              hint={t("partyForm.openingDateHint")}
            >
              <input
                name="opening_date"
                type="date"
                max={businessDate()}
                defaultValue={businessDate()}
              />
            </Field>
          </div>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy
              ? t("common.saving")
              : kind === "customer"
                ? t("partyForm.addCustomer")
                : t("partyForm.addSupplier")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ExpenseForm({ close, done }: DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  const [accounts, setAccounts] = useState<any[]>([]),
    [accountId, setAccountId] = useState(""),
    [adding, setAdding] = useState(false),
    [accountName, setAccountName] = useState(""),
    [accountBusy, setAccountBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api("expenseAccounts")
      .then((data) => {
        if (active) {
          setAccounts(data.rows);
          setAccountId(
            data.rows.find((a: any) => a.name === "Rent")?.id ||
              data.rows[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function addAccount() {
    setAccountBusy(true);
    setError("");
    try {
      const created = await api("expenseAccountCreate", { name: accountName });
      setAccounts((rows) => [...rows, created]);
      setAccountId(created.id);
      setAdding(false);
      setAccountName("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAccountBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("expense", {
        amount: toMoney(f.get("amount")),
        account_id: accountId,
        date: f.get("date"),
        note: f.get("note"),
        request_key: key.current,
      });
      done(t("toast.expenseRecorded"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("expense.recordAn")}
      subtitle={t("expense.subtitleDaily")}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="form-grid">
            <Field label={t("expense.amount")}>
              <NumericInput
                name="amount"
                min="0.01"
                step="0.01"
                required
                autoFocus
              />
            </Field>
            <Field label={t("expense.date")}>
              <input
                name="date"
                type="date"
                defaultValue={businessDate()}
                max={businessDate()}
                required
              />
            </Field>
          </div>
          <Field label={t("expenseAccounts.account")}>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              disabled={!accounts.length}
            >
              <option value="" disabled>
                {t("expenseAccounts.choose")}
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {expenseAccountName(account.name, t)}
                </option>
              ))}
            </select>
          </Field>
          {adding ? (
            <div className="expense-account-create">
              <Field label={t("expenseAccounts.newAccount")}>
                <input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  minLength={2}
                  maxLength={80}
                />
              </Field>
              <button
                type="button"
                className="button"
                disabled={accountBusy || accountName.trim().length < 2}
                onClick={addAccount}
              >
                {t("common.add")}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setAdding(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setAdding(true)}
            >
              <PlusIcon size={14} />
              {t("expenseAccounts.newAccount")}
            </button>
          )}
          <Field label={t("expense.description")}>
            <textarea
              name="note"
              placeholder={t("expense.descPh")}
              minLength={2}
              required
              rows={3}
            />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-dark"
            disabled={busy || accountBusy || !accountId || adding}
          >
            {busy ? t("common.saving") : t("expense.record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PaymentForm({
  party,
  close,
  done,
}: { party: Party } & DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const supplier = party.kind === "supplier";
  const [currency, setCurrency] = useState("AFN");
  const [rate, setRate] = useState("1");
  const [amount, setAmount] = useState(moneyInput(party.balance));
  const converted = (() => {
    try {
      return afnFromAed(toMoney(amount || "0"), toFxRate(rate || "0"));
    } catch {
      return 0;
    }
  })();
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("payment", {
        party_id: party.id,
        amount: afnFromAed(toMoney(amount), toFxRate(rate)),
        currency,
        fx_rate: toFxRate(rate),
        amount_foreign: toMoney(amount),
        date: f.get("date"),
        note: f.get("note"),
        request_key: key.current,
      });
      done(
        party.kind === "customer"
          ? t("payment.receiveSaved")
          : t("payment.paySaved"),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        party.kind === "customer"
          ? t("payment.receiveTitle")
          : t("payment.payTitle")
      }
      subtitle={t("payment.outstandingSub", {
        name: party.name,
        amount: af(party.balance, 2),
      })}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="supplier-payment-currency party-payment-currency">
            <Field label={t("currencies.choose")}>
              <CurrencyPicker
                compact
                value={currency}
                onChange={(code) => {
                  setCurrency(code);
                  setRate(code === "AFN" ? "1" : "");
                  setAmount("");
                }}
              />
            </Field>
            <Field label={t("currencies.rateShort", { code: currency })}>
              <NumericInput
                name="fx_rate"
                value={rate}
                readOnly={currency === "AFN"}
                onChange={(e) => setRate(e.target.value)}
                placeholder="0.00"
                required
              />
            </Field>
          </div>
          <Field
            label={
              supplier
                ? t("currencies.amountPaid", { code: currency })
                : t("currencies.amountReceived", { code: currency })
            }
            hint={t("currencies.paymentPreview", { amount: af(converted, 2) })}
          >
            <NumericInput
              name="amount"
              min="0.01"
              max={currency !== "AFN" ? undefined : party.balance / 100}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label={t("payment.date")}>
            <input
              name="date"
              type="date"
              defaultValue={businessDate()}
              max={businessDate()}
              required
            />
          </Field>
          <Field label={t("payment.note")}>
            <input name="note" placeholder={t("payment.notePhLong")} />
          </Field>
          <p className="help-note">{t("payment.help")}</p>
          {converted > party.balance && (
            <p className="text-red" role="alert">
              {t("currencies.overBalance")}
            </p>
          )}
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-dark"
            disabled={busy || converted <= 0 || converted > party.balance}
          >
            {busy ? t("payment.recording") : t("payment.record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function InvoiceDialog({
  documentId,
  user,
  close,
  done,
  edit,
  remove,
  autoPrint = false,
}: {
  documentId: string;
  user: User;
  edit?: () => void;
  remove?: () => void;
  autoPrint?: boolean;
} & DialogProps) {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<any>(null),
    [store, setStore] = useState<any>(null),
    [error, setError] = useState(""),
    [returning, setReturning] = useState(false),
    [refundCurrency, setRefundCurrency] = useState("AFN"),
    [refundRate, setRefundRate] = useState("1"),
    [refundAmount, setRefundAmount] = useState(""),
    [printReturn, setPrintReturn] = useState(false),
    [printOpen, setPrintOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [quantities, setQuantities] = useState<Record<string, number>>({});
  const ownerKindKeys: Record<string, string> = {
    consignment_receipt: "resale.receive",
    consignment_return: "resale.returnOwner",
    consignment_payment: "resale.payOwner",
    consignment_recovery: "resale.recover",
  };
  const kindTitle = doc
    ? ownerKindKeys[doc.kind]
      ? t(ownerKindKeys[doc.kind])
      : doc.kind.replaceAll("_", " ")
    : "";
  const key = useRef(requestKey());
  const printed = useRef(false);
  useEffect(() => {
    printed.current = false;
    Promise.all([api("document", { id: documentId }), api("status")])
      .then(([d, s]) => {
        setDoc(d);
        setStore(s.store);
      })
      .catch((e) => setError(e.message));
  }, [documentId]);
  useEffect(() => {
    if (autoPrint !== true || !doc || !store || printed.current) return;
    printed.current = true;
    setPrintOpen(true);
  }, [autoPrint, doc, store]);
  const returnTotal = (doc?.lines || []).reduce((sum: number, l: any) => {
    const quantity = quantities[l.id] || 0;
    if (!quantity) return sum;
    if (doc.kind === "purchase" && Array.isArray(l.return_batches)) {
      let remaining = quantity,
        amount = 0;
      for (const batch of l.return_batches) {
        const take = Math.min(remaining, batch.remaining);
        amount += take * batch.unit_cost;
        remaining -= take;
        if (!remaining) break;
      }
      return sum + amount;
    }
    const value = l.price * l.quantity - l.discount;
    return (
      sum +
      Math.floor((value * (l.returned_quantity + quantity)) / l.quantity) -
      Math.floor((value * l.returned_quantity) / l.quantity)
    );
  }, 0);
  const debtReduction = Math.min(
    returnTotal,
    Math.max(0, (doc?.total || 0) - (doc?.returned || 0) - (doc?.paid || 0)),
  );
  const refundDue = returnTotal - debtReduction;
  useEffect(() => {
    try {
      const rate = toFxRate(refundRate || "0");
      setRefundAmount(rate ? ((refundDue * 100) / rate).toFixed(2) : "");
    } catch {
      setRefundAmount("");
    }
  }, [refundDue, refundRate, refundCurrency]);
  const convertedRefund = (() => {
    try {
      return afnFromAed(
        toMoney(refundAmount || "0"),
        toFxRate(refundRate || "0"),
      );
    } catch {
      return -1;
    }
  })();
  async function postReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const selected = doc.lines.filter((l: any) => quantities[l.id] > 0);
      if (
        !selected.length ||
        selected.some(
          (l: any) =>
            !Number.isInteger(quantities[l.id]) ||
            quantities[l.id] > l.quantity - l.returned_quantity,
        )
      )
        throw new Error(t("currencies.returnQuantity"));
      const returned = await api<any>("return", {
        original_id: doc.id,
        lines: doc.lines
          .filter((l: any) => quantities[l.id] > 0)
          .map((l: any) => ({
            line_id: l.id,
            quantity: quantities[l.id],
          })),
        ...(["sale", "purchase"].includes(doc.kind)
          ? {
              refund_currency: refundDue ? refundCurrency : "AFN",
              refund_rate: refundDue ? toFxRate(refundRate) : 10000,
              refund_foreign: refundDue ? toMoney(refundAmount) : 0,
            }
          : {}),
        note: form.get("reason"),
        date: form.get("date"),
        request_key: key.current,
      });
      done(t("toast.returnPosted"), {
        id: returned.id,
        kind: returned.kind,
        print: printReturn === true,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={doc?.number || t("invoice.title")}
      subtitle={doc ? `${kindTitle} · ${doc.date}` : t("invoice.loading")}
      onClose={close}
      wide
      className={returning ? "invoice-return-dialog" : ""}
    >
      {doc && (
        <>
          <div
            hidden={returning}
            className="form-body invoice-print"
            id="invoice-print"
          >
            {["consignment_receipt", "consignment_return"].includes(
              doc.kind,
            ) && <p className="help-note">{t("resale.custodyNote")}</p>}
            <div className="invoice-top">
              <div>
                {store?.logo ? (
                  <img className="invoice-logo" src={store.logo} alt="" />
                ) : null}
                <h2>{store?.name}</h2>
                {store?.address ? <p>{store.address}</p> : null}
                <p>
                  {[store?.phone, store?.email].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div>
                <Badge tone="gray">{kindTitle.toUpperCase()}</Badge>
                <h3>{doc.number}</h3>
                <p>{doc.date}</p>
              </div>
            </div>
            <div className="invoice-meta">
              <div>
                <span>
                  {["purchase", "purchase_return", "payment"].includes(doc.kind)
                    ? t("invoice.supplier")
                    : t("invoice.customer")}
                </span>
                <strong>{doc.party_name || "—"}</strong>
              </div>
              <div>
                <span>{t("invoice.recordedBy")}</span>
                <strong>{doc.user_name}</strong>
              </div>
              <div>
                <span>{t("invoice.dueDate")}</span>
                <strong>{doc.due_date || "—"}</strong>
              </div>
              {["purchase", "purchase_return"].includes(doc.kind) &&
                !!doc.fx_rate && (
                  <div>
                    <span>{t("currencies.exchangeRate")}</span>
                    <strong>
                      <CurrencyFlag
                        code={doc.currency}
                        country={doc.currency_country}
                      />{" "}
                      {fxRateLabel(doc.fx_rate, doc.currency || "AED")}{" "}
                      <CurrencyFlag code="AFN" />
                    </strong>
                  </div>
                )}
            </div>
            {doc.lines.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("invoice.product")}</th>
                    <th>{t("invoice.quantity")}</th>
                    {["purchase", "purchase_return"].includes(doc.kind) && (
                      <th>
                        {t("currencies.unitCost", {
                          code:
                            (doc.kind === "purchase_return"
                              ? doc.lines[0]?.currency
                              : doc.currency) || "AED",
                        })}
                      </th>
                    )}
                    <th>
                      {["purchase", "purchase_return"].includes(doc.kind)
                        ? t("invoice.unitCostAf")
                        : t("invoice.unitPrice")}
                    </th>
                    <th>{t("invoice.discount")}</th>
                    <th>{t("invoice.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l: any) => {
                    const specs = productSpecEntries(l);
                    const identity = [l.brand, l.model, l.sku]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={l.id}>
                        <td>
                          <ProductName product={l} sub={identity || l.sku} />
                          {l.owner_unit_amount !== undefined && (
                            <small>
                              {t("resale.ownerUnitAmount")}:{" "}
                              <bdi dir="ltr">{af(l.owner_unit_amount, 2)}</bdi>
                            </small>
                          )}
                          {specs.length > 0 ? (
                            <div className="invoice-line-specs">
                              {specs.map((s) => (
                                <span key={s.key}>
                                  <em>{s.key}</em> {s.value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {l.quantity}
                          {l.returned_quantity > 0 && (
                            <small className="block muted">
                              {t("invoiceActions.returnedLine", {
                                n: l.returned_quantity,
                              })}
                            </small>
                          )}
                        </td>
                        {["purchase", "purchase_return"].includes(doc.kind) && (
                          <td>
                            {(l.cost_foreign ?? l.cost_aed)
                              ? foreignMoney(
                                  l.cost_foreign ?? l.cost_aed,
                                  l.currency || doc.currency || "AED",
                                )
                              : "—"}
                          </td>
                        )}
                        <td>{af(l.price, 2)}</td>
                        <td>{af(l.discount, 2)}</td>
                        <td>{af(l.quantity * l.price - l.discount, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {[
              "purchase",
              "sale",
              "payment",
              "receipt",
              "sale_return",
              "purchase_return",
            ].includes(doc.kind) &&
              doc.paid_foreign != null && (
                <div className="invoice-payment-conversion">
                  <span>
                    {t(
                      doc.kind === "purchase_return"
                        ? "currencies.refundReceived"
                        : doc.kind === "sale_return"
                          ? "currencies.refundPaid"
                          : ["payment", "receipt"].includes(doc.kind)
                            ? "payment.amount"
                            : doc.kind === "sale"
                              ? "currencies.paidAtSale"
                              : "currencies.paidAtPurchase",
                    )}
                  </span>
                  <strong>
                    <bdi dir="ltr">
                      {foreignMoney(doc.paid_foreign, doc.currency || "AED")}
                    </bdi>
                    <span aria-hidden="true"> → </span>
                    <bdi dir="ltr">
                      {af(afnFromAed(doc.paid_foreign, doc.fx_rate), 2)}
                    </bdi>
                  </strong>
                </div>
              )}
            <div className="invoice-summary">
              <div>
                <span>{t("invoice.total")}</span>
                <strong className="money">{af(doc.total, 2)}</strong>
              </div>
              <div>
                <span>
                  {t(
                    ["sale_return", "purchase_return"].includes(doc.kind)
                      ? "currencies.returnCredit"
                      : "invoice.returned",
                  )}
                </span>
                <strong className="money">
                  {af(
                    ["sale_return", "purchase_return"].includes(doc.kind)
                      ? doc.total - doc.paid
                      : doc.returned || 0,
                    2,
                  )}
                </strong>
              </div>
              <div>
                <span>
                  {t(
                    doc.kind === "purchase_return"
                      ? "currencies.refundReceived"
                      : doc.kind === "sale_return"
                        ? "currencies.refundPaid"
                        : "invoice.paid",
                  )}
                </span>
                <strong className="money">{af(doc.paid, 2)}</strong>
              </div>
              {!["sale_return", "purchase_return"].includes(doc.kind) && (
                <div className="invoice-due">
                  <span>{t("invoice.outstanding")}</span>
                  <strong className="money">
                    {af(
                      Math.max(0, doc.total - (doc.returned || 0) - doc.paid),
                      2,
                    )}
                  </strong>
                </div>
              )}
            </div>
            {doc.note && <p className="invoice-note">{doc.note}</p>}
            {store?.bill_footer ? (
              <p className="invoice-note">{store.bill_footer}</p>
            ) : null}
            <p className="subtle">{t("invoice.afnNote")}</p>
          </div>
          {returning && (
            <form className="return-form" onSubmit={postReturn}>
              <div className="form-section-title">
                <ArrowCounterClockwiseIcon size={17} />
                {t("invoiceActions.returnItems")}
              </div>
              {doc.lines
                .filter((l: any) => l.quantity > l.returned_quantity)
                .map((l: any) => (
                  <Field
                    key={l.id}
                    label={t("invoiceActions.remaining", {
                      name: l.name,
                      n: l.quantity - l.returned_quantity,
                    })}
                  >
                    <NumericInput
                      kind="integer"
                      min="0"
                      max={l.quantity - l.returned_quantity}
                      value={quantities[l.id] || 0}
                      onChange={(e) =>
                        setQuantities({
                          ...quantities,
                          [l.id]: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </Field>
                ))}
              {["sale", "purchase"].includes(doc.kind) && (
                <section className="return-refund-controls">
                  <div className="return-refund-summary">
                    <span>
                      {t("currencies.returnCredit")}{" "}
                      <bdi dir="ltr">{af(debtReduction, 2)}</bdi>
                    </span>
                    <strong>
                      {t(
                        doc.kind === "purchase"
                          ? "currencies.supplierRefundDue"
                          : "currencies.refundDue",
                      )}{" "}
                      <bdi dir="ltr">{af(refundDue, 2)}</bdi>
                    </strong>
                  </div>
                  {refundDue > 0 ? (
                    <>
                      <div className="supplier-payment-currency">
                        <Field label={t("currencies.refundCurrency")}>
                          <CurrencyPicker
                            compact
                            value={refundCurrency}
                            onChange={(code) => {
                              setRefundCurrency(code);
                              setRefundRate(code === "AFN" ? "1" : "");
                            }}
                          />
                        </Field>
                        <Field
                          label={t("currencies.rateShort", {
                            code: refundCurrency,
                          })}
                        >
                          <NumericInput
                            name="refund_rate"
                            value={refundRate}
                            readOnly={refundCurrency === "AFN"}
                            onChange={(e) => setRefundRate(e.target.value)}
                            required
                          />
                        </Field>
                      </div>
                      <Field
                        label={t("currencies.refundAmount", {
                          code: refundCurrency,
                        })}
                        hint={t("currencies.refundPreview", {
                          amount: af(Math.max(0, convertedRefund), 2),
                        })}
                      >
                        <NumericInput
                          name="refund_amount"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          required
                        />
                      </Field>
                      {convertedRefund !== refundDue && (
                        <p className="text-red" role="alert">
                          {t("currencies.refundMismatch")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      {t(
                        doc.kind === "purchase"
                          ? "currencies.supplierNoCashRefund"
                          : "currencies.noCashRefund",
                      )}
                    </p>
                  )}
                </section>
              )}
              <Field label={t("invoiceActions.reason")}>
                <input name="reason" minLength={2} required />
              </Field>
              <Field label={t("common.date")}>
                <input
                  name="date"
                  type="date"
                  min={doc.date}
                  max={businessDate()}
                  defaultValue={businessDate()}
                  required
                />
              </Field>
              <p className="help-note">{t("invoiceActions.returnHelp")}</p>
              <label className="sale-print-check">
                <input
                  type="checkbox"
                  checked={printReturn}
                  onChange={(e) => setPrintReturn(e.target.checked)}
                />
                <PrinterIcon size={15} />
                {t("sales.printAfter")}
              </label>
              <ErrorMessage error={error} />
              <button
                className="button button-dark"
                disabled={
                  busy ||
                  !Object.values(quantities).some((n) => n > 0) ||
                  (["sale", "purchase"].includes(doc.kind) &&
                    refundDue > 0 &&
                    convertedRefund !== refundDue)
                }
              >
                {busy ? t("common.posting") : t("invoiceActions.postReturn")}
              </button>
            </form>
          )}
        </>
      )}
      <ErrorMessage error={!returning ? error : ""} />
      <div className="modal-actions invoice-actions">
        {["sale", "purchase"].includes(doc?.kind) &&
          ["Owner", "Manager"].includes(user.role) && (
            <>
              <button className="button" onClick={edit}>
                {t("invoiceActions.edit")}
              </button>
              <button className="button danger-text" onClick={remove}>
                {t("invoiceActions.hardDelete")}
              </button>
            </>
          )}
        {doc &&
          ["sale", "purchase"].includes(doc.kind) &&
          ["Owner", "Manager", "Accountant"].includes(user.role) && (
            <button
              className="button"
              onClick={() => {
                if (!returning) {
                  setRefundCurrency("AFN");
                  setRefundRate("1");
                  setRefundAmount("");
                  setQuantities({});
                  setPrintReturn(false);
                  setError("");
                }
                setReturning(!returning);
              }}
            >
              <ArrowCounterClockwiseIcon size={15} />
              {returning
                ? t("invoiceActions.cancelReturn")
                : t("invoiceActions.returnItems")}
            </button>
          )}
        <button className="button" onClick={close}>
          {t("common.close")}
        </button>
        {doc && (
          <button
            className="button"
            disabled={busy}
            onClick={() => setPrintOpen(true)}
          >
            <DownloadSimpleIcon size={16} />
            {window.vault
              ? t("invoiceActions.downloadPdf")
              : t("invoiceActions.downloadInvoice")}
          </button>
        )}
        {doc && (
          <button
            className="button button-dark"
            onClick={() => setPrintOpen(true)}
          >
            <PrinterIcon size={16} />
            {t("invoiceActions.printPdf")}
          </button>
        )}
      </div>
      {printOpen && doc && store && (
        <PrintDialog
          document={
            invoicePrintModel(doc, store, {
              locale,
              t,
              money: af,
              foreignMoney: (amount: number, code?: string) =>
                foreignMoney(amount, code || doc.currency || "AED"),
              specs: productSpecEntries,
              rate: (rate: number) => fxRateLabel(rate, doc.currency || "AED"),
            }) as PrintDocument
          }
          onClose={() => setPrintOpen(false)}
        />
      )}
    </Modal>
  );
}
export function DeleteInvoiceDialog({
  documentId,
  close,
  done,
}: { documentId: string } & DialogProps) {
  const t = useT();
  const [doc, setDoc] = useState<any>(null),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  useEffect(() => {
    let active = true;
    api("document", { id: documentId })
      .then((d) => {
        if (active) setDoc(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [documentId]);
  const purchase = doc?.kind === "purchase";
  return (
    <Modal
      title={t("deleteInvoice.titleAction")}
      subtitle={doc?.number || t("deleteInvoice.loading")}
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(purchase ? "purchaseDelete" : "saleDelete", {
              id: doc.id,
              revision: doc.revision,
              confirmation,
              request_key: key.current,
            });
            done(
              purchase
                ? t("deleteInvoice.deletedPurchase")
                : t("deleteInvoice.deletedSale"),
            );
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-body">
          <p>
            {purchase
              ? t("deleteInvoice.bodyPurchase")
              : t("deleteInvoice.bodySale")}{" "}
            {t("deleteInvoice.bodyAudit")}
          </p>
          <p>
            {t("deleteInvoice.bodyLinked", {
              payments: purchase
                ? t("deleteInvoice.paymentsSupplier")
                : t("deleteInvoice.paymentsCustomer"),
            })}
            {purchase ? t("deleteInvoice.bodyPurchaseSold") : ""}
          </p>
          <Field
            label={t("deleteInvoice.confirmNumber", {
              number: doc?.number || t("deleteInvoice.confirmFallback"),
            })}
          >
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-danger"
            disabled={busy || !doc || confirmation !== doc.number}
          >
            {busy ? t("deleteInvoice.deleting") : t("deleteInvoice.action")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ProductDetail({
  product: initialProduct,
  user,
  close,
  done,
  edit,
  sell,
}: {
  product: Product;
  user: User;
  edit: () => void;
  sell?: () => void;
} & DialogProps) {
  const t = useT();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [adjust, setAdjust] = useState(false),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"details" | "movements">("details");
  const product: Product = data?.product || initialProduct;
  const movements = data ? movementBalances(product.stock, data.movements) : [];
  const key = useRef(requestKey());
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setTab("details");
    api("productDetail", { id: initialProduct.id })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [initialProduct.id]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("adjust", {
        product_id: product.id,
        quantity: Number(
          sanitizeNumericInput(
            String(f.get("quantity") || "0"),
            "signed-integer",
          ),
        ),
        cost: toMoney(f.get("cost") || "0"),
        note: f.get("note"),
        request_key: key.current,
        opening: f.get("opening") === "on",
      });
      done(t("productDetail.adjustmentPosted"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product.name}
      subtitle={`${product.sku} · ${product.brand} · ${product.model}`}
      onClose={close}
      wide
      className="product-detail-modal"
    >
      <div className="form-body">
        <div className="product-detail-top">
          <ProductPhoto product={product} alt={product.name} eager />
          <div className="product-detail-identity">
            <p>{t("inventory.sellingPrice")}</p>
            <h2>{af(product.price)}</h2>
            <p>
              {product.condition} ·{" "}
              {product.warranty || t("productDetail.noWarranty")}
            </p>
            {(user.permissions.includes("view_costs") ||
              user.permissions.includes("purchases")) &&
              product.unit_cost != null && (
                <p>
                  {t("inventory.unitCost")}: {af(product.unit_cost, 2)}
                </p>
              )}
            {(user.permissions.includes("view_costs") ||
              user.permissions.includes("purchases")) &&
            (product.cost_foreign || product.cost_aed || product.fx_rate) ? (
              <p>
                <CurrencyFlag code={product.currency || "AED"} />{" "}
                {t("productDetail.dubaiCost", {
                  aed: foreignMoney(
                    product.cost_foreign ?? product.cost_aed ?? 0,
                    product.currency || "AED",
                  ),
                  rate: fxRateLabel(
                    product.fx_rate || 0,
                    product.currency || "AED",
                  ),
                  afn: af(product.unit_cost || 0, 2),
                })}
              </p>
            ) : null}
          </div>
          <section
            className="product-stock-summary"
            aria-label={t("productDetail.currentStock")}
            aria-live="polite"
          >
            <span>{t("productDetail.currentStock")}</span>
            <strong className="numeric">{data ? product.stock : "—"}</strong>
            <small>{t("productDetail.remainingNow")}</small>
            <Badge
              tone={
                product.stock === 0
                  ? "red"
                  : product.stock <= product.reorder_level
                    ? "yellow"
                    : "green"
              }
            >
              {!data
                ? error
                  ? t("productDetail.stockUnavailable")
                  : t("common.loading")
                : product.stock === 0
                  ? t("productDetail.zeroStock")
                  : product.stock <= product.reorder_level
                    ? t("productDetail.lowStock")
                    : t("productDetail.available")}
            </Badge>
            <small>
              {t("productDetail.reorderAt", { n: product.reorder_level })}
            </small>
          </section>
        </div>
        <div
          className="report-tabs product-detail-tabs"
          role="tablist"
          aria-label={t("productDetail.information")}
        >
          {(["details", "movements"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`product-${id}-tab`}
              aria-selected={tab === id}
              aria-controls={`product-${id}-panel`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "details"
                      : event.key === "End"
                        ? "movements"
                        : id === "details"
                          ? "movements"
                          : "details";
                  setTab(next);
                  document.getElementById(`product-${next}-tab`)?.focus();
                }
              }}
            >
              {t(
                id === "details"
                  ? "productDetail.details"
                  : "productDetail.movementHistory",
              )}
            </button>
          ))}
        </div>
        <section
          role="tabpanel"
          tabIndex={0}
          id="product-details-panel"
          aria-labelledby="product-details-tab"
          hidden={tab !== "details"}
        >
          <div className="spec-grid product-identity-grid">
            {[
              [t("productDetail.category"), product.category],
              [t("productDetail.company"), product.brand],
              [t("productDetail.model"), product.model],
              ["SKU", product.sku],
              [t("productDetail.barcode"), product.barcode],
              [t("productDetail.location"), product.location],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
          </div>
          <div className="spec-grid">
            {Object.entries(product.attributes || {})
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
          </div>
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="product-movements-panel"
          aria-labelledby="product-movements-tab"
          hidden={tab !== "movements"}
        >
          <div className="form-section-title">
            {t("productDetail.movementHistory")}{" "}
            <small>{t("productDetail.latest100")}</small>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("productDetail.colDate")}</th>
                  <th>{t("productDetail.colReference")}</th>
                  <th>{t("productDetail.colType")}</th>
                  <th>{t("productDetail.colQuantity")}</th>
                  <th>{t("productDetail.remainingAfter")}</th>
                  {user.permissions.includes("view_costs") && (
                    <th>{t("productDetail.colCostMove")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {movements.map((m: any) => (
                  <tr key={m.id}>
                    <td>{m.date}</td>
                    <td>{m.number}</td>
                    <td>{m.kind.replaceAll("_", " ")}</td>
                    <td className={m.quantity > 0 ? "text-green" : "text-red"}>
                      {m.quantity > 0 ? "+" : ""}
                      {m.quantity}
                    </td>
                    <td className="numeric">
                      <strong>{m.remaining}</strong>
                    </td>
                    {user.permissions.includes("view_costs") && (
                      <td>{af(m.cost)}</td>
                    )}
                  </tr>
                ))}
                {!movements.length && (
                  <tr>
                    <td
                      colSpan={user.permissions.includes("view_costs") ? 6 : 5}
                    >
                      {!data
                        ? error || t("common.loading")
                        : t("productDetail.noMovements")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {adjust && (
          <form onSubmit={submit} className="adjust-form">
            <div className="form-section-title">
              {t("productDetail.adjust")}
            </div>
            <div className="form-grid">
              <Field
                label={t("productDetail.qtyChange")}
                hint={t("productDetail.adjustHint")}
              >
                <NumericInput
                  kind="signed-integer"
                  name="quantity"
                  required
                  defaultValue="1"
                />
              </Field>
              <Field label={t("productDetail.unitCostAdd")}>
                <NumericInput
                  name="cost"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </Field>
            </div>
            <Field label={t("productDetail.reason")}>
              <input
                name="note"
                minLength={3}
                required
                placeholder={t("productDetail.reasonPh")}
              />
            </Field>
            {user.role === "Owner" && product.stock === 0 && (
              <label className="checkbox-field">
                <input name="opening" type="checkbox" />
                <span>
                  <strong>{t("productDetail.openingForward")}</strong>
                  <small>{t("productDetail.openingForwardHint")}</small>
                </span>
              </label>
            )}
            <p className="help-note">{t("productDetail.adjustHelp")}</p>
            <ErrorMessage error={error} />
            <button className="button button-dark" disabled={busy}>
              {busy ? t("common.saving") : t("productDetail.postAdjust")}
            </button>
          </form>
        )}
        <ErrorMessage error={!adjust ? error : ""} />
      </div>
      <div className="modal-actions">
        {sell && user.permissions.includes("sales") && (
          <button className="button button-dark" onClick={sell}>
            {t("productDetail.sell")} <ArrowRightIcon size={15} />
          </button>
        )}
        {user.permissions.includes("inventory") && (
          <button className="button" onClick={edit}>
            {t("productDetail.edit")}
          </button>
        )}
        {user.permissions.includes("inventory") && (
          <button className="button" onClick={() => setAdjust(!adjust)}>
            {adjust
              ? t("productDetail.cancelAdjust")
              : t("productDetail.adjust")}
          </button>
        )}
        <button className="button" onClick={close}>
          {t("productDetail.done")}
        </button>
      </div>
    </Modal>
  );
}
function partyLedgerLabel(
  tr: (key: string) => string,
  e: {
    category?: string;
    kind?: string;
    note?: string;
  },
) {
  if (e.category === "Opening balance" || /opening balance/i.test(e.note || ""))
    return tr("ledger.opening");
  const labels: Record<string, string> = {
    consignment_receipt: "resale.receive",
    consignment_return: "resale.returnOwner",
    consignment_payment: "resale.payOwner",
    consignment_recovery: "resale.recover",
    sale: "ledger.sale",
    purchase: "ledger.purchase",
    receipt: "ledger.paymentIn",
    payment: "ledger.paymentOut",
    sale_return: "ledger.returnSale",
    purchase_return: "ledger.returnPurchase",
  };
  const key = labels[e.kind || ""];
  return key ? tr(key) : e.kind || tr("productDetail.ledgerEntry");
}
export function PartyDetailDialog({
  party,
  user,
  close,
  open,
  refresh = 0,
}: {
  party: Party;
  user: User;
  open: (name: string, data?: any) => void;
  refresh?: number;
} & Pick<DialogProps, "close">) {
  const t = useT();
  const [ledgerAfter, setLedgerAfter] = useState("");
  const [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState("");
  const kind = party.kind;
  const canResale =
    kind === "customer" &&
    !party.walk_in &&
    user.permissions.includes("finance") &&
    user.permissions.includes("view_costs");
  const [ledgerView, setLedgerView] = useState<"trade" | "resale">(
    (party as any).ledgerView === "resale" ? "resale" : "trade",
  );

  useEffect(() => {
    let active = true;
    setError("");
    api("partyDetail", {
      id: party.id,
      after: ledgerAfter,
      limit: 25,
      view: ledgerView,
    })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [party.id, ledgerAfter, refresh, ledgerView]);
  const signed = (e: any) =>
    ledgerView === "resale"
      ? e.credit - e.debit
      : kind === "customer"
        ? e.debit - e.credit
        : e.credit - e.debit;
  let running = detail?.page_start_balance ?? detail?.party?.balance ?? 0;
  const ledgerRows = (detail?.entries || []).map((e: any) => {
    const row = { ...e, running, label: partyLedgerLabel(t, e) };
    running -= signed(e);
    return row;
  });
  const current = detail?.party || party;
  const ownerBalance = current.consignment_balance || 0;
  return (
    <Modal
      title={current.name}
      subtitle={
        kind === "customer"
          ? t("partyDetail.customerSubtitle")
          : t("partyDetail.supplierSubtitle")
      }
      onClose={close}
      wide
    >
      <div className="form-body party-detail-body">
        <ErrorMessage error={error} />
        <div className="contact-summary party-detail-summary">
          <span className="customer-initial avatar-lg">
            {current.name.slice(0, 1)}
          </span>
          <h2>{current.name}</h2>
          <p>{current.phone || t("people.noPhone")}</p>
          <p>{current.address || current.email || t("people.noAddress")}</p>
          {user.role === "Owner" && !current.walk_in && (
            <button
              className="text-button"
              onClick={() => open("openingBalance", current)}
            >
              {t("partyDetail.enterOpening")}
            </button>
          )}
          <div className="contact-balance">
            <span>{t("partyDetail.outstanding")}</span>
            <strong
              className={(current.balance || 0) > 0 ? "text-red" : "text-green"}
            >
              {af(current.balance || 0)}
            </strong>
          </div>
          {(current.balance || 0) > 0 &&
            user.permissions.includes("finance") && (
              <button
                className="button button-dark full"
                onClick={() => open("payment", current)}
              >
                {kind === "customer"
                  ? t("people.receivePayment")
                  : t("people.paySupplier")}
                <ArrowRightIcon size={15} />
              </button>
            )}
          {canResale && (
            <div className="resale-owner-balance">
              <span>
                {t(
                  ownerBalance < 0
                    ? "resale.recoverable"
                    : "resale.owedToOwners",
                )}
              </span>
              <strong className={ownerBalance > 0 ? "text-red" : "text-green"}>
                <bdi dir="ltr">{af(Math.abs(ownerBalance), 2)}</bdi>
              </strong>
              {ownerBalance !== 0 && (
                <button
                  className="button full"
                  onClick={() =>
                    open("consignmentSettlement", {
                      ...current,
                      balance: ownerBalance,
                    })
                  }
                >
                  {t(ownerBalance < 0 ? "resale.recover" : "resale.payOwner")}
                </button>
              )}
              {user.permissions.includes("inventory") && (
                <button
                  className="button full"
                  onClick={() => open("consignmentReceive", current)}
                >
                  {t("resale.receive")}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="contact-ledger">
          {canResale && (
            <div className="owner-ledger-tabs">
              <button
                className={
                  "button " + (ledgerView === "trade" ? "selected" : "")
                }
                onClick={() => {
                  setDetail(null);
                  setLedgerView("trade");
                  setLedgerAfter("");
                  setLedgerHistory([]);
                }}
              >
                {t("partyDetail.ledgerTitle")}
              </button>
              <button
                className={
                  "button " + (ledgerView === "resale" ? "selected" : "")
                }
                onClick={() => {
                  setDetail(null);
                  setLedgerView("resale");
                  setLedgerAfter("");
                  setLedgerHistory([]);
                }}
              >
                {t("resale.ownerLedger")}
              </button>
            </div>
          )}
          <h3>
            {t(
              ledgerView === "resale"
                ? "resale.ownerLedger"
                : "partyDetail.ledgerTitle",
            )}
          </h3>
          <p className="subtle ledger-hint">
            {t(
              ledgerView === "resale"
                ? "resale.ledgerHint"
                : "partyDetail.ledgerHint",
            )}
          </p>
          {!detail ? (
            <p className="muted">{t("partyDetail.loadingLedger")}</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("partyDetail.colDateRef")}</th>
                      <th>{t("partyDetail.debit")}</th>
                      <th>{t("partyDetail.credit")}</th>
                      <th>{t("partyDetail.balance")}</th>
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
                          <small className="block muted">
                            {e.label}
                            {e.number ? ` · ${e.number}` : ""}
                          </small>
                        </td>
                        <td
                          className={`money ${e.debit ? (kind === "customer" && ledgerView !== "resale" ? "text-red" : "text-green") : "muted"}`}
                        >
                          {e.debit ? af(e.debit) : "—"}
                        </td>
                        <td
                          className={`money ${e.credit ? (kind === "customer" && ledgerView !== "resale" ? "text-green" : "text-red") : "muted"}`}
                        >
                          {e.credit ? af(e.credit) : "—"}
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
              </div>
              {!detail.entries.length && (
                <p className="muted">{t("partyDetail.noActivity")}</p>
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
            </>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="button button-dark" onClick={close}>
          {t("productDetail.done")}
        </button>
      </div>
    </Modal>
  );
}
export function UserForm({ close, done, user }: DialogProps & { user?: User }) {
  const t = useT();
  const [role, setRole] = useState(user?.role || "Cashier"),
    [permissions, setPermissions] = useState<string[]>(
      user?.permissions || ["sales", "people"],
    ),
    [all, setAll] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("status").then(setAll);
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(user ? "userPermissions" : "userCreate", {
        id: user?.id,
        name: f.get("name"),
        username: f.get("username"),
        password: f.get("password"),
        role,
        permissions,
      });
      done(user ? t("userForm.accessUpdated") : t("userForm.created"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={user ? t("userForm.editTitle") : t("userForm.createTitle")}
      subtitle={t("userForm.subtitle")}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label={t("userForm.fullName")}>
            <input
              name="name"
              defaultValue={user?.name}
              disabled={!!user}
              minLength={2}
              required
            />
          </Field>
          <div className="form-grid">
            <Field label={t("settings.username")}>
              <input
                name="username"
                defaultValue={user?.username}
                disabled={!!user}
                minLength={3}
                pattern="[a-zA-Z0-9._-]+"
                required
                autoComplete="off"
              />
            </Field>
            {!user && (
              <Field label={t("userForm.password")}>
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="new-password"
                />
              </Field>
            )}
          </div>
          <Field label={t("userForm.role")}>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPermissions(all?.roles[e.target.value] || []);
              }}
            >
              {Object.keys(all?.roles || {}).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <div className="permission-grid">
            {all?.permissions.map((p: string) => (
              <label key={p}>
                <input
                  type="checkbox"
                  disabled={role === "Owner"}
                  checked={permissions.includes(p)}
                  onChange={(e) =>
                    setPermissions(
                      e.target.checked
                        ? [...permissions, p]
                        : permissions.filter((x) => x !== p),
                    )
                  }
                />
                {p.replaceAll("_", " ")}
              </label>
            ))}
          </div>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy
              ? t("common.saving")
              : user
                ? t("userForm.saveAccess")
                : t("userForm.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function OwnerMovement({ close, done }: DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("ownerMovement", {
        direction: f.get("direction"),
        amount: toMoney(f.get("amount")),
        note: f.get("note"),
        date: f.get("date"),
        request_key: key.current,
      });
      done(t("owner.cashSaved"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("owner.title")}
      subtitle={t("owner.subtitle")}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label={t("owner.movement")}>
            <select name="direction">
              <option value="deposit">{t("owner.investOption")}</option>
              <option value="withdrawal">{t("owner.withdrawOption")}</option>
            </select>
          </Field>
          <Field label={t("owner.amount")}>
            <NumericInput name="amount" min="0.01" step="0.01" required />
          </Field>
          <Field label={t("owner.date")}>
            <input
              name="date"
              type="date"
              required
              defaultValue={businessDate()}
              max={businessDate()}
            />
          </Field>
          <Field label={t("owner.reason")}>
            <input
              name="note"
              minLength={2}
              required
              placeholder={t("owner.notePh")}
            />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? t("common.saving") : t("owner.record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function OpeningBalanceForm({
  party,
  close,
  done,
}: { party: Party } & DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("openingBalance", {
        party_id: party.id,
        amount: toMoney(f.get("amount")),
        date: f.get("date"),
        request_key: key.current,
      });
      done(t("opening.savedEquity"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("opening.title")}
      subtitle={t("opening.subtitleParty", { name: party.name })}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field
            label={
              party.kind === "customer"
                ? t("opening.amountCustomer")
                : t("opening.amountSupplier")
            }
          >
            <NumericInput name="amount" min="0.01" step="0.01" required />
          </Field>
          <Field label={t("opening.openingDate")}>
            <input
              name="date"
              type="date"
              max={businessDate()}
              defaultValue={businessDate()}
              required
            />
          </Field>
          <p className="help-note">
            {t("opening.helpDetail", {
              kind:
                party.kind === "customer"
                  ? t("opening.receivables")
                  : t("opening.payables"),
            })}
          </p>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? t("common.saving") : t("opening.record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
