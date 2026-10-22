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
  productSpecEntries,
} from "../api";
import { useT } from "../i18n";
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
const PRODUCT_CATEGORIES = [
  "Computers",
  "Mobiles",
  "Tablets",
  "Storage",
  "Accessories",
] as const;
function categoryLabel(
  tr: (key: string) => string,
  category: string,
) {
  const keys: Record<string, string> = {
    Computers: "inventory.computers",
    Mobiles: "inventory.mobiles",
    Tablets: "inventory.tablets",
    Storage: "inventory.storage",
    Accessories: "inventory.accessories",
  };
  return tr(keys[category] || category);
}
function specFieldLabel(tr: (key: string) => string, key: string) {
  const map: Record<string, string> = {
    CPU: "product.cpu",
    RAM: "product.ram",
    Storage: "product.storage",
    GPU: "product.gpu",
    Display: "product.display",
    Color: "product.color",
    Connectivity: "product.connectivity",
    Interface: "product.interface",
    Compatibility: "productForm.compatibility",
    Wattage: "productForm.wattage",
  };
  return tr(map[key] || key);
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
  const t = useT();
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
      if (!resolvedBrand) throw new Error(t("productForm.errBrand"));
      const resolvedAccessory =
        category !== "Accessories"
          ? ""
          : accessoryPick === "Other"
            ? accessoryOther.trim()
            : accessoryPick.trim();
      if (category === "Accessories" && !resolvedAccessory)
        throw new Error(t("productForm.errAccessory"));
      let cost_aed = 0,
        fx_rate = 0;
      if (forPurchase) {
        // Purchase bill records AED cost + rate; catalog starts at zero stock.
      } else {
        cost_aed = costAed.trim() ? toMoney(costAed) : 0;
        fx_rate = fxRate.trim() ? toFxRate(fxRate) : 0;
        if (!cost_aed || !fx_rate)
          throw new Error(t("productForm.errCostRate"));
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
          ? t("productForm.detailsUpdated")
          : forPurchase
            ? t("productForm.addedForPurchase")
            : t("productForm.savedWithStock"),
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
          ? t("productForm.editTitle")
          : forPurchase
            ? t("productForm.newForPurchase")
            : t("productForm.newTitle")
      }
      subtitle={
        forPurchase
          ? t("productForm.subtitlePurchase")
          : t("productForm.subtitleCatalog")
      }
      onClose={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="form-section-title">
            <PackageIcon size={17} />
            {t("productForm.info")}
          </div>
          <div className="product-form-preview">
            <img src={previewImage} alt="" />
            <div>
              <strong>{t("productForm.image")}</strong>
              <small>
                {category === "Accessories"
                  ? previewAccessory
                    ? t("productForm.accessoryPhoto", {
                        type: previewAccessory,
                      })
                    : t("productForm.pickAccessory")
                  : t("productForm.categoryPhoto", {
                      category: categoryLabel(t, category),
                    })}
              </small>
            </div>
          </div>
          <div className="form-grid">
            <Field label={t("product.name")}>
              <input
                name="name"
                defaultValue={product?.name}
                placeholder={t("productForm.namePh")}
                required
                minLength={2}
              />
            </Field>
            <Field label={t("product.category")}>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(t, c)}
                  </option>
                ))}
              </select>
            </Field>
            {category === "Accessories" && (
              <>
                <Field label={t("product.accessoryType")}>
                  <select
                    value={accessoryPick}
                    onChange={(e) => setAccessoryPick(e.target.value)}
                    required
                  >
                    {accessoryChoices(product?.attributes?.Type).map(
                      (choice) => (
                        <option key={choice}>{choice}</option>
                      ),
                    )}
                  </select>
                </Field>
                {accessoryPick === "Other" && (
                  <Field label={t("productForm.customAccessory")}>
                    <input
                      value={accessoryOther}
                      onChange={(e) => setAccessoryOther(e.target.value)}
                      placeholder={t("productForm.customAccessoryPh")}
                      required
                    />
                  </Field>
                )}
              </>
            )}
            <Field label={t("productForm.companyBrand")}>
              <select
                value={brandPick}
                onChange={(e) => setBrandPick(e.target.value)}
                required
              >
                {brandChoices(product?.brand).map((b) => (
                  <option key={b}>
                    {b === "Other" ? t("common.other") : b}
                  </option>
                ))}
              </select>
            </Field>
            {brandPick === "Other" && (
              <Field label={t("productForm.customBrand")}>
                <input
                  value={brandOther}
                  onChange={(e) => setBrandOther(e.target.value)}
                  placeholder={t("productForm.customBrandPh")}
                  required
                />
              </Field>
            )}
            <Field label={t("product.model")}>
              <input
                name="model"
                defaultValue={product?.model}
                placeholder={t("productForm.modelPh")}
                required
              />
            </Field>
            <Field label={t("product.sku")}>
              <input
                name="sku"
                defaultValue={product?.sku}
                placeholder={t("productForm.skuPh")}
                required
              />
            </Field>
          </div>
          <div className="form-section-title">
            {t("productForm.barcodeSection")}{" "}
            <small>{t("productForm.barcodeScanHint")}</small>
          </div>
          <div className="barcode-field-row">
            <span className="barcode-field-icon" aria-hidden="true">
              <BarcodeIcon size={22} />
            </span>
            <Field
              label={t("product.barcode")}
              hint={t("productForm.barcodeHint")}
            >
              <input
                name="barcode"
                defaultValue={product?.barcode}
                placeholder={t("productForm.barcodePh")}
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="form-section-title">{t("productForm.pricing")}</div>
          <div className="form-grid">
            {!forPurchase && (
              <>
                <Field
                  label={t("product.unitCostAed")}
                  hint={t("productForm.unitCostAedHint")}
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
                  label={t("productForm.fxRateAtPurchase")}
                  hint={t("productForm.fxRateDayHint")}
                >
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder={t("sales.aedRatePh")}
                    required
                  />
                </Field>
                <Field
                  label={t("product.unitCostAf")}
                  hint={t("productForm.unitCostAfHint")}
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
            <Field label={t("product.sellingPrice")}>
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
                label={t("productForm.openingQty")}
                hint={t("productForm.openingQtyHint")}
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
                label={t("productForm.stockOnPurchase")}
                hint={t("productForm.stockOnPurchaseHint")}
              >
                <input
                  value={t("productForm.stockOnPurchaseValue")}
                  readOnly
                  tabIndex={-1}
                />
              </Field>
            )}
            <Field label={t("product.reorder")}>
              <input
                name="reorder_level"
                type="number"
                min="0"
                defaultValue={product?.reorder_level ?? 5}
                required
              />
            </Field>
            <Field label={t("product.condition")}>
              <select
                name="condition"
                defaultValue={product?.condition || "New"}
              >
                <option value="New">{t("productForm.conditionNew")}</option>
                <option value="Used">{t("productForm.conditionUsed")}</option>
                <option value="Refurbished">
                  {t("productForm.conditionRefurb")}
                </option>
              </select>
            </Field>
            <Field label={t("product.warranty")}>
              <input
                name="warranty"
                defaultValue={product?.warranty}
                placeholder={t("productForm.warrantyPh")}
              />
            </Field>
          </div>
          <div className="form-section-title">{t("productForm.specs")}</div>
          <div className="form-grid">
            {attrs.map((a) => (
              <Field key={a} label={specFieldLabel(t, a)}>
                <input
                  name={a}
                  defaultValue={product?.attributes?.[a] || ""}
                  placeholder={
                    a === "RAM"
                      ? t("productForm.specRamPh")
                      : a === "Storage"
                        ? t("productForm.specStoragePh")
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
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy
              ? t("common.saving")
              : product
                ? t("productForm.saveChanges")
                : forPurchase
                  ? t("productForm.addToPurchase")
                  : t("productForm.addProduct")}
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
  const t = useT();
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
                t("sales.errProductGone", { name: line.name }),
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
        throw new Error(t("sales.errBarcode", { code }));
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
      const rate = purchase && fxRate.trim() ? toFxRate(fxRate) : 0;
      if (purchase && lines.some((l) => (l.costAed || "").trim()) && !rate)
        throw new Error(t("sales.errFxRate"));
      const partyId = await resolveSalePartyId();
      const payload = lines.map((l) => {
        const cost_aed =
          purchase && (l.costAed || "").trim() ? toMoney(l.costAed!) : 0;
        const price = toMoney(l.price);
        if (purchase && cost_aed) {
          const expected = afnFromAed(cost_aed, rate);
          if (Math.abs(price - expected) > 1)
            throw new Error(
              t("sales.errAfnCost", { name: l.product.name }),
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
            ? t("sales.purchaseUpdated")
            : t("sales.purchasePosted")
          : documentId
            ? t("sales.saleUpdated")
            : t("sales.salePosted"),
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
            ? t("sales.editDoc", { number: initial.number })
            : t("sales.receivePurchase")
          : initial
            ? t("sales.editDoc", { number: initial.number })
            : t("sales.newBill")
      }
      subtitle={
        purchase
          ? t("sales.subtitlePurchase")
          : t("sales.subtitleSale")
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
                            <option value="">{t("sales.chooseSupplier")}</option>
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
                      <label className="sale-customer-name purchase-rate-field">
                        <span>{t("sales.aedRate")}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(e) => applyFxRate(e.target.value)}
                          placeholder={t("sales.aedRatePh")}
                          required
                        />
                        <small>
                          {fxRate.trim()
                            ? t("sales.aedRateInline", { rate: fxRate })
                            : t("sales.aedRateHint")}
                        </small>
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
                              onChange={(e) => setCustomerName(e.target.value)}
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
                                <option value="">{t("sales.chooseCustomer")}</option>
                                {parties.map((p) => (
                                  <option value={p.id} key={p.id}>
                                    {p.name}
                                    {p.walk_in ? t("sales.walkInCashOnly") : ""}
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
                          <p className="credit-hint">{t("sales.walkInMustPay")}</p>
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
                  <div
                    className="product-browser-list sale-product-list"
                    role="listbox"
                    aria-label={t("sales.availableProducts")}
                  >
                    {searching ? (
                      <div className="product-browser-empty">
                        <span className="muted">{t("sales.loadingProducts")}</span>
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
                                      ? p.category ||
                                        t("sales.catalogLabel")
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
                            <input
                              aria-label={t("sales.productQty", {
                                name: l.product.name,
                              })}
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
                              <Field label={t("sales.costAed")}>
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
                              <Field label={t("sales.costAf")}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.price}
                                  readOnly
                                  tabIndex={-1}
                                  placeholder={
                                    fxRate.trim()
                                      ? t("sales.autoFromRate")
                                      : t("sales.setAedRate")
                                  }
                                  required
                                />
                              </Field>
                            </>
                          ) : (
                            <>
                              <Field label={t("sales.unitPrice")}>
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
                              <Field label={t("sales.lineDiscount")}>
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
                            <Field label={t("sales.lineDiscountAf")}>
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
                        {purchase
                          ? t("sales.emptyPurchase")
                          : t("sales.emptyBill")}
                      </p>
                    </div>
                  )}
                </div>
                <div className="sale-pay-panel">
                  <div className="trade-totals">
                    <div>
                      <span>{t("sales.invoiceTotal")}</span>
                      <strong>{af(total, 2)}</strong>
                    </div>
                    <div>
                      <span>{t("sales.balanceRemaining")}</span>
                      <strong>{af(Math.max(0, total - payment), 2)}</strong>
                    </div>
                    <Field
                      label={t("sales.amountPaid")}
                      hint={t("sales.amountPaidHint")}
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
                      {t("sales.printAfter")}
                    </label>
                    <button
                      type="button"
                      className="button"
                      onClick={close}
                    >
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
                      <Field
                        label={t("sales.aedRateBar")}
                        hint={t("sales.aedRateBarHint")}
                      >
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(e) => applyFxRate(e.target.value)}
                          placeholder={t("sales.aedRatePh")}
                          required
                        />
                      </Field>
                      <p className="purchase-rate-note">
                        {fxRate.trim()
                          ? t("sales.aedRateLive", { rate: fxRate })
                          : t("sales.aedRateSetFirst")}
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
                          <option value="">{t("sales.chooseSupplier")}</option>
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
                    <div
                      className="product-browser-list"
                      role="listbox"
                      aria-label={t("sales.availableProducts")}
                    >
                      {searching ? (
                        <div className="product-browser-empty">
                          <span className="muted">{t("sales.loadingProducts")}</span>
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
                                setLines((ls) =>
                                  ls.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon size={17} />
                            </button>
                          </div>
                          <div className="form-grid three">
                            <Field label={t("common.quantity")}>
                              <input
                                aria-label={t("sales.productQty", {
                                  name: l.product.name,
                                })}
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
                            <Field label={t("sales.costAed")}>
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
                            <Field label={t("sales.costAf")}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={l.price}
                                readOnly
                                tabIndex={-1}
                                placeholder={
                                  fxRate.trim()
                                    ? t("sales.autoFromRate")
                                    : t("sales.setAedRateAbove")
                                }
                                required
                              />
                            </Field>
                          </div>
                          <div className="form-grid" style={{ marginTop: 4 }}>
                            <Field label={t("sales.lineDiscountAf")}>
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
                      label={t("sales.amountPaid")}
                      hint={t("sales.paidHintPurchase")}
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
          setAddingProduct(false);
          const created = result as { id?: string } | undefined;
          if (!created?.id) return;
          try {
            const d = await api<{ rows: Product[] }>("catalog", {
              id: created.id,
              limit: 1,
            });
            const p = d.rows[0];
            if (!p) throw new Error(t("sales.errProductLoad"));
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
              <input
                name="opening_balance"
                type="number"
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
              <input
                name="amount"
                type="number"
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
          <Field label={t("expense.category")}>
            <select name="category">
              {(
                [
                  ["Rent", "expense.rent"],
                  ["Salaries", "expense.salaries"],
                  ["Utilities", "expense.utilities"],
                  ["Transport", "expense.transport"],
                  ["Repairs", "expense.repairs"],
                  ["Other", "expense.other"],
                ] as const
              ).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
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
          <button className="button button-dark" disabled={busy}>
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
          <Field label={t("payment.amount")}>
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
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
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
  const t = useT();
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
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
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
      done(t("toast.returnPosted"));
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
        doc
          ? `${doc.kind.replaceAll("_", " ")} · ${doc.date}`
          : t("invoice.loading")
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
                <span>
                  {doc.kind === "purchase"
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
              {doc.kind === "purchase" && !!doc.fx_rate && (
                <div>
                  <span>{t("product.fxRate")}</span>
                  <strong>{fxRateLabel(doc.fx_rate)}</strong>
                </div>
              )}
            </div>
            {doc.lines.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("invoice.product")}</th>
                    <th>{t("invoice.quantity")}</th>
                    {doc.kind === "purchase" && (
                      <th>{t("invoice.unitCostAed")}</th>
                    )}
                    <th>
                      {doc.kind === "purchase"
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
                        {doc.kind === "purchase" && (
                          <td>{l.cost_aed ? aed(l.cost_aed) : "—"}</td>
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
            <div className="invoice-summary">
              <div>
                <span>{t("invoice.total")}</span>
                <strong className="money">{af(doc.total, 2)}</strong>
              </div>
              <div>
                <span>{t("invoice.returned")}</span>
                <strong className="money">{af(doc.returned || 0, 2)}</strong>
              </div>
              <div>
                <span>{t("invoice.paid")}</span>
                <strong className="money">{af(doc.paid, 2)}</strong>
              </div>
              <div className="invoice-due">
                <span>{t("invoice.outstanding")}</span>
                <strong className="money">
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
              <Field label={t("invoiceActions.reason")}>
                <input name="reason" minLength={2} required />
              </Field>
              <p className="help-note">{t("invoiceActions.returnHelp")}</p>
              <ErrorMessage error={error} />
              <button
                className="button button-dark"
                disabled={busy || !Object.values(quantities).some((n) => n > 0)}
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
            <button className="button" onClick={() => setReturning(!returning)}>
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
            {window.vault
              ? t("invoiceActions.downloadPdf")
              : t("invoiceActions.downloadInvoice")}
          </button>
        )}
        {doc && (
          <button className="button button-dark" onClick={() => window.print()}>
            <PrinterIcon size={16} />
            {t("invoiceActions.printPdf")}
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
            {purchase ? t("deleteInvoice.bodyPurchase") : t("deleteInvoice.bodySale")}{" "}
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
  const t = useT();
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
    >
      <div className="form-body">
        <div className="product-detail-top">
          <img src={product.image} alt={product.name} />
          <div>
            <Badge
              tone={product.stock <= product.reorder_level ? "yellow" : "green"}
            >
              {t("productDetail.inStock", { n: product.stock })}
            </Badge>
            <h2>{af(product.price)}</h2>
            <p>
              {product.condition} ·{" "}
              {product.warranty || t("productDetail.noWarranty")}
            </p>
            <p>
              {t("productDetail.reorderAt", { n: product.reorder_level })}
            </p>
            {(product.cost_aed || product.fx_rate) && (
              <p>
                {t("productDetail.dubaiCost", {
                  aed: aed(product.cost_aed || 0),
                  rate: fxRateLabel(product.fx_rate || 0),
                  afn: af(product.unit_cost || 0, 2),
                })}
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
                {user.permissions.includes("view_costs") && (
                  <th>{t("productDetail.colCostMove")}</th>
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
            <div className="form-section-title">
              {t("productDetail.adjust")}
            </div>
            <div className="form-grid">
              <Field
                label={t("productDetail.qtyChange")}
                hint={t("productDetail.adjustHint")}
              >
                <input
                  name="quantity"
                  type="number"
                  required
                  defaultValue="1"
                />
              </Field>
              <Field label={t("productDetail.unitCostAdd")}>
                <input
                  name="cost"
                  type="number"
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
    const row = { ...e, running, label: partyLedgerLabel(t, e) };
    running -= signed(e);
    return row;
  });
  const current = detail?.party || party;
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
                {kind === "customer"
                  ? t("people.receivePayment")
                  : t("people.paySupplier")}
                <ArrowRightIcon size={15} />
              </button>
            )}
        </div>
        <div className="contact-ledger">
          <h3>{t("partyDetail.ledgerTitle")}</h3>
          <p className="subtle ledger-hint">{t("partyDetail.ledgerHint")}</p>
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
      done(
        user ? t("userForm.accessUpdated") : t("userForm.created"),
      );
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
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
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
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
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
