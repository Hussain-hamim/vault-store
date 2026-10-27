/** Dial codes and national-number length rules for shop contact phones. */
export const PHONE_COUNTRIES = Object.freeze([
  { code: "AF", dial: "93", name: "Afghanistan", min: 9, max: 9 },
  { code: "IR", dial: "98", name: "Iran", min: 10, max: 10 },
  { code: "PK", dial: "92", name: "Pakistan", min: 10, max: 10 },
  { code: "IN", dial: "91", name: "India", min: 10, max: 10 },
  { code: "AE", dial: "971", name: "United Arab Emirates", min: 9, max: 9 },
  { code: "SA", dial: "966", name: "Saudi Arabia", min: 9, max: 9 },
  { code: "TR", dial: "90", name: "Türkiye", min: 10, max: 10 },
  { code: "CN", dial: "86", name: "China", min: 11, max: 11 },
  { code: "US", dial: "1", name: "United States", min: 10, max: 10 },
  { code: "GB", dial: "44", name: "United Kingdom", min: 10, max: 10 },
  { code: "DE", dial: "49", name: "Germany", min: 10, max: 11 },
  { code: "TJ", dial: "992", name: "Tajikistan", min: 9, max: 9 },
  { code: "UZ", dial: "998", name: "Uzbekistan", min: 9, max: 9 },
]);

export const DEFAULT_PHONE_COUNTRY = "AF";

export function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function phoneCountryByCode(code) {
  return (
    PHONE_COUNTRIES.find((c) => c.code === code) ||
    PHONE_COUNTRIES.find((c) => c.code === DEFAULT_PHONE_COUNTRY)
  );
}

export function phoneCountryByDial(dial) {
  const d = digitsOnly(dial);
  return (
    [...PHONE_COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => d.startsWith(c.dial)) || null
  );
}

/** Split a stored phone into country + national number. */
export function parsePhone(value) {
  const raw = digitsOnly(value);
  if (!raw) {
    const country = phoneCountryByCode(DEFAULT_PHONE_COUNTRY);
    return { country, national: "", e164: "" };
  }
  let country = phoneCountryByDial(raw);
  let national = raw;
  if (country) national = raw.slice(country.dial.length);
  else {
    country = phoneCountryByCode(DEFAULT_PHONE_COUNTRY);
    // Local AF numbers often omit the country code.
    if (
      country.code === "AF" &&
      raw.length >= country.min &&
      raw.length <= country.max
    )
      national = raw;
    else {
      country = phoneCountryByCode(DEFAULT_PHONE_COUNTRY);
      national = raw;
    }
  }
  return {
    country,
    national,
    e164: national ? `${country.dial}${national}` : "",
  };
}

export function formatPhoneDisplay(value) {
  const { country, national, e164 } = parsePhone(value);
  if (!national) return "";
  return `+${country.dial} ${national}`;
}

export function buildE164(countryCode, national) {
  const country = phoneCountryByCode(countryCode);
  const local = digitsOnly(national).replace(/^0+/, "");
  if (!local) return "";
  return `${country.dial}${local}`;
}

export function validateNational(countryCode, national) {
  const country = phoneCountryByCode(countryCode);
  const local = digitsOnly(national).replace(/^0+/, "");
  if (!local) return { ok: true, empty: true, e164: "" };
  if (local.length < country.min || local.length > country.max)
    return {
      ok: false,
      empty: false,
      e164: "",
      expected: country.min === country.max ? country.min : `${country.min}–${country.max}`,
    };
  return { ok: true, empty: false, e164: `${country.dial}${local}` };
}

/** True when the number can open a WhatsApp chat (E.164 digits without +). */
export function isWhatsAppPhone(value) {
  const digits = digitsOnly(value).replace(/^0+/, "");
  // Prefer full international; accept stored E.164 without +.
  const parsed = parsePhone(value);
  const e164 = parsed.e164 || digits;
  return /^[1-9]\d{6,14}$/.test(e164);
}

export function whatsAppChatUrl(value, text = "") {
  const parsed = parsePhone(value);
  const e164 = parsed.e164 || digitsOnly(value);
  if (!/^[1-9]\d{6,14}$/.test(e164)) return "";
  const base = `https://wa.me/${e164}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
