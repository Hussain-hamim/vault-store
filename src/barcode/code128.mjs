/** Compact Code 128-B encoder → SVG suitable for product labels (no external deps). */
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "11000111010",
];
const START_B = 104;
const STOP = 106;

function valueOf(char) {
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) return -1;
  return code - 32;
}

/** Returns true when every character fits Code 128-B (printable ASCII). */
export function canEncodeCode128(text) {
  const value = String(text || "");
  if (!value || value.length > 48) return false;
  for (const ch of value) if (valueOf(ch) < 0) return false;
  return true;
}

function modulesFor(text) {
  const values = [START_B];
  let checksum = START_B;
  for (let i = 0; i < text.length; i++) {
    const v = valueOf(text[i]);
    if (v < 0) throw new Error("barcode.unsupported");
    values.push(v);
    checksum += v * (i + 1);
  }
  values.push(checksum % 103, STOP);
  return values.map((v) => PATTERNS[v]).join("") + "11";
}

/** Build an inline SVG barcode; text is drawn under the bars. */
export function code128Svg(text, { height = 48, showText = true } = {}) {
  const value = String(text || "").trim();
  if (!canEncodeCode128(value)) throw new Error("barcode.unsupported");
  const bits = modulesFor(value);
  const module = 2;
  const width = bits.length * module;
  const barHeight = showText ? height - 14 : height;
  let x = 0;
  const rects = [];
  for (const bit of bits) {
    if (bit === "1")
      rects.push(
        `<rect x="${x}" y="0" width="${module}" height="${barHeight}" fill="#111"/>`,
      );
    x += module;
  }
  const label = showText
    ? `<text x="${width / 2}" y="${height - 2}" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-size="11" fill="#111">${escapeXml(value)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(value)}">${rects.join("")}${label}</svg>`;
}

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
