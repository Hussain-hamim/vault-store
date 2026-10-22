import { useEffect, useRef, useState } from "react";
import {
  MagnifyingGlassIcon,
  PackageIcon,
  UsersIcon,
  BuildingsIcon,
  XIcon,
} from "@phosphor-icons/react";
import { api, af, Product, Party } from "../api";
import { useT } from "../i18n";

export type GlobalSearchHit = {
  type: "product" | "customer" | "supplier";
  id: string;
  title: string;
  subtitle: string;
  meta: string | number;
  product?: Product;
  party?: Party;
};

export function GlobalSearch({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (hit: GlobalSearchHit) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GlobalSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let activeReq = true;
    const query = q.trim();
    if (!query) {
      setResults([]);
      setBusy(false);
      setError("");
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      api<{ results: GlobalSearchHit[] }>("globalSearch", { q: query, limit: 8 })
        .then((d) => {
          if (!activeReq) return;
          setResults(d.results);
          setActive(0);
          setError("");
        })
        .catch((e) => {
          if (!activeReq) return;
          setError(e.message);
          setResults([]);
        })
        .finally(() => {
          if (activeReq) setBusy(false);
        });
    }, 120);
    return () => {
      activeReq = false;
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(hit: GlobalSearchHit) {
    onSelect(hit);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <div
      className="modal-backdrop global-search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="global-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("globalSearch.title")}
        onKeyDown={onKeyDown}
      >
        <div className="global-search-field">
          <MagnifyingGlassIcon size={20} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("globalSearch.placeholder")}
            aria-label={t("globalSearch.title")}
            autoComplete="off"
          />
          <kbd>{t("globalSearch.shortcutKey")}</kbd>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="global-search-results" ref={listRef} role="listbox">
          {error && <p className="global-search-empty text-red">{error}</p>}
          {!error && !q.trim() && (
            <p className="global-search-empty">{t("globalSearch.empty")}</p>
          )}
          {!error && q.trim() && busy && !results.length && (
            <p className="global-search-empty">{t("common.loading")}</p>
          )}
          {!error && q.trim() && !busy && !results.length && (
            <p className="global-search-empty">{t("globalSearch.noHits")}</p>
          )}
          {results.map((hit, i) => {
            const Icon =
              hit.type === "product"
                ? PackageIcon
                : hit.type === "customer"
                  ? UsersIcon
                  : BuildingsIcon;
            const label =
              hit.type === "product"
                ? t("globalSearch.products")
                : hit.type === "customer"
                  ? t("globalSearch.customers")
                  : t("globalSearch.suppliers");
            const meta =
              hit.type === "product"
                ? String(hit.meta)
                : typeof hit.meta === "number"
                  ? hit.meta > 0
                    ? `${t("common.outstanding")} ${af(hit.meta)}`
                    : t("people.settled")
                  : String(hit.meta || "");
            return (
              <button
                key={`${hit.type}-${hit.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                data-index={i}
                className={`global-search-row${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit)}
              >
                <span className="global-search-icon">
                  <Icon size={18} />
                </span>
                <span className="global-search-copy">
                  <strong>{hit.title}</strong>
                  <small>{hit.subtitle}</small>
                </span>
                <span className="global-search-meta">
                  <span className="global-search-kind">{label}</span>
                  <small>{meta}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
