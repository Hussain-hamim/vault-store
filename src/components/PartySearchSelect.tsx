import { useEffect, useRef, useState } from "react";
import { api, type Party } from "../api";
import { useT } from "../i18n";

const PAGE = 10;

export function PartySearchSelect({
  kind,
  value,
  selected,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  walkInLabel,
  excludeWalkIn = false,
}: {
  kind: "customer" | "supplier";
  value: string;
  selected: Party | null;
  onChange: (party: Party | null) => void;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  walkInLabel?: string;
  excludeWalkIn?: boolean;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Party[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    setNext(null);
    const timer = setTimeout(
      () =>
        api<{ rows: Party[]; next: string | null }>("parties", {
          kind,
          q: q.trim(),
          limit: PAGE,
        })
          .then((d) => {
            if (!active) return;
            setRows(d.rows);
            setNext(d.next);
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      q.trim() ? 160 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, q, kind]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await api<{ rows: Party[]; next: string | null }>("parties", {
        kind,
        q: q.trim(),
        after: next,
        limit: PAGE,
      });
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...d.rows.filter((p) => !seen.has(p.id))];
      });
      setNext(d.next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const display = open ? q : selected?.name || "";

  return (
    <div
      className={`party-search-select${open ? " open" : ""}`}
      ref={rootRef}
    >
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="party-search-list"
        value={display}
        disabled={disabled}
        required={required && !value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          setQ(e.target.value);
          if (value) onChange(null);
        }}
      />
      {open && (
        <div
          className="party-search-menu"
          role="listbox"
          id="party-search-list"
        >
          {loading ? (
            <div className="party-search-empty">{t("common.loading")}</div>
          ) : error ? (
            <div className="party-search-empty text-red">{error}</div>
          ) : (
            (() => {
              const options = excludeWalkIn
                ? rows.filter((p) => !p.walk_in)
                : rows;
              return options.length ? (
                <>
                  {options.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === value}
                      className={p.id === value ? "selected" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(p);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <strong>{p.name}</strong>
                      <small>
                        {[
                          p.phone,
                          p.walk_in ? walkInLabel || t("sales.walkIn") : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </small>
                    </button>
                  ))}
                  {next ? (
                    <button
                      type="button"
                      className="party-search-more"
                      disabled={loadingMore}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={loadMore}
                    >
                      {loadingMore
                        ? t("common.loading")
                        : t("pagination.loadMore")}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="party-search-empty">
                  {t("sales.noPartyMatch")}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
