/** Shared browser/desktop print configuration; contains no Node-only code. */
export const PAPER_SIZES = Object.freeze({
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  A3: { width: 297, height: 420 },
  receipt80: { width: 80, height: 200 },
  receipt58: { width: 58, height: 200 },
  // Sticky QR-label roll for the shop scanners (width × height mm).
  label29x18: { width: 29, height: 18 },
});
export const LABEL_PAPERS = Object.freeze(["label29x18"]);
export const PRINT_LAYOUTS = ["modern", "classic", "minimal", "compact"];
export const PRINT_THEMES = Object.freeze({
  charcoal: { accent: "#30323a", soft: "#f0f1f3", ink: "#20232b" },
  lime: { accent: "#526518", soft: "#f0f6d9", ink: "#273015" },
  navy: { accent: "#244d85", soft: "#edf3fb", ink: "#18304f" },
  teal: { accent: "#18766e", soft: "#e9f5f1", ink: "#19433f" },
  rose: { accent: "#9d435c", soft: "#fbf0f3", ink: "#542d3b" },
  mono: { accent: "#111111", soft: "#ffffff", ink: "#111111" },
});
function isLabelPaper(paper) {
  return String(paper || "").startsWith("label");
}
function isThermalPaper(paper) {
  return (
    String(paper || "").startsWith("receipt") || isLabelPaper(paper)
  );
}
export function normalizePrintOptions(input = {}, kind = "invoice") {
  const raw = input && typeof input === "object" ? input : {};
  const labelJob = kind === "label";
  let paper = "A4";
  if (labelJob) {
    paper = LABEL_PAPERS.includes(raw.paper) ? raw.paper : "label29x18";
  } else if (
    Object.hasOwn(PAPER_SIZES, raw.paper) &&
    (kind === "invoice" || !String(raw.paper).startsWith("receipt")) &&
    !isLabelPaper(raw.paper)
  ) {
    paper = raw.paper;
  }
  const thermal =
    (["receipt80", "receipt58"].includes(paper) && kind === "invoice") ||
    labelJob;
  return {
    paper,
    layout: labelJob
      ? "compact"
      : PRINT_LAYOUTS.includes(raw.layout)
        ? raw.layout
        : "modern",
    theme: labelJob
      ? "mono"
      : Object.hasOwn(PRINT_THEMES, raw.theme)
        ? raw.theme
        : "charcoal",
    orientation:
      !thermal && raw.orientation === "landscape" ? "landscape" : "portrait",
    margins: labelJob
      ? "narrow"
      : raw.margins === "narrow"
        ? "narrow"
        : "standard",
    showLogo: labelJob ? false : raw.showLogo !== false,
    showSpecs: raw.showSpecs !== false,
    showFooter: labelJob ? false : raw.showFooter !== false,
  };
}
export function printGeometry(input, kind = "invoice") {
  const options = normalizePrintOptions(input, kind);
  const page = PAPER_SIZES[options.paper];
  const landscape = options.orientation === "landscape";
  return {
    width: landscape ? page.height : page.width,
    height: landscape ? page.width : page.height,
    margin: isLabelPaper(options.paper)
      ? 1
      : options.paper.startsWith("receipt")
        ? 3
        : options.margins === "narrow"
          ? 10
          : 16,
  };
}
export function electronPrintOptions(input, kind = "invoice", pdf = false) {
  const options = normalizePrintOptions(input, kind);
  const page = PAPER_SIZES[options.paper];
  const custom = isThermalPaper(options.paper);
  const margin = printGeometry(options, kind).margin;
  return {
    printBackground: true,
    landscape: options.orientation === "landscape",
    pageSize: custom
      ? {
          width: pdf ? page.width / 25.4 : page.width * 1000,
          height: pdf ? page.height / 25.4 : page.height * 1000,
        }
      : options.paper,
    ...(pdf
      ? {
          preferCSSPageSize: true,
          margins: {
            top: margin / 25.4,
            right: margin / 25.4,
            bottom: margin / 25.4,
            left: margin / 25.4,
          },
        }
      : {
          silent: false,
          color: options.theme !== "mono",
          margins: {
            marginType: "custom",
            top: (margin * 96) / 25.4,
            right: (margin * 96) / 25.4,
            bottom: (margin * 96) / 25.4,
            left: (margin * 96) / 25.4,
          },
        }),
  };
}
