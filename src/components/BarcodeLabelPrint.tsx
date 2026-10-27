import { useEffect, useState } from "react";
import { BarcodeIcon, PrinterIcon } from "@phosphor-icons/react";
import { api, type Product } from "../api";
import { useI18n } from "../i18n";
import { Modal, Field, NumericInput, ErrorMessage, Search } from "./ui";
import { canEncodeQr } from "../barcode/qrcode.mjs";
import { generateProductBarcode } from "../barcode/generate.mjs";
import { barcodeLabelDocument } from "../printing/barcode-label.mjs";
import { PrintDialog } from "../printing/PrintDialog";
import type { PrintDocument } from "../printing/types";

async function ensureBarcode(product: Product) {
  const code = String(product.barcode || "").trim();
  if (code && canEncodeQr(code)) return product;
  const next = generateProductBarcode();
  const result = await api<{ product: Product }>("productUpdate", {
    id: product.id,
    name: product.name,
    brand: product.brand,
    model: product.model,
    sku: product.sku,
    barcode: next,
    category: product.category,
    price: product.price,
    minimum: product.minimum ?? 0,
    location: product.location || "",
    reorder_level: product.reorder_level,
    condition: product.condition || "New",
    warranty: product.warranty || "",
    attributes: product.attributes || {},
    currency: product.currency || "AED",
    cost_foreign: product.cost_foreign ?? product.cost_aed ?? 0,
    cost_aed: product.cost_aed ?? 0,
    cargo_rent: product.cargo_rent ?? 0,
    fx_rate: product.fx_rate ?? 0,
    unit_cost: product.unit_cost,
  });
  return result.product;
}

export function BarcodeLabelPrintModal({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: Product | null;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(initial || null);
  const [copies, setCopies] = useState(
    String(Math.max(1, initial?.stock || 1)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<PrintDocument | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<{ rows: Product[] }>("listProducts", { q, limit: 10 })
        .then((r) => {
          if (active) setRows(r.rows || []);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q]);

  async function print() {
    if (!selected) {
      setError(t("barcode.pickProduct"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const product = await ensureBarcode(selected);
      setSelected(product);
      const n = Math.max(1, Math.min(500, Number(copies) || 1));
      setDoc(barcodeLabelDocument([product], { t, locale, copies: n }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={t("barcode.printStation")}
        subtitle={t("barcode.printStationHint")}
        onClose={onClose}
      >
        <div className="form-body">
          <Field label={t("barcode.pickProduct")}>
            <Search
              value={q}
              onChange={setQ}
              placeholder={t("inventory.searchPh")}
            />
          </Field>
          <div className="barcode-pick-list" role="listbox">
            {rows.map((p) => (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={selected?.id === p.id}
                className={
                  "barcode-pick-row" +
                  (selected?.id === p.id ? " selected" : "")
                }
                onClick={() => {
                  setSelected(p);
                  setCopies(String(Math.max(1, p.stock || 1)));
                  setError("");
                }}
              >
                <strong>{p.name}</strong>
                <small>
                  {[p.brand, p.model, p.sku, p.barcode]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <span>
                  {t("inventory.qty")}: {p.stock}
                </span>
              </button>
            ))}
            {!rows.length && <p className="muted">{t("common.noResults")}</p>}
          </div>
          <div className="form-grid two">
            <Field label={t("barcode.copies")}>
              <NumericInput
                min="1"
                max="500"
                step="1"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </Field>
            <Field label={t("product.barcode")}>
              <input
                readOnly
                dir="ltr"
                value={selected?.barcode || t("barcode.willGenerate")}
              />
            </Field>
          </div>
          <p className="muted">{t("barcode.thermalHint")}</p>
          <ErrorMessage error={error} />
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="button button-dark"
            disabled={busy || !selected}
            onClick={() => void print()}
          >
            <PrinterIcon size={15} />
            {busy ? t("printing.preparing") : t("barcode.print")}
          </button>
        </div>
      </Modal>
      {doc && (
        <PrintDialog
          document={doc}
          onClose={() => {
            setDoc(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function BarcodeCopiesDialog({
  product,
  defaultCopies,
  onClose,
  onReady,
}: {
  product: Pick<
    Product,
    "name" | "brand" | "model" | "sku" | "barcode" | "stock"
  >;
  defaultCopies?: number;
  onClose: () => void;
  onReady: (copies: number) => void;
}) {
  const { t } = useI18n();
  const [copies, setCopies] = useState(
    String(
      Math.max(1, defaultCopies ?? (product.stock > 0 ? product.stock : 1)),
    ),
  );
  return (
    <Modal title={t("barcode.print")} onClose={onClose}>
      <div className="form-body">
        <p>
          <strong>{product.name}</strong>
        </p>
        <p className="muted">
          {[product.brand, product.model, product.sku, product.barcode]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Field label={t("barcode.copies")}>
          <NumericInput
            min="1"
            max="500"
            step="1"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            autoFocus
          />
        </Field>
        <p className="muted">{t("barcode.copiesHint")}</p>
        <p className="muted">{t("barcode.thermalHint")}</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="button button-dark"
          onClick={() =>
            onReady(Math.max(1, Math.min(500, Number(copies) || 1)))
          }
        >
          <BarcodeIcon size={15} />
          {t("barcode.continuePrint")}
        </button>
      </div>
    </Modal>
  );
}
