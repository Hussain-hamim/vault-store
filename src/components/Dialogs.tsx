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
  toMoney,
  toFxRate,
  afnFromAed,
  fxRateLabel,
  fxRateInput,
  moneyInput,
  requestKey,
  businessDate,
  Product,
  Party,
  User,
  downloadInvoice,
} from "../api";
import {
  Modal,
  Field,
  Search,
  ProductName,
  Badge,
  Empty,
  ErrorMessage,
} from "./ui";
type DialogProps = {
  close: () => void;
  done: (message: string, result?: unknown) => void;
};
const PRODUCT_BRANDS = [
  "Apple",
  "Dell",
  "Samsung",
  "HP",
  "Lenovo",
  "Asus",
  "Acer",
  "Microsoft",
  "Sony",
  "LG",
  "Xiaomi",
  "Huawei",
  "Anker",
  "Logitech",
  "Western Digital",
  "Seagate",
  "Kingston",
  "SanDisk",
  "Corsair",
  "Razer",
  "Other",
];
const ACCESSORY_TYPES = [
  "Keyboard",
  "Mouse",
  "Headphones",
  "Charger",
  "Cable",
  "Case",
  "Mouse pad",
  "Plush",
  "Hard disk",
  "Webcam",
  "Hub",
  "Speaker",
  "Other",
];
function brandChoices(current?: string) {
  if (current && !PRODUCT_BRANDS.includes(current))
    return [current, ...PRODUCT_BRANDS];
  return PRODUCT_BRANDS;
}
function accessoryChoices(current?: string) {
  if (current && !ACCESSORY_TYPES.includes(current))
    return [current, ...ACCESSORY_TYPES];
  return ACCESSORY_TYPES;
}
const ACCESSORY_IMAGES: Record<string, string> = {
  Keyboard: "/assets/keyboard.jpg",
  Mouse: "/assets/mouse.jpg",
  Headphones: "/assets/headphones.png",
  Charger: "/assets/adapter.png",
  Cable: "/assets/cable.jpg",
  Case: "/assets/case.jpg",
  "Mouse pad": "/assets/mouse-pad.jpg",
  Plush: "/assets/plush.jpg",
  "Hard disk": "/assets/storage.png",
  Webcam: "/assets/webcam.jpg",
  Hub: "/assets/hub.jpg",
  Speaker: "/assets/speaker.jpg",
};
function productImage(category: string, accessoryType = "") {
  if (category === "Computers") return "/assets/laptop.png";
  if (category === "Tablets") return "/assets/tablet.png";
  if (category === "Mobiles") return "/assets/phone.png";
  if (category === "Storage") return "/assets/storage.png";
  if (category !== "Accessories") return "/assets/adapter.png";
  if (ACCESSORY_IMAGES[accessoryType]) return ACCESSORY_IMAGES[accessoryType];
  const t = accessoryType.toLowerCase();
  if (t.includes("key")) return ACCESSORY_IMAGES.Keyboard;
  if (t.includes("mouse pad") || t.includes("mousepad"))
    return ACCESSORY_IMAGES["Mouse pad"];
  if (t.includes("mouse")) return ACCESSORY_IMAGES.Mouse;
  if (t.includes("headphone") || t.includes("earbud") || t.includes("airpod"))
    return ACCESSORY_IMAGES.Headphones;
  if (t.includes("charg") || t.includes("adapter") || t.includes("power"))
    return ACCESSORY_IMAGES.Charger;
  if (t.includes("cable") || t.includes("cord")) return ACCESSORY_IMAGES.Cable;
  if (t.includes("case") || t.includes("cover")) return ACCESSORY_IMAGES.Case;
  if (t.includes("plush") || t.includes("toy")) return ACCESSORY_IMAGES.Plush;
  if (t.includes("hard") || t.includes("disk") || t.includes("ssd") || t.includes("storage"))
    return ACCESSORY_IMAGES["Hard disk"];
  if (t.includes("web") || t.includes("cam")) return ACCESSORY_IMAGES.Webcam;
  if (t.includes("hub") || t.includes("dock")) return ACCESSORY_IMAGES.Hub;
  if (t.includes("speaker") || t.includes("audio")) return ACCESSORY_IMAGES.Speaker;
  return ACCESSORY_IMAGES.Charger;
}
export function ProductForm({
  close,
  done,
  product,
  intent = "catalog",
}: {
  close: () => void;
  done: (message: string, result?: unknown) => void;
  product?: Product;
  /** From New Purchase: create catalog item with no stock; cost comes from the bill. */
  intent?: "catalog" | "purchase";
}) {
  const forPurchase = intent === "purchase" && !product;
  const [category, setCategory] = useState(product?.category || "Computers"),
    [brandPick, setBrandPick] = useState(product?.brand || "Apple"),
    [brandOther, setBrandOther] = useState(""),
    [accessoryPick, setAccessoryPick] = useState(
      product?.attributes?.Type || "Keyboard",
    ),
    [accessoryOther, setAccessoryOther] = useState(""),
    [costAed, setCostAed] = useState(
      product?.cost_aed ? moneyInput(product.cost_aed) : "",
    ),
    [fxRate, setFxRate] = useState(
      product?.fx_rate ? fxRateInput(product.fx_rate) : "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const costAedMinor = (() => {
    try {
      return costAed.trim() ? toMoney(costAed) : 0;
    } catch {
      return 0;
    }
  })();
  const fxRateScaled = (() => {
    try {
      return fxRate.trim() ? toFxRate(fxRate) : 0;
    } catch {
      return 0;
    }
  })();
  const unitCostAfn = afnFromAed(costAedMinor, fxRateScaled);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const resolvedBrand =
        brandPick === "Other" ? brandOther.trim() : brandPick.trim();
      if (!resolvedBrand) throw new Error("Choose a company / brand.");
      const resolvedAccessory =
        category !== "Accessories"
          ? ""
          : accessoryPick === "Other"
            ? accessoryOther.trim()
            : accessoryPick.trim();
      if (category === "Accessories" && !resolvedAccessory)
        throw new Error("Choose which accessory this is.");
      let cost_aed = 0,
        fx_rate = 0;
      if (forPurchase) {
        // Purchase bill records AED cost + rate; catalog starts at zero stock.
      } else {
        cost_aed = costAed.trim() ? toMoney(costAed) : 0;
        fx_rate = fxRate.trim() ? toFxRate(fxRate) : 0;
        if (!cost_aed || !fx_rate)
          throw new Error(
            "Enter the Dubai cost in AED and the AFN exchange rate at that time.",
          );
      }
      const attributes: Record<string, string> = {};
      for (const k of [
        "CPU",
        "RAM",
        "Storage",
        "GPU",
        "Display",
        "Color",
        "Connectivity",
        "Interface",
        "Compatibility",
        "Wattage",
      ]) {
        const v = String(f.get(k) || "");
        if (v) attributes[k] = v;
      }
      if (resolvedAccessory) attributes.Type = resolvedAccessory;
      const created = await api(product ? "productUpdate" : "productCreate", {
        id: product?.id,
        name: f.get("name"),
        brand: resolvedBrand,
        model: f.get("model"),
        sku: f.get("sku"),
        barcode: f.get("barcode"),
        category,
        price: toMoney(f.get("price")),
        minimum: product?.minimum ?? 0,
        reorder_level: Number(f.get("reorder_level")),
        location: product?.location || "",
        condition: f.get("condition"),
        warranty: f.get("warranty"),
        attributes,
        cost_aed,
        fx_rate,
        unit_cost: afnFromAed(cost_aed, fx_rate),
        ...(!product
          ? {
              opening_quantity: forPurchase
                ? 0
                : Number(f.get("opening_quantity") || 0),
            }
          : {}),
        image: productImage(category, resolvedAccessory),
      });
      done(
        product
          ? "Product details updated."
          : forPurchase
            ? "Product added to catalog. Set its AED cost on this purchase."
            : "Product and opening stock saved.",
        created,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const attrs =
    category === "Computers"
      ? ["CPU", "RAM", "Storage", "GPU", "Display", "Color"]
      : ["Mobiles", "Tablets"].includes(category)
        ? ["RAM", "Storage", "Color", "Connectivity"]
        : category === "Storage"
          ? ["Storage", "Interface"]
          : ["Compatibility", "Wattage", "Color"];
  const previewAccessory =
    accessoryPick === "Other" ? accessoryOther.trim() : accessoryPick;
  const previewImage = productImage(
    category,
    category === "Accessories" ? previewAccessory : "",
  );
  return (
    <Modal
      title={
        product
          ? "Edit product"
          : forPurchase
            ? "New product for this purchase"
            : "Add new product"
      }
      subtitle={
        forPurchase
          ? "Create the catalog item now. Stock and Dubai cost are recorded when you receive this purchase."
          : "Add product details, its cost and any stock already on your shelf."
      }
      onClose={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="form-section-title">
            <PackageIcon size={17} />
            Product information
          </div>
          <div className="product-form-preview">
            <img src={previewImage} alt="" />
            <div>
              <strong>Catalog image</strong>
              <small>
                {category === "Accessories"
                  ? previewAccessory
                    ? `${previewAccessory} accessory photo`
                    : "Pick an accessory type to choose its photo"
                  : `${category} catalog photo`}
              </small>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Product name">
              <input
                name="name"
                defaultValue={product?.name}
                placeholder="e.g. MacBook Air M3 13-inch"
                required
                minLength={2}
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {[
                  "Computers",
                  "Mobiles",
                  "Tablets",
                  "Storage",
                  "Accessories",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {category === "Accessories" && (
              <>
                <Field label="Accessory type">
                  <select
                    value={accessoryPick}
                    onChange={(e) => setAccessoryPick(e.target.value)}
                    required
                  >
                    {accessoryChoices(product?.attributes?.Type).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                {accessoryPick === "Other" && (
                  <Field label="Custom accessory type">
                    <input
                      value={accessoryOther}
                      onChange={(e) => setAccessoryOther(e.target.value)}
                      placeholder="e.g. Drawing tablet"
                      required
                    />
                  </Field>
                )}
              </>
            )}
            <Field label="Company / brand">
              <select
                value={brandPick}
                onChange={(e) => setBrandPick(e.target.value)}
                required
              >
                {brandChoices(product?.brand).map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            {brandPick === "Other" && (
              <Field label="Custom company / brand">
                <input
                  value={brandOther}
                  onChange={(e) => setBrandOther(e.target.value)}
                  placeholder="e.g. Baseus"
                  required
                />
              </Field>
            )}
            <Field label="Model">
              <input
                name="model"
                defaultValue={product?.model}
                placeholder="e.g. MacBook Air M3"
                required
              />
            </Field>
            <Field label="SKU">
              <input
                name="sku"
                defaultValue={product?.sku}
                placeholder="e.g. VLT-0011"
                required
              />
            </Field>
          </div>
          <div className="form-section-title">
            Barcode <small>Scan with a USB scanner or type it in</small>
          </div>
          <div className="barcode-field-row">
            <span className="barcode-field-icon" aria-hidden="true">
              <BarcodeIcon size={22} />
            </span>
            <Field
              label="Product barcode"
              hint="Used to find and add this product quickly when selling."
            >
              <input
                name="barcode"
                defaultValue={product?.barcode}
                placeholder="Scan or type barcode"
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="form-section-title">Pricing & stock rules</div>
          <div className="form-grid">
            {!forPurchase && (
              <>
                <Field
                  label="Unit cost (AED)"
                  hint="What you paid the Dubai supplier in dirhams."
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costAed}
                    onChange={(e) => setCostAed(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </Field>
                <Field
                  label="Exchange rate (AFN per 1 AED)"
                  hint="The Afghani rate on the day you bought this stock."
                >
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder="e.g. 18.50"
                    required
                  />
                </Field>
                <Field
                  label="Unit cost (AF)"
                  hint="Calculated from AED × rate for inventory and profit."
                >
                  <input
                    value={unitCostAfn ? moneyInput(unitCostAfn) : ""}
                    readOnly
                    tabIndex={-1}
                    placeholder="0.00"
                  />
                </Field>
              </>
            )}
            <Field label="Selling price (AF)">
              <input
                name="price"
                defaultValue={product ? product.price / 100 : undefined}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              />
            </Field>
            {!product && !forPurchase && (
              <Field
                label="Opening stock quantity"
                hint="Existing stock, not a new supplier purchase. Owner access is required for opening balances."
              >
                <input
                  name="opening_quantity"
                  type="number"
                  min="0"
                  max="100000"
                  defaultValue="0"
                  required
                />
              </Field>
            )}
            {forPurchase && (
              <Field
                label="Stock on this purchase"
                hint="Quantity and AED cost are entered on the purchase bill after you save."
              >
                <input value="Starts at 0 — added when you receive the purchase" readOnly tabIndex={-1} />
              </Field>
            )}
            <Field label="Reorder level">
              <input
                name="reorder_level"
                type="number"
                min="0"
                defaultValue={product?.reorder_level ?? 5}
                required
              />
            </Field>
            <Field label="Condition">
              <select
                name="condition"
                defaultValue={product?.condition || "New"}
              >
                <option>New</option>
                <option>Used</option>
                <option>Refurbished</option>
              </select>
            </Field>
            <Field label="Warranty">
              <input
                name="warranty"
                defaultValue={product?.warranty}
                placeholder="e.g. 12 months"
              />
            </Field>
          </div>
          <div className="form-section-title">Specifications</div>
          <div className="form-grid">
            {attrs.map((a) => (
              <Field key={a} label={a}>
                <input
                  name={a}
                  defaultValue={product?.attributes?.[a] || ""}
                  placeholder={
                    a === "RAM"
                      ? "e.g. 16 GB"
                      : a === "Storage"
                        ? "e.g. 512 GB"
                        : ""
                  }
                />
              </Field>
            ))}
          </div>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy
              ? "Saving…"
              : product
                ? "Save changes"
                : forPurchase
                  ? "Add to purchase"
                  : "Add product"}
            <PlusIcon size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
type CartLine = {
  product: Product;
  quantity: number;
  price: string;
  discount: string;
  /** Per-unit Dubai cost in AED (major units string). */
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
  const PAGE = 8;
  const [q, setQ] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [next, setNext] = useState<string | null>(null),
    [parties, setParties] = useState<Party[]>([]),
    [party, setParty] = useState(""),
    [lines, setLines] = useState<CartLine[]>([]),
    [paid, setPaid] = useState(""),
    [fxRate, setFxRate] = useState(""),
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
    [printAfter, setPrintAfter] = useState(true);
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
        if (!documentId && purchase)
          setParty(d.rows[0]?.id || "");
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
              throw new Error(
                `Product ${line.name} is no longer in the catalog.`,
              );
            return {
              product: { ...found, stock: found.stock + line.quantity },
              quantity: line.quantity,
              price: String(line.price / 100),
              discount: String(line.discount / 100),
              costAed: line.cost_aed
                ? moneyInput(line.cost_aed)
                : undefined,
            };
          }),
        );
        if (active) {
          setInitial(doc);
          setParty(doc.party_id);
          setCustomerMode("existing");
          setCustomerName(doc.party_name || "");
          setPaid(String(doc.paid / 100));
          if (doc.fx_rate) setFxRate(fxRateInput(doc.fx_rate));
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
    const costAedMajor = p.cost_aed ? moneyInput(p.cost_aed) : "";
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
      if (!p)
        throw new Error(`No product found for barcode “${code}”.`);
      if (!purchase && p.stock <= 0)
        throw new Error(`${p.name} is out of stock.`);
      if (lines.some((l) => l.product.id === p.id))
        throw new Error(`${p.name} is already on this bill.`);
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
  const total = lines.reduce(
    (s, l) =>
      s +
      Math.round(Number(l.price || 0) * 100) * l.quantity -
      Math.round(Number(l.discount || 0) * 100),
    0,
  );
  const payment =
    paid.trim() === "" ? 0 : Math.round(Number(paid) * 100 || 0);
  async function resolveSalePartyId() {
    if (purchase) {
      if (!party) throw new Error("Choose a supplier.");
      return party;
    }
    if (customerMode === "existing") {
      if (!party) throw new Error("Choose a customer.");
      return party;
    }
    const name = customerName.trim();
    if (name.length < 2)
      throw new Error("Enter the customer name (at least 2 characters).");
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
      const rate = purchase && fxRate.trim() ? toFxRate(fxRate) : 0;
      if (purchase && lines.some((l) => (l.costAed || "").trim()) && !rate)
        throw new Error(
          "Enter the AED→AFN exchange rate used for this Dubai purchase.",
        );
      const partyId = await resolveSalePartyId();
      const payload = lines.map((l) => {
        const cost_aed =
          purchase && (l.costAed || "").trim() ? toMoney(l.costAed!) : 0;
        const price = toMoney(l.price);
        if (purchase && cost_aed) {
          const expected = afnFromAed(cost_aed, rate);
          if (Math.abs(price - expected) > 1)
            throw new Error(
              `${l.product.name}: AFN cost must equal AED × exchange rate.`,
            );
        }
        return {
          product_id: l.product.id,
          quantity: l.quantity,
          price,
          discount: toMoney(l.discount),
          ...(purchase
            ? { cost_aed, fx_rate: cost_aed ? rate : 0 }
            : {}),
        };
      });
      const posted = await api<any>(
        documentId ? (purchase ? "purchaseEdit" : "saleEdit") : kind,
        {
          ...(documentId ? { id: documentId, revision: initial.revision } : {}),
          party_id: partyId,
          lines: payload,
          paid: paid.trim() === "" ? 0 : toMoney(paid),
          date: f.get("date"),
          due_date: null,
          note: "",
          ...(purchase ? { fx_rate: rate } : {}),
          request_key: key.current,
        },
      );
      done(
        purchase
          ? documentId
            ? "Purchase updated. Stock and supplier ledger recalculated."
            : "Purchase received. Stock and supplier ledger updated."
          : documentId
            ? "Invoice updated. Stock, payment and profit recalculated."
            : "Sale posted. Invoice, stock and ledger saved.",
        {
          id: posted?.id,
          kind: posted?.kind || kind,
          print: printAfter && inline,
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
            ? `Edit ${initial.number}`
            : "Receive a purchase"
          : initial
            ? `Edit ${initial.number}`
            : "New bill"
      }
      subtitle={
        purchase
          ? "Receive stock, record its cost, and update your supplier balance."
          : "Create an invoice and record payment in one step."
      }
      onClose={close}
      wide
    >
      {loading ? (
        <div className="form-body">Loading invoice…</div>
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
                        <span>Supplier</span>
                        <div className="inline-actions party-picker">
                          <select
                            value={party}
                            onChange={(e) => setParty(e.target.value)}
                            required
                          >
                            <option value="">Choose supplier</option>
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
                            Add
                          </button>
                        </div>
                      </label>
                      <label className="sale-customer-date">
                        <span>Date</span>
                        <input
                          type="date"
                          name="date"
                          defaultValue={initial?.date || businessDate()}
                          max={businessDate()}
                          required
                        />
                      </label>
                      <label className="sale-customer-name purchase-rate-field">
                        <span>AED rate (AFN per 1 AED)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(e) => applyFxRate(e.target.value)}
                          placeholder="e.g. 18.50"
                          required
                        />
                        <small>
                          {fxRate.trim()
                            ? `1 AED = ${fxRate} AFN`
                            : "Set rate before entering AED costs"}
                        </small>
                      </label>
                    </div>
                  ) : (
                    <>
                      <div className="sale-customer-row">
                        <div
                          className="sale-customer-modes"
                          role="tablist"
                          aria-label="Customer entry"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={customerMode === "new"}
                            className={customerMode === "new" ? "active" : ""}
                            onClick={() => setCustomerMode("new")}
                          >
                            Type name
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
                            Existing
                          </button>
                        </div>
                        {customerMode === "new" ? (
                          <label className="sale-customer-name">
                            <span>Customer</span>
                            <input
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              placeholder="Type customer name…"
                              minLength={2}
                              required
                              autoComplete="off"
                            />
                          </label>
                        ) : (
                          <label className="sale-customer-name">
                            <span>Customer</span>
                            <div className="inline-actions party-picker">
                              <select
                                value={party}
                                onChange={(e) => setParty(e.target.value)}
                                required
                              >
                                <option value="">Choose customer</option>
                                {parties.map((p) => (
                                  <option value={p.id} key={p.id}>
                                    {p.name}
                                    {p.walk_in ? " (cash only)" : ""}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="button"
                                onClick={() => setAddingParty(true)}
                              >
                                <PlusIcon size={15} />
                                Add
                              </button>
                            </div>
                          </label>
                        )}
                        <label className="sale-customer-date">
                          <span>Date</span>
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
                          Saves to Customers · unpaid balance stays on ledger
                        </small>
                      )}
                      {customerMode === "existing" &&
                        selectedParty?.walk_in &&
                        total - payment > 0 && (
                          <p className="credit-hint">
                            Walk-in must pay in full. Use Type name to leave a
                            balance unpaid.
                          </p>
                        )}
                    </>
                  )}
                </div>
                <div className="sale-catalog-panel">
                  <div className="trade-panel-head">
                    <div>
                      <h3>Product catalog</h3>
                    </div>
                    <div className="trade-catalog-actions">
                      {purchase && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => setAddingProduct(true)}
                        >
                          <PlusIcon size={15} />
                          New product
                        </button>
                      )}
                      <span className="subtle">
                        {products.length}
                        {next ? "+" : ""} shown
                      </span>
                    </div>
                  </div>
                  <div className="trade-barcode-scan">
                    <BarcodeIcon size={18} />
                    <input
                      ref={barcodeRef}
                      aria-label="Scan product barcode"
                      placeholder="Scan barcode to add…"
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
                      {scanBusy ? "Looking…" : "Add"}
                    </button>
                  </div>
                  <Search
                    value={q}
                    onChange={setQ}
                    placeholder="Search by name, SKU or barcode…"
                  />
                  <div
                    className="product-browser-list sale-product-list"
                    role="listbox"
                    aria-label="Available products"
                  >
                    {searching ? (
                      <div className="product-browser-empty">
                        <span className="muted">Loading products…</span>
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
                                {p.image ? (
                                  <img src={p.image} alt="" />
                                ) : (
                                  <PackageIcon size={24} weight="light" />
                                )}
                              </span>
                              <span className="product-pick-body">
                                <strong>{p.name}</strong>
                                {detail ? <small>{detail}</small> : null}
                                <span className="product-pick-meta">
                                  <em>
                                    {purchase
                                      ? p.category || "Catalog"
                                      : af(p.price)}
                                  </em>
                                  <em>
                                    {purchase
                                      ? "In catalog"
                                      : out
                                        ? "Out of stock"
                                        : `${p.stock} in stock`}
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
                            {loadingMore ? "Loading…" : "Load more products"}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="product-browser-empty">
                        <PackageIcon size={28} weight="light" />
                        <p>
                          {q.trim()
                            ? "No matching products. Try another search."
                            : purchase
                              ? "No products yet. Use New product to add one."
                              : "No products yet. Add products in Inventory first."}
                        </p>
                        {purchase && (
                          <button
                            type="button"
                            className="button button-dark"
                            onClick={() => setAddingProduct(true)}
                          >
                            <PlusIcon size={15} />
                            New product
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
                      <h3>Bill lines</h3>
                      <p>
                        {lines.length
                          ? `${lines.length} product${lines.length === 1 ? "" : "s"}`
                          : "Add products from the catalog"}
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
                            aria-label={`Remove ${l.product.name}`}
                            onClick={() =>
                              setLines((ls) => ls.filter((_, j) => j !== i))
                            }
                          >
                            <TrashIcon size={17} />
                          </button>
                        </div>
                        <div className="form-grid three">
                          <Field label="Quantity">
                            <input
                              aria-label={`${l.product.name} quantity`}
                              type="number"
                              min="1"
                              max={purchase ? 100000 : l.product.stock}
                              value={l.quantity}
                              onChange={(e) =>
                                update(i, "quantity", Number(e.target.value))
                              }
                              required
                            />
                          </Field>
                          {purchase ? (
                            <>
                              <Field label="Cost (AED)">
                                <input
                                  type="number"
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
                              <Field label="Cost (AF)">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.price}
                                  readOnly
                                  tabIndex={-1}
                                  placeholder={
                                    fxRate.trim()
                                      ? "Auto from rate"
                                      : "Set AED rate"
                                  }
                                  required
                                />
                              </Field>
                            </>
                          ) : (
                            <>
                              <Field label="Unit price (AF)">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.price}
                                  onChange={(e) =>
                                    update(i, "price", e.target.value)
                                  }
                                  required
                                />
                              </Field>
                              <Field label="Discount (AF)">
                                <input
                                  type="number"
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
                        {purchase && (
                          <div className="form-grid" style={{ marginTop: 4 }}>
                            <Field label="Line discount (AF)">
                              <input
                                type="number"
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
                        )}
                      </div>
                    ))}
                  </div>
                  {!lines.length && (
                    <div className="cart-empty">
                      <ShoppingIllustration />
                      <p>
                        Add products from the left to build this{" "}
                        {purchase ? "purchase" : "sale"}.
                      </p>
                    </div>
                  )}
                </div>
                <div className="sale-pay-panel">
                  <div className="trade-totals">
                    <div>
                      <span>Invoice total</span>
                      <strong>{af(total, 2)}</strong>
                    </div>
                    <div>
                      <span>Balance remaining</span>
                      <strong>{af(Math.max(0, total - payment), 2)}</strong>
                    </div>
                    <Field
                      label="Amount paid now (AF)"
                      hint="Blank or 0 = unpaid / on account."
                    >
                      <input
                        name="paid"
                        type="number"
                        min="0"
                        max={total / 100}
                        step="0.01"
                        value={paid}
                        placeholder="0.00"
                        onChange={(e) => setPaid(e.target.value)}
                      />
                    </Field>
                  </div>
                  <ErrorMessage error={error} />
                  <div className="sale-actions">
                    <label className="sale-print-check">
                      <input
                        type="checkbox"
                        checked={printAfter}
                        onChange={(e) => setPrintAfter(e.target.checked)}
                      />
                      <PrinterIcon size={15} />
                      Print bill after save
                    </label>
                    <button
                      type="button"
                      className="button"
                      onClick={close}
                    >
                      Cancel
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
                        ? "Posting…"
                        : purchase
                          ? documentId
                            ? "Save purchase"
                            : "Receive purchase"
                          : documentId
                            ? "Save invoice"
                            : "Create sale"}
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
                      <Field
                        label="AED rate in Afghanis"
                        hint="How many AFN for 1 AED today. Every product line uses this rate."
                      >
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(e) => applyFxRate(e.target.value)}
                          placeholder="e.g. 18.50"
                          required
                        />
                      </Field>
                      <p className="purchase-rate-note">
                        {fxRate.trim()
                          ? `1 AED = ${fxRate} AFN · line AF costs update automatically`
                          : "Set the rate first, then enter each product’s AED cost."}
                      </p>
                    </div>
                  )}
                  <div className="form-grid three">
                    <Field label="Supplier">
                      <div className="inline-actions party-picker">
                        <select
                          value={party}
                          onChange={(e) => setParty(e.target.value)}
                          required
                        >
                          <option value="">Choose supplier</option>
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
                          Add
                        </button>
                      </div>
                    </Field>
                    <Field label="Invoice date">
                      <input
                        type="date"
                        name="date"
                        defaultValue={initial?.date || businessDate()}
                        max={businessDate()}
                        required
                      />
                    </Field>
                    <Field label="Payment due (optional)">
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
                        <h3>Product catalog</h3>
                        <p>
                          Search existing items, or add a new product for this
                          purchase.
                        </p>
                      </div>
                      <div className="trade-catalog-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => setAddingProduct(true)}
                        >
                          <PlusIcon size={15} />
                          New product
                        </button>
                        <span className="subtle">
                          {products.length}
                          {next ? "+" : ""} shown
                        </span>
                      </div>
                    </div>
                    <div className="trade-barcode-scan">
                      <BarcodeIcon size={18} />
                      <input
                        ref={barcodeRef}
                        aria-label="Scan product barcode"
                        placeholder="Scan barcode to add…"
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
                        {scanBusy ? "Looking…" : "Add"}
                      </button>
                    </div>
                    <Search
                      value={q}
                      onChange={setQ}
                      placeholder="Search by name, SKU or barcode…"
                    />
                    <div
                      className="product-browser-list"
                      role="listbox"
                      aria-label="Available products"
                    >
                      {searching ? (
                        <div className="product-browser-empty">
                          <span className="muted">Loading products…</span>
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
                                  {p.image ? (
                                    <img src={p.image} alt="" />
                                  ) : (
                                    <PackageIcon size={28} weight="light" />
                                  )}
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
                                    <em>In catalog</em>
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
                                ? "Loading…"
                                : "Load more products"}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="product-browser-empty">
                          <PackageIcon size={28} weight="light" />
                          <p>
                            {q.trim()
                              ? "No matching products. Try another search."
                              : "No products yet. Use New product to add the first item for this purchase."}
                          </p>
                          <button
                            type="button"
                            className="button button-dark"
                            onClick={() => setAddingProduct(true)}
                          >
                            <PlusIcon size={15} />
                            New product
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="trade-cart">
                    <div className="trade-panel-head">
                      <div>
                        <h3>Bill lines</h3>
                        <p>
                          {lines.length
                            ? `${lines.length} product${lines.length === 1 ? "" : "s"} on this invoice`
                            : "Added products appear here."}
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
                              aria-label={`Remove ${l.product.name}`}
                              onClick={() =>
                                setLines((ls) =>
                                  ls.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon size={17} />
                            </button>
                          </div>
                          <div className="form-grid three">
                            <Field label="Quantity">
                              <input
                                aria-label={`${l.product.name} quantity`}
                                type="number"
                                min="1"
                                max={100000}
                                value={l.quantity}
                                onChange={(e) =>
                                  update(
                                    i,
                                    "quantity",
                                    Number(e.target.value),
                                  )
                                }
                                required
                              />
                            </Field>
                            <Field label="Cost (AED)">
                              <input
                                type="number"
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
                            <Field label="Cost (AF)">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={l.price}
                                readOnly
                                tabIndex={-1}
                                placeholder={
                                  fxRate.trim()
                                    ? "Auto from rate"
                                    : "Set AED rate above"
                                }
                                required
                              />
                            </Field>
                          </div>
                          <div className="form-grid" style={{ marginTop: 4 }}>
                            <Field label="Line discount (AF)">
                              <input
                                type="number"
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
                        <p>
                          Browse the catalog on the left and add products to
                          start your purchase.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
                <div className="trade-footer">
                  <div className="trade-totals">
                    <div>
                      <span>Invoice total</span>
                      <strong>{af(total, 2)}</strong>
                    </div>
                    <div>
                      <span>Supplier balance remaining</span>
                      <strong>{af(Math.max(0, total - payment), 2)}</strong>
                    </div>
                    <Field
                      label="Amount paid now (AF)"
                      hint="Leave blank for full payment. Enter 0 for credit."
                    >
                      <input
                        name="paid"
                        type="number"
                        min="0"
                        max={total / 100}
                        step="0.01"
                        value={paid}
                        placeholder={(total / 100).toFixed(2)}
                        onChange={(e) => setPaid(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Note (optional)">
                    <textarea
                      name="note"
                      defaultValue={initial?.note || ""}
                      rows={2}
                      placeholder="Additional details for this invoice"
                    />
                  </Field>
                  <ErrorMessage error={error} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="button" onClick={close}>
                  Cancel
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
                    ? "Posting…"
                    : documentId
                      ? "Save purchase changes"
                      : "Receive purchase"}
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
          setAddingProduct(false);
          const created = result as { id?: string } | undefined;
          if (!created?.id) return;
          try {
            const d = await api<{ rows: Product[] }>("catalog", {
              id: created.id,
              limit: 1,
            });
            const p = d.rows[0];
            if (!p) throw new Error("New product could not be loaded.");
            setProducts((rows) =>
              rows.some((r) => r.id === p.id) ? rows : [p, ...rows],
            );
            setQ("");
            add(p);
          } catch (e: any) {
            setError(e.message);
          }
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
      done(`${kind === "customer" ? "Customer" : "Supplier"} added.`, created);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Add ${kind}`}
      subtitle="Keep contact details and the full ledger in one place."
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label="Name / business name">
            <input name="name" required minLength={2} />
          </Field>
          <div className="form-grid">
            <Field label="Phone">
              <input name="phone" type="tel" />
            </Field>
            <Field label="Email (optional)">
              <input name="email" type="email" />
            </Field>
          </div>
          <Field label="Address">
            <textarea name="address" rows={2} />
          </Field>
          <div className="form-grid">
            <Field
              label={
                kind === "customer"
                  ? "Opening balance they owe you (AF)"
                  : "Opening balance you owe them (AF)"
              }
              hint={
                kind === "customer"
                  ? "How much this customer already owes you. Leave 0 if none."
                  : "How much you already owe this supplier. Leave 0 if none."
              }
            >
              <input
                name="opening_balance"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </Field>
            <Field
              label="Opening date"
              hint="Used only when an opening balance is entered."
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
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Saving…" : `Add ${kind}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ExpenseForm({ close, done }: DialogProps) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("expense", {
        amount: toMoney(f.get("amount")),
        category: f.get("category"),
        date: f.get("date"),
        note: f.get("note"),
        request_key: key.current,
      });
      done("Expense recorded in your daily book.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Record an expense"
      subtitle="Expenses are included in net profit and your cashbook."
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="form-grid">
            <Field label="Amount (AF)">
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                autoFocus
              />
            </Field>
            <Field label="Date">
              <input
                name="date"
                type="date"
                defaultValue={businessDate()}
                max={businessDate()}
                required
              />
            </Field>
          </div>
          <Field label="Category">
            <select name="category">
              {[
                "Rent",
                "Salaries",
                "Utilities",
                "Transport",
                "Repairs",
                "Other",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              name="note"
              placeholder="What was this expense for?"
              minLength={2}
              required
              rows={3}
            />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Saving…" : "Record expense"}
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
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("payment", {
        party_id: party.id,
        amount: toMoney(f.get("amount")),
        date: f.get("date"),
        note: f.get("note"),
        request_key: key.current,
      });
      done(
        party.kind === "customer"
          ? "Customer payment received."
          : "Supplier payment recorded.",
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
        party.kind === "customer" ? "Receive customer payment" : "Pay supplier"
      }
      subtitle={`${party.name} · Outstanding ${af(party.balance, 2)}`}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label="Amount (AF)">
            <input
              name="amount"
              type="number"
              min="0.01"
              max={party.balance / 100}
              step="0.01"
              defaultValue={party.balance / 100}
              required
            />
          </Field>
          <Field label="Payment date">
            <input
              name="date"
              type="date"
              defaultValue={businessDate()}
              max={businessDate()}
              required
            />
          </Field>
          <Field label="Note">
            <input name="note" placeholder="Payment reference or description" />
          </Field>
          <p className="help-note">
            Applied to the oldest outstanding invoices first.
          </p>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Recording…" : "Record payment"}
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
  const [doc, setDoc] = useState<any>(null),
    [store, setStore] = useState<any>(null),
    [error, setError] = useState(""),
    [returning, setReturning] = useState(false),
    [busy, setBusy] = useState(false),
    [quantities, setQuantities] = useState<Record<string, number>>({});
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
    if (!autoPrint || !doc || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, doc]);
  async function postReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("return", {
        original_id: doc.id,
        lines: doc.lines
          .filter((l: any) => quantities[l.id] > 0)
          .map((l: any) => ({
            line_id: l.id,
            quantity: quantities[l.id],
          })),
        note: new FormData(e.currentTarget).get("reason"),
        request_key: key.current,
      });
      done("Return posted. Stock, payment and profit adjusted.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={doc?.number || "Invoice"}
      subtitle={
        doc
          ? `${doc.kind.replaceAll("_", " ")} · ${doc.date}`
          : "Loading document…"
      }
      onClose={close}
      wide
    >
      {doc && (
        <>
          <div className="form-body invoice-print" id="invoice-print">
            <div className="invoice-top">
              <div>
                {store?.logo ? (
                  <img
                    className="invoice-logo"
                    src={store.logo}
                    alt=""
                  />
                ) : null}
                <h2>{store?.name}</h2>
                {store?.address ? <p>{store.address}</p> : null}
                <p>
                  {[store?.phone, store?.email].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div>
                <Badge tone="gray">
                  {doc.kind.toUpperCase().replaceAll("_", " ")}
                </Badge>
                <h3>{doc.number}</h3>
                <p>{doc.date}</p>
              </div>
            </div>
            <div className="invoice-meta">
              <div>
                <span>{doc.kind === "purchase" ? "Supplier" : "Customer"}</span>
                <strong>{doc.party_name || "—"}</strong>
              </div>
              <div>
                <span>Recorded by</span>
                <strong>{doc.user_name}</strong>
              </div>
              <div>
                <span>Due date</span>
                <strong>{doc.due_date || "—"}</strong>
              </div>
              {doc.kind === "purchase" && !!doc.fx_rate && (
                <div>
                  <span>Exchange rate</span>
                  <strong>{fxRateLabel(doc.fx_rate)}</strong>
                </div>
              )}
            </div>
            {doc.lines.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    {doc.kind === "purchase" && <th>Unit cost (AED)</th>}
                    <th>
                      {doc.kind === "purchase" ? "Unit cost (AF)" : "Unit price"}
                    </th>
                    <th>Discount</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l: any) => (
                    <tr key={l.id}>
                      <td>
                        <ProductName product={l} />
                      </td>
                      <td>
                        {l.quantity}
                        {l.returned_quantity > 0 && (
                          <small className="block muted">
                            {l.returned_quantity} returned
                          </small>
                        )}
                      </td>
                      {doc.kind === "purchase" && (
                        <td>{l.cost_aed ? aed(l.cost_aed) : "—"}</td>
                      )}
                      <td>{af(l.price, 2)}</td>
                      <td>{af(l.discount, 2)}</td>
                      <td>{af(l.quantity * l.price - l.discount, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="invoice-summary">
              <div>
                <span>Total</span>
                <strong>{af(doc.total, 2)}</strong>
              </div>
              <div>
                <span>Returned</span>
                <strong>{af(doc.returned || 0, 2)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong>{af(doc.paid, 2)}</strong>
              </div>
              <div className="invoice-due">
                <span>Outstanding</span>
                <strong>
                  {af(
                    Math.max(0, doc.total - (doc.returned || 0) - doc.paid),
                    2,
                  )}
                </strong>
              </div>
            </div>
            {doc.note && <p className="invoice-note">{doc.note}</p>}
            {store?.bill_footer ? (
              <p className="invoice-note">{store.bill_footer}</p>
            ) : null}
            <p className="subtle">
              All amounts in Afghan afghani (AFN). Tax disabled.
            </p>
          </div>
          {returning && (
            <form className="return-form" onSubmit={postReturn}>
              <div className="form-section-title">
                <ArrowCounterClockwiseIcon size={17} />
                Return items
              </div>
              {doc.lines
                .filter((l: any) => l.quantity > l.returned_quantity)
                .map((l: any) => (
                  <Field
                    key={l.id}
                    label={`${l.name} · ${l.quantity - l.returned_quantity} remaining`}
                  >
                    <input
                      type="number"
                      min="0"
                      max={l.quantity - l.returned_quantity}
                      value={quantities[l.id] || 0}
                      onChange={(e) =>
                        setQuantities({
                          ...quantities,
                          [l.id]: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              <Field label="Reason for return">
                <input name="reason" minLength={2} required />
              </Field>
              <p className="help-note">
                The return reduces outstanding debt first. Any remaining amount
                is refunded in cash.
              </p>
              <ErrorMessage error={error} />
              <button
                className="button button-dark"
                disabled={busy || !Object.values(quantities).some((n) => n > 0)}
              >
                {busy ? "Posting…" : "Post return"}
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
                Edit invoice
              </button>
              <button className="button danger-text" onClick={remove}>
                Hard delete
              </button>
            </>
          )}
        {doc &&
          ["sale", "purchase"].includes(doc.kind) &&
          ["Owner", "Manager", "Accountant"].includes(user.role) && (
            <button className="button" onClick={() => setReturning(!returning)}>
              <ArrowCounterClockwiseIcon size={15} />
              {returning ? "Cancel return" : "Return items"}
            </button>
          )}
        <button className="button" onClick={close}>
          Close
        </button>
        {doc && (
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await downloadInvoice(doc);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <DownloadSimpleIcon size={16} />
            {window.vault ? "Download PDF" : "Download invoice"}
          </button>
        )}
        {doc && (
          <button className="button button-dark" onClick={() => window.print()}>
            <PrinterIcon size={16} />
            Print / save PDF
          </button>
        )}
      </div>
    </Modal>
  );
}
export function DeleteInvoiceDialog({
  documentId,
  close,
  done,
}: { documentId: string } & DialogProps) {
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
      title="Hard delete invoice"
      subtitle={doc?.number || "Loading invoice…"}
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
                ? "Purchase permanently deleted. Stock and supplier ledger updated."
                : "Invoice permanently deleted. Stock, cash and customer ledger updated.",
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
              ? "This permanently removes the purchase and its accounting entries. Received stock that is still unsold is removed from inventory."
              : "This permanently removes the invoice and its accounting entries. Sold items return to their original stock batches."}{" "}
            An administrative audit reference remains.
          </p>
          <p>
            Invoices with linked returns or later{" "}
            {purchase ? "supplier payments" : "payment receipts"} cannot be
            deleted.
            {purchase
              ? " Purchases cannot be deleted after any of their stock has been sold."
              : ""}
          </p>
          <Field
            label={`Type ${doc?.number || "the invoice number"} to confirm`}
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
            Cancel
          </button>
          <button
            className="button button-danger"
            disabled={busy || !doc || confirmation !== doc.number}
          >
            {busy ? "Deleting…" : "Permanently delete invoice"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ProductDetail({
  product,
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
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [adjust, setAdjust] = useState(false),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  useEffect(() => {
    api("productDetail", { id: product.id })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [product.id]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("adjust", {
        product_id: product.id,
        quantity: Number(f.get("quantity")),
        cost: toMoney(f.get("cost") || "0"),
        note: f.get("note"),
        request_key: key.current,
        opening: f.get("opening") === "on",
      });
      done("Stock adjustment posted with an audit record.");
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
    >
      <div className="form-body">
        <div className="product-detail-top">
          <img src={product.image} alt={product.name} />
          <div>
            <Badge
              tone={product.stock <= product.reorder_level ? "yellow" : "green"}
            >
              {product.stock} in stock
            </Badge>
            <h2>{af(product.price)}</h2>
            <p>
              {product.condition} · {product.warranty || "No warranty set"}
            </p>
            <p>Reorder at {product.reorder_level}</p>
            {(product.cost_aed || product.fx_rate) && (
              <p>
                Dubai cost {aed(product.cost_aed || 0)} ·{" "}
                {fxRateLabel(product.fx_rate || 0)} · stock cost{" "}
                {af(product.unit_cost || 0, 2)}
              </p>
            )}
          </div>
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
        <div className="form-section-title">
          Stock movement history <small>Latest 100 entries</small>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Type</th>
                <th>Quantity</th>
                {user.permissions.includes("view_costs") && (
                  <th>Cost movement</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data?.movements.map((m: any) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>{m.number}</td>
                  <td>{m.kind.replaceAll("_", " ")}</td>
                  <td className={m.quantity > 0 ? "text-green" : "text-red"}>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity}
                  </td>
                  {user.permissions.includes("view_costs") && (
                    <td>{af(m.cost)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {adjust && (
          <form onSubmit={submit} className="adjust-form">
            <div className="form-section-title">Adjust stock</div>
            <div className="form-grid">
              <Field
                label="Quantity change"
                hint="Positive to add, negative to remove."
              >
                <input
                  name="quantity"
                  type="number"
                  required
                  defaultValue="1"
                />
              </Field>
              <Field label="Unit cost for added stock (AF)">
                <input
                  name="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </Field>
            </div>
            <Field label="Reason">
              <input
                name="note"
                minLength={3}
                required
                placeholder="Stock count correction, damage, or another reason"
              />
            </Field>
            {user.role === "Owner" && product.stock === 0 && (
              <label className="checkbox-field">
                <input name="opening" type="checkbox" />
                <span>
                  <strong>Opening stock brought forward</strong>
                  <small>
                    Posts against owner equity. Available before this product
                    has any stock movements.
                  </small>
                </span>
              </label>
            )}
            <p className="help-note">
              Adjustments affect inventory value and other income or expenses.
              Use a purchase for received supplier stock.
            </p>
            <ErrorMessage error={error} />
            <button className="button button-dark" disabled={busy}>
              {busy ? "Saving…" : "Post adjustment"}
            </button>
          </form>
        )}
        <ErrorMessage error={!adjust ? error : ""} />
      </div>
      <div className="modal-actions">
        {sell && user.permissions.includes("sales") && (
          <button className="button button-dark" onClick={sell}>
            Sell this product <ArrowRightIcon size={15} />
          </button>
        )}
        {user.permissions.includes("inventory") && (
          <button className="button" onClick={edit}>
            Edit product
          </button>
        )}
        {user.permissions.includes("inventory") && (
          <button className="button" onClick={() => setAdjust(!adjust)}>
            {adjust ? "Cancel adjustment" : "Adjust stock"}
          </button>
        )}
        <button className="button" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
function partyLedgerLabel(e: {
  category?: string;
  kind?: string;
  note?: string;
}) {
  if (e.category === "Opening balance" || /opening balance/i.test(e.note || ""))
    return "Opening balance";
  const labels: Record<string, string> = {
    sale: "Sale",
    purchase: "Purchase",
    receipt: "Payment received",
    payment: "Payment made",
    sale_return: "Sale return",
    purchase_return: "Purchase return",
  };
  return labels[e.kind || ""] || e.kind || "Entry";
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
  const [ledgerAfter, setLedgerAfter] = useState("");
  const [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState("");
  const kind = party.kind;
  useEffect(() => {
    let active = true;
    setError("");
    api("partyDetail", { id: party.id, after: ledgerAfter, limit: 25 })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [party.id, ledgerAfter, refresh]);
  const signed = (e: any) =>
    kind === "customer" ? e.debit - e.credit : e.credit - e.debit;
  let running = detail?.page_start_balance ?? detail?.party?.balance ?? 0;
  const ledgerRows = (detail?.entries || []).map((e: any) => {
    const row = { ...e, running, label: partyLedgerLabel(e) };
    running -= signed(e);
    return row;
  });
  const current = detail?.party || party;
  return (
    <Modal
      title={current.name}
      subtitle={
        kind === "customer"
          ? "Customer ledger, history and payments"
          : "Supplier ledger, history and payments"
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
          <p>{current.phone || "No phone number"}</p>
          <p>{current.address || current.email || "No address saved"}</p>
          {user.role === "Owner" && !current.walk_in && (
            <button
              className="text-button"
              onClick={() => open("openingBalance", current)}
            >
              Enter opening balance
            </button>
          )}
          <div className="contact-balance">
            <span>Outstanding balance</span>
            <strong
              className={
                (current.balance || 0) > 0 ? "text-red" : "text-green"
              }
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
                {kind === "customer" ? "Receive payment" : "Pay supplier"}
                <ArrowRightIcon size={15} />
              </button>
            )}
        </div>
        <div className="contact-ledger">
          <h3>Account ledger</h3>
          <p className="subtle ledger-hint">
            Newest activity first. Opening balances and payments appear here
            with the running outstanding.
          </p>
          {!detail ? (
            <p className="muted">Loading ledger…</p>
          ) : (
            <>
              <div className="table-wrap">
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
                          <small className="block muted">
                            {e.label}
                            {e.number ? ` · ${e.number}` : ""}
                          </small>
                        </td>
                        <td
                          className={`money ${e.debit ? (kind === "customer" ? "text-red" : "text-green") : "muted"}`}
                        >
                          {e.debit ? af(e.debit) : "—"}
                        </td>
                        <td
                          className={`money ${e.credit ? (kind === "customer" ? "text-green" : "text-red") : "muted"}`}
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
                <p className="muted">No ledger activity for this account yet.</p>
              )}
              <div className="pagination ledger-pagination">
                <span>25 entries per page</span>
                <button
                  className="button"
                  disabled={!ledgerHistory.length}
                  onClick={() => {
                    setLedgerAfter(ledgerHistory.at(-1) || "");
                    setLedgerHistory((h) => h.slice(0, -1));
                  }}
                >
                  Newer
                </button>
                <button
                  className="button"
                  disabled={!detail.next}
                  onClick={() => {
                    setLedgerHistory((h) => [...h, ledgerAfter]);
                    setLedgerAfter(detail.next || "");
                  }}
                >
                  Older
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="button button-dark" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
export function UserForm({ close, done, user }: DialogProps & { user?: User }) {
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
      done(
        user
          ? "Access rights updated immediately."
          : "User created with the selected access rights.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={user ? "Edit access rights" : "Create user"}
      subtitle="Give each team member their own account and access rights."
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label="Full name">
            <input
              name="name"
              defaultValue={user?.name}
              disabled={!!user}
              minLength={2}
              required
            />
          </Field>
          <div className="form-grid">
            <Field label="Username">
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
              <Field label="Password">
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
          <Field label="Role">
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
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Saving…" : user ? "Save access rights" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function OwnerMovement({ close, done }: DialogProps) {
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
      done("Owner cash movement recorded.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Record investment"
      subtitle="Capital deposits and withdrawals affect cash and equity, not profit."
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label="Movement">
            <select name="direction">
              <option value="deposit">Invest cash in the business</option>
              <option value="withdrawal">Withdraw capital</option>
            </select>
          </Field>
          <Field label="Amount (AF)">
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </Field>
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              defaultValue={businessDate()}
              max={businessDate()}
            />
          </Field>
          <Field label="Reason">
            <input
              name="note"
              minLength={2}
              required
              placeholder="External investment, personal cash, bank transfer…"
            />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Saving…" : "Record movement"}
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
      done("Opening balance recorded against owner equity.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Opening balance"
      subtitle={`${party.name} · Debt brought forward from your previous records`}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field
            label={
              party.kind === "customer"
                ? "Amount this customer owes you (AF)"
                : "Amount you owe this supplier (AF)"
            }
          >
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </Field>
          <Field label="Opening date">
            <input
              name="date"
              type="date"
              max={businessDate()}
              defaultValue={businessDate()}
              required
            />
          </Field>
          <p className="help-note">
            This records{" "}
            {party.kind === "customer"
              ? "customer receivables"
              : "supplier payables"}{" "}
            against owner equity. It does not create sales revenue or an
            expense.
          </p>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            Cancel
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? "Saving…" : "Record opening balance"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
