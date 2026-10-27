import { CustomerSalesHistory } from "./CustomerSalesHistory";
import {
  DeviceSelection,
  ReceiveDevices,
  type Device,
  type DeviceDetails,
} from "./DeviceInventory";
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
  ArrowLeftIcon,
  PrinterIcon,
  ArrowCounterClockwiseIcon,
  PackageIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  DownloadSimpleIcon,
  BarcodeIcon,
  WhatsappLogoIcon,
  PhoneIcon,
  FloppyDiskIcon,
} from "@phosphor-icons/react";
import {
  api,
  af,
  aed,
  foreignMoney,
  toMoney,
  toFxRate,
  afnFromAed,
  foreignFromAfn,
  fxRateLabel,
  fxRateInput,
  moneyInput,
  sanitizeNumericInput,
  normalizeDigits,
  requestKey,
  businessDate,
  Product,
  Party,
  User,
  productSpecEntries,
} from "../api";
import { useT, useI18n } from "../i18n";
import { PrintDialog, ReportPrintButton } from "../printing/PrintDialog";
import { invoicePrintModel, invoiceWhen } from "../printing/models.mjs";
import { barcodeLabelDocument } from "../printing/barcode-label.mjs";
import type { PrintDocument } from "../printing/types";
import { generateProductBarcode } from "../barcode/generate.mjs";
import { canEncodeQr } from "../barcode/qrcode.mjs";
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
  BUILTIN_PRODUCT_CATEGORIES,
  categoryLabel,
  specFieldLabel,
} from "./product-fields";
import { PRODUCT_CATEGORIES, categoryLabel } from "./product-fields";
import { ProductForm } from "./ProductForm";
import { PartySearchSelect } from "./PartySearchSelect";
import { PhoneField, assertPhoneValid } from "./PhoneField";
import { canWhatsApp, shareViaWhatsApp } from "../whatsapp-share";
import { partyLedgerPrintDocument } from "../printing/party-ledger.mjs";
export { ProductForm } from "./ProductForm";

