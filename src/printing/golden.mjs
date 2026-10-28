import {
  autoDirHtml,
  bilingualLabel,
  ltrPhoneHtml,
  mixedHtml,
  westernDigits,
} from "./bidi.mjs";

/** Sale-only yellow shop stationery, matching typical Afghan computer-store pads. */
function ruledCount(paper) {
  if (paper === "A5" || paper === "Letter") return 10;
  if (paper === "A3") return 22;
  return 16;
}

export function contactGlyph(kind) {
  return `<svg class="gold-icon gold-icon-phone" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1l-2.2 2.2z"/></svg>`;
}

export function goldenSale({
  doc,
  options,
  e,
  logoLeft,
  logoRight,
  watermark,
  totals,
  companyCredit,
}) {
  const image = (src, cls = "") =>
    src && options.showLogo
      ? `<img class="${cls}" src="${e(src)}" alt="">`
      : "";
  const bi = bilingualLabel;
  const rows = (doc.lines || []).map(
    (l, i) =>
      `<tr><td class="row-number">${i + 1}</td><td class="gold-item">${autoDirHtml(l.name, e)} ${[
        l.identity,
        ...(options.showSpecs ? l.specs || [] : []),
        l.discountNote,
      ]
        .filter(Boolean)
        .map((v) => `<small dir="auto">${e(v)}</small>`)
        .join(
          "",
        )}</td><td class="num"><bdi dir="ltr">${e(westernDigits(l.price))}</bdi></td><td class="num"><bdi dir="ltr">${e(westernDigits(l.quantity))}</bdi></td><td class="num"><bdi dir="ltr">${e(westernDigits(l.total))}</bdi></td></tr>`,
  );
  if (
    !options.paper.startsWith("receipt") &&
    options.orientation !== "landscape"
  ) {
    const fill = ruledCount(options.paper);
    for (let i = rows.length; i < fill; i++)
      rows.push(
        `<tr class="blank-line"><td class="row-number">${i + 1}</td><td></td><td></td><td></td><td></td></tr>`,
      );
  }
  const glyph = (kind) => contactGlyph(kind);
  const seen = { phone: new Set() };
  const contacts = [];
  for (const i of [1, 2]) {
    const value = String(doc.store?.[`owner${i}_phone`] || "").trim();
    if (!value || seen.phone.has(value)) continue;
    seen.phone.add(value);
    contacts.push({ kind: "phone", value });
  }
  if (!contacts.length && doc.store?.phone)
    contacts.push({ kind: "phone", value: String(doc.store.phone).trim() });
  const phoneHtml = contacts
    .map(
      (c) =>
        `<span class="gold-contact-phone" dir="ltr">${glyph(c.kind)} ${ltrPhoneHtml(c.value, e)}</span>`,
    )
    .join("");
  const owners = [1, 2]
    .map((i) => String(doc.store?.[`owner${i}_name`] || "").trim())
    .filter(Boolean);
  const ownerLabel = owners.length > 1 ? "مسؤلين:" : "مسؤل:";
  const ownerHtml = owners.length
    ? `<div class="gold-in-charge" dir="rtl" lang="ps"><span>${ownerLabel}</span> ${owners.map((n) => `<strong dir="auto">${e(n)}</strong>`).join(" · ")}</div>`
    : "";
  const goldTotals = {
    total: "Total",
    returned: "Returned",
    paid: "Paid",
    outstanding: "Balance",
    previous: "Previous balance",
    newBalance: "Total balance",
    returnCredit: "Credit",
    refundPaid: "Refund",
    refundReceived: "Refund",
  };
  const summary = (doc.summary || [])
    .map(
      (s) =>
        `<div><span>${goldTotals[s.key] || e(s.label)}</span><strong><bdi dir="ltr">${e(westernDigits(s.value))}</bdi></strong></div>`,
    )
    .join("");
  const mark =
    options.showWatermark && watermark
      ? `<img class="gold-watermark" src="${e(watermark)}" alt="">`
      : "";
  return `<header class="gold-header">
    <div class="gold-brand">
      <div class="gold-side">${image(logoLeft)}</div>
      <div class="gold-titles">${
        doc.store?.name_ps
          ? `<h1 lang="ps" dir="rtl">${e(doc.store.name_ps)}</h1>`
          : ""
      }<h2 dir="ltr">${e(doc.store?.name || "")}</h2></div>
      <div class="gold-side">${image(logoRight)}</div>
    </div>
    ${doc.store?.services ? `<p class="gold-services" dir="ltr">${mixedHtml(doc.store.services, e)}</p>` : ""}
    <div class="gold-contacts" dir="rtl">${ownerHtml}${phoneHtml ? `<div class="gold-contact-phones" dir="ltr">${phoneHtml}</div>` : ""}</div>
  </header>
  <section class="gold-meta">
    <div><b>${bi("Name", "نوم")}</b> ${autoDirHtml(doc.metadata?.[0]?.value || "—", e)}</div>
    <div><b>${bi("Date", "نېټه")}</b> <bdi dir="ltr">${e(westernDigits(doc.subtitle))}</bdi></div>
    <div><b>${bi("Bill No", "بل شمېره")}</b> <bdi dir="ltr">${e(westernDigits(doc.reference))}</bdi></div>
  </section>
  <div class="gold-lines">${mark}<table class="gold-table" dir="ltr"><colgroup><col style="width:7%"><col style="width:45%"><col style="width:18%"><col style="width:10%"><col style="width:20%"></colgroup><thead><tr>${[
    bi("No", "ګڼه"),
    bi("Description", "تفصیل"),
    bi("Price", "بیه"),
    bi("Qty", "شمېر"),
    bi("Amount", "مبلغ"),
  ]
    .map((v) => `<th>${v}</th>`)
    .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>
  <section class="gold-closing">
    <div class="gold-settlement">
      <div class="gold-sign">${bi("Sign", "لاسلیک")}:<div></div></div>
      <div class="gold-totals">${summary || totals}</div>
    </div>
    ${doc.note ? `<p class="gold-note" dir="ltr">${mixedHtml(doc.note, e)}</p>` : ""}
    ${
      options.showFooter && doc.store?.bill_footer
        ? `<p class="store-footer" dir="ltr">${mixedHtml(doc.store.bill_footer, e)}</p>`
        : ""
    }
    ${
      doc.store?.address_ps || doc.store?.address
        ? `<div class="gold-address">${
            doc.store?.address_ps
              ? `<p lang="ps" dir="rtl">${e(doc.store.address_ps)}</p>`
              : ""
          }${
            doc.store?.address
              ? `<p dir="ltr">${e(doc.store.address)}</p>`
              : ""
          }</div>`
        : ""
    }
  </section>
  ${doc.endNote ? `<p class="end-note">${e(doc.endNote)}</p>` : ""}
  ${companyCredit}`;
}

