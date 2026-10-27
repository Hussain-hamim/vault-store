import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "./sqlite.mjs";
import { automaticProductPhoto, isStoredPhoto } from "./product-images.mjs";

function studioImage(row) {
  let attributes = {};
  try {
    attributes = JSON.parse(row.attributes || "{}");
  } catch {
    attributes = {};
  }
  if (row.accessoryType) attributes = { ...attributes, Type: row.accessoryType };
  return automaticProductPhoto({
    category: row.category || "",
    brand: row.brand || "",
    model: row.model || "",
    name: row.name || "",
    attributes,
  }).src;
}

function dropSidecars(file) {
  for (const suffix of ["-wal", "-shm"]) {
    const extra = file + suffix;
    if (existsSync(extra)) unlinkSync(extra);
  }
}

/** Drop camera/file photos from a backup copy so restore uses studio images. */
export function stripCustomPhotosFromBackup(file) {
  const db = new DatabaseSync(file);
  let compact = false;
  try {
    const photos = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_photos'",
      )
      .get();
    if (!photos) return;
    db.exec("BEGIN");
    const setProduct = db.prepare("UPDATE products SET image=? WHERE id=?");
    for (const row of db
      .prepare(
        "SELECT id,category,brand,model,attributes,name,image FROM products",
      )
      .all()) {
      if (!isStoredPhoto(row.image)) continue;
      setProduct.run(studioImage(row), row.id);
      compact = true;
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_product_snapshots'",
        )
        .get()
    ) {
      const setSnap = db.prepare(
        "UPDATE document_product_snapshots SET image=? WHERE line_id=?",
      );
      for (const row of db
        .prepare(
          `SELECT s.line_id,s.brand,s.model,s.attributes,s.image,p.category,p.name
           FROM document_product_snapshots s
           JOIN document_lines l ON l.id=s.line_id
           LEFT JOIN products p ON p.id=l.product_id`,
        )
        .all()) {
        if (!isStoredPhoto(row.image)) continue;
        setSnap.run(studioImage(row), row.line_id);
        compact = true;
      }
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_drafts'",
        )
        .get()
    ) {
      const setDraft = db.prepare("UPDATE product_drafts SET image=? WHERE id=?");
      for (const row of db.prepare("SELECT id,data,image FROM product_drafts").all()) {
        if (!isStoredPhoto(row.image)) continue;
        let data = {};
        try {
          data = JSON.parse(row.data || "{}");
        } catch {
          data = {};
        }
        setDraft.run(
          studioImage({
            category: data.category,
            brand: data.brand === "Other" ? data.brandOther : data.brand,
            model: data.model,
            name: data.name,
            accessoryType: data.accessoryOther || data.accessory,
          }),
          row.id,
        );
        compact = true;
      }
    }
    const blobCount = db.prepare("SELECT COUNT(*) n FROM product_photos").get().n;
    if (blobCount) {
      db.exec("DELETE FROM product_photos");
      compact = true;
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    db.close();
  }
  if (compact) {
    const vacuum = new DatabaseSync(file);
    try {
      vacuum.exec("PRAGMA journal_mode=DELETE; VACUUM;");
    } finally {
      vacuum.close();
    }
  }
  dropSidecars(file);
}
