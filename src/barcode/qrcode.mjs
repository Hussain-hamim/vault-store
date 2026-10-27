import QRCode from "qrcode";

/** Product codes fit easily in a version-1/2 QR; keep a hard cap for labels. */
const MAX_LEN = 120;

/** True when the value can be printed as a scannable QR code. */
export function canEncodeQr(text) {
  const value = String(text || "");
  if (!value || value.length > MAX_LEN) return false;
  for (const ch of value) {
    if (ch.charCodeAt(0) > 255) return false;
  }
  return true;
}

/**
 * Compact black/white QR SVG for sticky labels (no human-readable text inside).
 * modulePx is CSS/SVG user units — scale with CSS on the label.
 */
export function qrSvg(text, { margin = 1 } = {}) {
  const value = String(text || "").trim();
  if (!canEncodeQr(value)) throw new Error("barcode.unsupported");
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const dim = size + margin * 2;
  const rects = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.get(y, x)) continue;
      rects.push(`<rect x="${x + margin}" y="${y + margin}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" aria-label="${escapeAttr(value)}">${rects.join("")}</svg>`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
