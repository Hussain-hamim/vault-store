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
const categoryStudio = {
  Computers: "/assets/laptop.png",
  Mobiles: "/assets/phone.png",
  Tablets: "/assets/tablet.png",
  Storage: "/assets/storage.png",
};
const accessoryStudio = {
  keyboard: "/assets/keyboard.jpg",
  mouse: "/assets/mouse.jpg",
  headphones: "/assets/headphones.png",
  headphone: "/assets/headphones.png",
  cable: "/assets/cable.jpg",
  case: "/assets/case.jpg",
  plush: "/assets/plush.jpg",
  webcam: "/assets/webcam.jpg",
  hub: "/assets/hub.jpg",
  speaker: "/assets/speaker.jpg",
  mousepad: "/assets/mouse-pad.jpg",
  harddisk: "/assets/storage.png",
  harddrive: "/assets/storage.png",
  ssd: "/assets/storage.png",
  storage: "/assets/storage.png",
  adapter: "/assets/adapter.png",
  charger: "/assets/adapter.png",
  poweradapter: "/assets/adapter.png",
};
function studioEntry(src, product, label) {
  return {
    src,
    kind: "category",
    photo: {
      brand: "",
      model: label,
      category: product.category,
      accessoryType: product.attributes?.Type || "",
      src,
    },
  };
}
/** Clean studio category/accessory illustrations (not phone snapshots). */
export function automaticProductPhoto(product = {}) {
  if (product.category === "Accessories") {
    const type = normalizeImageText(product.attributes?.Type);
    const src = accessoryStudio[type] || "/assets/headphones.png";
    const label = String(product.attributes?.Type || "Accessories").trim();
    return studioEntry(src, product, label || "Accessories");
  }
  const src = categoryStudio[product.category] || "";
  if (!src) return { src: "", kind: "missing", photo: null };
  return studioEntry(src, product, product.category);
}
export function productPhotoSelection(product = {}) {
  if (isStoredPhoto(product.image))
    return { src: product.image, kind: "custom", photo: null };
  return automaticProductPhoto(product);
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
