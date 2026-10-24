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
  const logo = safePrintLogo(doc.store?.logo);
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
    `<td class="${numeric ? "num " : ""}${toneClass(tone)}">${numeric ? `<bdi dir="ltr">${e(value)}</bdi>` : e(value)}</td>`;
  const tables = (doc.sections || [])
    .map(
      (section) =>
        `<section class="document-section">${section.title ? `<h3>${e(section.title)}</h3>` : ""}${section.note ? `<p class="section-note">${e(section.note)}</p>` : ""}<table><thead><tr>${section.columns.map((c) => `<th${c.numeric ? ' class="num"' : ""}>${e(c.label)}</th>`).join("")}</tr></thead><tbody>${section.rows.length ? section.rows.map((row, r) => `<tr>${section.columns.map((c, i) => cell(row[i], c.numeric, section.tones?.[r]?.[i])).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}">${e(doc.emptyLabel)}</td></tr>`}</tbody></table></section>`,
    )
    .join("");
  const invoiceLines = (doc.lines || [])
    .map((line) => {
      const details = [
        line.identity,
        ...(options.showSpecs ? line.specs || [] : []),
      ]
        .filter(Boolean)
        .map((s) => `<small>${e(s)}</small>`)
        .join("");
      if (options.paper.startsWith("receipt"))
        return `<article class="receipt-line"><strong>${e(line.name)}</strong>${details}<div><bdi dir="ltr">${e(line.quantity)} × ${e(line.price)}</bdi><bdi dir="ltr">${e(line.total)}</bdi></div>${line.discountNote ? `<small>${e(line.discountNote)}</small>` : ""}</article>`;
      return `<tr><td><strong>${e(line.name)}</strong>${details}</td>${cell(line.quantity, true)}${doc.purchase ? cell(line.costAed || "—", true) : ""}${cell(line.price, true)}${cell(line.discount, true)}${cell(line.total, true)}</tr>`;
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
        `<div><span>${e(m.label)}</span><strong>${m.numeric ? `<bdi dir="ltr">${e(m.value)}</bdi>` : e(m.value)}</strong></div>`,
    )
    .join("");
  const totals = (doc.summary || [])
    .map(
      (s, i, a) =>
        `<div class="${i === a.length - 1 ? "grand-total" : ""}"><span>${e(s.label)}</span><strong class="${toneClass(s.tone)}"><bdi dir="ltr">${e(s.value)}</bdi></strong></div>`,
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
      ? `<footer class="company-print-credit"><svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="${COMPANY_LOGO_HOOK}"/><path fill-rule="evenodd" d="${COMPANY_LOGO_LEG}"/></svg>${creditLink("website", e(doc.companyCredit.label))}${creditLink("whatsapp", `<bdi dir="ltr">WhatsApp: ${e(doc.companyCredit.whatsapp)}</bdi>`)}</footer>`
      : "";
  const footer =
    options.showFooter && doc.store?.bill_footer
      ? `<p class="store-footer">${e(doc.store.bill_footer)}</p>`
      : "";
  const css = `
${fontFaces}
:root{--accent:${theme.accent};--soft:${theme.soft};--ink:${theme.ink};color-scheme:light}
*{box-sizing:border-box}html{background:white}body{margin:0;color:var(--ink);font:11px ${rtl ? "Printarabic,Printlatin" : "Printlatin"},Arial,sans-serif;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.company-print-credit{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:5px 9px;border-top:1px solid #dce0e5;padding-top:10px;margin-top:18px;font-size:8px;line-height:1.5;color:#626974;break-inside:avoid}.company-print-credit a{color:inherit;text-decoration:none}.company-print-credit a:hover{text-decoration:underline}.company-print-credit svg{width:16px;height:16px;flex-shrink:0}.company-print-credit bdi{white-space:nowrap}.sheet{background:white;overflow-wrap:anywhere;min-width:0}.document-header>div{min-width:0}.document-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:18px 0 22px;border-bottom:3px solid var(--accent)}.business-name{font-size:23px;line-height:1.25;margin:0 0 7px;letter-spacing:-.5px}.business-info{white-space:pre-line;color:#5b616b;margin:0}.logo{max-width:150px;max-height:64px;object-fit:contain;display:block;margin-bottom:12px}.document-heading{text-align:end;min-width:130px}.document-heading h2{font-size:23px;margin:0 0 7px;line-height:1.3;color:var(--accent)}.document-reference{font-size:12px;direction:ltr;unicode-bidi:isolate;display:inline-block}.document-subtitle{color:#5b616b;margin:5px 0}.metadata{display:flex;flex-wrap:wrap;gap:18px 32px;background:var(--soft);padding:15px;margin:22px 0}.metadata>div{min-width:100px;flex:1}.metadata span{display:block;color:#656b75;font-size:10px}.metadata strong{font-weight:600}.num{text-align:end;white-space:nowrap}bdi{unicode-bidi:isolate}table{width:100%;border-collapse:collapse;margin:20px 0;table-layout:auto;font-size:10px}thead{display:table-header-group}th{background:var(--accent);color:white;text-align:start;padding:10px 9px;font-weight:600}td{border-bottom:1px solid #dce0e5;padding:12px 9px;vertical-align:top}td:first-child{min-width:90px}td small,.receipt-line small{display:block;color:#626974;font-size:9px;white-space:pre-line;margin-top:3px}tbody tr:nth-child(even){background:var(--soft)}.summary{margin:20px 0 20px auto;max-width:310px;break-inside:avoid}.summary>div{display:flex;justify-content:space-between;gap:16px;padding:7px 10px}.grand-total{border-top:2px solid var(--accent);background:var(--soft);font-size:14px;margin-top:7px}.document-section{margin:24px 0}.document-section h3{margin:0 0 8px;color:var(--accent);font-size:15px}.section-note,.end-note{color:#626974;font-size:10px;white-space:pre-line}.store-footer{border-top:1px solid #dce0e5;padding-top:18px;margin-top:30px;white-space:pre-line}.document-note{white-space:pre-line}.receipt-line{padding:9px 0;border-bottom:1px dashed #aaa;break-inside:avoid}.receipt-line>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:4px}
.layout-modern .document-header{border-top:8px solid var(--accent);padding-top:22px}.layout-classic .document-header{border-bottom:2px double var(--accent);border-top:2px double var(--accent);padding-top:20px}.layout-classic th{background:var(--soft);color:var(--ink);border-block:1px solid var(--accent)}.layout-classic tbody tr{background:white}.layout-classic table td,.layout-classic table th{border:1px solid #c5cad1}.layout-minimal .document-header{border-bottom:1px solid #ccd1d7}.layout-minimal .metadata{background:none;padding-inline:0}.layout-minimal th{background:none;color:var(--accent);border-bottom:2px solid var(--accent)}.layout-minimal tbody tr{background:white}.layout-minimal .grand-total{background:none}.layout-compact{font-size:10px}.layout-compact th,.layout-compact td{padding:6px}.layout-compact .metadata{margin:12px 0;padding:10px}.layout-compact .document-header{padding-block:10px}.layout-compact h2,.layout-compact .business-name{font-size:18px}
.tone-positive{color:#237654}.tone-negative{color:#b13d4d}.tone-blue{color:#326b91}.tone-amber{color:#91601b}
.theme-mono th{background:white;color:black;border-bottom:2px solid black}.theme-mono tbody tr,.theme-mono .metadata,.theme-mono .grand-total{background:white}.theme-mono *{color:black!important}.theme-mono img{filter:grayscale(1)}
${options.paper.startsWith("receipt") ? "body{font-size:10px}.document-header{display:block;text-align:center;gap:0;padding-bottom:10px}.document-heading{text-align:center;margin-top:12px}.business-name,.document-heading h2{font-size:17px}.logo{margin-inline:auto;max-width:100px}.metadata{display:block;margin:12px 0;padding:8px}.metadata>div{margin-bottom:6px}.summary{max-width:none;margin:14px 0}.summary>div{padding-inline:0}.grand-total{font-size:12px}.store-footer{text-align:center;margin-top:15px}" : ""}
@page{size:${page.width}mm ${page.height}mm;margin:${page.margin}mm}tr{break-inside:avoid}h3{break-after:avoid}table{break-inside:auto}.document-header{break-inside:avoid}
@media screen{html{background:#e8ebef}body{background:white;width:${page.width}mm;min-height:${page.height}mm;padding:${page.margin}mm;margin:0}.sheet{width:100%;min-height:${page.height - page.margin * 2}mm;margin:0}}
@media print{body{margin:0;padding:0}.sheet{width:auto;min-height:0;margin:0}a{text-decoration:none;color:inherit}}
`;
  return `<!doctype html><html lang="${doc.locale === "prs" ? "fa-AF" : rtl ? "ps" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(doc.reference || doc.title)}</title><style>${css}</style></head><body class="layout-${options.layout} theme-${options.theme}"><main class="sheet"><header class="document-header"><div>${options.showLogo && logo ? `<img class="logo" src="${e(logo)}" alt="">` : ""}<h1 class="business-name">${e(doc.store?.name || "")}</h1><p class="business-info">${e([doc.store?.address, [doc.store?.phone, doc.store?.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n"))}</p></div><div class="document-heading"><h2>${e(doc.title)}</h2>${doc.reference ? `<strong class="document-reference">${e(doc.reference)}</strong>` : ""}${doc.subtitle ? `<p class="document-subtitle">${e(doc.subtitle)}</p>` : ""}</div></header>${meta ? `<section class="metadata">${meta}</section>` : ""}${invoice}${tables}${totals ? `<section class="summary">${totals}</section>` : ""}${doc.note ? `<p class="document-note">${e(doc.note)}</p>` : ""}${footer}${doc.endNote ? `<p class="end-note">${e(doc.endNote)}</p>` : ""}${companyCredit}</main></body></html>`;
}
