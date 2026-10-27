import type { PrintDocument } from "./types";

export function barcodeLabelDocument(
  products: Array<{
    name?: string;
    brand?: string;
    model?: string;
    sku?: string;
    barcode?: string;
    stock?: number;
  }>,
  options: {
    t: (key: string, params?: Record<string, string | number>) => string;
    locale: "en" | "ps" | "prs";
    copies?: number;
  },
): PrintDocument;