type CartLine = {
  key?: string;
  units?: DeviceDetails[];
  selectedUnits?: Device[];
  product: Product;
  quantity: number;
  price: string;
  discount: string;
  /** Per-unit supplier quote in the selected currency (major-unit string). */
  costAed?: string;
  /** Per-unit cargo / freight rent in the selected currency (major-unit string). */
  cargoRent?: string;
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
    [party, setParty] = useState(""),
    [selectedParty, setSelectedParty] = useState<Party | null>(null),
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
    [customerPhone, setCustomerPhone] = useState(""),
    [printAfter, setPrintAfter] = useState(false);
  const key = useRef(requestKey());
  const barcodeRef = useRef<HTMLInputElement>(null);
  const Frame = inline ? BillFrame : Modal;
  const purchase = kind === "purchase";
  const saleCustomerReady = purchase
    ? Boolean(party)
    : customerMode === "new"
      ? customerName.trim().length >= 2
      : Boolean(party);
  function chooseParty(next: Party | null) {
    setSelectedParty(next);
    setParty(next?.id || "");
  }
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
    if (!purchase || documentId) return;
    let active = true;
    api<{ rows: Party[] }>("parties", {
      kind: "supplier",
      limit: 1,
    })
      .then((d) => {
        if (!active || !d.rows[0]) return;
        chooseParty(d.rows[0]);
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
        const productIds = [
          ...new Set(
            doc.lines
              .map((line: any) => line.product_id)
              .filter((id: string) => !!id),
          ),
        ];
        const catalog = productIds.length
          ? await api<{ rows: Product[] }>("catalog", {
              ids: productIds,
              limit: Math.max(productIds.length, 1),
            })
          : { rows: [] as Product[] };
        const byId = new Map(catalog.rows.map((p) => [p.id, p]));
        const loaded = doc.lines.map((line: any) => {
          const found = byId.get(line.product_id);
          if (!found)
            throw new Error(t("sales.errProductGone", { name: line.name }));
          return {
            key: line.id,
            units: line.units || [],
            selectedUnits: line.units || [],
            product: { ...found, stock: found.stock + line.quantity },
            quantity: line.quantity,
            price: String(line.price / 100),
            discount: String(line.discount / 100),
            costAed:
              line.cost_foreign ?? line.cost_aed
                ? moneyInput(line.cost_foreign ?? line.cost_aed)
                : "0",
            cargoRent: line.cargo_rent ? moneyInput(line.cargo_rent) : "0",
          };
        });
        if (active) {
          setInitial(doc);
          chooseParty(
            doc.party_id
              ? ({
                  id: doc.party_id,
                  name: doc.party_name || "",
                  phone: doc.party_phone || "",
                  email: "",
                  address: "",
                  balance: doc.previous_balance ?? 0,
                  walk_in: 0,
                  kind: purchase ? "supplier" : "customer",
                } as Party)
              : null,
          );
          if (doc.party_id) {
            api<{ party: Party }>("partyDetail", { id: doc.party_id })
              .then((d) => {
                if (d?.party) chooseParty(d.party);
              })
              .catch(() => {});
          }
          setCustomerMode("existing");
          setCustomerName(doc.party_name || "");
          setCustomerPhone(doc.party_phone || "");
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
    // Sales merge by product like accessories; purchases still allow
    // separate serialized lines for different device costs.
    const mergeByProduct = !purchase || !p.serialized;
    if (mergeByProduct && lines.some((l) => l.product.id === p.id)) {
      setLines((ls) =>
        ls.map((l) => {
          if (l.product.id !== p.id) return l;
          const next = l.quantity + 1;
          const max = purchase ? 100000 : Math.max(1, p.stock);
          return { ...l, quantity: Math.min(next, max) };
        }),
      );
      if (q) setQ("");
      return;
    }
    const sourceCost =
      p.currency === currency || (!p.currency && currency === "AED")
        ? (p.cost_foreign ?? p.cost_aed ?? 0)
        : 0;
    const costAedMajor = sourceCost ? moneyInput(sourceCost) : "";
    setLines((ls) => [
      ...ls,
      {
        key: requestKey(),
        product: p,
        selectedUnits: [],
        quantity: 1,
        price: purchase
          ? afnPriceFromAed(costAedMajor, fxRate) || ""
          : String(p.price / 100),
        discount: "0",
        ...(purchase ? { costAed: costAedMajor, cargoRent: "0" } : {}),
      },
    ]);
    if (q) setQ("");
  }
  const scanBurst = useRef({ last: 0, rapid: false });
  async function scanBarcode(raw?: string) {
    const code = (raw ?? scanCode).trim();
    if (!code || scanBusy) return;
    scanBurst.current.rapid = false;
    setScanBusy(true);
    setError("");
    try {
      const d =
        code.length > 80
          ? { rows: [] as Product[] }
          : await api<{ rows: Product[] }>("catalog", {
              barcode: code,
              limit: 1,
            });
      let p = d.rows[0];
      if (!p && !purchase) {
        try {
          const result = await api<{ unit: Device; product: Product }>(
            "unitLookup",
            { code },
          );
          p = result.product;
        } catch {
          /* barcode may simply be unknown */
        }
      }
      if (!p) throw new Error(t("sales.errBarcode", { code }));
      if (!purchase && p.stock <= 0)
        throw new Error(t("sales.errOutOfStock", { name: p.name }));
      if (
        !purchase &&
        lines.some((l) => l.product.id === p.id && l.quantity >= p.stock)
      )
        throw new Error(t("sales.errOutOfStock", { name: p.name }));
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
    if (documentId || loading) return;
    const id = window.setTimeout(() => barcodeRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [documentId, loading, kind]);
  useEffect(() => {
    const code = scanCode.trim();
    if (!code || !scanBurst.current.rapid || scanBusy) return;
    const timer = window.setTimeout(() => {
      if (scanBurst.current.rapid) scanBarcode(code);
    }, 90);
    return () => clearTimeout(timer);
    // Intentionally only react to scanCode bursts from a wedge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanCode]);
  useEffect(() => {
    function onWedge(event: Event) {
      const code = String((event as CustomEvent).detail?.code || "").trim();
      if (!code || scanBusy) return;
      setScanCode(code);
      scanBarcode(code);
    }
    window.addEventListener("vault:barcode", onWedge);
    return () => window.removeEventListener("vault:barcode", onWedge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanBusy, purchase, lines]);
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
        cargoRent: "0",
        price: code === "AFN" ? l.price : "",
      })),
    );
  }
  const cargoUnitAfn = (l: CartLine) => {
    try {
      if (!purchase || !(l.cargoRent || "").trim()) return 0;
      return toMoney(l.cargoRent!);
    } catch {
      return 0;
    }
  };
  const total = lines.reduce((s, l) => {
    const goods =
      Math.round(Number(l.price || 0) * 100) * l.quantity -
      Math.round(Number(l.discount || 0) * 100);
    return s + goods + cargoUnitAfn(l) * l.quantity;
  }, 0);
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
  const saleFxScaled =
    !purchase && paymentInForeign && currency !== "AFN" && fxRate.trim()
      ? (() => {
          try {
            return toFxRate(fxRate);
          } catch {
            return 0;
          }
        })()
      : 0;
  const totalForeign = saleFxScaled
    ? foreignFromAfn(total, saleFxScaled)
    : 0;
  const previousBalance =
    !purchase && customerMode === "existing" && selectedParty && !selectedParty.walk_in
      ? selectedParty.balance || 0
      : 0;
  const projectedBalance = previousBalance + total - payment;
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
    const phone = assertPhoneValid(customerPhone, t);
    if (name.length < 2) throw new Error(t("sales.errCustomerName"));
    const found = await api<{ rows: Party[] }>("parties", {
      kind: "customer",
      q: name,
      limit: 20,
    });
    const match = found.rows.find(
      (p) => !p.walk_in && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      if (phone && !match.phone) {
        try {
          await api("partyUpdate", {
            id: match.id,
            name: match.name,
            phone,
            email: match.email || "",
            address: match.address || "",
          });
          match.phone = phone;
        } catch {
          /* keep sale moving if phone update is denied */
        }
      }
      chooseParty(match);
      return match.id;
    }
    const created = await api<{ id: string }>("partyCreate", {
      kind: "customer",
      name,
      phone,
      request_key: requestKey(),
    });
    chooseParty({
      id: created.id,
      kind: "customer",
      name,
      phone,
      email: "",
      address: "",
      balance: 0,
      walk_in: 0,
    });
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
        const cargo_rent =
          purchase && (l.cargoRent || "").trim()
            ? toMoney(l.cargoRent!)
            : 0;
        return {
          product_id: l.product.id,
          ...(l.product.serialized && purchase
            ? {
                units: l.units?.length
                  ? Array.from(
                      { length: l.quantity },
                      (_, i) => l.units?.[i] || {},
                    )
                  : undefined,
              }
            : {}),
          quantity: l.quantity,
          price,
          discount: toMoney(l.discount),
          ...(purchase
            ? {
                currency,
                cost_foreign: cost_aed,
                cost_aed: currency === "AED" ? cost_aed : 0,
                cargo_rent,
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
                            <PartySearchSelect
                              kind="supplier"
                              value={party}
                              selected={selectedParty}
                              onChange={chooseParty}
                              placeholder={t("people.searchSuppliers")}
                              required
                            />
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
                            <>
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
                              <div className="sale-customer-phone">
                                <PhoneField
                                  key={documentId || "new-sale-phone"}
                                  label={t("party.phone")}
                                  defaultValue={customerPhone}
                                  onChange={setCustomerPhone}
                                  showCountry={false}
                                />
                              </div>
                            </>
                          ) : (
                            <label className="sale-customer-name">
                              <span>{t("sales.customer")}</span>
                              <div className="inline-actions party-picker">
                                <PartySearchSelect
                                  kind="customer"
                                  value={party}
                                  selected={selectedParty}
                                  onChange={chooseParty}
                                  placeholder={t("people.searchCustomers")}
                                  walkInLabel={t("sales.walkInCashOnly")}
                                  required
                                />
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
                          onChange={(e) => {
                            const now = Date.now();
                            const gap = now - scanBurst.current.last;
                            scanBurst.current.rapid =
                              !scanBurst.current.last || gap < 55;
                            scanBurst.current.last = now;
                            setScanCode(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              scanBurst.current.rapid = false;
                              scanBarcode();
                            }
                          }}
                          name="barcode_scan"
                          inputMode="text"
                          autoComplete="off"
                          autoFocus={!documentId}
                        />
                        <button
                          type="button"
                          className="button"
                          disabled={scanBusy || !scanCode.trim()}
                          onClick={() => void scanBarcode()}
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
                                      {out
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
                        <div className="cart-line" key={l.key || l.product.id}>
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
                          {l.product.serialized && purchase ? (
                            <ReceiveDevices
                              defaultCondition={l.product.condition}
                              quantity={l.quantity}
                              values={l.units}
                              onChange={(v) => update(i, "units", v)}
                            />
                          ) : null}
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
                                <Field
                                  label={t("currencies.cargoRent", {
                                    code: "AFN",
                                  })}
                                >
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={l.cargoRent ?? "0"}
                                    onChange={(e) =>
                                      update(i, "cargoRent", e.target.value)
                                    }
                                    placeholder="0.00"
                                  />
                                </Field>
                                <Field label={t("sales.landedCostAf")}>
                                  <NumericInput
                                    min="0"
                                    step="0.01"
                                    value={(() => {
                                      try {
                                        if (!(l.price || "").trim()) return "";
                                        return moneyInput(
                                          toMoney(l.price) + cargoUnitAfn(l),
                                        );
                                      } catch {
                                        return l.price;
                                      }
                                    })()}
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
                                <Field
                                  label={
                                    saleFxScaled
                                      ? t("sales.unitPriceFx", {
                                          code: currency,
                                        })
                                      : t("sales.unitPrice")
                                  }
                                  hint={
                                    saleFxScaled
                                      ? (() => {
                                          try {
                                            return foreignMoney(
                                              foreignFromAfn(
                                                toMoney(l.price || "0"),
                                                saleFxScaled,
                                              ),
                                              currency,
                                            );
                                          } catch {
                                            return "";
                                          }
                                        })()
                                      : undefined
                                  }
                                >
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
                            allowCodes={["AFN", "USD"]}
                            allowAdd={false}
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
                                lines.reduce((sum, l) => {
                                  try {
                                    return (
                                      sum +
                                      toMoney(l.costAed || "0") * l.quantity
                                    );
                                  } catch {
                                    return sum;
                                  }
                                }, 0),
                                currency,
                              )}
                            </bdi>
                          </strong>
                        </div>
                      )}
                      {!purchase &&
                        customerMode === "existing" &&
                        selectedParty &&
                        !selectedParty.walk_in && (
                          <>
                            <div>
                              <span>{t("sales.previousBalance")}</span>
                              <strong
                                className={
                                  previousBalance > 0 ? "text-red" : undefined
                                }
                              >
                                {af(previousBalance, 2)}
                              </strong>
                            </div>
                            <div>
                              <span>{t("sales.thisInvoice")}</span>
                              <strong>{af(total, 2)}</strong>
                            </div>
                            <div>
                              <span>{t("sales.newBalance")}</span>
                              <strong
                                className={
                                  projectedBalance > 0 ? "text-red" : "text-green"
                                }
                              >
                                {af(Math.max(0, projectedBalance), 2)}
                              </strong>
                            </div>
                          </>
                        )}
                      <div>
                        <span>{t("sales.invoiceTotal")}</span>
                        <strong>
                          {af(total, 2)}
                          {saleFxScaled ? (
                            <>
                              {" · "}
                              <bdi dir="ltr">
                                {foreignMoney(totalForeign, currency)}
                              </bdi>
                            </>
                          ) : null}
                        </strong>
                      </div>
                      {saleFxScaled ? (
                        <div>
                          <span>{t("currencies.exchangeRate")}</span>
                          <strong>
                            <bdi dir="ltr">
                              {fxRateLabel(saleFxScaled, currency)}
                            </bdi>
                          </strong>
                        </div>
                      ) : null}
                      <div>
                        <span>{t("sales.balanceRemaining")}</span>
                        <strong>
                          {af(Math.max(0, total - payment), 2)}
                          {saleFxScaled ? (
                            <>
                              {" · "}
                              <bdi dir="ltr">
                                {foreignMoney(
                                  foreignFromAfn(
                                    Math.max(0, total - payment),
                                    saleFxScaled,
                                  ),
                                  currency,
                                )}
                              </bdi>
                            </>
                          ) : null}
                        </strong>
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
                          <PartySearchSelect
                            kind="supplier"
                            value={party}
                            selected={selectedParty}
                            onChange={chooseParty}
                            placeholder={t("people.searchSuppliers")}
                            required
                          />
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
                            name="barcode_scan"
                            inputMode="text"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="button"
                            disabled={scanBusy || !scanCode.trim()}
                            onClick={() => void scanBarcode()}
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
                              const added =
                                !p.serialized &&
                                lines.some((l) => l.product.id === p.id);
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
                          <div
                            className="cart-line"
                            key={l.key || l.product.id}
                          >
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
                            {l.product.serialized ? (
                              <ReceiveDevices
                                defaultCondition={l.product.condition}
                                quantity={l.quantity}
                                values={l.units}
                                onChange={(v) => update(i, "units", v)}
                              />
                            ) : null}
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
                              <Field
                                label={t("currencies.cargoRent", {
                                  code: "AFN",
                                })}
                              >
                                <NumericInput
                                  min="0"
                                  step="0.01"
                                  value={l.cargoRent ?? "0"}
                                  onChange={(e) =>
                                    update(i, "cargoRent", e.target.value)
                                  }
                                  placeholder="0.00"
                                />
                              </Field>
                            </div>
                            <div className="form-grid three" style={{ marginTop: 4 }}>
                              <Field label={t("sales.landedCostAf")}>
                                <NumericInput
                                  min="0"
                                  step="0.01"
                                  value={(() => {
                                    try {
                                      if (!(l.price || "").trim()) return "";
                                      return moneyInput(
                                        toMoney(l.price) + cargoUnitAfn(l),
                                      );
                                    } catch {
                                      return l.price;
                                    }
                                  })()}
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
            const created = result as
              | (Party & { keepOpen?: boolean })
              | { id?: string; keepOpen?: boolean }
              | undefined;
            if (!created?.keepOpen) setAddingParty(false);
            if (created?.id) {
              chooseParty({
                id: created.id,
                kind: purchase ? "supplier" : "customer",
                name: (created as Party).name || "",
                phone: (created as Party).phone || "",
                email: (created as Party).email || "",
                address: (created as Party).address || "",
                balance: (created as Party).balance || 0,
                walk_in: (created as Party).walk_in || 0,
              });
              if (!purchase) setCustomerMode("existing");
            }
          }}
        />
      )}
      {addingProduct && purchase && (
        <ProductForm
          intent="purchase"
          close={() => setAddingProduct(false)}
          done={async (_message, result) => {
            if (!result?.product) return;
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
type PartyDraft = {
  opening_request_key?: string;
  id?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  opening_balance: string;
  opening_date: string;
  walk_in?: number;
};
function blankParty(seed?: Party | null): PartyDraft {
  return {
    id: seed?.id,
    name: seed?.name || "",
    phone: seed?.phone || "",
    email: seed?.email || "",
    address: seed?.address || "",
    opening_balance: "0",
    opening_date: businessDate(),
    walk_in: seed?.walk_in,
  };
}
export function PartyForm({
  kind,
  party,
  user,
  close,
  done,
}: {
  kind: "customer" | "supplier";
  party?: Party | null;
  user?: User;
} & DialogProps) {
  const t = useT();
  const [draft, setDraft] = useState<PartyDraft>(() => blankParty(party));
  const [history, setHistory] = useState<PartyDraft[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const key = useRef(requestKey());
  const newDraft = useRef<PartyDraft>(blankParty());
  const editing = !!draft.id;
  const canOpening = user?.role === "Owner" && !draft.walk_in;
  const sessionCreate = !party?.id;
  function patch(name: keyof PartyDraft, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
    setNotice("");
  }
  function loadDraft(next: PartyDraft, index = -1) {
    setDraft(next);
    setCursor(index);
    setError("");
    setNotice("");
    key.current = requestKey();
  }
  function previous() {
    if (cursor >= 0)
      setHistory((rows) => rows.map((row, i) => (i === cursor ? draft : row)));
    else if (!editing) newDraft.current = draft;
    const index = cursor < 0 ? history.length - 1 : cursor - 1;
    if (index >= 0) loadDraft(history[index], index);
  }
  function backToNew() {
    if (cursor >= 0)
      setHistory((rows) => rows.map((row, i) => (i === cursor ? draft : row)));
    loadDraft(newDraft.current);
  }
  async function save(mode: "close" | "next") {
    setBusy(true);
    setError("");
    try {
      const phone = assertPhoneValid(draft.phone, t);
      let saved: PartyDraft;
      if (editing) {
        await api<{ id: string }>("partyUpdate", {
          id: draft.id,
          name: draft.name,
          phone,
          email: draft.email,
          address: draft.address,
          ...(draft.opening_request_key && canOpening ? { opening: {
            request_key: draft.opening_request_key,
            amount: toMoney(draft.opening_balance || "0"),
            date: draft.opening_date || businessDate(),
          }} : {}),
        });
        const opening = toMoney(draft.opening_balance || "0");
        if (opening > 0 && canOpening && !draft.opening_request_key) {
          await api("openingBalance", {
            party_id: draft.id,
            amount: opening,
            date: draft.opening_date || businessDate(),
            request_key: `${key.current}-opening`,
          });
        }
        saved = {
          ...draft,
          phone,
          opening_balance: draft.opening_request_key ? draft.opening_balance : "0",
        };
        if (cursor >= 0)
          setHistory((rows) =>
            rows.map((row, i) => (i === cursor ? saved : row)),
          );
        await done(
          kind === "customer"
            ? t("partyForm.customerUpdated")
            : t("partyForm.supplierUpdated"),
          { id: draft.id, keepOpen: mode === "next" },
        );
      } else {
        const created = await api<{ id: string }>("partyCreate", {
          kind,
          name: draft.name,
          phone,
          email: draft.email,
          address: draft.address,
          opening_balance: toMoney(draft.opening_balance || "0"),
          opening_date: draft.opening_date || businessDate(),
          request_key: key.current,
        });
        saved = {
          ...draft,
          id: created.id,
          phone,
          opening_balance: draft.opening_balance,
          opening_request_key: key.current,
        };
        setHistory((rows) => [...rows, saved]);
        await done(
          kind === "customer"
            ? t("partyForm.customerAdded")
            : t("partyForm.supplierAdded"),
          { ...created, keepOpen: mode === "next" },
        );
      }
      if (mode === "next") {
        const fresh = blankParty();
        newDraft.current = fresh;
        loadDraft(fresh);
        setNotice(
          kind === "customer"
            ? t("entry.savedCustomerNext")
            : t("entry.savedSupplierNext"),
        );
      } else if (editing && cursor >= 0) {
        loadDraft(newDraft.current);
        setNotice(
          kind === "customer"
            ? t("entry.savedCustomerNext")
            : t("entry.savedSupplierNext"),
        );
      } else {
        close();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        editing
          ? kind === "customer"
            ? t("partyForm.editCustomer")
            : t("partyForm.editSupplier")
          : kind === "customer"
            ? t("partyForm.addCustomer")
            : t("partyForm.addSupplier")
      }
      subtitle={
        cursor >= 0
          ? t("entry.previousCustomer", { number: cursor + 1 })
          : t("partyForm.subtitle")
      }
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(editing && cursor >= 0 ? "next" : "close");
        }}
      >
        <div className="form-body">
          <Field label={t("partyForm.nameBusiness")}>
            <input
              name="name"
              required
              minLength={2}
              value={draft.name}
              onChange={(e) => patch("name", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <PhoneField
              key={`${draft.id || "new"}-${cursor}`}
              name="phone"
              label={t("party.phone")}
              defaultValue={draft.phone}
              onChange={(value) => patch("phone", value)}
            />
            <Field label={t("partyForm.emailOptional")}>
              <input
                name="email"
                type="email"
                value={draft.email}
                onChange={(e) => patch("email", e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("party.address")}>
            <textarea
              name="address"
              rows={2}
              value={draft.address}
              onChange={(e) => patch("address", e.target.value)}
            />
          </Field>
          {(!editing || canOpening) && (
            <div className="form-grid">
              <Field
                label={
                  kind === "customer"
                    ? t("partyForm.openingCustomer")
                    : t("partyForm.openingSupplier")
                }
                hint={
                  editing && !draft.opening_request_key
                    ? kind === "customer"
                      ? t("partyForm.openingEditHintCustomer")
                      : t("partyForm.openingEditHintSupplier")
                    : kind === "customer"
                      ? t("partyForm.openingHintCustomer")
                      : t("partyForm.openingHintSupplier")
                }
              >
                <NumericInput
                  name="opening_balance"
                  min="0"
                  step="0.01"
                  value={draft.opening_balance}
                  onChange={(e) => patch("opening_balance", e.target.value)}
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
                  value={draft.opening_date}
                  onChange={(e) => patch("opening_date", e.target.value)}
                />
              </Field>
            </div>
          )}
          {notice && <p className="entry-notice">{notice}</p>}
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          {sessionCreate && (
            <>
              <button
                type="button"
                className="button"
                disabled={busy || !history.length || cursor === 0}
                onClick={previous}
              >
                <ArrowLeftIcon size={15} aria-hidden="true" />
                {t("entry.previous")}
              </button>
              {cursor >= 0 && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={backToNew}
                >
                  <ArrowRightIcon size={15} aria-hidden="true" />
                  {t("entry.backToNew")}
                </button>
              )}
              {!editing && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void save("next")}
                >
                  <PlusIcon size={15} aria-hidden="true" />
                  {t("entry.saveNew")}
                </button>
              )}
            </>
          )}
          <button className="button button-dark" disabled={busy}>
            <FloppyDiskIcon size={15} aria-hidden="true" />
            {busy
              ? t("common.saving")
              : editing
                ? t("common.save")
                : kind === "customer"
                  ? t("partyForm.addCustomer")
                  : t("partyForm.addSupplier")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
type ExpenseDraft = {
  id?: string;
  amount: string;
  date: string;
  account_id: string;
  note: string;
};
function blankExpense(accountId = ""): ExpenseDraft {
  return {
    amount: "",
    date: businessDate(),
    account_id: accountId,
    note: "",
  };
}
export function ExpenseForm({ close, done }: DialogProps) {
  const t = useT();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const key = useRef(requestKey());
  const [accounts, setAccounts] = useState<any[]>([]),
    [adding, setAdding] = useState(false),
    [accountName, setAccountName] = useState(""),
    [accountBusy, setAccountBusy] = useState(false);
  const [draft, setDraft] = useState<ExpenseDraft>(() => blankExpense());
  const [history, setHistory] = useState<ExpenseDraft[]>([]);
  const [cursor, setCursor] = useState(-1);
  const newDraft = useRef<ExpenseDraft>(blankExpense());
  const defaultAccount = useRef("");
  const editing = !!draft.id;
  useEffect(() => {
    let active = true;
    api("expenseAccounts")
      .then((data) => {
        if (!active) return;
        setAccounts(data.rows);
        const id =
          data.rows.find((a: any) => a.name === "Rent")?.id ||
          data.rows[0]?.id ||
          "";
        defaultAccount.current = id;
        setDraft((d) => (d.account_id ? d : { ...d, account_id: id }));
        newDraft.current = blankExpense(id);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function patch(name: keyof ExpenseDraft, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
    setNotice("");
  }
  function loadDraft(next: ExpenseDraft, index = -1) {
    setDraft(next);
    setCursor(index);
    setError("");
    setNotice("");
    key.current = requestKey();
  }
  function previous() {
    if (cursor >= 0)
      setHistory((rows) => rows.map((row, i) => (i === cursor ? draft : row)));
    else if (!editing) newDraft.current = draft;
    const index = cursor < 0 ? history.length - 1 : cursor - 1;
    if (index >= 0) loadDraft(history[index], index);
  }
  function backToNew() {
    if (cursor >= 0)
      setHistory((rows) => rows.map((row, i) => (i === cursor ? draft : row)));
    loadDraft(newDraft.current);
  }
  async function addAccount() {
    setAccountBusy(true);
    setError("");
    try {
      const created = await api("expenseAccountCreate", { name: accountName });
      setAccounts((rows) => [...rows, created]);
      patch("account_id", created.id);
      setAdding(false);
      setAccountName("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAccountBusy(false);
    }
  }
  async function save(mode: "close" | "next") {
    setBusy(true);
    setError("");
    try {
      let saved: ExpenseDraft;
      if (editing) {
        await api("expenseUpdate", {
          id: draft.id,
          amount: toMoney(draft.amount),
          account_id: draft.account_id,
          date: draft.date,
          note: draft.note,
        });
        saved = { ...draft };
        if (cursor >= 0)
          setHistory((rows) =>
            rows.map((row, i) => (i === cursor ? saved : row)),
          );
        await done(t("toast.expenseRecorded"), {
          id: draft.id,
          keepOpen: mode === "next",
        });
      } else {
        const created = await api<{ id: string }>("expense", {
          amount: toMoney(draft.amount),
          account_id: draft.account_id,
          date: draft.date,
          note: draft.note,
          request_key: key.current,
        });
        saved = { ...draft, id: created.id };
        setHistory((rows) => [...rows, saved]);
        await done(t("toast.expenseRecorded"), {
          ...created,
          keepOpen: mode === "next",
        });
      }
      if (mode === "next") {
        const fresh = blankExpense(
          draft.account_id || defaultAccount.current,
        );
        newDraft.current = fresh;
        loadDraft(fresh);
        setNotice(t("entry.savedExpenseNext"));
      } else if (editing && cursor >= 0) {
        loadDraft(newDraft.current);
        setNotice(t("entry.savedExpenseNext"));
      } else {
        close();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        editing ? t("expense.recordAn") : t("expense.recordAn")
      }
      subtitle={
        cursor >= 0
          ? t("entry.previousExpense", { number: cursor + 1 })
          : t("expense.subtitleDaily")
      }
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(editing && cursor >= 0 ? "next" : "close");
        }}
      >
        <div className="form-body">
          <div className="form-grid">
            <Field label={t("expense.amount")}>
              <NumericInput
                name="amount"
                min="0.01"
                step="0.01"
                required
                autoFocus
                value={draft.amount}
                onChange={(e) => patch("amount", e.target.value)}
              />
            </Field>
            <Field label={t("expense.date")}>
              <input
                name="date"
                type="date"
                value={draft.date}
                max={businessDate()}
                required
                onChange={(e) => patch("date", e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("expenseAccounts.account")}>
            <select
              value={draft.account_id}
              onChange={(e) => patch("account_id", e.target.value)}
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
              value={draft.note}
              onChange={(e) => patch("note", e.target.value)}
            />
          </Field>
          {notice && <p className="entry-notice">{notice}</p>}
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !history.length || cursor === 0}
            onClick={previous}
          >
            <ArrowLeftIcon size={15} aria-hidden="true" />
            {t("entry.previous")}
          </button>
          {cursor >= 0 && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={backToNew}
            >
              <ArrowRightIcon size={15} aria-hidden="true" />
              {t("entry.backToNew")}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="button"
              disabled={busy || accountBusy || !draft.account_id || adding}
              onClick={() => void save("next")}
            >
              <PlusIcon size={15} aria-hidden="true" />
              {t("entry.saveNew")}
            </button>
          )}
          <button
            className="button button-dark"
            disabled={busy || accountBusy || !draft.account_id || adding}
          >
            <FloppyDiskIcon size={15} aria-hidden="true" />
            {busy
              ? t("common.saving")
              : editing
                ? t("common.save")
                : t("expense.record")}
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
    [notice, setNotice] = useState(""),
    [returning, setReturning] = useState(false),
    [refundCurrency, setRefundCurrency] = useState("AFN"),
    [refundRate, setRefundRate] = useState("1"),
    [refundAmount, setRefundAmount] = useState(""),
    [printReturn, setPrintReturn] = useState(false),
    [printOpen, setPrintOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [quantities, setQuantities] = useState<Record<string, number>>({});
  const [returnDevices, setReturnDevices] = useState<Record<string, string[]>>(
    {},
  );
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
    if (doc.kind === "purchase" && l.units?.length)
      return (
        sum +
        l.units
          .filter((u: any) => (returnDevices[l.id] || []).includes(u.id))
          .reduce((n: number, u: any) => n + (u.return_cost || 0), 0)
      );
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
            unit_ids: returnDevices[l.id],
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
      subtitle={
        doc ? `${kindTitle} · ${invoiceWhen(doc)}` : t("invoice.loading")
      }
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
            {doc.kind === "sale" ? (
              <div className="sale-shop-preview">
                <div className="sale-shop-preview-brand">
                  {(store?.logo_left || store?.logo) && (
                    <img
                      className="invoice-logo"
                      src={store.logo_left || store.logo}
                      alt=""
                    />
                  )}
                  <div className="sale-shop-preview-titles">
                    <h2 dir="ltr">{store?.name}</h2>
                    {store?.name_ps ? (
                      <h3 className="sale-shop-preview-ps" dir="rtl" lang="ps">
                        {store.name_ps}
                      </h3>
                    ) : null}
                  </div>
                  {store?.logo_right ? (
                    <img
                      className="invoice-logo"
                      src={store.logo_right}
                      alt=""
                    />
                  ) : (
                    <span className="sale-shop-preview-spacer" aria-hidden="true" />
                  )}
                </div>
                {store?.services ? (
                  <p className="sale-shop-preview-services" dir="auto">
                    {store.services}
                  </p>
                ) : null}
                <div className="sale-shop-preview-owners">
                  {(
                    [
                      [
                        store?.owner1_name,
                        store?.owner1_phone,
                        store?.owner1_whatsapp,
                      ],
                      [
                        store?.owner2_name,
                        store?.owner2_phone,
                        store?.owner2_whatsapp,
                      ],
                    ] as const
                  )
                    .filter(([name]) => !!name)
                    .map(([name, phone, whatsapp], i) => {
                      const wa = normalizeDigits(String(whatsapp || "")).trim();
                      const tel = normalizeDigits(String(phone || "")).trim();
                      return (
                        <div key={i}>
                          <strong dir="auto">{name}</strong>
                          {wa || tel ? (
                            <small className="sale-shop-preview-contacts">
                              {wa ? (
                                <span dir="ltr">
                                  <WhatsappLogoIcon size={12} weight="fill" />
                                  <bdi dir="ltr">{wa}</bdi>
                                </span>
                              ) : null}
                              {tel ? (
                                <span dir="ltr">
                                  <PhoneIcon size={12} weight="fill" />
                                  <bdi dir="ltr">{tel}</bdi>
                                </span>
                              ) : null}
                            </small>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
                <div className="sale-shop-preview-doc">
                  <Badge tone="gray">{kindTitle.toUpperCase()}</Badge>
                  <h3>{doc.number}</h3>
                  <p>
                    <bdi dir="ltr">{invoiceWhen(doc)}</bdi>
                  </p>
                </div>
              </div>
            ) : (
              <div className="invoice-top">
                <div>
                  {store?.logo ? (
                    <img className="invoice-logo" src={store.logo} alt="" />
                  ) : null}
                  <h2 dir="ltr">{store?.name}</h2>
                  {store?.address ? <p dir="auto">{store.address}</p> : null}
                  <p>
                    {store?.phone ? (
                      <bdi dir="ltr">
                        {normalizeDigits(String(store.phone))}
                      </bdi>
                    ) : null}
                    {store?.phone && store?.email ? " · " : null}
                    {store?.email || null}
                  </p>
                </div>
                <div>
                  <Badge tone="gray">{kindTitle.toUpperCase()}</Badge>
                  <h3>{doc.number}</h3>
                  <p>
                    <bdi dir="ltr">{invoiceWhen(doc)}</bdi>
                  </p>
                </div>
              </div>
            )}
            <div className="invoice-meta">
              <div>
                <span>
                  {["purchase", "purchase_return", "payment"].includes(doc.kind)
                    ? t("invoice.supplier")
                    : t("invoice.customer")}
                </span>
                <strong>{doc.party_name || "—"}</strong>
                {doc.party_phone ? (
                  <small className="block muted">
                    <bdi dir="ltr">
                      {normalizeDigits(String(doc.party_phone))}
                    </bdi>
                  </small>
                ) : null}
              </div>
              <div>
                <span>{t("invoice.recordedBy")}</span>
                <strong>{doc.user_name}</strong>
              </div>
              <div>
                <span>{t("invoice.dueDate")}</span>
                <strong>{doc.due_date || "—"}</strong>
              </div>
              {["purchase", "purchase_return", "sale", "sale_return"].includes(
                doc.kind,
              ) &&
                !!doc.fx_rate &&
                doc.currency &&
                doc.currency !== "AFN" && (
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
                    {doc.kind === "purchase" && (
                      <th>{t("currencies.cargoRent", { code: "AFN" })}</th>
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
                    const lineTotal =
                      doc.kind === "purchase" && l.cost != null
                        ? l.cost
                        : l.quantity * l.price - l.discount;
                    const landedUnit =
                      doc.kind === "purchase" && l.quantity
                        ? Math.round(lineTotal / l.quantity)
                        : l.price;
                    return (
                      <tr key={l.id}>
                        <td>
                          <ProductName product={l} sub={identity || l.sku} />
                          {l.units?.map((u: any) => (
                            <div className="unit-invoice" key={u.id}>
                              <bdi dir="ltr">{u.serial || u.code}</bdi> ·{" "}
                              {[u.condition, u.battery, u.notes, u.accessories]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          ))}
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
                        {doc.kind === "purchase" && (
                          <td>{l.cargo_rent ? af(l.cargo_rent, 2) : "—"}</td>
                        )}
                        <td>
                          {af(
                            doc.kind === "purchase" ? landedUnit : l.price,
                            2,
                          )}
                        </td>
                        <td>{af(l.discount, 2)}</td>
                        <td>{af(lineTotal, 2)}</td>
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
              {doc.kind === "sale" && doc.previous_balance != null && (
                <>
                  {doc.previous_balance ? (
                    <div>
                      <span>{t("sales.previousBalance")}</span>
                      <strong className="money">
                        {af(doc.previous_balance, 2)}
                      </strong>
                    </div>
                  ) : null}
                  <div>
                    <span>{t("sales.totalBalance")}</span>
                    <strong className="money text-red">
                      {af(doc.new_balance ?? doc.party_balance ?? 0, 2)}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {doc.note && <p className="invoice-note">{doc.note}</p>}
            {store?.bill_footer ? (
              <p className="invoice-note">{store.bill_footer}</p>
            ) : null}
            {doc.kind === "sale" && (
              <>
                <div className="sale-shop-preview-signature">
                  <span>{t("invoice.customerSignature")}</span>
                  <i />
                </div>
                {store?.address_ps ? (
                  <p className="sale-shop-preview-address" dir="rtl" lang="ps">
                    {store.address_ps}
                  </p>
                ) : null}
              </>
            )}
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
                .map((l: any) =>
                  l.units?.length ? (
                    <section className="device-selection" key={l.id}>
                      <strong>
                        {l.name} · {t("devices.chooseReturn")}
                      </strong>
                      {l.units
                        .filter((u: any) => u.returnable)
                        .map((u: any) => (
                          <label className="device-option" key={u.id}>
                            <input
                              type="checkbox"
                              checked={(returnDevices[l.id] || []).includes(
                                u.id,
                              )}
                              onChange={(e) => {
                                const ids = e.target.checked
                                  ? [...(returnDevices[l.id] || []), u.id]
                                  : (returnDevices[l.id] || []).filter(
                                      (id) => id !== u.id,
                                    );
                                setReturnDevices((v) => ({
                                  ...v,
                                  [l.id]: ids,
                                }));
                                setQuantities((v) => ({
                                  ...v,
                                  [l.id]: ids.length,
                                }));
                              }}
                            />
                            <span>
                              <b>{u.serial || u.code}</b>
                              <small>
                                {[u.condition, u.battery, u.notes]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </span>
                          </label>
                        ))}
                    </section>
                  ) : (
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
                  ),
                )}
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
      {notice && !returning && (
        <p className="entry-notice" role="status">
          {notice}
        </p>
      )}
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
        {["receipt", "payment", "consignment_payment", "consignment_recovery"].includes(
          doc?.kind,
        ) &&
          ["Owner", "Manager"].includes(user.role) &&
          user.permissions.includes("finance") && (
            <>
              {["consignment_payment", "consignment_recovery"].includes(
                doc.kind,
              ) &&
                edit && (
                  <button className="button" onClick={edit}>
                    {t("resale.editPayment")}
                  </button>
                )}
              {remove && (
                <button className="button danger-text" onClick={remove}>
                  {t("invoiceActions.deletePayment")}
                </button>
              )}
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
                  setReturnDevices({});
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
        {doc && canWhatsApp(doc.party_phone) && (
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              if (!store) return;
              setBusy(true);
              setError("");
              try {
                const printDoc = invoicePrintModel(doc, store, {
                  locale,
                  t,
                  money: af,
                  foreignMoney: (amount: number, code?: string) =>
                    foreignMoney(amount, code || doc.currency || "AED"),
                  specs: productSpecEntries,
                  rate: (rate: number) =>
                    fxRateLabel(rate, doc.currency || "AED"),
                }) as PrintDocument;
                const result = await shareViaWhatsApp({
                  phone: doc.party_phone,
                  text: t("whatsapp.invoiceText", {
                    number: doc.number,
                    name: doc.party_name || "",
                    total: af(doc.total, 2),
                  }),
                  document: printDoc,
                  fileBase: `${doc.party_name || "invoice"}-${doc.number}`,
                  t,
                });
                setNotice(result.message);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <WhatsappLogoIcon size={16} />
            {t("whatsapp.sendInvoice")}
          </button>
        )}
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
  const settlement = [
    "receipt",
    "payment",
    "consignment_payment",
    "consignment_recovery",
  ].includes(doc?.kind);
  const command = settlement
    ? "paymentDelete"
    : purchase
      ? "purchaseDelete"
      : "saleDelete";
  return (
    <Modal
      title={
        settlement
          ? t("deleteInvoice.titlePayment")
          : t("deleteInvoice.titleAction")
      }
      subtitle={doc?.number || t("deleteInvoice.loading")}
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(command, {
              id: doc.id,
              revision: doc.revision,
              request_key: key.current,
            });
            done(
              settlement
                ? ["consignment_payment", "consignment_recovery"].includes(
                    doc.kind,
                  )
                  ? t("resale.paymentDeleted")
                  : t("deleteInvoice.deletedPayment")
                : purchase
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
            {t(
              settlement
                ? "deleteInvoice.areYouSurePayment"
                : purchase
                  ? "deleteInvoice.areYouSurePurchase"
                  : "deleteInvoice.areYouSureSale",
              { number: doc?.number || "" },
            )}
          </p>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-danger"
            disabled={busy || !doc}
          >
            {busy
              ? t("deleteInvoice.deleting")
              : settlement
                ? t("deleteInvoice.actionPayment")
                : t("deleteInvoice.action")}
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
  const { locale } = useI18n();
  const [adjustQty, setAdjustQty] = useState("1");
  const [adjustUnits, setAdjustUnits] = useState<Device[]>([]);
  const [receiveUnits, setReceiveUnits] = useState<DeviceDetails[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [labelDoc, setLabelDoc] = useState<PrintDocument | null>(null);
  const [labelCopies, setLabelCopies] = useState(1);
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
        unit_ids: adjustUnits.map((u) => u.id),
        units:
          Number(adjustQty) > 0 && receiveUnits.length
            ? Array.from(
                { length: Number(adjustQty) },
                (_, i) => receiveUnits[i] || {},
              )
            : undefined,
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
    <>
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
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  required
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
            {!!product.serialized &&
              (Number(adjustQty) < 0 ? (
                <DeviceSelection
                  product={product}
                  selected={adjustUnits}
                  onChange={setAdjustUnits}
                />
              ) : (
                <ReceiveDevices
                  quantity={Number(adjustQty)}
                  values={receiveUnits}
                  onChange={setReceiveUnits}
                />
              ))}
            <p className="help-note">{t("productDetail.adjustHelp")}</p>
            <ErrorMessage error={error} />
            <button className="button button-dark" disabled={busy}>
              {busy ? t("common.saving") : t("productDetail.postAdjust")}
            </button>
          </form>
        )}
        {confirmDelete && (
          <div className="product-delete-confirm" role="alert">
            <p>{t("productDetail.deleteConfirm")}</p>
            <div className="heading-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="button button-danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api("productDelete", { id: product.id });
                    done(t("productDetail.deleted"));
                  } catch (e: any) {
                    setError(e.message);
                    setConfirmDelete(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <TrashIcon size={15} />
                {t("common.delete")}
              </button>
            </div>
          </div>
        )}
        <ErrorMessage error={!adjust ? error : ""} />
      </div>
      <div className="modal-actions">
        {user.permissions.includes("inventory") && (
          <button
            className="button button-danger"
            disabled={busy || !data}
            onClick={() => {
              setAdjust(false);
              if (product.stock !== 0) {
                setError(
                  t("productDetail.deleteStockRemaining", { n: product.stock }),
                );
                return;
              }
              setError("");
              setConfirmDelete(true);
            }}
          >
            <TrashIcon size={15} />
            {t("common.delete")}
          </button>
        )}
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
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setError("");
              let code = String(product.barcode || "").trim();
              if (!code || !canEncodeQr(code)) {
                setBusy(true);
                try {
                  code = generateProductBarcode();
                  const result = await api<{ product: Product }>(
                    "productUpdate",
                    {
                      id: product.id,
                      name: product.name,
                      brand: product.brand,
                      model: product.model,
                      sku: product.sku,
                      barcode: code,
                      category: product.category,
                      price: product.price,
                      minimum: product.minimum ?? 0,
                      location: product.location || "",
                      reorder_level: product.reorder_level,
                      condition: product.condition || "New",
                      warranty: product.warranty || "",
                      attributes: product.attributes || {},
                      currency: product.currency || "AED",
                      cost_foreign:
                        product.cost_foreign ?? product.cost_aed ?? 0,
                      cost_aed: product.cost_aed ?? 0,
                      cargo_rent: product.cargo_rent ?? 0,
                      fx_rate: product.fx_rate ?? 0,
                      unit_cost: product.unit_cost,
                    },
                  );
                  setData((current: any) =>
                    current
                      ? { ...current, product: result.product }
                      : { product: result.product, movements: [] },
                  );
                } catch (e: any) {
                  setError(e.message);
                  return;
                } finally {
                  setBusy(false);
                }
              }
              const suggested = product.stock > 0 ? product.stock : 1;
              setLabelCopies(suggested);
              setLabelDoc(
                barcodeLabelDocument([product], {
                  t,
                  locale,
                  copies: suggested,
                }) as PrintDocument,
              );
            }}
          >
            <BarcodeIcon size={15} />
            {t("barcode.printShort")}
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
    {labelDoc && (
      <PrintDialog
        document={labelDoc}
        defaultCopies={labelCopies}
        onClose={() => setLabelDoc(null)}
      />
    )}
    </>
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
  done,
}: {
  party: Party;
  user: User;
  open: (name: string, data?: any) => void;
  refresh?: number;
  done?: DialogProps["done"];
} & Pick<DialogProps, "close">) {
  const { t, locale } = useI18n();
  const [detailTab, setDetailTab] = useState("ledger");
  const [ledgerAfter, setLedgerAfter] = useState("");
  const [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind = party.kind;
  const canManage = user.permissions.includes("people");
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
      <div className="form-body party-detail-body party-ledger-only">
        <ErrorMessage error={error} />
        <div className="contact-ledger">
          <div className="people-ledger-bar">
            <div className="people-ledger-balance">
              <span>{t("partyDetail.outstanding")}</span>
              <strong
                className={(current.balance || 0) > 0 ? "text-red" : "text-green"}
              >
                {af(current.balance || 0)}
              </strong>
            </div>
            <div className="inline-actions">
              {(current.balance || 0) > 0 &&
                user.permissions.includes("finance") && (
                  <button
                    className="button button-dark"
                    onClick={() => open("payment", current)}
                  >
                    {kind === "customer"
                      ? t("people.receivePayment")
                      : t("people.paySupplier")}
                    <ArrowRightIcon size={15} />
                  </button>
                )}
              {canManage && !current.walk_in && (
                <>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => open(kind, current)}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    className="button button-danger"
                    disabled={busy}
                    onClick={() => {
                      if ((current.balance || 0) !== 0) {
                        setConfirmDelete(false);
                        setError(
                          kind === "customer"
                            ? t("partyDetail.deleteBalanceCustomer")
                            : t("partyDetail.deleteBalanceSupplier"),
                        );
                        return;
                      }
                      setError("");
                      setConfirmDelete(true);
                    }}
                  >
                    <TrashIcon size={15} />
                    {t("common.delete")}
                  </button>
                </>
              )}
            </div>
          </div>
          {confirmDelete && (
            <div className="product-delete-confirm" role="alert">
              <p>
                {kind === "customer"
                  ? t("partyDetail.deleteConfirmCustomer")
                  : t("partyDetail.deleteConfirmSupplier")}
              </p>
              <div className="heading-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="button button-danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("partyDelete", { id: current.id });
                      done?.(
                        kind === "customer"
                          ? t("partyDetail.customerDeleted")
                          : t("partyDetail.supplierDeleted"),
                      );
                      close();
                    } catch (e: any) {
                      setError(e.message);
                      setConfirmDelete(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <TrashIcon size={15} />
                  {t("common.delete")}
                </button>
              </div>
            </div>
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
                  className="button"
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
                  className="button"
                  onClick={() => open("consignmentReceive", current)}
                >
                  {t("resale.receive")}
                </button>
              )}
            </div>
          )}
          {kind === "customer" && <div className="owner-ledger-tabs customer-detail-tabs" role="tablist">
            <button className="button" role="tab" aria-selected={detailTab === "ledger" && ledgerView === "trade"} onClick={() => { setDetailTab("ledger"); setLedgerView("trade"); setLedgerAfter(""); setLedgerHistory([]); }}>{t("partyDetail.ledgerTitle")}</button>
            <button className="button" role="tab" aria-selected={detailTab === "sales"} onClick={() => setDetailTab("sales")}>{t("customerHistory.title")}</button>
            {canResale && <button className="button" role="tab" aria-selected={detailTab === "ledger" && ledgerView === "resale"} onClick={() => { setDetailTab("ledger"); setLedgerView("resale"); setLedgerAfter(""); setLedgerHistory([]); }}>{t("resale.ownerLedger")}</button>}
          </div>}
          {detailTab === "sales" ? <CustomerSalesHistory id={current.id} refresh={refresh} onOpenInvoice={(id) => open("invoice", { id })} /> : <>
          <div className="panel-heading party-ledger-heading">
            <h3>
              {t(
                ledgerView === "resale"
                  ? "resale.ownerLedger"
                  : "partyDetail.ledgerTitle",
              )}
            </h3>
            {detail && (
              <div className="inline-actions">
                <ReportPrintButton
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
                      labelFor: (e: any) =>
                        partyLedgerLabel(t, e) || e.kind || "",
                    }) as PrintDocument
                  }
                />
                <ReportPrintButton
                  intent="pdf"
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
                      labelFor: (e: any) =>
                        partyLedgerLabel(t, e) || e.kind || "",
                    }) as PrintDocument
                  }
                />
                {canWhatsApp(detail.party?.phone || current.phone) && (
                  <button
                    type="button"
                    className="button"
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
                          labelFor: (e: any) =>
                            partyLedgerLabel(t, e) || e.kind || "",
                        }) as PrintDocument;
                        const result = await shareViaWhatsApp({
                          phone: detail.party.phone || current.phone,
                          text: t("whatsapp.ledgerText", {
                            name: detail.party.name,
                            balance: af(detail.party.balance, 2),
                          }),
                          document: doc,
                          fileBase: `${detail.party.name}-ledger`,
                          t,
                        });
                        done?.(result.message);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    <WhatsappLogoIcon size={15} />
                    {t("whatsapp.sendLedger")}
                  </button>
                )}
              </div>
            )}
          </div>
          {!detail ? (
            <p className="muted">{t("partyDetail.loadingLedger")}</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table ledger-table">
                  <thead>
                    <tr>
                      <th className="ledger-col-date">{t("common.date")}</th>
                      <th className="ledger-col-ref">
                        {t("ledger.reference")}
                      </th>
                      <th className="numeric ledger-col-debit">
                        {t("partyDetail.debit")}
                      </th>
                      <th className="numeric ledger-col-credit">
                        {t("partyDetail.credit")}
                      </th>
                      <th className="numeric ledger-col-balance">
                        {t("partyDetail.balance")}
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
                        </td>
                        <td
                          className={`money ledger-col-debit ${e.debit ? (kind === "customer" && ledgerView !== "resale" ? "text-red" : "text-green") : "muted"}`}
                        >
                          <strong>{e.debit ? af(e.debit) : "—"}</strong>
                        </td>
                        <td
                          className={`money ledger-col-credit ${e.credit ? (kind === "customer" && ledgerView !== "resale" ? "text-green" : "text-red") : "muted"}`}
                        >
                          <strong>{e.credit ? af(e.credit) : "—"}</strong>
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
          </>}
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
