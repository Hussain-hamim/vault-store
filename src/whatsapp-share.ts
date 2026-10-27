import { getToken } from "./api";
import { renderPrintDocument } from "./printing/document.mjs";
import { printFonts } from "./printing/fonts";
import type { PrintDocument, PrintOptions } from "./printing/types";
import { normalizePrintOptions } from "../server/print-options.mjs";
import {
  isWhatsAppPhone,
  parsePhone,
  whatsAppChatUrl,
} from "../shared/phone.mjs";

export function canWhatsApp(phone?: string | null) {
  return !!phone && isWhatsAppPhone(phone);
}

/** Open the local WhatsApp chat for a party phone; optionally prepare a PDF for attaching. */
export async function shareViaWhatsApp({
  phone,
  text,
  document,
  t,
}: {
  phone: string;
  text?: string;
  document?: PrintDocument;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<{ message: string }> {
  if (!canWhatsApp(phone)) throw new Error(t("whatsapp.needPhone"));
  const url = whatsAppChatUrl(phone, text || "");
  if (!url) throw new Error(t("whatsapp.needPhone"));

  if (window.vault?.shareWhatsApp) {
    let job: Record<string, unknown> | undefined;
    if (document) {
      const options = normalizePrintOptions(
        { paper: "A4", layout: "modern", theme: "mono" },
        document.kind,
      ) as PrintOptions;
      const html = renderPrintDocument(document, options, printFonts);
      job = {
        mode: "pdf",
        kind: document.kind,
        title: document.title,
        html,
        options,
        source: document.source,
      };
    }
    const result = await window.vault.shareWhatsApp(
      { phone: parsePhone(phone).e164, text: text || "", job },
      getToken(),
    );
    if (result?.pdfPath) {
      if (result.pasted) return { message: t("whatsapp.openedWithPdf") };
      if (result.copied)
        return { message: t("whatsapp.openedWithPdfManual") };
      return { message: t("whatsapp.openedWithPdfManual") };
    }
    return { message: t("whatsapp.opened") };
  }

  if (document && window.vault?.renderPrint) {
    const options = normalizePrintOptions(
      { paper: "A4", layout: "modern", theme: "mono" },
      document.kind,
    ) as PrintOptions;
    const html = renderPrintDocument(document, options, printFonts);
    await window.vault.renderPrint(
      {
        mode: "pdf",
        kind: document.kind,
        title: document.title,
        html,
        options,
        source: document.source,
      },
      getToken(),
    );
  }

  if (window.vault?.openExternal) await window.vault.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
  return {
    message: document ? t("whatsapp.openedWithPdf") : t("whatsapp.opened"),
  };
}
