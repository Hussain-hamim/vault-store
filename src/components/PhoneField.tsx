import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  buildE164,
  digitsOnly,
  parsePhone,
  phoneCountryByCode,
  validateNational,
} from "../../shared/phone.mjs";
import { Field } from "./ui";

function flagEmoji(code: string) {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function PhoneField({
  name = "phone",
  label,
  defaultValue = "",
  required = false,
  value,
  onChange,
}: {
  name?: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  value?: string;
  onChange?: (e164: string) => void;
}) {
  const { t, locale } = useI18n();
  const initial = useMemo(() => parsePhone(defaultValue || value || ""), []);
  const [countryCode, setCountryCode] = useState(
    initial.country?.code || DEFAULT_PHONE_COUNTRY,
  );
  const [national, setNational] = useState(initial.national);
  const country = phoneCountryByCode(countryCode);
  const check = validateNational(countryCode, national);
  const e164 = check.e164 || buildE164(countryCode, national);
  const names = useMemo(
    () =>
      new Intl.DisplayNames([locale === "prs" ? "fa-AF" : locale], {
        type: "region",
      }),
    [locale],
  );
  function emit(nextCountry: string, nextNational: string) {
    const built = buildE164(nextCountry, nextNational);
    onChange?.(built ? `+${built}` : "");
  }
  return (
    <Field label={label}>
      <div className="phone-field">
        <select
          aria-label={t("phone.country")}
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
            emit(e.target.value, national);
          }}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {flagEmoji(c.code)} +{c.dial} ·{" "}
              {names.of(c.code) || c.name}
            </option>
          ))}
        </select>
        <span className="phone-dial" dir="ltr">
          +{country.dial}
        </span>
        <input
          name={`${name}_national`}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          dir="ltr"
          data-digits="western"
          required={required}
          value={national}
          maxLength={country.max + 2}
          placeholder={t("phone.nationalPh", { n: country.max })}
          onChange={(e) => {
            const next = digitsOnly(e.target.value).slice(0, country.max);
            setNational(next);
            emit(countryCode, next);
          }}
        />
        <input type="hidden" name={name} value={e164 ? `+${e164}` : ""} />
      </div>
      <p className="entry-field-hint">
        {t("phone.lengthHint", {
          dial: country.dial,
          n:
            country.min === country.max
              ? String(country.min)
              : `${country.min}–${country.max}`,
        })}
      </p>
      {!check.ok && national && (
        <p className="field-error" role="alert">
          {t("phone.invalidLength", {
            n: String(check.expected),
            dial: country.dial,
          })}
        </p>
      )}
    </Field>
  );
}

/** Throw a translated error when a filled phone fails country length rules. */
export function assertPhoneValid(
  phone: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  if (!String(phone || "").trim()) return "";
  const parsed = parsePhone(phone);
  const check = validateNational(parsed.country.code, parsed.national);
  if (!check.ok)
    throw new Error(
      t("phone.invalidLength", {
        n: String(check.expected),
        dial: parsed.country.dial,
      }),
    );
  return check.e164 ? `+${check.e164}` : "";
}
