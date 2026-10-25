import { DesktopActivationGate } from "./components/DesktopActivation";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { I18nProvider } from "./i18n";
import { normalizeDigits, sanitizeNumericInput } from "./api";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/vazirmatn";
import "./styles.css";
import "./theme.css";
import "./appearance.css";
import "./responsive.css";

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

// Bypass React's tracked setter so the input event updates controlled state too.
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
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
    if (!event.cancelable || !data || !EASTERN_DIGIT.test(data)) return;

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
      setNativeValue(target, merged);
      try {
        const caret = Math.min(start + inserted.length, merged.length);
        target.setSelectionRange(caret, caret);
      } catch {
        /* type=number may not support selection */
      }
      notifyReact(target);
      return;
    }

    // Normalize identifiers only; passwords and free text must remain exactly as entered.
    if (target.type !== "text" || !/barcode|sku/i.test(target.name)) return;
    event.preventDefault();
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const inserted = normalizeDigits(data);
    setNativeValue(
      target,
      target.value.slice(0, start) + inserted + target.value.slice(end),
    );
    target.setSelectionRange(start + inserted.length, start + inserted.length);
    notifyReact(target);
  },
  true,
);

document.addEventListener(
  "paste",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const numeric = isNumericField(target);
    const identifier =
      target.type === "text" && /barcode|sku/i.test(target.name);
    if (!numeric && !identifier) return;
    if (target.readOnly || target.disabled) return;
    const text = event.clipboardData?.getData("text");
    if (!text || !EASTERN_DIGIT.test(text)) return;
    event.preventDefault();
    const kind = numericKind(target);
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const inserted = numeric
      ? sanitizeNumericInput(text, kind)
      : normalizeDigits(text);
    const merged =
      target.value.slice(0, start) + inserted + target.value.slice(end);
    setNativeValue(
      target,
      numeric ? sanitizeNumericInput(merged, kind) : merged,
    );
    try {
      target.setSelectionRange(
        start + inserted.length,
        start + inserted.length,
      );
    } catch {
      /* native number fields have no selection */
    }
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
      <DesktopActivationGate>
        <App />
      </DesktopActivationGate>
    </I18nProvider>
  </React.StrictMode>,
);
