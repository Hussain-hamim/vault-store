import { canEncodeQr, qrSvg } from "../barcode/qrcode.mjs";

/** One printable sticky QR label per copy (29×18 mm thermal stock). */
export function barcodeLabelDocument(products, { t, locale, copies = 1 }) {
  const labels = [];
  const count = Math.max(1, Math.min(500, Math.floor(Number(copies) || 1)));
  for (const product of products) {
    const code = String(product.barcode || "").trim();
    if (!code || !canEncodeQr(code)) continue;
    const svg = qrSvg(code, { margin: 1 });
    for (let i = 0; i < count; i++) {
      labels.push({
        name: product.name || "",
        identity: [product.brand, product.model, product.sku]
          .filter(Boolean)
          .join(" · "),
        barcode: code,
        svg,
      });
    }
  }
  return {
    kind: "label",
    locale,
    title: t("barcode.labelsTitle"),
    subtitle: t("barcode.labelsSubtitle", { n: labels.length }),
    source: { type: "report", permission: "inventory" },
    labels,
    emptyLabel: t("barcode.noLabels"),
    endNote: t("barcode.labelsHint"),
  };
}