export const goldenCss = `
.golden-bill{font-family:Printlatin,Printarabic,Arial,sans-serif;direction:ltr;unicode-bidi:isolate;color:#211b2d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.golden-bill [lang=ps]{font-family:Printarabic,Arial,sans-serif;direction:rtl;unicode-bidi:isolate}
.ltr-phone,.golden-bill .num bdi,.gold-meta bdi,.gold-totals bdi{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums;white-space:nowrap}
.gold-bi{display:inline-flex;flex-direction:column;align-items:center;gap:1px;line-height:1.25;unicode-bidi:isolate;vertical-align:middle}
.gold-bi [dir=ltr]{direction:ltr;unicode-bidi:isolate}
.gold-bi [lang=ps]{direction:rtl;unicode-bidi:isolate;font-size:.92em;font-weight:600}
.auto-dir{unicode-bidi:plaintext;display:inline-block;max-width:100%}
.gold-header{background:linear-gradient(#fff6c8,#ffd53a 55%,#f5b41a);border-bottom:3px solid #e36a12;text-align:center;break-inside:avoid}
.gold-brand{display:grid;grid-template-columns:18% 64% 18%;align-items:center;gap:6px;padding:10px 8px 4px}
.gold-side{min-height:70px;display:flex;align-items:center;justify-content:center}
.gold-side img,.gold-brand img{max-width:100%;max-height:88px;object-fit:contain}
.gold-titles h1{font-size:28px;line-height:1.45;margin:0 0 6px;color:#2a1d38;font-weight:800;direction:rtl;unicode-bidi:isolate}
.gold-titles h2{font-size:16px;line-height:1.3;color:#fff;background:#1d1528;border-radius:999px;margin:0 auto;padding:5px 14px;font-weight:800;text-transform:uppercase;display:inline-block;letter-spacing:.04em;direction:ltr;unicode-bidi:isolate}
.gold-services{font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:13px;margin:6px 12px 10px;color:#2a1d38;direction:ltr;unicode-bidi:isolate}
.gold-contacts{background:#1d1528;color:#fff;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px 16px;font-size:12px;direction:rtl}
.gold-contact-phones{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-inline-start:auto;direction:ltr;unicode-bidi:isolate}
.gold-contact-phone{display:inline-flex;align-items:center;gap:5px;direction:ltr;unicode-bidi:isolate;white-space:nowrap}
.gold-icon{width:14px;height:14px;flex-shrink:0;fill:currentColor}
.gold-in-charge{direction:rtl;unicode-bidi:isolate;text-align:start}
.gold-in-charge span{margin-inline-end:6px}
.gold-in-charge strong{unicode-bidi:isolate}
.gold-meta{display:flex;flex-wrap:wrap;gap:8px 14px;padding:10px 4px 8px;justify-content:space-between;font-size:11px;border-bottom:1px solid #d8c27a;direction:ltr}
.gold-meta>div:first-child{flex:1;min-width:36%}
.gold-meta b{margin-inline-end:6px}
.gold-meta b .gold-bi{flex-direction:row;gap:6px;align-items:baseline}
.gold-item{unicode-bidi:isolate}
.gold-lines{position:relative}
.gold-watermark{position:absolute;left:22%;top:18%;width:56%;max-height:64%;object-fit:contain;opacity:.12;pointer-events:none;z-index:0}
.gold-table{position:relative;z-index:1;table-layout:fixed;margin:0;border-collapse:collapse;width:100%;border:1px solid #2a1d38}
.gold-table th{background:#2a1d38;color:#fff;text-align:center;font-size:11px;padding:6px 3px;border:1px solid #5a4d63;font-weight:700}
.gold-table th .gold-bi{display:flex}
.gold-table td{border:1px solid #5a4d63;padding:5px 6px;min-width:0!important;white-space:normal;overflow-wrap:anywhere;background:transparent}
.gold-table td.num{text-align:center;font-size:10px}
.gold-table .row-number{background:#3b2f46;color:#fff;text-align:center;font-size:12px;font-weight:700;width:7%}
.gold-table tbody tr{background:transparent}
.gold-table .blank-line{height:22px}
.gold-table .blank-line td{padding:0 4px;height:22px}
.gold-table td small{font-size:8px;line-height:1.35;margin-top:1px;color:#4d4458}
.gold-closing{background:#ffe14a;break-inside:avoid;padding-top:8px}
.gold-settlement{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:0 8px 6px}
.gold-sign{width:42%;font-size:13px;font-weight:700}
.gold-sign>div{border-bottom:1px solid #3b2a24;height:32px;margin:4px 0 12px}
.gold-totals{width:48%;border:1px solid #514133;background:#fff}
.gold-totals>div{display:flex;justify-content:space-between;border-bottom:1px solid #514133;font-size:10px;gap:4px}
.gold-totals>div:last-child{border:0;font-weight:800}
.gold-totals span{background:#f09a4f;padding:4px 6px;min-width:52%;color:#2a1d38}
.gold-totals strong{padding:4px 6px}
.gold-note,.gold-closing .store-footer{border:0;margin:4px 0;padding:2px 10px;font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:11px;font-weight:600;white-space:pre-line;text-align:center;unicode-bidi:plaintext}
.gold-address{background:#3a2b52;color:#fff;text-align:center;padding:8px 10px;font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:12px}
.gold-address p{margin:0;white-space:pre-line}
.gold-address p+p{margin-top:4px}
.golden-bill .company-print-credit{margin-top:8px;padding-top:6px}
.golden-bill .end-note{margin:5px 0;font-size:8px}
@media print{.gold-watermark,.gold-header,.gold-closing,.gold-address,.gold-table th,.gold-table .row-number,.gold-totals span{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
