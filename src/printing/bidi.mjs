/** Print helpers for mixed English/Pashto bills. Numbers always stay Western LTR. */

const ARABIC_CHAR =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_MARK = /[\u064B-\u065F\u0670\u200C\u200D]/;

function isArabicLetter(ch) {
  return ARABIC_CHAR.test(ch);
}

function isArabicMark(ch) {
  return ARABIC_MARK.test(ch);
}

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

/** True when Arabic-script letters outnumber Latin letters. */
export function isMostlyRtl(value) {
  let rtl = 0;
  let ltr = 0;
  for (const ch of String(value ?? "")) {
    if (isArabicLetter(ch)) rtl += 1;
    else if (/[A-Za-z]/.test(ch)) ltr += 1;
  }
  return rtl > ltr;
}

/**
 * Keep author order on an LTR pad while isolating Pashto and English.
 * Consecutive Arabic words (and spaces between them) stay in one RTL island so
 * multi-line notes wrap with readable word order instead of scrambling.
 */
export function mixedHtml(value, e) {
  const text = String(value ?? "");
  if (!text) return "";
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isArabicLetter(ch)) {
      let j = i + 1;
      while (j < text.length) {
        const c = text[j];
        if (isArabicLetter(c) || isArabicMark(c)) {
          j += 1;
          continue;
        }
        if (/\s/.test(c)) {
          let k = j;
          while (k < text.length && /\s/.test(text[k])) k += 1;
          if (k < text.length && isArabicLetter(text[k])) {
            j = k;
            continue;
          }
        }
        break;
      }
      out += `<span dir="rtl" lang="ps">${e(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < text.length && !isArabicLetter(text[j])) j += 1;
    const chunk = text.slice(i, j);
    out += chunk
      .split(/([A-Za-z0-9][A-Za-z0-9'’.-]*)/)
      .map((part) => {
        if (!part) return "";
        if (/^[A-Za-z0-9]/.test(part)) return `<span dir="ltr">${e(part)}</span>`;
        return e(part);
      })
      .join("");
    i = j;
  }
  return out;
}

/**
 * Bill notes / store footers: Pashto-majority text is one RTL block so wrapping
 * stays readable; mixed lines keep run-based isolation on an LTR pad.
 */
export function noteHtml(value, e, className = "store-footer") {
  const text = String(value ?? "");
  if (!text) return "";
  if (isMostlyRtl(text)) {
    return `<p class="${className}" lang="ps" dir="rtl">${e(text)}</p>`;
  }
  if (ARABIC_CHAR.test(text)) {
    return `<p class="${className}" dir="ltr">${mixedHtml(text, e)}</p>`;
  }
  return `<p class="${className}" dir="ltr">${e(text)}</p>`;
}

export function bilingualLabel(en, ps) {
  return `<span class="gold-bi"><span dir="ltr">${en}</span><span lang="ps" dir="rtl">${ps}</span></span>`;
}
