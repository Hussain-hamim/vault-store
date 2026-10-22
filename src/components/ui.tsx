import React, { useEffect, useRef } from "react";
import {
  XIcon,
  MagnifyingGlassIcon,
  ArrowDownIcon,
  ArrowUpRightIcon,
  PackageIcon,
} from "@phosphor-icons/react";
import { af, sanitizeNumericInput } from "../api";
import { useT } from "../i18n";

type NumericKind = "decimal" | "integer" | "signed-decimal" | "signed-integer";

/** Amount/qty field that always stores Western digits, even with a Pashto/Dari keyboard. */
export function NumericInput({
  kind = "decimal",
  className,
  onChange,
  onPaste,
  inputMode,
  lang = "en",
  dir = "ltr",
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  kind?: NumericKind;
}) {
  const mode =
    inputMode ??
    (kind === "integer" || kind === "signed-integer" ? "numeric" : "decimal");

  function applyValue(
    el: HTMLInputElement,
    raw: string,
    event: React.SyntheticEvent<HTMLInputElement>,
  ) {
    const next = sanitizeNumericInput(raw, kind);
    if (el.value !== next) el.value = next;
    onChange?.(event as React.ChangeEvent<HTMLInputElement>);
  }

  const { value, defaultValue, ...rest } = props;
  const normalizedValue =
    value === undefined || value === null
      ? value
      : sanitizeNumericInput(String(value), kind);
  const normalizedDefault =
    defaultValue === undefined || defaultValue === null
      ? defaultValue
      : sanitizeNumericInput(String(defaultValue), kind);

  return (
    <input
      {...rest}
      type="text"
      inputMode={mode}
      lang={lang}
      dir={dir}
      autoComplete="off"
      spellCheck={false}
      data-numeric={kind}
      className={["numeric-input", className].filter(Boolean).join(" ")}
      value={normalizedValue}
      defaultValue={normalizedDefault}
      onChange={(e) => applyValue(e.currentTarget, e.currentTarget.value, e)}
      onPaste={(e) => {
        onPaste?.(e);
        if (e.defaultPrevented) return;
        const text = e.clipboardData.getData("text");
        if (!text) return;
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const merged =
          el.value.slice(0, start) +
          sanitizeNumericInput(text, kind) +
          el.value.slice(end);
        applyValue(el, merged, e);
        const caret = Math.min(
          start + sanitizeNumericInput(text, kind).length,
          el.value.length,
        );
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
      }}
    />
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,select,button",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const backdrops = document.querySelectorAll(".modal-backdrop");
        if (backdrops[backdrops.length - 1] === ref.current?.parentElement)
          onClose();
        return;
      }
      if (e.key === "Tab") {
        const list = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        );
        if (!list.length) return;
        if (e.shiftKey && document.activeElement === list[0]) {
          e.preventDefault();
          list.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
          e.preventDefault();
          list[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div className="modal-head-copy">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button modal-close"
            aria-label={t("ui.closeDialog")}
            onClick={onClose}
          >
            <XIcon size={18} weight="bold" aria-hidden />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function ProductName({
  product,
  sub,
}: {
  product: { name: string; image?: string; sku?: string; brand?: string };
  sub?: string;
}) {
  return (
    <span className="product-name">
      <span className="product-image">
        {product.image ? (
          <img src={product.image} alt="" />
        ) : (
          <PackageIcon size={20} />
        )}
      </span>
      <span>
        <strong>{product.name}</strong>
        <small>{sub || product.sku || product.brand}</small>
      </span>
    </span>
  );
}
export function Search({
  value,
  onChange,
  placeholder,
  onFocus,
  onBlur,
  onClick,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onClick?: () => void;
}) {
  const t = useT();
  const ph = placeholder ?? t("ui.searchProducts");
  return (
    <div className="search-input">
      <MagnifyingGlassIcon size={17} />
      <input
        aria-label={ph}
        placeholder={ph}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
      />
      {value && (
        <button
          type="button"
          aria-label={t("ui.clearSearch")}
          onClick={() => onChange("")}
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  const t = useT();
  const emptyTitle = title ?? t("ui.emptyTitle");
  const emptyText = text ?? t("ui.emptyText");
  return (
    <div className="empty">
      <PackageIcon size={32} weight="light" />
      <h3>{emptyTitle}</h3>
      <p>{emptyText}</p>
      {action}
    </div>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function PageIntro({
  eyebrow,
  title,
  description,
  action,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`page-intro${compact ? " page-intro-compact" : ""}`}>
      <div className="page-intro-copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="page-intro-actions">{action}</div> : null}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  dark = false,
}: {
  label: string;
  value: string;
  detail?: string;
  dark?: boolean;
}) {
  return (
    <div className={`simple-metric ${dark ? "dark" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Money({ value }: { value: number }) {
  return <span className="money">{af(value)}</span>;
}
export function ExportButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button className="button" onClick={onClick}>
      <ArrowDownIcon size={15} />
      {t("ui.exportCsv")}
    </button>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRightIcon size={14} />
    </button>
  );
}
