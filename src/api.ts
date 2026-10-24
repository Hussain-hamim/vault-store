import { serializeCSV } from "./printing/csv.mjs";
export type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  permissions: string[];
};
export type Product = {
  id: string;
  name: string;
  sku: string;
  brand: string;
  model: string;
  category: string;
  price: number;
  minimum: number;
  reorder_level: number;
  stock: number;
  consignment_stock?: number;
  image: string;
  barcode: string;
  location: string;
  condition: string;
  warranty: string;
  attributes: Record<string, string>;
  cost?: number;
  unit_cost?: number;
  /** Dubai supplier unit cost in fils (AED × 100). */
  cost_aed?: number;
  cost_foreign?: number;
  currency?: string;
  /** AFN per 1 AED, scaled by 10_000 (e.g. 18.5 → 185000). */
  fx_rate?: number;
};
export type Party = {
  id: string;
  kind: "customer" | "supplier";
  name: string;
  phone: string;
  email: string;
  address: string;
  balance: number;
  walk_in: number;
};

/** Ordered attribute keys by product category for bills / inventory. */
export function specOrder(category?: string) {
  if (category === "Computers")
    return ["CPU", "RAM", "Storage", "GPU", "Display", "Color"];
  if (category === "Mobiles" || category === "Tablets")
    return ["RAM", "Storage", "Color", "Connectivity"];
  if (category === "Storage") return ["Storage", "Interface"];
  if (category === "Accessories") return ["Type"];
  return [] as string[];
}

export function productSpecEntries(product: {
  category?: string;
  attributes?: Record<string, string> | string | null;
}) {
  const raw = product.attributes;
  const attrs =
    typeof raw === "string"
      ? (JSON.parse(raw || "{}") as Record<string, string>)
      : raw || {};
  const ordered = specOrder(product.category);
  const seen = new Set<string>();
  const specs: { key: string; value: string }[] = [];
  for (const key of ordered) {
    const value = attrs[key];
    if (value) {
      specs.push({ key, value });
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (value && !seen.has(key)) specs.push({ key, value });
  }
  return specs;
}

export function productDetailLine(product: {
  brand?: string;
  model?: string;
  sku?: string;
  category?: string;
  attributes?: Record<string, string> | string | null;
}) {
  const identity = [product.brand, product.model, product.sku]
    .filter(Boolean)
    .join(" · ");
  const specs = productSpecEntries(product)
    .map((s) => `${s.key}: ${s.value}`)
    .join(" · ");
  return [identity, specs].filter(Boolean).join(" · ");
}
declare global {
  interface Window {
    vault?: {
      request: (command: string, args: unknown, token?: string) => Promise<any>;
      openExternal?: (url: string) => Promise<void>;
      pickFolder: () => Promise<string | null>;
      pickBackup: () => Promise<string | null>;
      restore: (path: string, token: string) => Promise<any>;
      installSchedule: (token: string) => Promise<any>;
      renderPrint: (job: unknown, token: string) => Promise<any>;
    };
  }
}
function readStoredToken() {
  try {
    return (
      localStorage.getItem("vault-session") ||
      sessionStorage.getItem("vault-session") ||
      ""
    );
  } catch {
    return "";
  }
}
let token = readStoredToken();
export function getToken() {
  return token || readStoredToken();
}
export function setToken(value: string) {
  if (token !== value) window.dispatchEvent(new Event("radefy-photos-reset"));
  token = value;
  try {
    if (value) {
      localStorage.setItem("vault-session", value);
      sessionStorage.removeItem("vault-session");
    } else {
      localStorage.removeItem("vault-session");
      sessionStorage.removeItem("vault-session");
    }
  } catch {
    /* private mode / storage blocked */
  }
}
export async function api<T = any>(
  command: string,
  args: unknown = {},
): Promise<T> {
  try {
    if (window.vault) return await window.vault.request(command, args, token);
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, args, token }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  } catch (e: any) {
    if (e.message?.includes("SESSION_EXPIRED"))
      window.dispatchEvent(new Event("vault-session-expired"));
    throw e;
  }
}
export const requestKey = () => crypto.randomUUID();
export const businessDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const af = (amount = 0, decimals = 0) =>
  `AF ${new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(amount / 100)}`;
export const foreignMoney = (amount = 0, code = "AED", decimals = 2) =>
  `${code} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(amount / 100)}`;
export const aed = (amount = 0, decimals = 2) =>
  `AED ${new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(amount / 100)}`;
export const shortMoney = (amount = 0) => {
  const n = amount / 100;
  return n >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}K`
      : n.toFixed(0);
};
/**
 * Map Eastern Arabic-Indic (٠-٩) and Persian/Pashto (۰-۹) digits to ASCII 0-9.
 * Also normalizes Arabic decimal/thousands separators so amount fields work
 * when the OS keyboard layout is Pashto or Dari.
 */
export function normalizeDigits(value: string): string {
  return String(value ?? "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "");
}

/** Keep a typed amount/qty string as ASCII digits (and optional sign/dot). */
export function sanitizeNumericInput(
  value: string,
  kind: "decimal" | "integer" | "signed-decimal" | "signed-integer" = "decimal",
): string {
  let s = normalizeDigits(value).replace(/,/g, "");
  const signed = kind.startsWith("signed");
  const integer = kind.endsWith("integer");
  let sign = "";
  if (signed && s.startsWith("-")) {
    sign = "-";
    s = s.slice(1);
  } else if (signed && s.startsWith("+")) {
    s = s.slice(1);
  }
  if (integer) return sign + s.replace(/[^\d]/g, "");
  s = s.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return sign + s;
}

export function toMoney(value: FormDataEntryValue | null | string) {
  const s = normalizeDigits(String(value ?? "0"))
    .trim()
    .replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("Amount is too large.");
  return n;
}
/** Parse AFN-per-AED rate into a scaled integer (×10_000). */
export function toFxRate(value: FormDataEntryValue | null | string) {
  const s = normalizeDigits(String(value ?? ""))
    .trim()
    .replace(/,/g, "");
  if (!s) return 0;
  if (!/^\d+(\.\d{1,4})?$/.test(s))
    throw new Error("Enter the exchange rate with up to four decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("Exchange rate must be greater than zero.");
  return n;
}
export const fxRateLabel = (rate = 0, currency = "AED") =>
  rate
    ? `${(rate / 10_000).toLocaleString("en-US", { maximumFractionDigits: 4 })} AFN / ${currency}`
    : "—";
export function afnFromAed(aedMinor = 0, rateScaled = 0) {
  if (!aedMinor || !rateScaled) return 0;
  return Math.round((aedMinor * rateScaled) / 10_000);
}
export function moneyInput(amount = 0) {
  return (amount / 100).toFixed(2);
}
export function fxRateInput(rate = 0) {
  if (!rate) return "";
  const n = rate / 10_000;
  return Number.isInteger(n) ? String(n) : String(n);
}
export function exportCSV(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const blob = new Blob([serializeCSV(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sendPrintJob(job: unknown) {
  if (!window.vault?.renderPrint)
    throw new Error("Desktop print service is unavailable.");
  return window.vault.renderPrint(job, token);
}
