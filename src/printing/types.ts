export type PrintOptions = {
  template: string;
  showWatermark: boolean;
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
  /** Sale invoices use the shop bill chrome; others keep the standard header. */
  preferenceGroup?: string;
  billStyle?: "saleShop" | "standard";
  companyCredit?: { label: string; whatsapp: string };
  title: string;
  reference?: string;
  subtitle?: string;
  locale: "en" | "ps" | "prs";
  source: PrintSource;
  signatureLabel?: string;
  store?: {
    name?: string;
    name_ps?: string;
    address?: string;
    address_ps?: string;
    phone?: string;
    email?: string;
    logo?: string;
    logo_left?: string;
    logo_right?: string;
    services?: string;
    owner1_name?: string;
    owner1_phone?: string;
    owner1_whatsapp?: string;
    owner2_name?: string;
    owner2_phone?: string;
    owner2_whatsapp?: string;
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
