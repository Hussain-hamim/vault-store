import { normalizePrintOptions } from "../../server/print-options.mjs";
export function printPreferenceKey(doc) {
  return `vault-print-${doc.preferenceGroup || (doc.billStyle === "saleShop" ? "sale" : doc.kind)}-v2`;
}
export function readPrintPreferences(doc, storage = globalThis.localStorage) {
  try {
    const saved =
      storage?.getItem(printPreferenceKey(doc)) ??
      storage?.getItem(`vault-print-${doc.kind}-v1`) ??
      "{}";
    const parsed = JSON.parse(saved);
    const options = normalizePrintOptions(parsed, doc.kind);
    if (doc.billStyle !== "saleShop") options.template = "standard";
    else if (parsed.template !== "standard") options.template = "golden";
    return options;
  } catch {
    const options = normalizePrintOptions({}, doc.kind);
    if (doc.billStyle === "saleShop") options.template = "golden";
    return options;
  }
}
