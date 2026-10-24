import { createHash } from "node:crypto";
import { automaticProductPhoto, isStoredPhoto } from "./product-images.mjs";
export const MAX_PRODUCT_PHOTO_BYTES = 350000;
export function decodeProductPhoto(value) {
  if (typeof value !== "string" || value.length > 500000)
    throw new Error(
      "Product photo is too large. Choose a smaller JPG, PNG or WebP image.",
    );
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Choose a JPG, PNG or WebP product photo.");
  const data = Buffer.from(match[2], "base64");
  if (
    data.length < 16 ||
    data.length > MAX_PRODUCT_PHOTO_BYTES ||
    data.toString("base64") !== match[2]
  )
    throw new Error("Invalid or oversized product photo.");
  const mime = match[1];
  const valid =
    mime === "jpeg"
      ? data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255 &&
        data.at(-2) === 255 &&
        data.at(-1) === 217
      : mime === "png"
        ? data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          data.subarray(12, 16).toString() === "IHDR"
        : data.subarray(0, 4).toString() === "RIFF" &&
          data.subarray(8, 12).toString() === "WEBP";
  if (!valid)
    throw new Error("The product photo does not match its image format.");
  return {
    data,
    mime: "image/" + mime,
    id: createHash("sha256").update(data).digest("hex"),
  };
}
/** Called inside the same transaction as creating/updating the product. */
export function saveProductPhoto(s, product) {
  if (product.photo_data !== undefined) {
    const { data, mime, id } = decodeProductPhoto(product.photo_data);
    s.run(
      "INSERT OR IGNORE INTO product_photos(id,mime,data,created_at) VALUES (?,?,?,?)",
      id,
      mime,
      data,
      new Date().toISOString(),
    );
    return "photo:" + id;
  }
  if (isStoredPhoto(product.image)) {
    if (
      !s.one("SELECT id FROM product_photos WHERE id=?", product.image.slice(6))
    )
      throw new Error("Product photo was not found. Upload it again.");
    return product.image;
  }
  return automaticProductPhoto(product).src;
}
export function readProductPhoto(s, ref) {
  if (!isStoredPhoto(ref)) throw new Error("Invalid product photo reference.");
  const photo = s.one(
    "SELECT mime,data FROM product_photos WHERE id=?",
    ref.slice(6),
  );
  if (!photo) throw new Error("Product photo was not found.");
  return {
    src:
      "data:" +
      photo.mime +
      ";base64," +
      Buffer.from(photo.data).toString("base64"),
  };
}
