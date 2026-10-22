import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { I18nProvider } from "./i18n";
import { normalizeDigits, sanitizeNumericInput } from "./api";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/vazirmatn";
import "./styles.css";

const EASTERN_DIGIT = /[\u0660-\u0669\u06F0-\u06F9\u066B\u066C]/;

function isNumericField(el: HTMLInputElement) {
  return (
    el.type === "number" ||
    el.dataset.numeric != null ||
    el.classList.contains("numeric-input") ||
    el.inputMode === "decimal" ||
    el.inputMode === "numeric"
  );
}

function numericKind(
  el: HTMLInputElement,
): "decimal" | "integer" | "signed-decimal" | "signed-integer" {
  const k = el.dataset.numeric;
  if (
    k === "integer" ||
    k === "signed-integer" ||
    k === "signed-decimal" ||
    k === "decimal"
  )
    return k;
  if (el.inputMode === "numeric") return "integer";
  return "decimal";
}

function notifyReact(el: HTMLInputElement) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Pashto/Dari keyboards type ۰-۹ — convert to 0-9 before the field rejects them. */
document.addEventListener(
  "beforeinput",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.readOnly || target.disabled) return;
    if (event.isComposing) return;

    const data = event.data;
    if (!data || !EASTERN_DIGIT.test(data)) return;

    if (isNumericField(target)) {
      event.preventDefault();
      const kind = numericKind(target);
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const inserted = sanitizeNumericInput(data, kind);
      const merged = sanitizeNumericInput(
        target.value.slice(0, start) + inserted + target.value.slice(end),
        kind,
      );
      target.value = merged;
      try {
        const caret = Math.min(start + inserted.length, merged.length);
        target.setSelectionRange(caret, caret);
      } catch {
        /* type=number may not support selection */
      }
      notifyReact(target);
      return;
    }

    // Text fields (barcode, notes): still store Western digits when typed
    event.preventDefault();
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const inserted = normalizeDigits(data);
    target.setRangeText(inserted, start, end, "end");
    notifyReact(target);
  },
  true,
);

document.addEventListener(
  "paste",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !isNumericField(target))
      return;
    if (target.readOnly || target.disabled) return;
    const text = event.clipboardData?.getData("text");
    if (!text || !EASTERN_DIGIT.test(text)) return;
    event.preventDefault();
    const kind = numericKind(target);
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const inserted = sanitizeNumericInput(text, kind);
    target.value = sanitizeNumericInput(
      target.value.slice(0, start) + inserted + target.value.slice(end),
      kind,
    );
    notifyReact(target);
  },
  true,
);

// Number / numeric fields must only change by typing — not scroll or stepper keys.
document.addEventListener(
  "wheel",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !isNumericField(target))
      return;
    if (document.activeElement === target) event.preventDefault();
  },
  { passive: false },
);
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isNumericField(target)) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown")
    event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
