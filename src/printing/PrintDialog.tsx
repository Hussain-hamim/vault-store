import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PrinterIcon,
  DownloadSimpleIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { api, sendPrintJob } from "../api";
import { useI18n } from "../i18n";
import { ErrorMessage, Field, Modal, NumericInput } from "../components/ui";
import {
  normalizePrintOptions,
  PAPER_SIZES,
  LABEL_PAPERS,
  PRINT_LAYOUTS,
  PRINT_THEMES,
  printGeometry,
} from "../../server/print-options.mjs";
import { renderPrintDocument } from "./document.mjs";
import "./print-setup.css";
import { printPreferenceKey, readPrintPreferences } from "./preferences.mjs";
import type { PrintDocument, PrintOptions } from "./types";

function expandLabelCopies(
  doc: PrintDocument,
  copies: number,
  subtitle: string,
): PrintDocument {
  if (doc.kind !== "label") return doc;
  const n = Math.max(1, Math.min(500, Math.floor(Number(copies) || 1)));
  const templates = doc.labels || [];
  const labels = [];
  for (const label of templates) {
    for (let i = 0; i < n; i++) labels.push(label);
  }
  return {
    ...doc,
    labels,
    labelCopies: n,
    subtitle,
  };
}

export function PrintDialog({
  document: baseDoc,
  onClose,
  defaultCopies,
}: {
  document: PrintDocument;
  onClose: () => void;
  defaultCopies?: number;
}) {
  const { t } = useI18n();
  const labelJob = baseDoc.kind === "label";
  const [options, setOptions] = useState<PrintOptions>(() =>
    readPrintPreferences(baseDoc),
  );
  const [copies, setCopies] = useState(() =>
    String(
      Math.max(
        1,
        Math.min(
          500,
          Math.floor(Number(defaultCopies ?? baseDoc.labelCopies ?? 1) || 1),
        ),
      ),
    ),
  );
  const [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [readyHtml, setReadyHtml] = useState(""),
    [fonts, setFonts] = useState<Record<string, string> | null>(null),
    [error, setError] = useState("");
  const [scale, setScale] = useState(0.6),
    [frameHeight, setFrameHeight] = useState(1100);
  const frame = useRef<HTMLIFrameElement>(null),
    preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    import("./fonts")
      .then((module) => {
        if (active) setFonts(module.printFonts);
      })
      .catch(() => {
        if (active) setError(t("printing.previewError"));
      });
    return () => {
      active = false;
    };
  }, [t]);
  const doc = useMemo(
    () =>
      expandLabelCopies(
        baseDoc,
        Number(copies) || 1,
        t("barcode.labelsSubtitle", {
          n:
            (baseDoc.labels?.length || 0) *
            Math.max(1, Math.min(500, Math.floor(Number(copies) || 1))),
        }),
      ),
    [baseDoc, copies, t],
  );
  const html = useMemo(
    () => renderPrintDocument(doc, options, fonts || {}),
    [doc, options, fonts],
  );
  const ready = !!fonts && readyHtml === html;
  const currentHtml = useRef(html);
  currentHtml.current = html;
  const geometry = printGeometry(options, doc.kind),
    width = (geometry.width * 96) / 25.4;
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setScale(
        Math.min(
          1,
          Math.max(0.15, (entries[0].contentRect.width - 24) / width),
        ),
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  const update = (key: keyof PrintOptions, value: string | boolean) =>
    setOptions((current) =>
      normalizePrintOptions({ ...current, [key]: value }, doc.kind),
    );
  async function frameLoaded() {
    const loadedHtml = html;
    const content = frame.current?.contentDocument;
    if (!content) return;
    try {
      await content.fonts.ready;
      await Promise.all(
        Array.from(content.images).map((image) =>
          image.decode().catch(() => {}),
        ),
      );
      if (currentHtml.current !== loadedHtml) return;
      setFrameHeight(
        Math.max(
          (geometry.height * 96) / 25.4,
          (content.querySelector(".sheet")?.scrollHeight || 0) +
            (geometry.margin * 2 * 96) / 25.4,
        ),
      );
      setReadyHtml(loadedHtml);
    } catch {
      setError(t("printing.previewError"));
    }
  }
  function persist() {
    try {
      const key = printPreferenceKey(doc);
      if (remember) localStorage.setItem(key, JSON.stringify(options));
      else localStorage.removeItem(key);
    } catch {
      /* Printing remains available when local storage is disabled. */
    }
  }
  async function output(mode: "print" | "pdf" | "html") {
    setBusy(true);
    setError("");
    persist();
    try {
      if (window.vault?.renderPrint && mode !== "html") {
        await sendPrintJob({
          html,
          title: doc.reference || doc.title,
          options,
          source: doc.source,
          kind: doc.kind,
          mode,
        });
      } else if (mode === "html") {
        const url = URL.createObjectURL(
          new Blob([html], { type: "text/html;charset=utf-8" }),
        );
        const link = window.document.createElement("a");
        link.href = url;
        link.download = `${(doc.reference || doc.title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")}.html`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const target = frame.current?.contentWindow;
        if (!target) throw new Error(t("printing.previewError"));
        target.focus();
        target.print();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <Modal
      title={t(labelJob ? "barcode.printSetup" : "printing.title")}
      subtitle={t(labelJob ? "barcode.printSetupHint" : "printing.subtitle")}
      onClose={() => {
        persist();
        onClose();
      }}
      wide
      className="print-setup-modal"
    >
      <div className="print-setup-grid">
        <div className="print-settings">
          {labelJob && (
            <div className="print-settings-group">
              <Field label={t("barcode.copies")}>
                <NumericInput
                  min="1"
                  max="500"
                  step="1"
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                  autoFocus
                />
              </Field>
              <p className="muted">{t("barcode.copiesHint")}</p>
            </div>
          )}
          {baseDoc.billStyle === "saleShop" && (
            <div className="print-settings-group">
              <Field label={t("printing.template")}>
                <select
                  value={options.template}
                  onChange={(e) => update("template", e.target.value)}
                >
                  <option value="standard">
                    {t("printing.standardTemplate")}
                  </option>
                  <option value="golden">{t("printing.goldenTemplate")}</option>
                </select>
              </Field>
              <p className="muted">{t("printing.templateHint")}</p>
            </div>
          )}
          {!labelJob && options.template !== "golden" && (
            <div className="print-settings-group">
              <h3>{t("printing.layout")}</h3>
              <div
                className="print-layouts"
                role="group"
                aria-label={t("printing.layout")}
              >
                {PRINT_LAYOUTS.map((layout) => (
                  <button
                    type="button"
                    key={layout}
                    aria-pressed={options.layout === layout}
                    className={options.layout === layout ? "selected" : ""}
                    onClick={() => update("layout", layout)}
                  >
                    <span
                      className={`layout-thumbnail thumbnail-${layout}`}
                      aria-hidden="true"
                    >
                      <i />
                      <b />
                      <em />
                      <em />
                      <em />
                    </span>
                    <span>{t(`printing.layouts.${layout}`)}</span>
                    {options.layout === layout && <CheckIcon size={14} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!labelJob && options.template !== "golden" && (
            <div className="print-settings-group">
              <h3>{t("printing.theme")}</h3>
              <div
                className="print-themes"
                role="group"
                aria-label={t("printing.theme")}
              >
                {Object.entries(PRINT_THEMES).map(([id, theme]) => (
                  <button
                    type="button"
                    key={id}
                    title={t(`printing.themes.${id}`)}
                    aria-label={t(`printing.themes.${id}`)}
                    aria-pressed={options.theme === id}
                    onClick={() => update("theme", id)}
                    className={options.theme === id ? "selected" : ""}
                  >
                    <span style={{ background: theme.accent }}>
                      {options.theme === id && <CheckIcon size={15} />}
                    </span>
                    <small>{t(`printing.themes.${id}`)}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="print-settings-group">
            {labelJob && LABEL_PAPERS.length === 1 ? (
              <Field label={t("barcode.labelSize")}>
                <input
                  readOnly
                  value={`${t(`printing.papers.${LABEL_PAPERS[0]}`)} · ${PAPER_SIZES.label29x18.width} × ${PAPER_SIZES.label29x18.height} mm`}
                />
                <p className="muted">{t("barcode.thermalHint")}</p>
              </Field>
            ) : (
              <Field
                label={t(labelJob ? "barcode.labelSize" : "printing.paper")}
              >
                <select
                  value={options.paper}
                  onChange={(e) => update("paper", e.target.value)}
                >
                  {(labelJob
                    ? (
                        LABEL_PAPERS as readonly (keyof typeof PAPER_SIZES)[]
                      ).map((id) => [id, PAPER_SIZES[id]] as const)
                    : Object.entries(PAPER_SIZES).filter(
                        ([id]) =>
                          (doc.kind === "invoice" ||
                            !id.startsWith("receipt")) &&
                          (options.template !== "golden" ||
                            !id.startsWith("receipt")) &&
                          !id.startsWith("label"),
                      )
                  ).map(([id, paper]) => (
                    <option key={id} value={id}>
                      {t(`printing.papers.${id}`)} · {paper.width} ×{" "}
                      {paper.height} mm
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!labelJob && (
              <div className="form-grid">
                <Field label={t("printing.orientation")}>
                  <select
                    value={options.orientation}
                    disabled={options.paper.startsWith("receipt")}
                    onChange={(e) => update("orientation", e.target.value)}
                  >
                    <option value="portrait">{t("printing.portrait")}</option>
                    <option value="landscape">{t("printing.landscape")}</option>
                  </select>
                </Field>
                <Field label={t("printing.margins")}>
                  <select
                    value={options.margins}
                    disabled={options.paper.startsWith("receipt")}
                    onChange={(e) => update("margins", e.target.value)}
                  >
                    <option value="standard">{t("printing.standard")}</option>
                    <option value="narrow">{t("printing.narrow")}</option>
                  </select>
                </Field>
              </div>
            )}
            {labelJob && <p className="muted">{t("barcode.driverHint")}</p>}
          </div>
          <div className="print-settings-group print-toggles">
            {!labelJob &&
              (
                [
                  "showLogo",
                  ...(doc.kind === "invoice" ? ["showSpecs"] : []),
                  "showFooter",
                  ...(doc.billStyle === "saleShop" ? ["showWatermark"] : []),
                ] as (keyof PrintOptions)[]
              ).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!options[key]}
                    onChange={(e) => update(key, e.target.checked)}
                  />
                  <span>{t(`printing.${key}`)}</span>
                </label>
              ))}
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>{t("printing.remember")}</span>
            </label>
          </div>
        </div>
        <div className="print-preview-area">
          <div className="print-preview-heading">
            <strong>{t("printing.preview")}</strong>
            <span>
              {t(`printing.papers.${options.paper}`)} ·{" "}
              {t(`printing.${options.orientation}`)}
            </span>
          </div>
          <div
            className="print-preview-scroll"
            ref={preview}
            aria-busy={!ready}
          >
            <div
              className="print-preview-size"
              style={{ width: width * scale, height: frameHeight * scale }}
            >
              <iframe
                ref={frame}
                title={t("printing.preview")}
                srcDoc={html}
                sandbox="allow-same-origin allow-modals"
                tabIndex={-1}
                onLoad={frameLoaded}
                style={{
                  width,
                  height: frameHeight,
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          </div>
          <p className="print-preview-note">
            {t(
              window.vault?.renderPrint
                ? "printing.printerHint"
                : "reports.browserPdfHint",
            )}
          </p>
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className="modal-actions">
        <button
          className="button"
          onClick={() => {
            persist();
            onClose();
          }}
          disabled={busy}
        >
          {t("common.close")}
        </button>
        <button
          className="button"
          disabled={busy || !ready}
          onClick={() => output("pdf")}
        >
          <DownloadSimpleIcon size={16} />
          {t("printing.savePdf")}
        </button>
        <button
          className="button button-dark"
          disabled={busy || !ready}
          onClick={() => output("print")}
        >
          <PrinterIcon size={16} />
          {t(
            busy
              ? "printing.preparing"
              : window.vault?.renderPrint
                ? "common.print"
                : "printing.printPdf",
          )}
        </button>
      </div>
    </Modal>,
    window.document.body,
  );
}
/** Gives every report the same print chooser without touching its query or ledger. */
export function ReportPrintButton({
  getDocument,
  disabled = false,
  intent = "print",
}: {
  getDocument: () => PrintDocument | Promise<PrintDocument>;
  intent?: "print" | "pdf";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<PrintDocument | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const close = useCallback(() => setDoc(null), []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function openPrint() {
    setBusy(true);
    setError("");
    try {
      const snapshot = await getDocument();
      const status = await api("status");
      if (mounted.current) setDoc({ ...snapshot, store: status.store });
    } catch (e: any) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <button
        className="button"
        type="button"
        disabled={disabled || busy}
        onClick={openPrint}
      >
        {intent === "pdf" ? (
          <DownloadSimpleIcon size={16} />
        ) : (
          <PrinterIcon size={16} />
        )}
        {t(
          busy
            ? "printing.preparing"
            : intent === "pdf"
              ? "printing.savePdf"
              : "common.print",
        )}
      </button>
      {error && (
        <span className="text-red" role="alert">
          {error}
        </span>
      )}
      {doc && <PrintDialog document={doc} onClose={close} />}
    </>
  );
}
