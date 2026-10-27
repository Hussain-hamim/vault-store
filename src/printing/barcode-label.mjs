import { canEncodeCode128, code128Svg } from "../barcode/code128.mjs";

/** One printable sticky label per copy, sized for barcode-label printers. */
export function barcodeLabelDocument(products, { t, locale, copies = 1 }) {
  const labels = [];
  const count = Math.max(1, Math.min(500, Math.floor(Number(copies) || 1)));
  for (const product of products) {
    const code = String(product.barcode || "").trim();
    if (!code || !canEncodeCode128(code)) continue;
    const svg = code128Svg(code, { height: 40, showText: true });
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
