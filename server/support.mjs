/** Only configured contact destinations may be opened by the desktop bridge. */
export function supportLinks(config = {}) {
  const result = [];
  try {
    const url = new URL(config.website);
    if (url.protocol === "https:" && !url.username && !url.password)
      result.push({ id: "website", url: url.href, value: config.website });
  } catch {}
  if (
    /^[A-Z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(
      config.email || "",
    )
  )
    result.push({
      id: "email",
      url: "mailto:" + encodeURIComponent(config.email).replace("%40", "@"),
      value: config.email,
    });
  const number = String(config.whatsapp || "").replace(/[\s()+-]/g, "");
  if (/^[1-9]\d{6,14}$/.test(number))
    result.push({
      id: "whatsapp",
      url: "https://wa.me/" + number,
      value: config.whatsapp,
    });
  return result;
}
