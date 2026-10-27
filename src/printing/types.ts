export type PrintOptions = {
  paper: string;
  layout: string;
  theme: string;
  orientation: string;
  margins: string;
  showLogo: boolean;
  showSpecs: boolean;
  showFooter: boolean;
};
export type PrintSource =
  | { type: "invoice"; id: string }
  | {
      type: "report";
      permission:
        "reports" | "finance" | "inventory" | "people" | "sales" | "purchases";
    };
export type PrintSection = {
  title?: string;
  note?: string;
  columns: { label: string; numeric?: boolean }[];
  rows: (string | number)[][];
  tones?: string[][];
  rawRows?: (string | number)[][];
};
export type PrintDocument = {
  kind: "invoice" | "report" | "label";
  companyCredit?: { label: string; whatsapp: string };
  title: string;
  reference?: string;
  subtitle?: string;
  locale: "en" | "ps" | "prs";
  source: PrintSource;
  store?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    logo?: string;
    bill_footer?: string;
  };
  metadata?: { label: string; value: string | number; numeric?: boolean }[];
  sections?: PrintSection[];
  summary?: { label: string; value: string | number; tone?: string }[];
  lines?: {
    name: string;
    identity: string;
    specs: string[];
    quantity: number;
    price: string;
    discount: string;
    total: string;
    costAed?: string;
    discountNote?: string;
  }[];
  lineLabels?: string[];
  purchase?: boolean;
  note?: string;
  endNote?: string;
  emptyLabel?: string;
  labels?: {
    name: string;
    model?: string;
    identity?: string;
    barcode: string;
    svg: string;
  }[];
  /** Suggested sticky-label copy count shown in print setup (label jobs). */
  labelCopies?: number;
};
