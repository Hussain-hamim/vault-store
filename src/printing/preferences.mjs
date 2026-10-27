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
    const options = normalizePrintOptions(JSON.parse(saved), doc.kind);
    if (doc.billStyle !== "saleShop") options.template = "standard";
    return options;
  } catch {
    return normalizePrintOptions({}, doc.kind);
  }
}
