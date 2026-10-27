import { getToken } from "./api";
import { renderPrintDocument } from "./printing/document.mjs";
import { printFonts } from "./printing/fonts";
import type { PrintDocument, PrintOptions } from "./printing/types";
import { readPrintPreferences } from "./printing/preferences.mjs";
import {
  isWhatsAppPhone,
  parsePhone,
  whatsAppChatUrl,
} from "../shared/phone.mjs";

export function canWhatsApp(phone?: string | null) {
  return !!phone && isWhatsAppPhone(phone);
}

export function whatsAppFileBase(name?: string | null) {
  const cleaned = String(name || "document")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return cleaned || "document";
}

/** Open the local WhatsApp chat for a party phone; optionally prepare a PDF for attaching. */
export async function shareViaWhatsApp({
  phone,
  text,
  document,
  fileBase,
  t,
}: {
  phone: string;
  text?: string;
  document?: PrintDocument;
  fileBase?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<{ message: string }> {
  if (!canWhatsApp(phone)) throw new Error(t("whatsapp.needPhone"));
  const url = whatsAppChatUrl(phone, text || "");
  if (!url) throw new Error(t("whatsapp.needPhone"));

  // Desktop path: main process builds the PDF and opens WhatsApp Desktop only.
  // Never fall back to wa.me+text here — that opens the browser and sends text alone.
  if (window.vault?.shareWhatsApp) {
    let job: Record<string, unknown> | undefined;
    if (document) {
      const options = readPrintPreferences(document) as PrintOptions;
      const html = renderPrintDocument(document, options, printFonts);
      job = {
        mode: "pdf",
        kind: document.kind,
        title: document.title,
        fileBase: whatsAppFileBase(fileBase || document.title),
        html,
        options,
        source: document.source,
      };
    }
    let result;
    try {
      result = await window.vault.shareWhatsApp(
        { phone: parsePhone(phone).e164, text: text || "", job, formatLabels: document ? { title: t("whatsapp.chooseFormat"), image: t("whatsapp.image"), cancel: t("whatsapp.cancelShare") } : undefined },
        getToken(),
      );
    } catch (error: any) {
      const messages: Record<string, string> = {
        WHATSAPP_NOT_INSTALLED: "notInstalled",
        WHATSAPP_AUTOMATION_DENIED: "automationDenied",
        WHATSAPP_CHAT_NOT_READY: "chatNotReady",
        WHATSAPP_ATTACH_FAILED: "attachFailed",
        WHATSAPP_SEND_UNCONFIRMED: "sendUnconfirmed",
        WHATSAPP_UNSUPPORTED: "needDesktop",
        WHATSAPP_BUSY: "busy",
        WHATSAPP_IMAGE_TOO_LARGE: "imageTooLarge",
      };
      // Electron's context bridge can discard custom Error properties.
      const code = error.code || error.message;
      if (messages[code]) throw new Error(t(`whatsapp.${messages[code]}`));
      throw error;
    }
    if (result?.canceled) return { message: t("whatsapp.canceled") };
    if (document && !result?.pdfPath) throw new Error(t("whatsapp.pdfFailed"));
    if (result?.pdfPath) {
      if (result.submitted) return { message: t("whatsapp.fileSubmitted") };
      return { message: t("whatsapp.openedWithPdfManual") };
    }
    return { message: t("whatsapp.opened") };
  }

  // Browser / non-desktop fallback: save PDF if possible, never auto-open wa.me with text
  // when a document was requested (that only sends the greeting).
  if (document && window.vault?.renderPrint) {
    const options = readPrintPreferences(document) as PrintOptions;
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
    return { message: t("whatsapp.openedWithPdfManual") };
  }

  if (document) throw new Error(t("whatsapp.needDesktop"));

  if (window.vault?.openExternal) await window.vault.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
  return { message: t("whatsapp.opened") };
}
