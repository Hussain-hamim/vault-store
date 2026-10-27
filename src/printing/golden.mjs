/** Sale-only bilingual stationery. Values arrive escaped from the shared renderer. */
export function goldenSale({
  doc,
  options,
  e,
  logoLeft,
  logoRight,
  totals,
  companyCredit,
  footer,
  meta,
}) {
  const image = (src, cls = "") =>
    src && options.showLogo
      ? `<img class="${cls}" src="${e(src)}" alt="">`
      : "";
  const bi = (en, ps) => `${en} <span lang="ps" dir="rtl">${ps}</span>`;
  const rows = (doc.lines || []).map(
    (l, i) =>
      `<tr><td class="row-number">${i + 1}</td><td><strong>${e(l.name)}</strong>${[
        l.identity,
        ...(options.showSpecs ? l.specs || [] : []),
        l.discountNote,
      ]
        .filter(Boolean)
        .map((v) => `<small>${e(v)}</small>`)
        .join(
          "",
        )}</td><td class="num"><bdi dir="ltr">${e(l.price)}</bdi></td><td class="num"><bdi dir="ltr">${e(l.quantity)}</bdi></td><td class="num"><bdi dir="ltr">${e(l.total)}</bdi></td></tr>`,
  );
  // Printed ruling remains flexible: long specs and additional lines can paginate.
  if (
    !options.paper.startsWith("receipt") &&
    options.orientation !== "landscape"
  )
    for (let i = rows.length; i < (options.paper === "A5" ? 6 : 16); i++)
      rows.push(
        `<tr class="blank-line"><td class="row-number">${i + 1}</td><td></td><td></td><td></td><td></td></tr>`,
      );
  const contacts =
    [1, 2]
      .map((i) => {
        const name = doc.store?.[`owner${i}_name`];
        const phone = doc.store?.[`owner${i}_phone`];
        const whatsapp = doc.store?.[`owner${i}_whatsapp`];
        return [
          name && `<strong dir="auto">${e(name)}</strong>`,
          phone && `<bdi dir="ltr">${e(phone)}</bdi>`,
          whatsapp && `<bdi dir="ltr">WhatsApp: ${e(whatsapp)}</bdi>`,
        ]
          .filter(Boolean)
          .join(" · ");
      })
      .filter(Boolean)
      .join(" &nbsp; | &nbsp; ") ||
    [doc.store?.phone, doc.store?.email].filter(Boolean).map(e).join(" · ");
  const labels = [
    bi("Total", "ټول"),
    bi("Returned", "بېرته شوي"),
    bi("Paid", "ورکړل شوي"),
    bi("Balance", "پاتې"),
  ];
  const summary = (doc.summary || [])
    .map(
      (s, i) =>
        `<div><span>${labels[i] || e(s.label)}</span><strong><bdi dir="ltr">${e(s.value)}</bdi></strong></div>`,
    )
    .join("");
  return `<header class="gold-header"><div class="gold-brand"><div>${image(logoLeft)}</div><div class="gold-titles">${doc.store?.name_ps ? `<h1 lang="ps" dir="rtl">${e(doc.store.name_ps)}</h1>` : ""}<h2>${e(doc.store?.name)}</h2></div><div>${image(logoRight)}</div></div>${doc.store?.services ? `<p dir="auto">${e(doc.store.services)}</p>` : ""}${contacts ? `<div class="gold-contacts">${contacts}</div>` : ""}</header>
  <section class="gold-meta"><div><b>${bi("Name", "نوم")}:</b> <span dir="auto">${e(doc.metadata?.[0]?.value || "—")}</span></div><div><b>${bi("Date", "نېټه")}:</b> <bdi dir="ltr">${e(doc.subtitle)}</bdi></div><div><b>${bi("Bill No", "بل شمېره")}:</b> <bdi dir="ltr">${e(doc.reference)}</bdi></div></section>
  <div class="gold-lines">${options.showWatermark && options.showLogo && logoLeft ? `<img class="gold-watermark" src="${e(logoLeft)}" alt="">` : ""}<table class="gold-table" dir="ltr"><colgroup><col style="width:6%"><col style="width:46%"><col style="width:18%"><col style="width:10%"><col style="width:20%"></colgroup><thead><tr>${[bi("No", "ګڼه"), bi("Description", "تفصیل"), bi("Price", "بیه"), bi("Qty", "شمېر"), bi("Amount", "مبلغ")].map((v) => `<th>${v}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>
  <section class="gold-closing"><div class="gold-settlement"><div class="gold-sign">${bi("Sign", "لاسلیک")}:<div></div></div><div class="gold-totals">${summary}</div></div>${doc.note ? `<p dir="auto">${e(doc.note)}</p>` : ""}${footer}${doc.store?.address_ps || doc.store?.address ? `<div class="gold-address" dir="auto">${e([doc.store?.address_ps, doc.store?.address].filter(Boolean).join(" · "))}</div>` : ""}</section>
  ${meta ? `<section class="metadata gold-details">${meta}</section>` : ""}${doc.endNote ? `<p class="end-note">${e(doc.endNote)}</p>` : ""}${companyCredit}`;
}
export const goldenCss = `
.golden-bill{font-family:Printlatin,Printarabic,Arial,sans-serif;direction:ltr;color:#211b2d}.golden-bill [lang=ps]{font-family:Printarabic,Arial,sans-serif}.gold-header{background:linear-gradient(#fff9e5,#ffde43);border-bottom:3px solid #f18135;text-align:center;break-inside:avoid}.gold-brand{display:grid;grid-template-columns:17% 66% 17%;align-items:center;padding:12px 8px 8px}.gold-brand img{max-width:100%;max-height:85px;object-fit:contain}.gold-titles h1{font-size:30px;line-height:1.5;margin:0 0 5px;color:#30223e}.gold-titles h2{font-size:19px;line-height:1.35;color:white;background:#211b2d;border-radius:30px;margin:0;padding:4px 8px;font-weight:800;text-transform:uppercase}.gold-header>p{font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:14px;margin:4px 10px 12px}.gold-contacts{background:#211b2d;color:white;padding:8px 10px;display:flex;justify-content:space-around;flex-wrap:wrap;gap:6px;font-size:12px}.gold-meta{display:flex;flex-wrap:wrap;gap:7px 12px;padding:12px 3px 7px;justify-content:space-between;font-size:10px}.gold-meta>div:first-child{flex:1;min-width:30%}.gold-meta b span{font-size:9px}.gold-lines{position:relative}.gold-watermark{position:absolute;left:25%;top:25%;width:50%;max-height:50%;object-fit:contain;opacity:.075;pointer-events:none}.gold-table{position:relative;table-layout:fixed;margin:0;border:1px solid #302536}.gold-table th{background:#302536;color:#fff;text-align:center;font-size:12px;padding:5px 3px;border:1px solid #665768}.gold-table th span{display:block;font-size:10px;font-weight:400}.gold-table td{border:1px solid #4e4353;padding:5px 6px;min-width:0!important;white-space:normal;overflow-wrap:anywhere}.gold-table td.num{text-align:center;font-size:10px}.gold-table .row-number{background:#443344;color:white;text-align:center;font-size:13px;font-weight:700}.gold-table tbody tr{background:transparent}.gold-table .blank-line{height:22px}.gold-table .blank-line td{padding:0 4px;line-height:1;height:22px}.gold-table td small{font-size:8px;line-height:1.4;margin-top:1px}.gold-closing{background:#ffe34a;break-inside:avoid;padding-top:9px}.gold-settlement{display:flex;justify-content:space-between;align-items:end;gap:15px;padding:0 8px}.gold-sign{width:40%;font-size:13px;font-weight:700}.gold-sign>div{border-bottom:1px solid #45322e;height:28px;margin-bottom:15px}.gold-totals{width:48%;border:1px solid #514133}.gold-totals>div{display:flex;background:#fff;justify-content:space-between;border-bottom:1px solid #514133;font-size:10px;gap:5px}.gold-totals>div:last-child{border:0}.gold-totals span{background:#f3a16a;padding:3px 5px;min-width:50%}.gold-totals strong{padding:3px 5px}.gold-closing>p{padding:0 10px;white-space:pre-line}.gold-closing .store-footer{border:0;margin:8px 0;padding:4px 10px;font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:11px;font-weight:600}.gold-address{background:#3c304f;color:white;text-align:center;padding:7px 10px;font-family:Printarabic,Printlatin,Arial,sans-serif;font-size:12px;white-space:pre-line}.gold-details{margin:10px 0;padding:8px;gap:6px 14px;font-size:9px}.gold-details span{font-size:8px}.golden-bill .company-print-credit{margin-top:8px;padding-top:6px}.golden-bill .end-note{margin:5px 0;font-size:8px}
@media print{.gold-watermark{print-color-adjust:exact}}
`;
