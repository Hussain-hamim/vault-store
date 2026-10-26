import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import {
  DEFAULT_CURRENCIES,
  SUPPORTED_FLAG_COUNTRIES,
  currencyCountry,
} from "../../shared/currencies.mjs";
import { Modal, Field, ErrorMessage } from "./ui";
import "./currencies.css";

export type Currency = { code: string; name: string; country: string };

/** Lazy flag modules — do not eager-load hundreds of SVGs into the app bundle. */
const flagModules = import.meta.glob<string>(
  "../../node_modules/flag-icons/flags/4x3/*.svg",
  { query: "?url", import: "default" },
);

const flagCache = new Map<string, string>();

function flagModuleKey(country: string) {
  return `../../node_modules/flag-icons/flags/4x3/${country.toLowerCase()}.svg`;
}

function loadFlagUrl(country: string): Promise<string | undefined> {
  const code = country.toLowerCase();
  if (flagCache.has(code)) return Promise.resolve(flagCache.get(code));
  const loader = flagModules[flagModuleKey(code)];
  if (!loader) return Promise.resolve(undefined);
  return loader().then((url) => {
    flagCache.set(code, url);
    return url;
  });
}

export const flagEmoji = (country: string) =>
  country
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

export function CurrencyFlag({
  code,
  country,
}: {
  code?: string;
  country?: string;
}) {
  const [savedCountry, setSavedCountry] = useState<string>();
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let active = true;
    setSavedCountry(undefined);
    if (!country && code && !currencyCountry(code)) {
      api<Currency[]>("currencies")
        .then((rows) => {
          if (active)
            setSavedCountry(rows.find((c) => c.code === code)?.country);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [code, country]);
  const region = country || currencyCountry(code || "AFN") || savedCountry;
  useEffect(() => {
    let active = true;
    setSrc(undefined);
    if (!region) return;
    loadFlagUrl(region).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [region]);
  return src ? (
    <img
      className="currency-flag"
      src={src}
      alt={code || region?.toUpperCase() || ""}
    />
  ) : (
    <span aria-hidden="true">¤</span>
  );
}

export function CurrencyPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Currency[]>(DEFAULT_CURRENCIES);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("us");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api<Currency[]>("currencies")
        .then((data) => {
          if (active) setRows(data);
        })
        .catch(() => {});
    refresh();
    window.addEventListener("currencies-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("currencies-changed", refresh);
    };
  }, []);
  const selected = rows.find((c) => c.code === value);
  const names = new Intl.DisplayNames([locale === "prs" ? "fa-AF" : locale], {
    type: "region",
  });
  const countries = [...SUPPORTED_FLAG_COUNTRIES]
    .filter((c) => /^[a-z]{2}$/.test(c))
    .sort((a, b) =>
      (names.of(a.toUpperCase()) || a).localeCompare(
        names.of(b.toUpperCase()) || b,
      ),
    );
  async function save() {
    setBusy(true);
    setError("");
    try {
      const currency = await api<Currency>("currencyCreate", {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        country,
      });
      setRows((current) =>
        current.some((c) => c.code === currency.code)
          ? current
          : [...current, currency],
      );
      onChange(currency.code);
      setAdding(false);
      window.dispatchEvent(new Event("currencies-changed"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`currency-control${compact ? " currency-compact" : ""}`}>
      <div className="currency-picker">
        <CurrencyFlag code={value} country={selected?.country} />
        <select
          aria-label={t("currencies.choose")}
          title={selected ? `${selected.code} · ${selected.name}` : value}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {!selected && <option value={value}>{value}</option>}
          {rows.map((c) => (
            <option key={c.code} value={c.code}>
              {!compact && flagEmoji(c.country)} {c.code}
              {!compact && ` · ${c.name}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          title={t("currencies.add")}
          aria-label={t("currencies.add")}
          onClick={() => {
            setError("");
            setCode("");
            setName("");
            setAdding(true);
          }}
        >
          {compact ? <span aria-hidden="true">+</span> : t("currencies.add")}
        </button>
      </div>
      {!adding && <ErrorMessage error={error} />}
      {adding &&
        createPortal(
          <Modal title={t("currencies.add")} onClose={() => setAdding(false)}>
            <div
              className="form-body"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (
                    code.trim().length === 3 &&
                    name.trim().length >= 2 &&
                    !busy
                  )
                    void save();
                }
              }}
            >
              <p className="muted">{t("currencies.savedHint")}</p>
              <Field label={t("currencies.code")}>
                <input
                  aria-label={t("currencies.code")}
                  value={code}
                  maxLength={3}
                  dir="ltr"
                  onChange={(e) =>
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                  }
                  placeholder="USD"
                />
              </Field>
              <Field label={t("currencies.name")}>
                <input
                  aria-label={t("currencies.name")}
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={t("currencies.flag")}>
                <div className="currency-country">
                  <CurrencyFlag country={country} />
                  <select
                    aria-label={t("currencies.flag")}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {flagEmoji(c)} {names.of(c.toUpperCase()) || c}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
              <ErrorMessage error={error} />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setAdding(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="button button-dark"
                disabled={
                  busy || code.trim().length !== 3 || name.trim().length < 2
                }
                onClick={() => void save()}
              >
                {busy ? t("common.saving") : t("currencies.add")}
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </div>
  );
}
