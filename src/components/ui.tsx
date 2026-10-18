import React, { useEffect, useRef } from "react";
import {
  XIcon,
  MagnifyingGlassIcon,
  ArrowDownIcon,
  ArrowUpRightIcon,
  PackageIcon,
} from "@phosphor-icons/react";
import { af } from "../api";
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,select,button",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <XIcon size={20} />
          </button>
        </div>
        {children}
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
  placeholder = "Search products…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <MagnifyingGlassIcon size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title = "Nothing here yet",
  text = "Your records will appear here.",
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <PackageIcon size={32} weight="light" />
      <h3>{title}</h3>
      <p>{text}</p>
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
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
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
  return (
    <button className="button" onClick={onClick}>
      <ArrowDownIcon size={15} />
      Export CSV
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
