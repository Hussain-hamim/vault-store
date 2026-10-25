import { randomUUID } from "node:crypto";
import { z } from "zod";
import { saveProductPhoto } from "./product-photos.mjs";
const intentSchema = z.enum(["catalog", "purchase"]);
const dataSchema = z.record(z.string().max(80), z.string().max(1000));
function owned(s, user, id) {
  const row = s.one(
    "SELECT * FROM product_drafts WHERE id=? AND user_id=?",
    id,
    user.id,
  );
  if (!row) throw new Error("Product draft not found.");
  return row;
}
function revision(row, value) {
  if (value !== row.revision)
    throw new Error(
      "This draft changed in another window. Reopen it before saving.",
    );
}
function read(row) {
  return { ...row, data: JSON.parse(row.data) };
}
export function productDraftCommand(s, user, command, args) {
  if (!user.permissions.includes("inventory"))
    throw new Error("Permission required: inventory");
  if (command === "productDraftList") {
    const intent = intentSchema.parse(args.intent);
    const offset = z
      .number()
      .int()
      .min(0)
      .parse(args.offset ?? 0);
    const rows = s.all(
      "SELECT id,data,updated_at,revision FROM product_drafts WHERE user_id=? AND intent=? ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?",
      user.id,
      intent,
      offset,
    );
    return {
      rows: rows.slice(0, 20).map((r) => ({
        id: r.id,
        name: JSON.parse(r.data).name || "",
        brand: JSON.parse(r.data).brandOther || JSON.parse(r.data).brand || "",
        model: JSON.parse(r.data).model || "",
        updated_at: r.updated_at,
        revision: r.revision,
      })),
      next: rows.length > 20 ? offset + 20 : null,
      count: s.one(
        "SELECT COUNT(*) n FROM product_drafts WHERE user_id=? AND intent=?",
        user.id,
        intent,
      ).n,
    };
  }
  if (command === "productDraftRead")
    return read(owned(s, user, z.string().parse(args.id)));
  return s.transaction(() => {
    if (command === "productDraftDelete") {
      const row = owned(s, user, z.string().parse(args.id));
      revision(row, args.revision);
      s.run("DELETE FROM product_drafts WHERE id=?", row.id);
      return { ok: true };
    }
    if (command === "productDraftSave") {
      const data = dataSchema.parse(args.data);
      if (JSON.stringify(data).length > 16000)
        throw new Error("Product draft is too large.");
      const intent = intentSchema.parse(args.intent);
      const old = args.id ? owned(s, user, args.id) : null;
      if (old) {
        revision(old, args.revision);
        if (old.intent !== intent)
          throw new Error("Draft entry context does not match.");
      }
      const image = saveProductPhoto(s, {
        category: data.category,
        brand: data.brand === "Other" ? data.brandOther : data.brand,
        model: data.model,
        attributes: { Type: data.accessoryOther || data.accessory },
        image: args.image === undefined ? old?.image : args.image,
        photo_data: args.photo_data,
      });
      const id = old?.id || randomUUID(),
        rev = (old?.revision ?? -1) + 1;
      s.run(
        "INSERT INTO product_drafts(id,user_id,intent,data,image,revision,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,image=excluded.image,revision=excluded.revision,updated_at=excluded.updated_at",
        id,
        user.id,
        intent,
        JSON.stringify(data),
        image,
        rev,
        new Date().toISOString(),
      );
      return read(owned(s, user, id));
    }
    if (command === "productDraftPublish") {
      const key = z.string().min(8).max(160).parse(args.request_key);
      const previous = s.one(
        "SELECT result FROM product_entry_operations WHERE user_id=? AND request_key=?",
        user.id,
        key,
      );
      if (previous) {
        const saved = JSON.parse(previous.result);
        return {
          ...saved,
          product: s.listProducts({ id: saved.id, limit: 1 }, user).rows[0],
        };
      }
      const intent = intentSchema.parse(args.intent);
      const draft = args.id ? owned(s, user, args.id) : null;
      if (draft) {
        revision(draft, args.revision);
        if (draft.intent !== intent)
          throw new Error("Draft entry context does not match.");
      }
      const payload = { ...args.product };
      if (
        draft &&
        payload.image === undefined &&
        payload.photo_data === undefined
      )
        payload.image = draft.image;
      if (intent === "purchase") payload.opening_quantity = 0;
      const result = s.createProduct(user, payload);
      const product = s.listProducts({ id: result.id, limit: 1 }, user).rows[0];
      const response = { ...result, product };
      if (draft) s.run("DELETE FROM product_drafts WHERE id=?", draft.id);
      s.run(
        "INSERT INTO product_entry_operations(user_id,request_key,result) VALUES (?,?,?)",
        user.id,
        key,
        JSON.stringify(result),
      );
      return response;
    }
    throw new Error("Unknown product draft command.");
  });
}
