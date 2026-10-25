import {
  BarcodeIcon,
  PackageIcon,
  TagIcon,
  BuildingsIcon,
  SquaresFourIcon,
  CpuIcon,
  HardDriveIcon,
  MemoryIcon,
  CurrencyCircleDollarIcon,
  ArrowsLeftRightIcon,
  ShieldCheckIcon,
  StackIcon,
  FloppyDiskIcon,
  PlusIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  FolderOpenIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  api,
  moneyInput,
  fxRateInput,
  toMoney,
  toFxRate,
  afnFromAed,
  requestKey,
  type Product,
} from "../api";
import { useT } from "../i18n";
import { Modal, Field as BaseField, NumericInput, ErrorMessage } from "./ui";
import { ProductPhotoPicker, type PhotoValue } from "./ProductPhotoPicker";
import { CurrencyPicker } from "./CurrencyPicker";
import {
  PRODUCT_CATEGORIES,
  brandChoices,
  accessoryChoices,
  categoryLabel,
  specFieldLabel,
} from "./product-fields";
import "./product-entry.css";
const fieldIcons: Record<string, Icon> = {
  name: PackageIcon,
  category: SquaresFourIcon,
  brand: BuildingsIcon,
  brandOther: BuildingsIcon,
  model: CpuIcon,
  sku: TagIcon,
  barcode: BarcodeIcon,
  CPU: CpuIcon,
  GPU: CpuIcon,
  RAM: MemoryIcon,
  Storage: HardDriveIcon,
  cost: CurrencyCircleDollarIcon,
  price: CurrencyCircleDollarIcon,
  rate: ArrowsLeftRightIcon,
  opening_quantity: StackIcon,
  reorder_level: StackIcon,
  warranty: ShieldCheckIcon,
};
function Field({
  label,
  children,
  icon: Mark = TagIcon,
}: {
  label: ReactNode;
  children: ReactNode;
  icon?: Icon;
}) {
  return (
    <BaseField
      label={
        <>
          <Mark size={13} aria-hidden="true" />
          {label}
        </>
      }
    >
      {children}
    </BaseField>
  );
}
type Values = Record<string, string>;
type Entry = {
  data: Values;
  photo: PhotoValue;
  original?: Product;
  draftId?: string;
  revision?: number;
  key: string;
  baseline: string;
};
type Saved = { id: string; product: Product; operation: "create" | "update" };
type Draft = {
  id: string;
  data: Values;
  image: string;
  revision: number;
  intent: string;
};
const fields = [
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
];
function signature(e: Pick<Entry, "data" | "photo">) {
  return JSON.stringify([
    e.data,
    e.photo.photo_data ||
      (e.photo.image?.startsWith("photo:") ? e.photo.image : ""),
  ]);
}
function empty(common?: Values): Entry {
  const data: Values = {
    name: "",
    category: common?.category || "Computers",
    brand: common?.brand || "Apple",
    brandOther: common?.brandOther || "",
    model: "",
    sku: "",
    barcode: "",
    accessory: "Keyboard",
    accessoryOther: "",
    currency: common?.currency || "AED",
    cost: "",
    rate: common?.rate || "",
    price: "",
    opening_quantity: "0",
    reorder_level: "5",
    condition: "New",
    warranty: "",
    ...Object.fromEntries(fields.map((k) => [k, ""])),
  };
  const e = { data, photo: { image: "" }, key: requestKey(), baseline: "" };
  e.baseline = signature(e);
  return e;
}
function existing(p: Product): Entry {
  const e = empty();
  e.original = p;
  e.data = {
    ...e.data,
    name: p.name,
    category: p.category,
    brand: p.brand,
    model: p.model,
    sku: p.sku,
    barcode: p.barcode || "",
    accessory: p.attributes?.Type || "Keyboard",
    currency: p.currency || "AED",
    cost:
      (p.cost_foreign ?? p.cost_aed)
        ? moneyInput(p.cost_foreign ?? p.cost_aed ?? 0)
        : "",
    rate: p.fx_rate ? fxRateInput(p.fx_rate) : "",
    price: moneyInput(p.price),
    reorder_level: String(p.reorder_level),
    condition: p.condition,
    warranty: p.warranty,
    ...p.attributes,
  };
  e.photo = { image: p.image || "" };
  e.baseline = signature(e);
  return e;
}
export function ProductForm({
  close,
  done,
  product,
  intent = "catalog",
}: {
  close: () => void;
  done: (message: string, result: Saved) => void | Promise<void>;
  product?: Product;
  intent?: "catalog" | "purchase";
}) {
  const t = useT();
  const [entry, setEntry] = useState<Entry>(() =>
    product ? existing(product) : empty(),
  );
  const [history, setHistory] = useState<Entry[]>([]),
    [cursor, setCursor] = useState(-1),
    [epoch, setEpoch] = useState(0);
  const newEntry = useRef<Entry>(entry),
    form = useRef<HTMLFormElement>(null),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<any[]>([]),
    [count, setCount] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [showDrafts, setShowDrafts] = useState(false);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const d = entry.data,
    editing = !!entry.original,
    dirty = signature(entry) !== entry.baseline;
  function value(name: string, value: string) {
    setEntry((e) => ({ ...e, data: { ...e.data, [name]: value } }));
    setNotice("");
  }
  function photoChanged(photo: PhotoValue) {
    setEntry((e) =>
      JSON.stringify(e.photo) === JSON.stringify(photo) ? e : { ...e, photo },
    );
  }
  const photoHandler = useRef(photoChanged);
  photoHandler.current = photoChanged;
  const stablePhoto = useRef((photo: PhotoValue) =>
    photoHandler.current(photo),
  ).current;
  async function listDrafts(offset = 0) {
    try {
      const r = await api<any>("productDraftList", { intent, offset });
      setDrafts((rows) => (offset ? [...rows, ...r.rows] : r.rows));
      setCount(r.count);
      setNext(r.next);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void listDrafts();
  }, [intent]);
  function load(e: Entry, index = -1) {
    setEntry(e);
    setCursor(index);
    setEpoch((n) => n + 1);
    setError("");
    setNotice("");
    setPhotoBusy(false);
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLInputElement>("[name=name]")?.focus(),
    );
  }
  function remember() {
    if (cursor >= 0)
      setHistory((rows) => rows.map((e, i) => (i === cursor ? entry : e)));
    else if (!editing) newEntry.current = entry;
  }
  function previous() {
    remember();
    const index = cursor < 0 ? history.length - 1 : cursor - 1;
    if (index >= 0) load(history[index], index);
  }
  function backToNew() {
    remember();
    load(newEntry.current);
  }
  function leave(action: () => void) {
    if (locked.current || photoBusy) return;
    if (dirty) setPending(() => action);
    else action();
  }
  const closeRef = useRef<(skip?: Set<string>) => void>(() => {});
  closeRef.current = (skip = new Set()) => {
    if (locked.current || photoBusy) return;
    const candidates = [
      { record: entry, index: cursor },
      ...history
        .map((record, index) => ({ record, index }))
        .filter((r) => r.index !== cursor),
      ...(cursor >= 0 ? [{ record: newEntry.current, index: -1 }] : []),
    ];
    const unsaved = candidates.find(
      ({ record }) =>
        !skip.has(record.key) && signature(record) !== record.baseline,
    );
    if (!unsaved) {
      close();
      return;
    }
    if (unsaved.record !== entry) {
      remember();
      load(unsaved.record, unsaved.index);
    }
    const ignored = new Set(skip);
    ignored.add(unsaved.record.key);
    setPending(
      () => () => requestAnimationFrame(() => closeRef.current(ignored)),
    );
  };
  const stableClose = useRef(() => closeRef.current()).current;
  function payload() {
    const brand = d.brand === "Other" ? d.brandOther.trim() : d.brand.trim();
    if (!brand) throw new Error(t("productForm.errBrand"));
    const accessory =
      d.accessory === "Other" ? d.accessoryOther.trim() : d.accessory;
    if (d.category === "Accessories" && !accessory)
      throw new Error(t("productForm.errAccessory"));
    const purchase = intent === "purchase";
    const cost = purchase
      ? (entry.original?.cost_foreign ?? entry.original?.cost_aed ?? 0)
      : d.cost.trim()
        ? toMoney(d.cost)
        : 0;
    const rate = purchase
      ? (entry.original?.fx_rate ?? 0)
      : d.rate.trim()
        ? toFxRate(d.rate)
        : 0;
    if (!purchase && (!cost || !rate))
      throw new Error(t("currencies.costRateRequired"));
    const attrs =
      d.category === "Computers"
        ? ["CPU", "RAM", "Storage", "GPU", "Display", "Color"]
        : ["Mobiles", "Tablets"].includes(d.category)
          ? ["RAM", "Storage", "Color", "Connectivity"]
          : d.category === "Storage"
            ? ["Storage", "Interface"]
            : ["Compatibility", "Wattage", "Color"];
    const attributes = Object.fromEntries(
      attrs.filter((k) => d[k]).map((k) => [k, d[k]]),
    );
    if (d.category === "Accessories") attributes.Type = accessory;
    return {
      id: entry.original?.id,
      name: d.name,
      brand,
      model: d.model,
      sku: d.sku,
      barcode: d.barcode,
      category: d.category,
      price: toMoney(d.price),
      minimum: entry.original?.minimum ?? 0,
      location: entry.original?.location || "",
      reorder_level: Number(d.reorder_level),
      condition: d.condition,
      warranty: d.warranty,
      attributes,
      currency: purchase ? entry.original?.currency || d.currency : d.currency,
      cost_foreign: cost,
      cost_aed: d.currency === "AED" ? cost : 0,
      fx_rate: rate,
      unit_cost: purchase
        ? (entry.original?.unit_cost ?? 0)
        : afnFromAed(cost, rate),
      ...(!editing
        ? { opening_quantity: purchase ? 0 : Number(d.opening_quantity) }
        : {}),
      ...entry.photo,
    };
  }
  async function saveDraft(): Promise<boolean> {
    if (locked.current || photoBusy) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api<Draft>("productDraftSave", {
        id: entry.draftId,
        revision: entry.revision,
        intent,
        data: d,
        ...entry.photo,
      });
      const updated = {
        ...entry,
        draftId: r.id,
        revision: r.revision,
        photo: { image: r.image },
      };
      updated.baseline = signature(updated);
      setEntry(updated);
      newEntry.current = updated;
      setEpoch((n) => n + 1);
      setNotice(t("entry.draftSaved"));
      void listDrafts();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function save(
    mode: "close" | "next",
    after?: () => void,
  ): Promise<boolean> {
    if (locked.current || photoBusy || !form.current?.reportValidity())
      return false;
    locked.current = true;
    setBusy(true);
    setError("");
    let committed = false;
    try {
      const data = payload();
      let p: Product;
      if (editing) {
        const result = await api<{ id: string; product: Product }>(
          "productUpdate",
          data,
        );
        p = result.product;
      } else {
        const r = await api<{ id: string; product: Product }>(
          "productDraftPublish",
          {
            id: entry.draftId,
            revision: entry.revision,
            intent,
            request_key: entry.key,
            product: data,
          },
        );
        p = r.product;
      }
      committed = true;
      const savedEntry = existing(p);
      if (editing && cursor >= 0)
        setHistory((rows) =>
          rows.map((e, i) => (i === cursor ? savedEntry : e)),
        );
      else if (!editing) setHistory((rows) => [...rows, savedEntry]);
      if (!editing) {
        const fresh = empty(d);
        newEntry.current = fresh;
        load(fresh);
        void listDrafts();
      } else if (cursor >= 0) load(newEntry.current);
      else load(savedEntry);
      try {
        await done(
          t(
            editing
              ? "productForm.detailsUpdated"
              : "productForm.savedWithStock",
          ),
          { id: p.id, product: p, operation: editing ? "update" : "create" },
        );
      } catch (e: any) {
        setError(t("entry.refreshFailed") + " " + e.message);
      }
      if (after) after();
      else if (mode === "close" || (editing && cursor < 0))
        requestAnimationFrame(() => closeRef.current());
      else
        setNotice(
          t(editing ? "productForm.detailsUpdated" : "entry.savedNext"),
        );
      return true;
    } catch (e: any) {
      setError(e.message);
      return committed;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const shortcut = useRef(() => void save("next"));
  shortcut.current = () => void save("next");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        (e.ctrlKey && e.metaKey) ||
        e.altKey ||
        e.shiftKey ||
        e.isComposing ||
        e.repeat ||
        (e.code !== "KeyS" && e.key.toLowerCase() !== "s")
      )
        return;
      const top = Array.from(document.querySelectorAll("[role=dialog]")).at(-1);
      if (top !== form.current?.closest("[role=dialog]")) return;
      e.preventDefault();
      e.stopPropagation();
      shortcut.current();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);
  async function resume(id: string) {
    try {
      const r = await api<Draft>("productDraftRead", { id });
      if (r.intent !== intent) throw new Error(t("entry.wrongContext"));
      const e = {
        data: { ...empty().data, ...r.data },
        photo: { image: r.image },
        draftId: r.id,
        revision: r.revision,
        key: requestKey(),
        baseline: "",
      };
      e.baseline = signature(e);
      newEntry.current = e;
      load(e);
      setShowDrafts(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  const attrs =
    d.category === "Computers"
      ? ["CPU", "RAM", "Storage", "GPU", "Display", "Color"]
      : ["Mobiles", "Tablets"].includes(d.category)
        ? ["RAM", "Storage", "Color", "Connectivity"]
        : d.category === "Storage"
          ? ["Storage", "Interface"]
          : ["Compatibility", "Wattage", "Color"];
  let costAF = "";
  try {
    costAF =
      d.cost && d.rate
        ? moneyInput(afnFromAed(toMoney(d.cost), toFxRate(d.rate)))
        : "";
  } catch {}
  const text = (name: string, label: string, required = false) => (
    <Field label={label} icon={fieldIcons[name]}>
      <input
        name={name}
        value={d[name] || ""}
        onChange={(e) => value(name, e.target.value)}
        required={required}
        maxLength={name === "name" ? 500 : 200}
        minLength={name === "name" ? 2 : undefined}
      />
    </Field>
  );
  const number = (
    name: string,
    label: string,
    integer = false,
    required = true,
  ) => (
    <Field label={label} icon={fieldIcons[name]}>
      <NumericInput
        name={name}
        kind={integer ? "integer" : "decimal"}
        min="0"
        step={integer ? "1" : "0.01"}
        value={d[name] || ""}
        onChange={(e) => value(name, e.target.value)}
        required={required}
      />
    </Field>
  );
  return (
    <>
      <Modal
        title={t(
          editing
            ? "productForm.editTitle"
            : intent === "purchase"
              ? "productForm.newForPurchase"
              : "productForm.newTitle",
        )}
        onClose={stableClose}
        className="product-entry-modal"
        wide
      >
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing && cursor >= 0 ? "next" : "close");
          }}
        >
          <div
            className="product-entry-toolbar"
            hidden={cursor < 0 && !entry.draftId}
          >
            <span>
              {cursor >= 0
                ? t("entry.previousRecord", { number: cursor + 1 })
                : entry.draftId
                  ? t("entry.savedDraft")
                  : ""}
            </span>
          </div>
          <div className="form-body product-entry-body">
            <ProductPhotoPicker
              key={epoch}
              product={{
                category: d.category,
                brand: d.brand === "Other" ? d.brandOther : d.brand,
                model: d.model,
                attributes: {
                  Type:
                    d.accessory === "Other" ? d.accessoryOther : d.accessory,
                },
              }}
              existingImage={entry.photo.image}
              initialUpload={entry.photo.photo_data}
              compact
              onChange={stablePhoto}
              onBusy={setPhotoBusy}
            />
            <div className="product-entry-panels">
              <div className="product-entry-details">
                <section className="entry-section entry-identity">
                  <h3>{t("productForm.info")}</h3>
                  <div className="entry-grid three">
                    {text("name", t("product.name"), true)}
                    <Field label={t("product.category")} icon={SquaresFourIcon}>
                      <select
                        name="category"
                        value={d.category}
                        onChange={(e) => value("category", e.target.value)}
                      >
                        {PRODUCT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(t, c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label={t("productForm.companyBrand")}
                      icon={BuildingsIcon}
                    >
                      <select
                        name="brand"
                        value={d.brand}
                        onChange={(e) => value("brand", e.target.value)}
                      >
                        {brandChoices(d.brand).map((b) => (
                          <option key={b} value={b}>
                            {b === "Other" ? t("common.other") : b}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {d.brand === "Other" &&
                      text("brandOther", t("productForm.customBrand"), true)}
                    {text("model", t("product.model"), true)}
                    {text("sku", t("product.sku"), true)}
                    {text("barcode", t("product.barcode"))}
                    {d.category === "Accessories" && (
                      <Field label={t("product.accessoryType")}>
                        <select
                          name="accessory"
                          value={d.accessory}
                          onChange={(e) => value("accessory", e.target.value)}
                        >
                          {accessoryChoices(d.accessory).map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {d.category === "Accessories" &&
                      d.accessory === "Other" &&
                      text(
                        "accessoryOther",
                        t("productForm.customAccessory"),
                        true,
                      )}
                  </div>
                </section>
                <section className="entry-section entry-specifications">
                  <h3>{t("productForm.specs")}</h3>
                  <div className="entry-grid three">
                    {attrs.map((a) => (
                      <SpecInput
                        key={a}
                        name={a}
                        label={specFieldLabel(t, a)}
                        value={d[a] || ""}
                        onChange={(v) => value(a, v)}
                      />
                    ))}
                  </div>
                </section>
              </div>
              <section className="entry-section entry-pricing">
                <h3>{t("productForm.pricing")}</h3>
                <div className="entry-grid two">
                  {intent !== "purchase" && (
                    <>
                      <Field
                        label={t("currencies.choose")}
                        icon={CurrencyCircleDollarIcon}
                      >
                        <CurrencyPicker
                          compact
                          value={d.currency}
                          onChange={(code) =>
                            setEntry((e) => ({
                              ...e,
                              data: {
                                ...e.data,
                                currency: code,
                                cost: "",
                                rate: code === "AFN" ? "1" : "",
                              },
                            }))
                          }
                        />
                      </Field>
                      {number(
                        "cost",
                        t("currencies.unitCost", { code: d.currency }),
                      )}
                      <Field
                        label={t("currencies.rate", { code: d.currency })}
                        icon={ArrowsLeftRightIcon}
                      >
                        <NumericInput
                          name="rate"
                          value={d.rate}
                          readOnly={d.currency === "AFN"}
                          onChange={(e) => value("rate", e.target.value)}
                          required
                          step="0.0001"
                        />
                      </Field>
                      <Field
                        label={t("product.unitCostAf")}
                        icon={CurrencyCircleDollarIcon}
                      >
                        <input
                          readOnly
                          value={costAF}
                          tabIndex={-1}
                          dir="ltr"
                        />
                      </Field>
                    </>
                  )}
                  {number("price", t("product.sellingPrice"))}
                  {!editing &&
                    intent !== "purchase" &&
                    number(
                      "opening_quantity",
                      t("productForm.openingQty"),
                      true,
                    )}
                  {number("reorder_level", t("product.reorder"), true)}
                  <Field label={t("product.condition")} icon={ShieldCheckIcon}>
                    <select
                      name="condition"
                      value={d.condition}
                      onChange={(e) => value("condition", e.target.value)}
                    >
                      {["New", "Used", "Refurbished"].map((v, i) => (
                        <option key={v} value={v}>
                          {t(
                            [
                              "productForm.conditionNew",
                              "productForm.conditionUsed",
                              "productForm.conditionRefurb",
                            ][i],
                          )}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {text("warranty", t("product.warranty"))}
                </div>
              </section>
            </div>
            <ErrorMessage error={error} />
            {notice && (
              <p className="entry-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy || photoBusy}
              onClick={() => {
                setShowDrafts(true);
                void listDrafts();
              }}
            >
              <FolderOpenIcon size={15} aria-hidden="true" />
              {t("entry.drafts")} ({count})
            </button>

            <button
              type="button"
              className="button"
              disabled={busy || photoBusy}
              onClick={stableClose}
            >
              <XIcon size={15} aria-hidden="true" />
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || photoBusy || !history.length || cursor === 0}
              onClick={previous}
            >
              <ArrowLeftIcon size={15} aria-hidden="true" />
              {t("entry.previous")}
            </button>
            {cursor >= 0 && (
              <button
                type="button"
                className="button"
                disabled={busy || photoBusy}
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
                disabled={busy || photoBusy}
                onClick={() => void saveDraft()}
              >
                <FloppyDiskIcon size={15} aria-hidden="true" />
                {t("entry.saveDraft")}
              </button>
            )}
            {!editing && (
              <button
                type="button"
                className="button"
                disabled={busy || photoBusy}
                onClick={() => void save("next")}
              >
                <PlusIcon size={15} aria-hidden="true" />
                {t("entry.saveNew")}
              </button>
            )}
            <button className="button button-dark" disabled={busy || photoBusy}>
              <FloppyDiskIcon size={15} aria-hidden="true" />
              {t(
                busy
                  ? "common.saving"
                  : editing
                    ? "productForm.saveChanges"
                    : "common.save",
              )}
            </button>
          </div>
        </form>
      </Modal>
      {showDrafts && (
        <Modal
          title={t("entry.drafts")}
          onClose={() => setShowDrafts(false)}
          className="product-drafts-modal"
        >
          <div className="form-body">
            {drafts.length === 0 && <p>{t("entry.noDrafts")}</p>}
            {drafts.map((row) => (
              <article className="entry-draft-row" key={row.id}>
                <div>
                  <strong>{row.name || t("entry.untitled")}</strong>
                  <small>
                    {[row.brand, row.model].filter(Boolean).join(" · ")}
                  </small>
                  <time>{new Date(row.updated_at).toLocaleString()}</time>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => leave(() => void resume(row.id))}
                >
                  {t("entry.resume")}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    try {
                      await api("productDraftDelete", {
                        id: row.id,
                        revision: row.revision,
                      });
                      if (entry.draftId === row.id)
                        setEntry((e) => ({
                          ...e,
                          draftId: undefined,
                          revision: undefined,
                          baseline: "",
                        }));
                      void listDrafts();
                    } catch (e: any) {
                      setError(e.message);
                      setShowDrafts(false);
                    }
                  }}
                >
                  {t("common.delete")}
                </button>
              </article>
            ))}
            {next !== null && (
              <button className="button" onClick={() => void listDrafts(next)}>
                {t("common.loadMore")}
              </button>
            )}
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title={t("entry.unsaved")} onClose={() => setPending(null)}>
          <div className="form-body">
            <p>{t("entry.unsavedQuestion")}</p>
            <ErrorMessage error={error} />
          </div>
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {t("entry.continueEditing")}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                const action = pending;
                setPending(null);
                action();
              }}
            >
              {t("entry.discard")}
            </button>
            <button
              className="button button-dark"
              disabled={busy || photoBusy}
              onClick={async () => {
                const action = pending;
                if (editing) {
                  if (
                    await save("next", () => {
                      setPending(null);
                      action();
                    })
                  )
                    setPending(null);
                } else if (await saveDraft()) {
                  setPending(null);
                  action();
                }
              }}
            >
              {t(editing ? "productForm.saveChanges" : "entry.saveDraft")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function SpecInput({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const suggestions =
    name === "RAM"
      ? ["4 GB", "8 GB", "16 GB", "32 GB", "64 GB", "128 GB"]
      : name === "Storage"
        ? ["128 GB", "256 GB", "512 GB", "1 TB", "2 TB", "4 TB"]
        : [];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const choose = (suggestion: string) => {
    onChange(suggestion);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  };
  return (
    <div
      className="entry-spec"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <Field label={label} icon={fieldIcons[name]}>
        <input
          ref={input}
          name={name}
          value={value}
          maxLength={200}
          role={suggestions.length ? "combobox" : undefined}
          aria-expanded={suggestions.length ? open : undefined}
          aria-controls={suggestions.length && open ? listId : undefined}
          aria-autocomplete={suggestions.length ? "list" : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive(
                (i) =>
                  (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                  suggestions.length,
              );
            } else if (e.key === "Enter" && open && active >= 0) {
              e.preventDefault();
              choose(suggestions[active]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
      </Field>
      {suggestions.length > 0 && open && (
        <div
          id={listId}
          className="entry-suggestions"
          role="listbox"
          aria-label={label}
        >
          {suggestions.map((s, i) => (
            <button
              type="button"
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
