/** Keep numeric cells numeric while protecting user-entered text from CSV formulas. */
export function serializeCSV(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (value) => {
    let text =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value ?? "");
    if (typeof value !== "number" && /^[\s]*[=+\-@]|^[\t\r]/.test(text))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(","),
      ...rows.map((row) => keys.map((key) => cell(row[key])).join(",")),
    ].join("\r\n")
  );
}
