import { z } from "zod";
import { createHash } from "node:crypto";
export const stockRevision = (s, id) =>
  s.one("SELECT revision FROM product_stock_revisions WHERE product_id=?", id)
    ?.revision || 0;
export function beginProductEdit(s, user, args, action) {
  const d = z
    .object({
      id: z.string(),
      request_key: z.string().min(8).max(100),
      expected_stock: z.number().int().nonnegative(),
      expected_revision: z.number().int().nonnegative(),
    })
    .parse(args);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const previous = s.one(
    "SELECT * FROM product_operations WHERE request_key=?",
    d.request_key,
  );
  if (previous) {
    if (
      previous.user_id !== user.id ||
      previous.action !== action ||
      previous.fingerprint !== fingerprint
    )
      throw Error("Request key already used.");
    const cached = JSON.parse(previous.result);
    if (
      cached.product &&
      !user.permissions.some((p) => ["view_costs", "purchases"].includes(p))
    )
      for (const key of [
        "cost",
        "unit_cost",
        "cost_aed",
        "cost_foreign",
        "fx_rate",
      ])
        delete cached.product[key];
    return { cached };
  }
  const p = s.one("SELECT * FROM products WHERE id=? AND active=1", d.id);
  if (!p) throw Error("Product not found.");
  if (
    p.stock !== d.expected_stock ||
    stockRevision(s, p.id) !== d.expected_revision
  )
    throw Error("STOCK_CHANGED");
  return {
    p,
    finish(result) {
      s.run(
        "INSERT INTO product_operations VALUES (?,?,?,?,?)",
        d.request_key,
        user.id,
        action,
        fingerprint,
        JSON.stringify(result),
      );
      return result;
    },
  };
}
export function reductionDevices(s, p, quantity, selected, all = false) {
  if (!p.serialized) return undefined;
  if (selected?.length) {
    const ids = z.array(z.string().min(1)).max(100000).parse(selected);
    if (ids.length !== quantity || new Set(ids).size !== quantity)
      throw Error("Select one available device per removed unit.");
    return ids;
  }
  const rows = s.all(
    `SELECT u.id FROM inventory_units u JOIN batches b ON b.id=u.batch_id WHERE u.product_id=? AND u.status='available' AND b.owner_id IS NULL ${all ? "" : "AND COALESCE(u.serial,'')=''"} ORDER BY b.received_at,b.rowid,u.rowid LIMIT ?`,
    p.id,
    quantity,
  );
  if (rows.length !== quantity) throw Error("SELECT_STOCK_DEVICES");
  return rows.map((u) => u.id);
}
export function assertShopStock(s, p) {
  if (
    p.consignment_only ||
    s.one(
      "SELECT id FROM batches WHERE product_id=? AND owner_id IS NOT NULL AND remaining>0 LIMIT 1",
      p.id,
    )
  )
    throw Error("Return customer-owned stock through Customer resale.");
}
