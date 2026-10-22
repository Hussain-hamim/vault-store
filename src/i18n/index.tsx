import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import { ps } from "./ps";
import { prs } from "./prs";
import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  type Locale,
  type MessageTree,
} from "./types";

const catalogs: Record<Locale, MessageTree> = { en, ps, prs };

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "en" || v === "ps" || v === "prs") return v;
  } catch {
    /* private mode */
  }
  return "en";
}

function lookup(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: string | MessageTree | undefined = tree;
  for (const p of parts) {
    if (!cur || typeof cur === "string") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`,
  );
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
) {
  const pluralKey =
    vars && typeof vars.n === "number" && vars.n !== 1 && lookup(catalogs[locale], `${key}_plural`)
      ? `${key}_plural`
      : key;
  const raw =
    lookup(catalogs[locale], pluralKey) ||
    lookup(en, pluralKey) ||
    lookup(en, key) ||
    key;
  return interpolate(raw, vars);
}

export function applyDocumentLocale(locale: Locale) {
  const meta = LOCALES.find((l) => l.id === locale) || LOCALES[0];
  document.documentElement.lang = meta.htmlLang;
  document.documentElement.dir = meta.dir;
  document.documentElement.dataset.locale = locale;
  document.title = translate(locale, "app.title");
}

type I18nContextValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale || readStoredLocale(),
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      dir: (LOCALES.find((l) => l.id === locale)?.dir || "ltr") as
        | "ltr"
        | "rtl",
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}

export { LOCALES, LOCALE_STORAGE_KEY };
export type { Locale };
