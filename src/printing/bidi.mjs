/** Print helpers for mixed English/Pashto bills. Numbers always stay Western LTR. */

export function westernDigits(value) {
  return String(value ?? "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, "")
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
}

export function ltrPhoneHtml(value, e) {
  const text = westernDigits(value).trim();
  return text ? `<bdi class="ltr-phone" dir="ltr">${e(text)}</bdi>` : "";
}

export function autoDirHtml(value, e) {
  const text = String(value ?? "");
  if (!text) return "";
  return `<span class="auto-dir" dir="auto">${e(text)}</span>`;
}

/** Keep author order on an LTR pad while isolating Pashto and English words. */
export function mixedHtml(value, e) {
  const text = String(value ?? "");
  if (!text) return "";
  return text
    .split(/(\s+|·|,|\|)/)
    .map((part) => {
      if (!part || /^(\s+|·|,|\|)$/.test(part)) return e(part);
      const rtl = /[\u0600-\u06FF]/.test(part);
      return `<span dir="${rtl ? "rtl" : "ltr"}">${e(part)}</span>`;
    })
    .join("");
}

export function bilingualLabel(en, ps) {
  return `<span class="gold-bi"><span dir="ltr">${en}</span><span lang="ps" dir="rtl">${ps}</span></span>`;
}
