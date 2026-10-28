import { autoDirHtml, ltrPhoneHtml, mixedHtml, westernDigits } from "./bidi.mjs";
import { contactGlyph, goldenSale, goldenCss } from "./golden.mjs";
import brand from "../../shared/brand.json" with { type: "json" };
import { supportLinks } from "../../server/support.mjs";
import {
  COMPANY_LOGO_HOOK,
  COMPANY_LOGO_LEG,
} from "../../shared/company-logo.mjs";
import {
  normalizePrintOptions,
  printGeometry,
  PRINT_THEMES,
} from "../../server/print-options.mjs";
export const escapePrintText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function safePrintLogo(value) {
  return typeof value === "string" &&
    value.length <= 3_000_000 &&
    /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(value)
    ? value
    : "";
}
/** Render the same safe, self-contained document for preview, paper, and downloads. */
export function renderPrintDocument(doc, input, fonts = {}) {
  const options = normalizePrintOptions(input, doc.kind);
  const page = printGeometry(options, doc.kind);
  const theme = PRINT_THEMES[options.theme];
  const e = escapePrintText;
  const rtl = ["ps", "prs"].includes(doc.locale);
  const saleShop = doc.kind === "invoice" && doc.billStyle === "saleShop";
  const golden = saleShop && options.template === "golden";
  const logo = safePrintLogo(doc.store?.logo_left || doc.store?.logo);
  const logoLeft = safePrintLogo(doc.store?.logo_left || doc.store?.logo);
  const logoRight = safePrintLogo(doc.store?.logo_right);
  const watermark =
    safePrintLogo(doc.store?.watermark) || logoLeft;
  const fontFaces = Object.entries(fonts)
    .filter(
      ([key, url]) =>
        ["latin", "arabic"].includes(key) &&
        /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(url),
    )
    .map(
      ([key, url]) =>
        `@font-face{font-family:Print${key};src:url("${url}") format("woff2");font-weight:100 900;font-display:block}`,
    )
    .join("");
  const toneClass = (tone) =>
    ["positive", "negative", "blue", "amber"].includes(tone)
      ? `tone-${tone}`
      : "";
  const cell = (value, numeric = false, tone = "") =>
    `<td class="${numeric ? "num " : ""}${toneClass(tone)}">${numeric ? `<bdi dir="ltr">${e(westernDigits(value))}</bdi>` : autoDirHtml(value, e)}</td>`;
  const tables = (doc.sections || [])
    .map(
      (section) =>
        `<section class="document-section">${section.title ? `<h3>${e(section.title)}</h3>` : ""}${section.note ? `<p class="section-note">${e(section.note)}</p>` : ""}<table><thead><tr>${section.columns.map((c) => `<th${c.numeric ? ' class="num"' : ""}>${e(c.label)}</th>`).join("")}</tr></thead><tbody>${section.rows.length ? section.rows.map((row, r) => `<tr>${section.columns.map((c, i) => cell(row[i], c.numeric, section.tones?.[r]?.[i])).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}">${e(doc.emptyLabel)}</td></tr>`}</tbody></table></section>`,
    )
    .join("");
  const labels = (doc.labels || [])
    .map((label) => {
      const model = String(label.model || label.identity || "").trim();
      const top = [label.name, model].filter(Boolean).join(" · ");
      return `<article class="barcode-label"><div class="barcode-top"><strong>${e(top || label.name || "")}</strong></div><div class="barcode-svg">${typeof label.svg === "string" && label.svg.startsWith("<svg") ? label.svg : ""}</div><div class="barcode-bottom"><bdi dir="ltr">${e(label.barcode)}</bdi></div></article>`;
    })
    .join("");
  const labelSheet = labels
    ? `<section class="barcode-label-sheet">${labels}</section>`
    : doc.labels
      ? `<p class="section-note">${e(doc.emptyLabel || "")}</p>`
      : "";
  if (doc.kind === "label") {
    const innerH = Math.max(8, page.height - page.margin * 2);
    const innerW = Math.max(8, page.width - page.margin * 2);
    // Top name + bottom code share ~3.6 mm; the rest goes to a centered QR.
    const qrMax = Math.min(innerW - 0.2, Math.max(9, innerH - 3.6));
    const labelCss = `
${fontFaces}
*{box-sizing:border-box}html{background:white}body{margin:0;color:#111;font:6px ${rtl ? "Printarabic,Printlatin" : "Printlatin"},Arial,sans-serif;line-height:1.1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.barcode-label{width:100%;height:${innerH}mm;min-height:${innerH}mm;padding:0.2mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:0.2mm;text-align:center;page-break-after:always;break-after:page;overflow:hidden}
.barcode-label:last-child{page-break-after:auto;break-after:auto}
.barcode-top,.barcode-bottom{flex:0 0 auto;width:100%;min-width:0;overflow:hidden}
.barcode-top strong{display:block;font-size:5.5px;font-weight:700;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.barcode-svg{flex:0 0 auto;width:${qrMax}mm;height:${qrMax}mm;display:flex;align-items:center;justify-content:center;margin:0 auto}
.barcode-svg svg{width:100%;height:100%;display:block}
.barcode-bottom bdi{display:block;font-family:ui-monospace,Consolas,monospace;font-size:5.5px;letter-spacing:.02em;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty-labels{padding:8px;text-align:center;color:#555}
@page{size:${page.width}mm ${page.height}mm;margin:${page.margin}mm}
@media screen{html{background:#e8ebef}body{background:white;width:${page.width}mm;min-height:${page.height}mm;padding:${page.margin}mm;margin:8px auto;box-shadow:0 0 0 1px #c5cad1}
.barcode-label{border:1px dashed #b0b6bf;margin-bottom:8px;page-break-after:auto}}
@media print{body{margin:0;padding:0}.barcode-label{border:0;margin:0}}
`;
    const body = labels
      ? labels
      : `<p class="empty-labels">${e(doc.emptyLabel || "")}</p>`;
    return `<!doctype html><html lang="${doc.locale === "prs" ? "fa-AF" : rtl ? "ps" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(doc.title)}</title><style>${labelCss}</style></head><body>${body}</body></html>`;
  }
  const invoiceLines = (doc.lines || [])
    .map((line) => {
      const details = [
        line.identity,
        ...(options.showSpecs ? line.specs || [] : []),
      ]
        .filter(Boolean)
        .map((s) => `<small dir="auto">${e(s)}</small>`)
        .join("");
      if (options.paper.startsWith("receipt"))
        return `<article class="receipt-line"><strong>${autoDirHtml(line.name, e)}</strong>${details}<div><bdi dir="ltr">${e(westernDigits(line.quantity))} × ${e(westernDigits(line.price))}</bdi><bdi dir="ltr">${e(westernDigits(line.total))}</bdi></div>${line.discountNote ? `<small dir="auto">${e(line.discountNote)}</small>` : ""}</article>`;
      return `<tr><td><strong>${autoDirHtml(line.name, e)}</strong>${details}</td>${cell(line.quantity, true)}${doc.purchase ? cell(line.costAed || "—", true) : ""}${cell(line.price, true)}${cell(line.discount, true)}${cell(line.total, true)}</tr>`;
    })
    .join("");
  const invoice =
    doc.kind === "invoice" && doc.lines?.length
      ? options.paper.startsWith("receipt")
        ? `<div class="receipt-lines">${invoiceLines}</div>`
        : `<table class="invoice-table"><thead><tr>${doc.lineLabels.map((s, i) => `<th${i ? ' class="num"' : ""}>${e(s)}</th>`).join("")}</tr></thead><tbody>${invoiceLines}</tbody></table>`
      : "";
  const meta = (doc.metadata || [])
    .filter((m) => m.value !== "" && m.value != null)
    .map(
      (m) =>
        `<div><span>${e(m.label)}</span><strong>${m.numeric ? `<bdi dir="ltr">${e(westernDigits(m.value))}</bdi>` : autoDirHtml(m.value, e)}</strong></div>`,
    )
    .join("");
  const totals = (doc.summary || [])
    .map(
      (s, i, a) =>
        `<div class="${i === a.length - 1 ? "grand-total" : ""}"><span>${e(s.label)}</span><strong class="${toneClass(s.tone)}"><bdi dir="ltr">${e(westernDigits(s.value))}</bdi></strong></div>`,
    )
    .join("");
  const companyLinks = supportLinks(brand.support);
  const creditLink = (id, content) => {
    const link = companyLinks.find((item) => item.id === id);
    return link
      ? `<a href="${e(link.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`
      : content;
  };
  const companyCredit =
    doc.kind === "invoice" && doc.companyCredit
      ? `<footer class="company-print-credit"><svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="${COMPANY_LOGO_HOOK}"/><path fill-rule="evenodd" d="${COMPANY_LOGO_LEG}"/></svg>${creditLink("website", e(doc.companyCredit.label))}</footer>`
      : "";
  const footer =
    options.showFooter && doc.store?.bill_footer
      ? `<p class="store-footer" dir="auto">${e(doc.store.bill_footer)}</p>`
      : "";
  const ownerLine = (name, phone) => {
    const who = String(name || "").trim();
    if (!who) return "";
    const contacts = [
      ["phone", phone],
    ]
      .map(([kind, v]) => {
        const text = String(v || "").trim();
        return text
          ? `${contactGlyph(kind)} ${ltrPhoneHtml(text, e)}`
          : "";
      })
      .filter(Boolean)
      .join("");
    return `<div class="sale-owner"><strong dir="auto">${e(who)}</strong>${contacts ? `<span class="sale-owner-contacts" dir="ltr">${contacts}</span>` : ""}</div>`;
  };
  const saleOwners = saleShop
    ? [
        ownerLine(
          doc.store?.owner1_name,
          doc.store?.owner1_phone,
        ),
        ownerLine(
          doc.store?.owner2_name,
          doc.store?.owner2_phone,
        ),
      ]
        .filter(Boolean)
        .join("")
    : "";
  const storePhone = ltrPhoneHtml(doc.store?.phone, e);
  const saleHeader = saleShop
    ? `<header class="sale-shop-header">
  <div class="sale-shop-brand">
    <div class="sale-shop-logo">${options.showLogo && logoLeft ? `<img src="${e(logoLeft)}" alt="">` : ""}</div>
    <div class="sale-shop-titles">
      <h1 class="business-name" dir="ltr">${e(doc.store?.name || "")}</h1>
      ${doc.store?.name_ps ? `<h2 class="business-name-ps" dir="rtl" lang="ps">${e(doc.store.name_ps)}</h2>` : ""}
    </div>
    <div class="sale-shop-logo">${options.showLogo && logoRight ? `<img src="${e(logoRight)}" alt="">` : ""}</div>
  </div>
  ${doc.store?.services ? `<p class="sale-shop-services" dir="ltr">${mixedHtml(doc.store.services, e)}</p>` : ""}
  ${saleOwners ? `<div class="sale-shop-owners">${saleOwners}</div>` : ""}
  <div class="sale-shop-doc"><h2>${e(doc.title)}</h2>${doc.reference ? `<strong class="document-reference">${e(westernDigits(doc.reference))}</strong>` : ""}${doc.subtitle ? `<p class="document-subtitle"><bdi dir="ltr">${e(westernDigits(doc.subtitle))}</bdi></p>` : ""}</div>
</header>`
    : `<header class="document-header"><div>${options.showLogo && logo ? `<img class="logo" src="${e(logo)}" alt="">` : ""}<h1 class="business-name" dir="ltr">${e(doc.store?.name || "")}</h1><p class="business-info">${doc.store?.address ? `<span dir="auto">${e(doc.store.address)}</span>` : ""}${storePhone || doc.store?.email ? `${doc.store?.address ? "<br>" : ""}${[storePhone, doc.store?.email ? e(doc.store.email) : ""].filter(Boolean).join(" · ")}` : ""}</p></div><div class="document-heading"><h2>${e(doc.title)}</h2>${doc.reference ? `<strong class="document-reference">${e(westernDigits(doc.reference))}</strong>` : ""}${doc.subtitle ? `<p class="document-subtitle"><bdi dir="ltr">${e(westernDigits(doc.subtitle))}</bdi></p>` : ""}</div></header>`;
  const saleClosing = saleShop
    ? `${footer}${doc.signatureLabel ? `<div class="sale-signature"><span>${e(doc.signatureLabel)}</span><i></i></div>` : ""}${doc.store?.address_ps ? `<p class="sale-address-ps" dir="rtl" lang="ps">${e(doc.store.address_ps)}</p>` : ""}`
    : footer;
  const css = `
${fontFaces}
:root{--accent:${theme.accent};--soft:${theme.soft};--ink:${theme.ink};color-scheme:light}
*{box-sizing:border-box}html{background:white}body{margin:0;color:var(--ink);font:11px ${rtl ? "Printarabic,Printlatin" : "Printlatin"},Arial,sans-serif;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.company-print-credit{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:5px 9px;border-top:1px solid #dce0e5;padding-top:10px;margin-top:18px;font-size:8px;line-height:1.5;color:#626974;break-inside:avoid}.company-print-credit a{color:inherit;text-decoration:none}.company-print-credit a:hover{text-decoration:underline}.company-print-credit svg{width:16px;height:16px;flex-shrink:0}.company-print-credit .ltr-phone,bdi.ltr-phone{white-space:nowrap;direction:ltr;unicode-bidi:isolate}.sheet{background:white;overflow-wrap:anywhere;min-width:0}.document-header>div{min-width:0}.document-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:18px 0 22px;border-bottom:3px solid var(--accent)}.business-name{font-size:23px;line-height:1.25;margin:0 0 7px;letter-spacing:-.5px;unicode-bidi:isolate}.business-info{white-space:pre-line;color:#5b616b;margin:0}.logo{max-width:150px;max-height:64px;object-fit:contain;display:block;margin-bottom:12px}.document-heading{text-align:end;min-width:130px}.document-heading h2{font-size:23px;margin:0 0 7px;line-height:1.3;color:var(--accent)}.document-reference{font-size:12px;direction:ltr;unicode-bidi:isolate;display:inline-block}.document-subtitle{color:#5b616b;margin:5px 0}.metadata{display:flex;flex-wrap:wrap;gap:18px 32px;background:var(--soft);padding:15px;margin:22px 0}.metadata>div{min-width:100px;flex:1}.metadata span{display:block;color:#656b75;font-size:10px}.metadata strong{font-weight:600}.num{text-align:end;white-space:nowrap}bdi,.auto-dir{unicode-bidi:isolate}.auto-dir{unicode-bidi:plaintext}table{width:100%;border-collapse:collapse;margin:20px 0;table-layout:auto;font-size:10px}thead{display:table-header-group}th{background:var(--accent);color:white;text-align:start;padding:10px 9px;font-weight:600}td{border-bottom:1px solid #dce0e5;padding:12px 9px;vertical-align:top}td:first-child{min-width:90px}td small,.receipt-line small{display:block;color:#626974;font-size:9px;white-space:pre-line;margin-top:3px}tbody tr:nth-child(even){background:var(--soft)}.summary{margin:20px 0 20px auto;max-width:310px;break-inside:avoid}.summary>div{display:flex;justify-content:space-between;gap:16px;padding:7px 10px}.grand-total{border-top:2px solid var(--accent);background:var(--soft);font-size:14px;margin-top:7px}.document-section{margin:24px 0}.document-section h3{margin:0 0 8px;color:var(--accent);font-size:15px}.section-note,.end-note{color:#626974;font-size:10px;white-space:pre-line}.store-footer{border-top:1px solid #dce0e5;padding-top:18px;margin-top:30px;white-space:pre-line;text-align:center}.document-note{white-space:pre-line}.receipt-line{padding:9px 0;border-bottom:1px dashed #aaa;break-inside:avoid}.receipt-line>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:4px}
.sale-shop-header{text-align:center;padding:8px 0 16px;border-bottom:3px solid var(--accent);margin-bottom:8px;break-inside:avoid}.sale-shop-brand{display:grid;grid-template-columns:72px 1fr 72px;gap:10px;align-items:center}.sale-shop-logo{min-height:48px;display:flex;align-items:center;justify-content:center}.sale-shop-logo img{max-width:72px;max-height:64px;object-fit:contain;display:block}.sale-shop-titles{min-width:0}.sale-shop-titles .business-name{margin:0;font-size:22px;text-align:center;direction:ltr}.business-name-ps{margin:4px 0 0;font-size:18px;font-weight:700;line-height:1.35;color:var(--accent);unicode-bidi:isolate}.sale-shop-services,.store-footer,.document-note,.sale-address-ps{unicode-bidi:plaintext}.sale-shop-services{margin:10px 0 0;white-space:pre-line;color:#4d5560;font-size:10px;line-height:1.45}.sale-shop-owners{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px 28px;margin-top:10px;direction:rtl}.sale-owner{display:flex;flex-direction:column;gap:2px;font-size:10px;text-align:start}.sale-owner strong{font-size:11px;unicode-bidi:isolate}.sale-owner-contacts{display:inline-flex;align-items:center;gap:8px;color:#5b616b;direction:ltr;unicode-bidi:isolate}.sale-owner-contacts .gold-icon{width:12px;height:12px}.sale-shop-doc{margin-top:14px;padding-top:10px;border-top:1px solid #dce0e5}.sale-shop-doc h2{margin:0 0 4px;font-size:16px;color:var(--accent)}.sale-signature{display:flex;align-items:flex-end;justify-content:flex-end;gap:12px;margin-top:28px;padding-top:8px;break-inside:avoid}.sale-signature span{font-size:10px;color:#5b616b}.sale-signature i{display:block;width:160px;border-bottom:1px solid #30323a;height:28px}.sale-address-ps{text-align:center;margin:16px 0 0;font-size:11px;font-weight:600;line-height:1.45;white-space:pre-line}
.watermarked-lines{position:relative}.standard-watermark{position:absolute;left:28%;top:12%;width:44%;max-height:72%;object-fit:contain;opacity:.1;pointer-events:none;z-index:0}.watermarked-lines table{position:relative;z-index:1}.layout-modern .sale-shop-header{border-top:7px solid var(--accent)}.layout-classic .sale-shop-header{border:2px solid var(--accent);padding:14px}.layout-minimal .sale-shop-header{border-bottom:1px solid #ccd1d7}.layout-compact .sale-shop-header{padding:4px 0}.layout-compact .sale-shop-doc{margin-top:6px;padding-top:6px}.layout-modern .document-header{border-top:8px solid var(--accent);padding-top:22px}.layout-classic .document-header{border-bottom:2px double var(--accent);border-top:2px double var(--accent);padding-top:20px}.layout-classic th{background:var(--soft);color:var(--ink);border-block:1px solid var(--accent)}.layout-classic tbody tr{background:white}.layout-classic table td,.layout-classic table th{border:1px solid #c5cad1}.layout-minimal .document-header{border-bottom:1px solid #ccd1d7}.layout-minimal .metadata{background:none;padding-inline:0}.layout-minimal th{background:none;color:var(--accent);border-bottom:2px solid var(--accent)}.layout-minimal tbody tr{background:white}.layout-minimal .grand-total{background:none}.layout-compact{font-size:10px}.layout-compact th,.layout-compact td{padding:6px}.layout-compact .metadata{margin:12px 0;padding:10px}.layout-compact .document-header{padding-block:10px}.layout-compact h2,.layout-compact .business-name{font-size:18px}
.tone-positive{color:#237654}.tone-negative{color:#b13d4d}.tone-blue{color:#326b91}.tone-amber{color:#91601b}
.theme-mono th{background:white;color:black;border-bottom:2px solid black}.theme-mono tbody tr,.theme-mono .metadata,.theme-mono .grand-total{background:white}.theme-mono *{color:black!important}.theme-mono img{filter:grayscale(1)}
.barcode-label-sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:18px 0}.barcode-label{border:1px dashed #9aa3ad;border-radius:8px;padding:10px 12px;text-align:center;break-inside:avoid}.barcode-label strong{display:block;font-size:12px;line-height:1.3;margin-bottom:2px}.barcode-label small{display:block;color:#626974;font-size:9px;margin-bottom:6px}.barcode-svg{display:flex;justify-content:center;margin:4px 0 2px}.barcode-svg svg{max-width:100%;height:auto}.barcode-label bdi{display:block;font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.04em;margin-top:2px}
${golden ? goldenCss : ""}
${golden && options.paper === "A5" ? ".gold-brand{padding:6px}.gold-brand img{max-height:45px}.gold-titles h1{font-size:22px}.gold-titles h2{font-size:13px}.gold-header>p{font-size:10px}.gold-table th{font-size:10px}.gold-table td.num{font-size:8px}" : ""}
${options.paper.startsWith("receipt") ? "body{font-size:10px}.document-header{display:block;text-align:center;gap:0;padding-bottom:10px}.document-heading{text-align:center;margin-top:12px}.business-name,.document-heading h2{font-size:17px}.logo{margin-inline:auto;max-width:100px}.metadata{display:block;margin:12px 0;padding:8px}.metadata>div{margin-bottom:6px}.summary{max-width:none;margin:14px 0}.summary>div{padding-inline:0}.grand-total{font-size:12px}.store-footer{text-align:center;margin-top:15px}.sale-shop-brand{grid-template-columns:48px 1fr 48px}.sale-shop-logo img{max-width:48px;max-height:48px}.sale-signature{justify-content:center}.barcode-label-sheet{grid-template-columns:1fr}" : ""}
@page{size:${page.width}mm ${page.height}mm;margin:${page.margin}mm}tr{break-inside:avoid}h3{break-after:avoid}table{break-inside:auto}.document-header,.sale-shop-header{break-inside:avoid}
@media screen{html{background:#e8ebef}body{background:white;width:${page.width}mm;min-height:${page.height}mm;padding:${page.margin}mm;margin:0}.sheet{width:100%;min-height:${page.height - page.margin * 2}mm;margin:0}}
@media print{body{margin:0;padding:0}.sheet{width:auto;min-height:0;margin:0}a{text-decoration:none;color:inherit}}
`;
  return `<!doctype html><html lang="${doc.locale === "prs" ? "fa-AF" : rtl ? "ps" : "en"}" dir="${golden ? "ltr" : rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(doc.reference || doc.title)}</title><style>${css}</style></head><body class="layout-${options.layout} theme-${golden ? "golden" : options.theme}${golden ? " golden-bill" : ""}${saleShop ? " sale-shop-bill" : ""}"><main class="sheet">${golden ? goldenSale({ doc, options, e, logoLeft, logoRight, watermark, totals, companyCredit }) : `${saleHeader}${meta ? `<section class="metadata">${meta}</section>` : ""}${saleShop && options.showWatermark && watermark ? `<div class="watermarked-lines"><img class="standard-watermark" src="${e(watermark)}" alt="">${invoice}</div>` : invoice}${tables}${labelSheet}${totals ? `<section class="summary">${totals}</section>` : ""}${doc.note ? `<p class="document-note" dir="auto">${e(doc.note)}</p>` : ""}${saleClosing}${doc.endNote ? `<p class="end-note">${e(doc.endNote)}</p>` : ""}${companyCredit}`} </main></body></html>`;
}
