/** Detect USB barcode-wedge bursts (rapid keystrokes ending in Enter or a short pause). */
export type BarcodeWedgeOptions = {
  enabled: boolean;
  onScan: (code: string) => void;
  /** Ignore scans while these are true (dialogs, editable fields, etc.). */
  shouldIgnore?: (event: KeyboardEvent) => boolean;
  minLength?: number;
};

export function attachBarcodeWedge({
  enabled,
  onScan,
  shouldIgnore,
  minLength = 3,
}: BarcodeWedgeOptions): () => void {
  if (!enabled) return () => {};
  let buffer = "";
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    buffer = "";
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    const code = buffer.trim();
    clear();
    if (code.length >= minLength) onScan(code);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled) return;
    if (event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (shouldIgnore?.(event)) return;
    if (event.key === "Enter") {
      if (!buffer) return;
      event.preventDefault();
      event.stopPropagation();
      flush();
      return;
    }
    if (event.key.length !== 1) return;
    const now = Date.now();
    if (last && now - last > 80) buffer = "";
    last = now;
    buffer += event.key;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 100);
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    clear();
  };
}
