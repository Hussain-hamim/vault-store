/** Store a small raster thumbnail, never a filesystem path or an internet dependency. */
export async function prepareProductPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("photos.invalidType");
  if (file.size > 12 * 1024 * 1024) throw new Error("photos.tooLarge");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("photos.unreadable");
  }
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 50000000
    )
      throw new Error("photos.unreadable");
    let edge = 640;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("photos.unreadable");
    while (edge >= 80) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.76, 0.66, 0.56]) {
        const result = canvas.toDataURL("image/jpeg", quality);
        const encoded = result.split(",")[1];
        const bytes =
          (encoded.length * 3) / 4 -
          (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
        if (bytes <= 150000) return result;
      }
      edge = Math.floor(edge * 0.8);
    }
    throw new Error("photos.tooLarge");
  } finally {
    bitmap.close();
  }
}
