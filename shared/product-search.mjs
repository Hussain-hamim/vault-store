export function normalizeGeneration(value) {
  const normalized = String(value)
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String(c.charCodeAt(0) - (c <= "٩" ? 1632 : 1776)),
    )
    .trim();
  if (!/^(?:[2-9]|1[0-4])$/.test(normalized)) return value;
  const n = Number(normalized);
  return `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} Gen`;
}
export function productSearch(query) {
  const terms = String(query).trim().split(/\s+/).filter(Boolean);
  const params = [];
  const text =
    "COALESCE(p.name,'')||' '||COALESCE(p.brand,'')||' '||COALESCE(p.model,'')||' '||COALESCE(p.sku,'')||' '||COALESCE(p.barcode,'')||' '||COALESCE(p.attributes,'')";
  const clauses = terms.map((term) => {
    params.push("%" + term.replace(/[\\%_]/g, "\\$&") + "%");
    return `(${text}) LIKE ? ESCAPE '\\'`;
  });
  return { sql: clauses.length ? clauses.join(" AND ") : "1", params };
}
