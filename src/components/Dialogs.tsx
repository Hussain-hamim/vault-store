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
} from "@phosphor-icons/react";
import {
  api,
  af,
  toMoney,
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
type DialogProps = { close: () => void; done: (message: string) => void };
export function ProductForm({
  close,
  done,
  product,
}: {
  close: () => void;
  done: (message: string) => void;
  product?: Product;
}) {
  const [category, setCategory] = useState(product?.category || "Computers"),
    [serialized, setSerialized] = useState(
      product ? !!product.serialized : true,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
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
      await api(product ? "productUpdate" : "productCreate", {
        id: product?.id,
        name: f.get("name"),
        brand: f.get("brand"),
        model: f.get("model"),
        sku: f.get("sku"),
        barcode: f.get("barcode"),
        category,
        price: toMoney(f.get("price")),
        minimum: toMoney(f.get("minimum")),
        reorder_level: Number(f.get("reorder_level")),
        location: f.get("location"),
        condition: f.get("condition"),
        warranty: f.get("warranty"),
        serialized,
        attributes,
        ...(!product
          ? { opening_quantity: Number(f.get("opening_quantity") || 0) }
          : {}),
        ...(f.has("unit_cost")
          ? { unit_cost: toMoney(f.get("unit_cost")) }
          : {}),
        image:
          product?.image ||
          `/assets/${category === "Computers" ? "laptop" : category === "Tablets" ? "tablet" : category === "Mobiles" ? "phone" : category === "Storage" ? "storage" : "adapter"}.png`,
      });
      done(
        product
          ? "Product details updated."
          : "Product and opening stock saved.",
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
  return (
    <Modal
      title={product ? "Edit product" : "Add new product"}
      subtitle="Add product details, its cost and any stock already on your shelf."
      onClose={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="form-section-title">
            <PackageIcon size={17} />
            Product information
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
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSerialized(
                    ["Computers", "Mobiles", "Tablets"].includes(
                      e.target.value,
                    ),
                  );
                }}
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
            <Field label="Company / brand">
              <input
                name="brand"
                defaultValue={product?.brand}
                placeholder="e.g. Apple"
                required
              />
            </Field>
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
            <Field label="Barcode (optional)">
              <input
                name="barcode"
                defaultValue={product?.barcode}
                placeholder="Scan or type barcode"
              />
            </Field>
          </div>
          <div className="form-section-title">Pricing & stock rules</div>
          <div className="form-grid three">
            <Field
              label="Unit cost (AF)"
              hint="Opening stock is valued at this cost. Later purchases keep their actual costs."
            >
              <input
                name="unit_cost"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(product?.unit_cost ?? 0) / 100}
                required
              />
            </Field>
            {!product && (
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
            <Field label="Minimum price (AF)">
              <input
                name="minimum"
                type="number"
                min="0"
                step="0.01"
                defaultValue={product ? product.minimum / 100 : 0}
              />
            </Field>
            <Field label="Reorder level">
              <input
                name="reorder_level"
                type="number"
                min="0"
                defaultValue={product?.reorder_level ?? 5}
                required
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Shelf / location">
              <input
                name="location"
                defaultValue={product?.location}
                placeholder="e.g. A-01"
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
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={serialized}
              onChange={(e) => setSerialized(e.target.checked)}
            />
            <span>
              <strong>Track individual devices</strong>
              <small>
                Keep a separate cost for each unit. Serial numbers and IMEIs are
                optional.
              </small>
            </span>
          </label>
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
            {busy ? "Saving…" : product ? "Save changes" : "Add product"}
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
  device_ids: string[];
  devices: any[];
  serialText: string;
};
function BillFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <section className="panel bill-editor">
      <div className="bill-heading">
        <div>
          <span className="eyebrow">SALES COUNTER</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <Badge tone="green">AFN · No tax</Badge>
      </div>
      {children}
    </section>
  );
}
export function TradeForm({
  kind,
  close,
  done,
  inline = false,
  documentId,
}: {
  kind: "sale" | "purchase";
  inline?: boolean;
  documentId?: string;
} & DialogProps) {
  const [q, setQ] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [parties, setParties] = useState<Party[]>([]),
    [party, setParty] = useState(""),
    [lines, setLines] = useState<CartLine[]>([]),
    [paid, setPaid] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [initial, setInitial] = useState<any>(null),
    [loading, setLoading] = useState(!!documentId);
  const key = useRef(requestKey());
  const Frame = inline ? BillFrame : Modal;
  const purchase = kind === "purchase";
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api<{ rows: Product[] }>("catalog", { q, limit: 12 })
          .then((d) => {
            if (active) setProducts(d.rows);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      150,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q]);
  useEffect(() => {
    let active = true;
    api<{ rows: Party[] }>("parties", {
      kind: purchase ? "supplier" : "customer",
    })
      .then((d) => {
        if (!active) return;
        setParties(d.rows);
        if (!documentId)
          setParty(d.rows.find((p) => p.walk_in)?.id || d.rows[0]?.id || "");
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
            const devices = found.serialized
              ? await api<any[]>("deviceCatalog", { id: found.id })
              : [];
            const soldDevices = (line.device_serials || []).map((d: any) => ({
              ...d,
              status: "sold",
            }));
            return {
              product: { ...found, stock: found.stock + line.quantity },
              quantity: line.quantity,
              price: String(line.price / 100),
              discount: String(line.discount / 100),
              devices: [...devices, ...soldDevices],
              device_ids: soldDevices.map((d: any) => d.id),
              serialText: "",
            };
          }),
        );
        if (active) {
          setInitial(doc);
          setParty(doc.party_id);
          setPaid(String(doc.paid / 100));
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
  async function add(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    try {
      const devices =
        !purchase && p.serialized
          ? await api<any[]>("deviceCatalog", { id: p.id })
          : [];
      setLines((ls) =>
        ls.some((l) => l.product.id === p.id)
          ? ls
          : [
              ...ls,
              {
                product: p,
                quantity: 1,
                price: String(
                  purchase
                    ? p.stock && p.cost
                      ? Math.round(p.cost / p.stock) / 100
                      : (p.unit_cost || 0) / 100
                    : p.price / 100,
                ),
                discount: "0",
                device_ids: devices
                  .filter((d) => d.serial_missing)
                  .slice(0, 1)
                  .map((d) => d.id),
                devices,
                serialText: "",
              },
            ],
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  const update = (i: number, key: keyof CartLine, v: any) =>
    setLines((ls) =>
      ls.map((l, j) =>
        i === j
          ? {
              ...l,
              [key]: v,
              ...(key === "quantity" && l.product.serialized && !purchase
                ? {
                    device_ids: [
                      ...l.device_ids.slice(0, v),
                      ...l.devices
                        .filter(
                          (d) =>
                            d.serial_missing && !l.device_ids.includes(d.id),
                        )
                        .slice(0, Math.max(0, v - l.device_ids.length))
                        .map((d) => d.id),
                    ],
                  }
                : {}),
            }
          : l,
      ),
    );
  const total = lines.reduce(
    (s, l) =>
      s +
      Math.round(Number(l.price || 0) * 100) * l.quantity -
      Math.round(Number(l.discount || 0) * 100),
    0,
  );
  const payment = paid === "" ? total : Math.round(Number(paid) * 100);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const payload = lines.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        price: toMoney(l.price),
        discount: toMoney(l.discount),
        device_ids: l.device_ids,
        serials:
          purchase && l.product.serialized
            ? l.serialText
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((row) => {
                  const [serial, imei1 = "", imei2 = ""] = row
                    .split("|")
                    .map((x) => x.trim());
                  return { serial, imei1, imei2 };
                })
            : [],
      }));
      await api(documentId ? "saleEdit" : kind, {
        ...(documentId ? { id: documentId, revision: initial.revision } : {}),
        party_id: party,
        lines: payload,
        paid: paid === "" ? total : toMoney(paid),
        date: f.get("date"),
        due_date: f.get("due_date") || null,
        note: f.get("note"),
        request_key: key.current,
      });
      done(
        purchase
          ? "Purchase received. Stock and supplier ledger updated."
          : documentId
            ? "Invoice updated. Stock, payment and profit recalculated."
            : "Sale posted. Invoice, stock and ledger saved.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame
      title={
        purchase
          ? "Receive a purchase"
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
        <form onSubmit={submit}>
          <div className="form-body trade-body">
            <div className="form-grid three">
              <Field label={purchase ? "Supplier" : "Customer"}>
                <select
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  required
                >
                  <option value="">
                    Choose {purchase ? "supplier" : "customer"}
                  </option>
                  {parties.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
            <div className="form-section-title">
              Add products{" "}
              <span className="subtle">
                {lines.length} invoice line{lines.length === 1 ? "" : "s"} · Add
                as many products as you need
              </span>
            </div>
            <Search
              value={q}
              onChange={setQ}
              placeholder="Search by name, SKU, barcode or serial…"
            />
            <div className="product-picker">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={
                    lines.some((l) => l.product.id === p.id) ||
                    (!purchase && p.stock === 0)
                  }
                  onClick={() => add(p)}
                >
                  <ProductName product={p} />
                  <span>{purchase ? af(p.price) : `${p.stock} in stock`}</span>
                  <PlusIcon size={16} />
                </button>
              ))}
              {!products.length && (
                <span className="muted">
                  No matching products. Add a product in Inventory first.
                </span>
              )}
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
                    <Field
                      label={purchase ? "Unit cost (AF)" : "Unit price (AF)"}
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.price}
                        onChange={(e) => update(i, "price", e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Line discount (AF)">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.discount}
                        onChange={(e) => update(i, "discount", e.target.value)}
                        required
                      />
                    </Field>
                  </div>
                  {!!l.product.serialized &&
                    (purchase ? (
                      <Field
                        label="Device serial numbers (optional)"
                        hint="Leave blank if not available. Enter up to one device per line: SERIAL | IMEI1 | IMEI2. Remaining units are recorded without serials."
                      >
                        <textarea
                          rows={Math.min(l.quantity + 1, 5)}
                          placeholder="SN-0001 | 123456789012345"
                          value={l.serialText}
                          onChange={(e) =>
                            update(i, "serialText", e.target.value)
                          }
                        />
                      </Field>
                    ) : (
                      <Field
                        label={`Select ${l.quantity} device${l.quantity > 1 ? "s" : ""}`}
                        hint="Units without recorded serials are selected automatically. You can change the selection."
                      >
                        <select
                          multiple
                          value={l.device_ids}
                          onChange={(e) =>
                            update(
                              i,
                              "device_ids",
                              Array.from(e.target.selectedOptions).map(
                                (o) => o.value,
                              ),
                            )
                          }
                          required
                          size={Math.min(4, Math.max(2, l.devices.length))}
                        >
                          {l.devices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.serial}
                              {d.imei1 ? ` · IMEI ${d.imei1}` : ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                </div>
              ))}
            </div>
            {!lines.length && (
              <div className="cart-empty">
                <ShoppingIllustration />
                <p>
                  Select products above to start your{" "}
                  {purchase ? "purchase" : "sale"}.
                </p>
              </div>
            )}
            <div className="trade-totals">
              <div>
                <span>Invoice total</span>
                <strong>{af(total, 2)}</strong>
              </div>
              <div>
                <span>
                  {purchase
                    ? "Supplier balance remaining"
                    : "Customer balance remaining"}
                </span>
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
          <div className="modal-actions">
            <span className="subtle">AFN · No tax</span>
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button
              className="button button-dark"
              disabled={
                busy || !lines.length || !party || (!!documentId && !initial)
              }
            >
              {busy
                ? "Posting…"
                : purchase
                  ? "Receive purchase"
                  : documentId
                    ? "Save invoice changes"
                    : "Post sale"}
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </form>
      )}
    </Frame>
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
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("partyCreate", {
        kind,
        name: f.get("name"),
        phone: f.get("phone"),
        email: f.get("email"),
        address: f.get("address"),
        credit_limit: toMoney(f.get("credit_limit") || "0"),
      });
      done(`${kind === "customer" ? "Customer" : "Supplier"} added.`);
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
          {kind === "customer" && (
            <Field
              label="Credit limit (AF)"
              hint="0 means no configured limit. Walk-in sales still require full payment."
            >
              <input
                name="credit_limit"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </Field>
          )}
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
}: {
  documentId: string;
  user: User;
  edit?: () => void;
  remove?: () => void;
} & DialogProps) {
  const [doc, setDoc] = useState<any>(null),
    [store, setStore] = useState<any>(null),
    [error, setError] = useState(""),
    [returning, setReturning] = useState(false),
    [busy, setBusy] = useState(false),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [returnDevices, setReturnDevices] = useState<Record<string, string[]>>({});
  const key = useRef(requestKey());
  useEffect(() => {
    Promise.all([api("document", { id: documentId }), api("status")])
      .then(([d, s]) => {
        setDoc(d);
        setStore(s.store);
      })
      .catch((e) => setError(e.message));
  }, [documentId]);
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
            device_ids: returnDevices[l.id] || [],
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
                <h2>{store?.name}</h2>
                <p>{store?.address}</p>
                <p>{store?.phone}</p>
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
            </div>
            {doc.lines.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Discount</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l: any) => (
                    <tr key={l.id}>
                      <td>
                        <ProductName product={l} />
                        {l.device_serials?.map((d: any) => (
                          <small
                            className="device-invoice-serial"
                            key={d.serial}
                          >
                            {d.serial}
                            {d.imei1 ? " · IMEI " + d.imei1 : ""}
                          </small>
                        ))}
                      </td>
                      <td>
                        {l.quantity}
                        {l.returned_quantity > 0 && (
                          <small className="block muted">
                            {l.returned_quantity} returned
                          </small>
                        )}
                      </td>
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
              {doc.lines
                .filter((l: any) => l.serialized && quantities[l.id] > 0)
                .map((l: any) => (
                  <Field
                    key={l.id + "-devices"}
                    label={`Devices to return · ${l.name}`}
                  >
                    <select
                      multiple
                      required
                      value={returnDevices[l.id] || []}
                      onChange={(e) =>
                        setReturnDevices({
                          ...returnDevices,
                          [l.id]: Array.from(e.target.selectedOptions).map(
                            (o) => o.value,
                          ),
                        })
                      }
                    >
                      {(l.return_devices || []).map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.serial}
                          {d.imei1 ? " · " + d.imei1 : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              <Field label="Reason for return">
                <input name="reason" minLength={2} required />
              </Field>
              <p className="help-note">
                The return reduces outstanding debt first. Any remaining amount
                is refunded in cash. For serial-tracked items, select the exact
                devices being returned.
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
        {doc?.kind === "sale" && ["Owner", "Manager"].includes(user.role) && (
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
            await api("saleDelete", {
              id: doc.id,
              revision: doc.revision,
              confirmation,
              request_key: key.current,
            });
            done(
              "Invoice permanently deleted. Stock, cash and customer ledger updated.",
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
            This permanently removes the invoice and its accounting entries.
            Sold items return to their original stock batches. An administrative
            audit reference remains.
          </p>
          <p>
            Invoices with linked returns or later payment receipts cannot be
            deleted.
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
}: { product: Product; user: User; edit: () => void } & DialogProps) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [adjust, setAdjust] = useState(false),
    [busy, setBusy] = useState(false),
    [devices, setDevices] = useState<any[]>([]);
  const key = useRef(requestKey());
  useEffect(() => {
    api("productDetail", { id: product.id })
      .then(setData)
      .catch((e) => setError(e.message));
    if (product.serialized)
      api<any[]>("deviceCatalog", { id: product.id })
        .then(setDevices)
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
        device_ids: f.getAll("devices"),
        serials: String(f.get("serials") || "")
          .split("\n")
          .filter(Boolean)
          .map((serial) => ({ serial: serial.trim() })),
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
            <p>
              Location: {product.location || "Not set"} · Reorder at{" "}
              {product.reorder_level}
            </p>
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
        {!!product.serialized && (
          <details className="device-details">
            <summary>Available serial numbers ({devices.length})</summary>
            <div className="serial-list">
              {devices.map((d) => (
                <span key={d.id}>
                  {d.serial}
                  {d.imei1 && <small>IMEI {d.imei1}</small>}
                </span>
              ))}
            </div>
          </details>
        )}
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
            {!!product.serialized && (
              <>
                <Field label="Serials for added units (one per line)">
                  <textarea name="serials" rows={2} />
                </Field>
                <Field label="Devices to remove">
                  <select name="devices" multiple>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.serial}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
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
        <button className="button" onClick={edit}>
          Edit product
        </button>
        <button className="button" onClick={() => setAdjust(!adjust)}>
          {adjust ? "Cancel adjustment" : "Adjust stock"}
        </button>
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
      title="Owner cash movement"
      subtitle="Capital deposits and withdrawals affect cash and equity, not profit."
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <Field label="Movement">
            <select name="direction">
              <option value="deposit">Capital deposit</option>
              <option value="withdrawal">Owner withdrawal</option>
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
          <Field label="Reason">
            <input name="note" minLength={2} required />
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
          <Field label="Outstanding opening amount (AF)">
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
            This adds{" "}
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
