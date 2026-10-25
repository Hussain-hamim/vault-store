import {
  DeviceSelection,
  ReceiveDevices,
  type Device,
  type DeviceDetails,
} from "./DeviceInventory";
import { ProductPhotoPicker, type PhotoValue } from "./ProductPhotoPicker";
import {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  categoryLabel,
  specFieldLabel,
} from "./Dialogs";
import { specOrder } from "../api";
import { useEffect, useRef, useState } from "react";
import {
  PlusIcon,
  ArrowCounterClockwiseIcon,
  MoneyIcon,
} from "@phosphor-icons/react";
import { api, af, businessDate, requestKey, toMoney, Party } from "../api";
import { useI18n } from "../i18n";
import { Empty, ErrorMessage, Field, Modal, NumericInput } from "./ui";
import type { PageProps } from "./Pages";
import "./resale.css";
type DialogProps = { close: () => void; done: (message: string) => void };
function useChoices(command: string, q: string, kind?: string, enabled = true) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (!enabled) {
      setRows([]);
      return;
    }
    const timer = setTimeout(
      () =>
        api(command, { q, limit: 50, ...(kind ? { kind } : {}) })
          .then((d) => {
            if (active) setRows(d.rows);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [command, q, kind, enabled]);
  return { rows, error };
}
export function CustomerResalePage({ refresh, open, user }: PageProps) {
  const { t } = useI18n();
  const [view, setView] = useState<"stock" | "owners">("stock"),
    [rows, setRows] = useState<any[]>([]),
    [summary, setSummary] = useState<any>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const activeKey = useRef("");
  const signature = view + "-" + refresh;
  activeKey.current = signature;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setNext(null);
    setError("");
    setBusy(false);
    api("consignments", { view })
      .then((d) => {
        if (active) {
          setRows(d.rows);
          setNext(d.next);
          setSummary(d.summary);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [view, refresh]);
  async function more() {
    const key = signature;
    setBusy(true);
    try {
      const data = await api("consignments", { view, after: next });
      if (activeKey.current === key) {
        setRows((r) => [...r, ...data.rows]);
        setNext(data.next);
        setSummary(data.summary);
      }
    } catch (e: any) {
      if (activeKey.current === key) setError(e.message);
    } finally {
      if (activeKey.current === key) setBusy(false);
    }
  }
  return (
    <div className="page-content resale-page">
      <div className="resale-header">
        <div className="inline-actions">
          {user.permissions.includes("people") && (
            <button className="button" onClick={() => open("customer")}>
              {t("people.addCustomer")}
            </button>
          )}
          {user.permissions.includes("inventory") && (
            <>
              <button className="button" onClick={() => open("product")}>
                {t("resale.newProduct")}
              </button>
              <button
                className="button button-dark"
                onClick={() => open("consignmentReceive")}
              >
                <PlusIcon size={16} />
                {t("resale.receive")}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="help-note">{t("resale.explainer")}</p>
      {summary && (
        <div className="resale-summary">
          <article>
            <span>{t("resale.stockHeld")}</span>
            <strong>{summary.held_units}</strong>
          </article>
          <article>
            <span>{t("resale.owedToOwners")}</span>
            <strong className="text-red">
              <bdi dir="ltr">{af(summary.due, 2)}</bdi>
            </strong>
          </article>
          <article>
            <span>{t("resale.recoverable")}</span>
            <strong className="text-green">
              <bdi dir="ltr">{af(summary.recoverable, 2)}</bdi>
            </strong>
          </article>
        </div>
      )}
      <div className="sales-tabs" role="tablist" aria-label={t("resale.title")}>
        <button
          role="tab"
          aria-selected={view === "stock"}
          onClick={() => {
            if (view !== "stock") {
              setLoading(true);
              setView("stock");
            }
          }}
        >
          {t("resale.stockHeld")}
        </button>
        <button
          role="tab"
          aria-selected={view === "owners"}
          onClick={() => {
            if (view !== "owners") {
              setLoading(true);
              setView("owners");
            }
          }}
        >
          {t("resale.ownerBalances")}
        </button>
      </div>
      <ErrorMessage error={error} />
      {loading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="resale-list">
          {rows.map((row) =>
            view === "stock" ? (
              <article className="resale-row" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {[row.brand, row.model, row.sku]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <small>
                    {t("resale.owner")}: {row.owner_name} · {row.received_date}
                  </small>
                </div>
                <div>
                  <small>{t("resale.stockHeld")}</small>
                  <strong>{row.remaining}</strong>
                </div>
                <div>
                  <small>{t("resale.ownerUnitAmount")}</small>
                  <strong>
                    <bdi dir="ltr">{af(row.owner_unit_amount, 2)}</bdi>
                  </strong>
                </div>
                {user.permissions.includes("sales") && (
                  <button
                    className="button button-dark"
                    onClick={() =>
                      open("sale", {
                        product: {
                          ...row,
                          id: row.product_id,
                          attributes:
                            typeof row.attributes === "string"
                              ? JSON.parse(row.attributes)
                              : row.attributes,
                        },
                      })
                    }
                  >
                    {t("resale.sellItem")}
                  </button>
                )}
                {user.permissions.includes("inventory") && (
                  <button
                    className="button"
                    onClick={() => open("consignmentReturn", row)}
                  >
                    <ArrowCounterClockwiseIcon size={15} />
                    {t("resale.returnOwner")}
                  </button>
                )}
              </article>
            ) : (
              <article className="resale-row" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {row.phone || "—"} · {t("resale.stockHeld")}:{" "}
                    {row.held_units}
                  </small>
                  <button
                    className="text-button"
                    onClick={() =>
                      open("partyDetail", {
                        ...row,
                        kind: "customer",
                        balance: 0,
                        consignment_balance: row.balance,
                        ledgerView: "resale",
                      })
                    }
                  >
                    {t("resale.ownerLedger")}
                  </button>
                </div>
                <div>
                  <small>
                    {t(
                      row.balance < 0
                        ? "resale.recoverable"
                        : "resale.owedToOwners",
                    )}
                  </small>
                  <strong
                    className={row.balance > 0 ? "text-red" : "text-green"}
                  >
                    <bdi dir="ltr">{af(Math.abs(row.balance), 2)}</bdi>
                  </strong>
                </div>
                {row.balance !== 0 && (
                  <button
                    className="button"
                    onClick={() => open("consignmentSettlement", row)}
                  >
                    <MoneyIcon size={15} />
                    {t(row.balance < 0 ? "resale.recover" : "resale.payOwner")}
                  </button>
                )}
              </article>
            ),
          )}
        </div>
      )}
      {!loading && !rows.length && !error && (
        <Empty title={t("resale.empty")} text={t("resale.emptyHint")} />
      )}
      {next && (
        <button className="button" disabled={busy} onClick={more}>
          {busy ? t("common.loading") : t("pagination.loadMore")}
        </button>
      )}
    </div>
  );
}
export function ResaleReceiveDialog({
  party,
  close,
  done,
  user,
}: { party?: Party; user: import("../api").User } & DialogProps) {
  const { t } = useI18n();
  const [newOwner, setNewOwner] = useState(
      !party && user.permissions.includes("people"),
    ),
    [newProduct, setNewProduct] = useState(true),
    [category, setCategory] = useState("Computers"),
    [brand, setBrand] = useState("Dell"),
    [customBrand, setCustomBrand] = useState(""),
    [accessoryType, setAccessoryType] = useState(""),
    [model, setModel] = useState(""),
    [photo, setPhoto] = useState<PhotoValue>({ image: "" }),
    [photoBusy, setPhotoBusy] = useState(false),
    [ownerSearch, setOwnerSearch] = useState(party?.name || ""),
    [productSearch, setProductSearch] = useState(""),
    [owner, setOwner] = useState(party?.id || ""),
    [product, setProduct] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const owners = useChoices("parties", ownerSearch, "customer", !newOwner),
    products = useChoices("catalog", productSearch, undefined, !newProduct);
  const [receiptQty, setReceiptQty] = useState("1"),
    [receiptUnits, setReceiptUnits] = useState<DeviceDetails[]>([]);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const attributes = Object.fromEntries(
        specOrder(category)
          .map((k) => [k, String(form.get("spec-" + k) || "")])
          .filter(([, v]) => v),
      );
      await api("consignmentReceive", {
        ...(newOwner
          ? {
              new_owner: {
                name: form.get("owner_name"),
                phone: form.get("owner_phone"),
              },
            }
          : { owner_id: owner }),
        ...(newProduct
          ? {
              new_product: {
                ...photo,
                name: form.get("product_name"),
                brand: brand === "Other" ? form.get("custom_brand") : brand,
                model: form.get("model"),
                category,
                serialized: ["Computers", "Mobiles", "Tablets"].includes(
                  category,
                ),
                price: toMoney(form.get("selling_price")),
                condition: form.get("condition"),
                attributes,
              },
            }
          : { product_id: product }),
        quantity: Number(form.get("quantity")),
        units: receiptUnits.length
          ? Array.from(
              { length: Number(receiptQty) },
              (_, i) => receiptUnits[i] || {},
            )
          : undefined,
        owner_unit_amount: toMoney(form.get("amount")),
        date: form.get("date"),
        note: form.get("note"),
        request_key: key.current,
      });
      done(t("resale.received"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("resale.receive")}
      subtitle={t("resale.receiveHint")}
      onClose={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-body resale-intake">
          <section className="resale-intake-section">
            <div className="resale-intake-heading">
              <h3>{t("resale.owner")}</h3>
              <div className="resale-mode-switch">
                <button
                  type="button"
                  disabled={!user.permissions.includes("people")}
                  aria-pressed={newOwner}
                  onClick={() => setNewOwner(true)}
                >
                  {t("resale.newOwner")}
                </button>
                <button
                  type="button"
                  aria-pressed={!newOwner}
                  onClick={() => setNewOwner(false)}
                >
                  {t("resale.existingOwner")}
                </button>
              </div>
            </div>
            {newOwner ? (
              <div className="form-grid">
                <Field label={t("resale.ownerName")}>
                  <input
                    name="owner_name"
                    required
                    minLength={2}
                    maxLength={500}
                  />
                </Field>
                <Field label={t("people.phone")}>
                  <input name="owner_phone" type="tel" maxLength={500} />
                </Field>
              </div>
            ) : (
              <Field label={t("resale.findOwner")}>
                <input
                  aria-label={t("resale.findOwner")}
                  value={ownerSearch}
                  onChange={(e) => {
                    setOwnerSearch(e.target.value);
                    setOwner("");
                  }}
                  placeholder={t("resale.findOwner")}
                />
                <select
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  required
                >
                  <option value="">{t("resale.chooseOwner")}</option>
                  {owners.rows
                    .filter((p) => !p.walk_in)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.phone}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </section>
          <section className="resale-intake-section">
            <div className="resale-intake-heading">
              <h3>{t("invoice.product")}</h3>
              <div className="resale-mode-switch">
                <button
                  type="button"
                  aria-pressed={newProduct}
                  onClick={() => setNewProduct(true)}
                >
                  {t("resale.unlistedProduct")}
                </button>
                <button
                  type="button"
                  aria-pressed={!newProduct}
                  onClick={() => setNewProduct(false)}
                >
                  {t("resale.existingProduct")}
                </button>
              </div>
            </div>
            {newProduct ? (
              <>
                <ProductPhotoPicker
                  product={{
                    brand: brand === "Other" ? customBrand : brand,
                    model,
                    category,
                    attributes: { Type: accessoryType },
                  }}
                  onChange={setPhoto}
                  onBusy={setPhotoBusy}
                />
                <div className="form-grid">
                  <Field label={t("product.name")}>
                    <input
                      name="product_name"
                      required
                      minLength={2}
                      maxLength={500}
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
                </div>
                <div className="form-grid">
                  <Field label={t("product.brand")}>
                    <select
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                    >
                      {PRODUCT_BRANDS.map((b) => (
                        <option key={b} value={b}>
                          {b === "Other" ? t("common.other") : b}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("product.model")}>
                    <input
                      name="model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      required
                      maxLength={500}
                    />
                  </Field>
                </div>
                {brand === "Other" && (
                  <Field label={t("product.brand")}>
                    <input
                      name="custom_brand"
                      value={customBrand}
                      onChange={(e) => setCustomBrand(e.target.value)}
                      required
                      maxLength={500}
                    />
                  </Field>
                )}
                <div className="form-grid">
                  <Field label={t("product.condition")}>
                    <select name="condition" defaultValue="Used">
                      {["New", "Used", "Refurbished"].map((c) => (
                        <option key={c} value={c}>
                          {t(
                            "productForm." +
                              {
                                New: "conditionNew",
                                Used: "conditionUsed",
                                Refurbished: "conditionRefurb",
                              }[c],
                          )}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("resale.expectedPrice")}>
                    <NumericInput
                      name="selling_price"
                      min="0"
                      step="0.01"
                      placeholder={t("resale.priceLater")}
                    />
                  </Field>
                </div>
                <div className="form-grid">
                  {specOrder(category).map((k) => (
                    <Field
                      key={category + k}
                      label={
                        k === "Type"
                          ? t("product.accessoryType")
                          : specFieldLabel(t, k)
                      }
                    >
                      <input
                        name={"spec-" + k}
                        maxLength={200}
                        value={k === "Type" ? accessoryType : undefined}
                        onChange={(e) => {
                          if (k === "Type") setAccessoryType(e.target.value);
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <p className="help-note">{t("resale.newProductHint")}</p>
              </>
            ) : (
              <Field label={t("resale.findProduct")}>
                <input
                  aria-label={t("resale.findProduct")}
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setProduct("");
                  }}
                  placeholder={t("resale.findProduct")}
                />
                <select
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  required
                >
                  <option value="">{t("resale.chooseProduct")}</option>
                  {products.rows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.sku}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </section>
          <section className="resale-intake-section">
            <h3>{t("resale.ownerAgreement")}</h3>
            <div className="form-grid">
              <Field label={t("invoice.quantity")}>
                <NumericInput
                  name="quantity"
                  value={receiptQty}
                  onChange={(e) => setReceiptQty(e.target.value)}
                  min="1"
                  max="100000"
                  step="1"
                  required
                />
              </Field>
              <Field label={t("resale.ownerUnitAmount")}>
                <NumericInput name="amount" min="0" step="0.01" required />
              </Field>
              <Field label={t("common.date")}>
                <input
                  name="date"
                  type="date"
                  defaultValue={businessDate()}
                  max={businessDate()}
                  required
                />
              </Field>
              <Field label={t("resale.agreementNote")}>
                <input name="note" maxLength={500} />
              </Field>
            </div>
            {(newProduct
              ? ["Computers", "Mobiles", "Tablets"].includes(category)
              : products.rows.find((p) => p.id === product)?.serialized) && (
              <ReceiveDevices
                quantity={Number(receiptQty)}
                values={receiptUnits}
                onChange={setReceiptUnits}
              />
            )}
            <p className="help-note">{t("resale.intakeNote")}</p>
          </section>
          <ErrorMessage error={error || owners.error || products.error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-dark"
            disabled={
              busy ||
              (newProduct && photoBusy) ||
              (!newOwner && !owner) ||
              (!newProduct && !product)
            }
          >
            {t(busy ? "common.saving" : "resale.receive")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ResaleSettlementDialog({
  owner,
  close,
  done,
}: { owner: any } & DialogProps) {
  const { t } = useI18n();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  const recovery = owner.balance < 0;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("consignmentPay", {
        owner_id: owner.id,
        amount: toMoney(form.get("amount")),
        direction: recovery ? "recover" : "pay",
        date: form.get("date"),
        note: form.get("note"),
        request_key: key.current,
      });
      done(t("resale.settled"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(recovery ? "resale.recover" : "resale.payOwner")}
      subtitle={owner.name}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <p className="help-note">
            {t(recovery ? "resale.recoveryHint" : "resale.payoutHint")}
          </p>
          <p>
            {t("common.outstanding")}:{" "}
            <bdi dir="ltr">{af(Math.abs(owner.balance), 2)}</bdi>
          </p>
          <Field label={t("expense.amount")}>
            <NumericInput
              name="amount"
              min="0.01"
              max={Math.abs(owner.balance) / 100}
              step="0.01"
              defaultValue={(Math.abs(owner.balance) / 100).toFixed(2)}
              required
              autoFocus
            />
          </Field>
          <Field label={t("common.date")}>
            <input
              type="date"
              name="date"
              defaultValue={businessDate()}
              max={businessDate()}
              required
            />
          </Field>
          <Field label={t("resale.agreementNote")}>
            <textarea name="note" maxLength={500} rows={2} />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ResaleReturnDialog({
  batch,
  close,
  done,
}: { batch: any } & DialogProps) {
  const { t } = useI18n();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selectedUnits, setSelectedUnits] = useState<Device[]>([]);
  const key = useRef(requestKey());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("consignmentReturn", {
        batch_id: batch.id,
        quantity: batch.serialized
          ? selectedUnits.length
          : Number(form.get("quantity")),
        unit_ids: selectedUnits.map((u) => u.id),
        date: form.get("date"),
        note: form.get("note"),
        request_key: key.current,
      });
      done(t("resale.returned"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("resale.returnOwner")}
      subtitle={batch.name + " · " + batch.owner_name}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <p className="help-note">{t("resale.unsoldHint")}</p>
          {batch.serialized ? (
            <DeviceSelection
              product={{ ...batch, id: batch.product_id }}
              batchId={batch.id}
              selected={selectedUnits}
              onChange={setSelectedUnits}
            />
          ) : (
            <Field label={t("invoice.quantity")}>
              <NumericInput
                name="quantity"
                min="1"
                max={batch.remaining}
                step="1"
                defaultValue="1"
                required
              />
            </Field>
          )}
          <Field label={t("common.date")}>
            <input
              type="date"
              name="date"
              defaultValue={businessDate()}
              max={businessDate()}
              required
            />
          </Field>
          <Field label={t("resale.agreementNote")}>
            <textarea name="note" maxLength={500} rows={2} />
          </Field>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? t("common.saving") : t("resale.returnOwner")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
