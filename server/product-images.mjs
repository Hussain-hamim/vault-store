import catalog from "./product-photo-catalog.mjs";
export { catalog as PRODUCT_PHOTO_CATALOG };
export const normalizeImageText = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function normalizeImageBrand(value) {
  const text = normalizeImageText(value);
  return (
    {
      iphone: "apple",
      ipad: "apple",
      hewlettpackard: "hp",
      hewlettpackardcompany: "hp",
      redmi: "xiaomi",
      wd: "westerndigital",
      ms: "microsoft",
    }[text] || text
  );
}
export const isStoredPhoto = (value) =>
  typeof value === "string" && /^photo:[a-f0-9]{64}$/.test(value);
const legacy = new Set(
  [
    "laptop.png",
    "phone.png",
    "tablet.png",
    "storage.png",
    "adapter.png",
    "headphones.png",
    "keyboard.jpg",
    "mouse.jpg",
    "mouse-pad.jpg",
    "cable.jpg",
    "case.jpg",
    "plush.jpg",
    "webcam.jpg",
    "hub.jpg",
    "speaker.jpg",
  ].map((file) => "/assets/" + file),
);
function modelKey(model, brand) {
  const value = normalizeImageText(model),
    prefix = normalizeImageText(brand);
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
/** Exact aliases first. References never cross category, company, or accessory type. */
export function automaticProductPhoto(product = {}) {
  const brand = normalizeImageBrand(product.brand),
    model = modelKey(product.model, product.brand);
  const type = normalizeImageText(product.attributes?.Type);
  const choices = catalog.filter(
    (photo) =>
      normalizeImageBrand(photo.brand) === brand &&
      photo.category === product.category &&
      (product.category !== "Accessories" ||
        (photo.accessoryType &&
          normalizeImageText(photo.accessoryType) === type)),
  );
  const exact =
    model &&
    choices.find((photo) =>
      [photo.model, ...photo.aliases].some(
        (alias) => modelKey(alias, photo.brand) === model,
      ),
    );
  const photo = exact || choices[0];
  return photo
    ? { src: photo.src, kind: exact ? "exact" : "reference", photo }
    : { src: "", kind: "missing", photo: null };
}
export function productPhotoSelection(product = {}) {
  if (isStoredPhoto(product.image))
    return { src: product.image, kind: "custom", photo: null };
  const matched = catalog.find(
    (photo) =>
      photo.src === product.image &&
      normalizeImageBrand(photo.brand) === normalizeImageBrand(product.brand) &&
      photo.category === product.category &&
      (product.category !== "Accessories" ||
        normalizeImageText(photo.accessoryType) ===
          normalizeImageText(product.attributes?.Type)),
  );
  const automatic = automaticProductPhoto(product);
  if (matched)
    return {
      src: matched.src,
      kind:
        automatic.kind === "exact" && automatic.src === matched.src
          ? "exact"
          : "reference",
      photo: matched,
    };
  // Old generated category defaults are deliberately resolved again by company/model.
  if (
    !product.image ||
    legacy.has(product.image) ||
    product.image.startsWith("/assets/products/")
  )
    return automatic;
  return automatic;
}
/** External links are limited to the exact credits bundled with this catalog. */
export function productPhotoCreditUrls() {
  return [
    ...new Set(
      catalog
        .flatMap((photo) => [photo.source, photo.licenseUrl])
        .filter((value) => {
          try {
            const url = new URL(value);
            return (
              url.protocol === "https:" &&
              [
                "commons.wikimedia.org",
                "creativecommons.org",
                "www.gnu.org",
              ].includes(url.hostname) &&
              !url.username &&
              !url.password
            );
          } catch {
            return false;
          }
        }),
    ),
  ];
}
