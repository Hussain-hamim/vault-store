import {
  DeviceSelection,
  ReceiveDevices,
  type Device,
  type DeviceDetails,
} from "./DeviceInventory";
import {
  PRODUCT_BRANDS,
  BUILTIN_PRODUCT_CATEGORIES,
  categoryLabel,
  specFieldLabel,
} from "./product-fields";
import { PartySearchSelect } from "./PartySearchSelect";
import { specOrder } from "../api";
import { trackedCategory } from "../../shared/product-categories.mjs";
import { useEffect, useRef, useState } from "react";
import {
  PlusIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
  MoneyIcon,
} from "@phosphor-icons/react";
import { api, af, businessDate, requestKey, toMoney, Party } from "../api";
import { useI18n } from "../i18n";
import { Empty, ErrorMessage, Field, Modal, NumericInput } from "./ui";
import type { PageProps } from "./Pages";
import "./resale.css";
type DialogProps = { close: () => void; done: (message: string) => void };
type IntakeLine = {
  key: string;
  name: string;
  category: string;
  brand: string;
  customBrand: string;
  model: string;
  accessoryType: string;
  condition: string;
  sellingPrice: string;
  quantity: string;
  ownerAmount: string;
  specs: Record<string, string>;
  showSpecs: boolean;
  units: DeviceDetails[];
};
function blankIntakeLine(): IntakeLine {
  return {
    key: requestKey(),
    name: "",
    category: "Computers",
    brand: "Dell",
    customBrand: "",
    model: "",
    accessoryType: "",
    condition: "Used",
    sellingPrice: "",
    quantity: "1",
    ownerAmount: "",
    specs: {},
    showSpecs: false,
    units: [],
  };
}
type ResaleView = "stock" | "owners" | "payments";
export function CustomerResalePage({ refresh, open, user }: PageProps) {
  const { t } = useI18n();
  const [view, setView] = useState<ResaleView>("stock"),
    [q, setQ] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [summary, setSummary] = useState<any>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const activeKey = useRef("");
  const query = q.trim();
  const signature = view + "-" + query + "-" + refresh;
  activeKey.current = signature;
  const canManagePayments =
    ["Owner", "Manager"].includes(user.role) &&
    user.permissions.includes("finance");
  function switchView(nextView: ResaleView) {
    if (view === nextView) return;
    setLoading(true);
    setQ("");
    setView(nextView);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setNext(null);
    setError("");
    setBusy(false);
    const timer = setTimeout(
      () =>
        api("consignments", { view, q: query })
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
          }),
      query ? 160 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [view, query, refresh]);
  async function more() {
    const key = signature;
    setBusy(true);
    try {
      const data = await api("consignments", { view, q: query, after: next });
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
      <div className="resale-topbar">
        <div className="resale-summary">
          <article>
            <span>{t("resale.stockHeld")}</span>
            <strong>{summary ? summary.held_units : "—"}</strong>
          </article>
          <article>
            <span>{t("resale.owedToOwners")}</span>
            <strong className="text-red">
              <bdi dir="ltr">{summary ? af(summary.due, 2) : "—"}</bdi>
            </strong>
          </article>
          <article>
            <span>{t("resale.recoverable")}</span>
            <strong className="text-green">
              <bdi dir="ltr">
                {summary ? af(summary.recoverable, 2) : "—"}
              </bdi>
            </strong>
          </article>
        </div>
        <div
          className="sales-tabs resale-top-tabs"
          role="tablist"
          aria-label={t("resale.title")}
        >
          <button
            role="tab"
            aria-selected={view === "stock"}
            onClick={() => switchView("stock")}
          >
            {t("resale.stockHeld")}
          </button>
          <button
            role="tab"
            aria-selected={view === "owners"}
            onClick={() => switchView("owners")}
          >
            {t("resale.ownerBalances")}
          </button>
          <button
            role="tab"
            aria-selected={view === "payments"}
            onClick={() => switchView("payments")}
          >
            {t("resale.paymentHistory")}
          </button>
        </div>
        {user.permissions.includes("inventory") && (
          <button
            className="button button-dark resale-receive-btn"
            onClick={() => open("consignmentReceive")}
          >
            <PlusIcon size={16} />
            {t("resale.receive")}
          </button>
        )}
      </div>
      <div className="resale-toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            view === "stock"
              ? t("resale.searchStock")
              : view === "owners"
                ? t("resale.searchOwners")
                : t("resale.searchPayments")
          }
          aria-label={
            view === "stock"
              ? t("resale.searchStock")
              : view === "owners"
                ? t("resale.searchOwners")
                : t("resale.searchPayments")
          }
        />
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
                  <div className="resale-owner-line">
                    <strong className="resale-owner-name">
                      {row.owner_name}
                    </strong>
                    <small>{row.received_date}</small>
                  </div>
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
            ) : view === "owners" ? (
              <article className="resale-row" key={row.id}>
                <div>
                  <strong className="resale-owner-name">{row.name}</strong>
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
            ) : (
              <article className="resale-row" key={row.id}>
                <div>
                  <strong>{row.number}</strong>
                  <small>
                    {row.date} ·{" "}
                    {t(
                      row.kind === "consignment_recovery"
                        ? "resale.recovery"
                        : "resale.pay",
                    )}
                  </small>
                  <div className="resale-owner-line">
                    <strong className="resale-owner-name">
                      {row.party_name}
                    </strong>
                    <small>{row.phone || "—"}</small>
                  </div>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
                <div>
                  <small>{t("expense.amount")}</small>
                  <strong
                    className={
                      row.kind === "consignment_recovery"
                        ? "text-green"
                        : "text-red"
                    }
                  >
                    <bdi dir="ltr">{af(row.total, 2)}</bdi>
                  </strong>
                </div>
                <button
                  className="button"
                  onClick={() =>
                    open("invoice", { id: row.id, kind: row.kind })
                  }
                >
                  {t("common.view")}
                </button>
                {canManagePayments && (
                  <>
                    <button
                      className="button"
                      onClick={() =>
                        open("consignmentSettlement", {
                          id: row.party_id,
                          name: row.party_name,
                          phone: row.phone,
                          balance: row.owner_balance,
                          payment: row,
                        })
                      }
                    >
                      {t("resale.editPayment")}
                    </button>
                    <button
                      className="button danger-text"
                      onClick={() =>
                        open("paymentDelete", {
                          id: row.id,
                          kind: row.kind,
                        })
                      }
                    >
                      <TrashIcon size={15} />
                      {t("resale.deletePayment")}
                    </button>
                  </>
                )}
              </article>
            ),
          )}
        </div>
      )}
      {!loading && !rows.length && !error && (
        <Empty
          title={t(
            view === "payments" ? "resale.emptyPayments" : "resale.empty",
          )}
          text={t(
            view === "payments"
              ? "resale.emptyPaymentsHint"
              : "resale.emptyHint",
          )}
        />
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
    [selectedOwner, setSelectedOwner] = useState<Party | null>(party || null),
    [ownerName, setOwnerName] = useState(""),
    [ownerPhone, setOwnerPhone] = useState(""),
    [date, setDate] = useState(businessDate()),
    [note, setNote] = useState(""),
    [lines, setLines] = useState<IntakeLine[]>([blankIntakeLine()]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(requestKey());
  function patchLine(lineKey: string, patch: Partial<IntakeLine>) {
    setLines((rows) =>
      rows.map((row) => (row.key === lineKey ? { ...row, ...patch } : row)),
    );
  }
  function patchSpec(lineKey: string, specKey: string, value: string) {
    setLines((rows) =>
      rows.map((row) =>
        row.key === lineKey
          ? {
              ...row,
              accessoryType: specKey === "Type" ? value : row.accessoryType,
              specs: { ...row.specs, [specKey]: value },
            }
          : row,
      ),
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!newOwner && !selectedOwner?.id)
        throw new Error(t("resale.chooseOwner"));
      await api("consignmentReceive", {
        ...(newOwner
          ? { new_owner: { name: ownerName, phone: ownerPhone } }
          : { owner_id: selectedOwner!.id }),
        date,
        note,
        lines: lines.map((line) => {
          const qty = Number(line.quantity);
          const attributes = Object.fromEntries(
            specOrder(line.category)
              .map((k) => [
                k,
                k === "Type"
                  ? line.accessoryType
                  : String(line.specs[k] || ""),
              ])
              .filter(([, v]) => v),
          );
          return {
            new_product: {
              name: line.name,
              brand: line.brand === "Other" ? line.customBrand : line.brand,
              model: line.model,
              category: line.category,
              serialized: trackedCategory(line.category),
              price: toMoney(line.sellingPrice),
              condition: line.condition,
              attributes,
            },
            quantity: qty,
            owner_unit_amount: toMoney(line.ownerAmount),
            units: trackedCategory(line.category)
              ? Array.from({ length: qty }, (_, i) => line.units[i] || {})
              : undefined,
          };
        }),
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
      className="resale-receive-modal"
    >
      <form onSubmit={submit} className="resale-receive-form">
        <div className="form-body resale-intake resale-intake-compact">
          <section className="resale-intake-section resale-intake-owner">
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
            <div
              className={
                "form-grid four resale-owner-row" +
                (newOwner ? "" : " existing-owner")
              }
            >
              {newOwner ? (
                <>
                  <Field label={t("resale.ownerName")}>
                    <input
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      required
                      minLength={2}
                      maxLength={500}
                    />
                  </Field>
                  <Field label={t("common.phone")}>
                    <input
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                      type="tel"
                      maxLength={500}
                    />
                  </Field>
                </>
              ) : (
                <Field label={t("sales.customer")}>
                  <PartySearchSelect
                    kind="customer"
                    value={selectedOwner?.id || ""}
                    selected={selectedOwner}
                    onChange={setSelectedOwner}
                    placeholder={t("people.searchCustomers")}
                    excludeWalkIn
                    required
                  />
                </Field>
              )}
              <Field label={t("common.date")}>
                <input
                  type="date"
                  value={date}
                  max={businessDate()}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>
              <Field label={t("resale.agreementNote")}>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </section>
          <div className="resale-intake-lines">
            {lines.map((line, index) => {
              const serialized = trackedCategory(line.category);
              return (
                <section
                  className="resale-intake-section resale-intake-line"
                  key={line.key}
                >
                  <div className="resale-intake-heading">
                    <h3>
                      {t("invoice.product")}
                      {lines.length > 1 ? ` ${index + 1}` : ""}
                    </h3>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t("resale.removeProduct")}
                        onClick={() =>
                          setLines((rows) =>
                            rows.filter((row) => row.key !== line.key),
                          )
                        }
                      >
                        <TrashIcon size={16} />
                      </button>
                    )}
                  </div>
                  <div className="form-grid four">
                    <Field label={t("product.name")}>
                      <input
                        value={line.name}
                        onChange={(e) =>
                          patchLine(line.key, { name: e.target.value })
                        }
                        required
                        minLength={2}
                        maxLength={500}
                      />
                    </Field>
                    <Field label={t("product.category")}>
                      <select
                        value={line.category}
                        onChange={(e) =>
                          patchLine(line.key, {
                            category: e.target.value,
                            accessoryType: "",
                            specs: {},
                            units: [],
                            showSpecs: !!specOrder(e.target.value, "").length,
                          })
                        }
                      >
                        {BUILTIN_PRODUCT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(t, c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("product.brand")}>
                      <select
                        value={line.brand}
                        onChange={(e) =>
                          patchLine(line.key, { brand: e.target.value })
                        }
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
                        value={line.model}
                        onChange={(e) =>
                          patchLine(line.key, { model: e.target.value })
                        }
                        required
                        maxLength={500}
                      />
                    </Field>
                  </div>
                  {line.brand === "Other" && (
                    <Field label={t("product.brand")}>
                      <input
                        value={line.customBrand}
                        onChange={(e) =>
                          patchLine(line.key, {
                            customBrand: e.target.value,
                          })
                        }
                        required
                        maxLength={500}
                      />
                    </Field>
                  )}
                  <div className="form-grid four">
                    <Field label={t("product.condition")}>
                      <select
                        value={line.condition}
                        onChange={(e) =>
                          patchLine(line.key, { condition: e.target.value })
                        }
                      >
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
                    <Field label={t("resale.expectedPriceShort")}>
                      <NumericInput
                        value={line.sellingPrice}
                        onChange={(e) =>
                          patchLine(line.key, {
                            sellingPrice: e.target.value,
                          })
                        }
                        min="0"
                        step="0.01"
                        placeholder={t("resale.priceLater")}
                      />
                    </Field>
                    <Field label={t("invoice.quantity")}>
                      <NumericInput
                        value={line.quantity}
                        onChange={(e) =>
                          patchLine(line.key, {
                            quantity: e.target.value,
                            units: [],
                          })
                        }
                        min="1"
                        max="100000"
                        step="1"
                        required
                      />
                    </Field>
                    <Field label={t("resale.ownerUnitAmount")}>
                      <NumericInput
                        value={line.ownerAmount}
                        onChange={(e) =>
                          patchLine(line.key, {
                            ownerAmount: e.target.value,
                          })
                        }
                        min="0"
                        step="0.01"
                        required
                      />
                    </Field>
                  </div>
                  {!!specOrder(line.category, line.accessoryType).length && (
                    <div className="resale-line-extras">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          patchLine(line.key, { showSpecs: !line.showSpecs })
                        }
                      >
                        {line.showSpecs
                          ? t("resale.hideSpecs")
                          : t("resale.showSpecs")}
                      </button>
                      {serialized && (
                        <ReceiveDevices
                          quantity={Number(line.quantity) || 0}
                          values={line.units}
                          onChange={(units) =>
                            patchLine(line.key, { units })
                          }
                          defaultCondition={line.condition}
                        />
                      )}
                    </div>
                  )}
                  {line.showSpecs && (
                    <div className="form-grid four">
                      {specOrder(line.category, line.accessoryType).map((k) => (
                        <Field
                          key={line.key + k}
                          label={
                            k === "Type"
                              ? line.category === "Cameras"
                                ? t("product.cameraType")
                                : t("product.accessoryType")
                              : specFieldLabel(t, k)
                          }
                        >
                          <input
                            maxLength={200}
                            value={
                              k === "Type"
                                ? line.accessoryType
                                : line.specs[k] || ""
                            }
                            onChange={(e) =>
                              patchSpec(line.key, k, e.target.value)
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                  {!specOrder(line.category, line.accessoryType).length &&
                    serialized && (
                    <ReceiveDevices
                      quantity={Number(line.quantity) || 0}
                      values={line.units}
                      onChange={(units) => patchLine(line.key, { units })}
                      defaultCondition={line.condition}
                    />
                  )}
                </section>
              );
            })}
          </div>
          <button
            type="button"
            className="button resale-add-product"
            onClick={() => setLines((rows) => [...rows, blankIntakeLine()])}
          >
            <PlusIcon size={15} />
            {t("resale.addProduct")}
          </button>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className="button button-dark"
            disabled={busy || (!newOwner && !selectedOwner?.id)}
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
  const payment = owner.payment;
  const editing = !!payment?.id;
  const recovery = editing
    ? payment.kind === "consignment_recovery"
    : owner.balance < 0;
  const available = editing
    ? Math.abs(owner.balance || 0) + (payment.total || 0)
    : Math.abs(owner.balance || 0);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (editing) {
        await api("consignmentPayEdit", {
          id: payment.id,
          revision: payment.revision,
          amount: toMoney(form.get("amount")),
          date: form.get("date"),
          note: form.get("note"),
          request_key: key.current,
        });
        done(t("resale.paymentUpdated"));
      } else {
        await api("consignmentPay", {
          owner_id: owner.id,
          amount: toMoney(form.get("amount")),
          direction: recovery ? "recover" : "pay",
          date: form.get("date"),
          note: form.get("note"),
          request_key: key.current,
        });
        done(t("resale.settled"));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(
        editing
          ? "resale.editPayment"
          : recovery
            ? "resale.recover"
            : "resale.payOwner",
      )}
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
            <bdi dir="ltr">{af(available, 2)}</bdi>
          </p>
          <Field label={t("expense.amount")}>
            <NumericInput
              name="amount"
              min="0.01"
              max={available / 100}
              step="0.01"
              defaultValue={(
                (editing ? payment.total : available) / 100
              ).toFixed(2)}
              required
              autoFocus
            />
          </Field>
          <Field label={t("common.date")}>
            <input
              type="date"
              name="date"
              defaultValue={editing ? payment.date : businessDate()}
              max={businessDate()}
              required
            />
          </Field>
          <Field label={t("resale.agreementNote")}>
            <textarea
              name="note"
              maxLength={500}
              rows={2}
              defaultValue={editing ? payment.note || "" : ""}
            />
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
