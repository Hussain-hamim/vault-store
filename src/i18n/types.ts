export type Locale = "en" | "ps" | "prs";

export const LOCALES: {
  id: Locale;
  label: string;
  nativeLabel: string;
  dir: "ltr" | "rtl";
  htmlLang: string;
}[] = [
  { id: "en", label: "English", nativeLabel: "English", dir: "ltr", htmlLang: "en" },
  { id: "ps", label: "Pashto", nativeLabel: "پښتو", dir: "rtl", htmlLang: "ps" },
  {
    id: "prs",
    label: "Dari",
    nativeLabel: "دری",
    dir: "rtl",
    htmlLang: "fa-AF",
  },
];

export const LOCALE_STORAGE_KEY = "vault-locale";

export type MessageTree = { [key: string]: string | MessageTree };
