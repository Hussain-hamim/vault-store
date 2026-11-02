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
/** One studio illustration per builtin product category. */
const categoryStudio = {
  Computers: "/assets/laptop.png",
  Mobiles: "/assets/phone.png",
  Tablets: "/assets/tablet.png",
  Cameras: "/assets/webcam.jpg",
  Printers: "/assets/printer.jpg",
  Storage: "/assets/storage.png",
  Accessories: "/assets/headphones.png",
};
const customCategoryStudio = "/assets/adapter.png";
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
/**
 * Clean studio category illustrations.
 * Custom store categories can supply a shop-saved photo ref via categoryImage.
 */
export function automaticProductPhoto(product = {}, categoryImage = "") {
  const category = String(product.category || "").trim();
  if (isStoredPhoto(categoryImage))
    return studioEntry(categoryImage, product, category || "Product");
  if (
    typeof categoryImage === "string" &&
    categoryImage.startsWith("/assets/")
  )
    return studioEntry(categoryImage, product, category || "Product");
  const src = categoryStudio[category] || customCategoryStudio;
  return studioEntry(src, product, category || "Product");
}
export function productPhotoSelection(product = {}, categoryImage = "") {
  if (isStoredPhoto(product.image)) {
    // Same blob as the category default still reads as a category photo.
    if (categoryImage && product.image === categoryImage)
      return automaticProductPhoto(product, categoryImage);
    return { src: product.image, kind: "custom", photo: null };
  }
  return automaticProductPhoto(product, categoryImage);
}
export function builtinCategoryStudio(category) {
  return categoryStudio[String(category || "").trim()] || "";
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
