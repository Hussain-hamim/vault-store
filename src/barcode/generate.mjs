/** Store-generated product barcodes (Code 128-B friendly, unique enough for offline shops). */
export function generateProductBarcode() {
  const digits = Array.from(crypto.getRandomValues(new Uint32Array(3)))
    .map((n) => String(n % 1_000_000_000).padStart(9, "0"))
    .join("")
    .slice(0, 12);
  return `RTM${digits}`;
}
