import { useEffect, useRef, useState } from "react";
import {
  api,
  af,
  moneyInput,
  toMoney,
  normalizeDigits,
  type Product,
} from "../api";
import { useT } from "../i18n";
import { Field, NumericInput, ErrorMessage } from "./ui";
import "./device-inventory.css";
export type DeviceDetails = {
  serial?: string;
  condition?: string;
  battery?: string;
  notes?: string;
  accessories?: string;
  price?: number;
};
export type Device = DeviceDetails & {
  id: string;
  code: string;
  status: string;
  unit_cost?: number;
  return_cost?: number;
  returnable?: boolean;
};
export function ReceiveDevices({
  quantity,
  values = [],
  onChange,
  defaultCondition = "New",
}: {
  quantity: number;
  defaultCondition?: string;
  values?: DeviceDetails[];
  onChange: (v: DeviceDetails[]) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false),
    [shown, setShown] = useState(10);
  const count = Math.max(0, Math.min(1000, Math.floor(quantity)));
  function update(i: number, k: keyof DeviceDetails, value: any) {
    const rows = Array.from({ length: count }, (_, n) => values[n] || {});
    rows[i] = { ...rows[i], [k]: value };
    onChange(rows);
  }
  return (
    <section className="device-receipt">
      <button
        type="button"
        className="button"
        title={t("devices.serialOptional")}
        onClick={() => setExpanded(!expanded)}
      >
        {t("devices.details")} ({count})
      </button>
      {expanded && (
        <>
          {Array.from({ length: Math.min(count, shown) }, (_, i) => (
            <div className="device-detail-row" key={i}>
              <strong>
                {t("devices.device")} {i + 1}
              </strong>
              <div className="form-grid three">
                <Field label={t("devices.serial")}>
                  <input
                    value={values[i]?.serial || ""}
                    maxLength={120}
                    onChange={(e) =>
                      update(i, "serial", normalizeDigits(e.target.value))
                    }
                  />
                </Field>
                <Field label={t("product.condition")}>
                  <select
                    value={values[i]?.condition || defaultCondition}
                    onChange={(e) => update(i, "condition", e.target.value)}
                  >
                    {["New", "Used", "Refurbished"].map((v, n) => (
                      <option value={v} key={v}>
                        {t(
                          [
                            "productForm.conditionNew",
                            "productForm.conditionUsed",
                            "productForm.conditionRefurb",
                          ][n],
                        )}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("devices.battery")}>
                  <input
                    value={values[i]?.battery || ""}
                    maxLength={100}
                    onChange={(e) => update(i, "battery", e.target.value)}
                  />
                </Field>
                <Field label={t("devices.notes")}>
                  <input
                    value={values[i]?.notes || ""}
                    maxLength={1000}
                    onChange={(e) => update(i, "notes", e.target.value)}
                  />
                </Field>
                <Field label={t("devices.accessories")}>
                  <input
                    value={values[i]?.accessories || ""}
                    maxLength={500}
                    onChange={(e) => update(i, "accessories", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}
          {count > shown && (
            <button
              type="button"
              className="button"
              onClick={() => setShown((n) => n + 10)}
            >
              {t("common.loadMore")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function DeviceSelection({
  product,
  selected,
  onChange,
  saleId,
  batchId,
}: {
  product: Product;
  selected: Device[];
  onChange: (v: Device[]) => void;
  saleId?: string;
  batchId?: string;
}) {
  const request = useRef(0);
  const t = useT();
  const [rows, setRows] = useState<Device[]>([]),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [next, setNext] = useState<number | null>(null),
    [loading, setLoading] = useState(false);
  async function load(offset = 0) {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const r = await api<{ rows: Device[]; next: number | null }>("devices", {
        product_id: product.id,
        q,
        offset,
        sale_id: saleId,
        batch_id: batchId,
      });
      if (ticket !== request.current) return;
      setRows((v) => (offset ? [...v, ...r.rows] : r.rows));
      setNext(r.next);
    } catch (e: any) {
      if (ticket === request.current) setError(e.message);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void load();
    }, 180);
    return () => {
      active = false;
      request.current++;
      clearTimeout(timer);
    };
  }, [product.id, q, saleId, batchId]);
  return (
    <section className="device-selection">
      <strong>
        {t("devices.choose")} ({selected.length})
      </strong>
      <input
        aria-label={t("devices.search")}
        placeholder={t("devices.search")}
        value={q}
        onChange={(e) => setQ(normalizeDigits(e.target.value))}
      />
      <ErrorMessage error={error} />
      <div className="device-options">
        {rows.map((u) => (
          <label className="device-option" key={u.id}>
            <input
              type="checkbox"
              checked={selected.some((v) => v.id === u.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, u]
                    : selected.filter((v) => v.id !== u.id),
                )
              }
            />
            <span>
              <b>
                <bdi dir="ltr">{u.serial || u.code}</bdi>
              </b>
              <small>
                {[u.condition, u.battery, u.notes, u.accessories]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {u.price !== undefined && (
                <small>
                  {t("product.sellingPrice")}:{" "}
                  <bdi dir="ltr">{af(u.price, 2)}</bdi>
                </small>
              )}
              {u.unit_cost !== undefined && (
                <small>
                  {t("inventory.unitCost")}:{" "}
                  <bdi dir="ltr">{af(u.unit_cost, 2)}</bdi>
                </small>
              )}
            </span>
          </label>
        ))}
        {!loading && !rows.length && !error && <p>{t("devices.none")}</p>}
      </div>
      {next !== null && (
        <button
          type="button"
          className="button"
          disabled={loading}
          onClick={() => void load(next)}
        >
          {t("common.loadMore")}
        </button>
      )}
    </section>
  );
}
export function ProductDevices({ product }: { product: Product }) {
  const t = useT();
  const [selected, setSelected] = useState<Device[]>([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Device | null>(null);
  const [price, setPrice] = useState("");
  return (
    <div>
      <DeviceSelection
        key={revision}
        product={product}
        selected={selected}
        onChange={(rows) => {
          const u = rows.at(-1) || null;
          setSelected(u ? [u] : []);
          setForm(u);
          setPrice(moneyInput(u?.price || 0));
          setError("");
        }}
      />
      {form && (
        <form
          className="device-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await api("unitUpdate", { ...form, price: toMoney(price) });
              setForm(null);
              setSelected([]);
              setRevision((n) => n + 1);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <ReceiveDevices
            defaultCondition={form.condition}
            quantity={1}
            values={[form]}
            onChange={(v) => setForm({ ...form, ...v[0] })}
          />
          <Field label={t("product.sellingPrice")}>
            <NumericInput
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <ErrorMessage error={error} />
          <button className="button button-dark" disabled={saving}>
            {t("productForm.saveChanges")}
          </button>
        </form>
      )}
    </div>
  );
}
