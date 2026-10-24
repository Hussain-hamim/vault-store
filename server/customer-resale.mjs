import { randomUUID } from "node:crypto";
import { z } from "zod";
const id = () => randomUUID();
const amount = z.number().int().min(0).max(1e12);
const quantity = z.number().int().min(1).max(100000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const request_key = z.string().min(8).max(100);
const party = (s, ownerId) => {
  const owner = s.one(
    "SELECT * FROM parties WHERE id=? AND kind='customer' AND walk_in=0",
    ownerId,
  );
  if (!owner) throw new Error("Choose a saved customer as the product owner.");
  return owner;
};
export const ownerBalance = (s, ownerId) =>
  s.one(
    "SELECT COALESCE(SUM(credit-debit),0) balance FROM party_totals WHERE party_id=? AND account='consignment_payables'",
    ownerId,
  ).balance;
export function consignmentCredits(s, documentId) {
  return s.all(
    "SELECT b.owner_id,SUM(a.cost) amount FROM allocations a JOIN batches b ON b.id=a.batch_id JOIN document_lines l ON l.id=a.line_id WHERE l.document_id=? AND b.owner_id IS NOT NULL GROUP BY b.owner_id",
    documentId,
  );
}
export function receiveConsignment(s, user, input) {
  const d = z
    .object({
      owner_id: z.string().optional(),
      new_owner: z
        .object({
          name: z.string().trim().min(2).max(500),
          phone: z.string().trim().max(500).default(""),
        })
        .optional(),
      product_id: z.string().optional(),
      new_product: z
        .object({
          name: z.string().trim().min(2).max(500),
          brand: z.string().trim().min(1).max(500),
          model: z.string().trim().min(1).max(500),
          sku: z.string().trim().max(500).optional(),
          category: z.enum([
            "Computers",
            "Mobiles",
            "Tablets",
            "Storage",
            "Accessories",
          ]),
          price: amount.default(0),
          image: z.string().max(500).default(""),
          photo_data: z.string().max(500000).optional(),
          condition: z.enum(["New", "Used", "Refurbished"]).default("Used"),
          attributes: z.record(z.string(), z.string().max(200)).default({}),
        })
        .optional(),
      quantity,
      owner_unit_amount: amount,
      date: date.optional(),
      note: z.string().trim().max(500).default(""),
      request_key,
    })
    .parse(input);
  return s.transaction(() => {
    const previous = s.existingRequest(user, d.request_key, [
      "consignment_receipt",
    ]);
    if (previous) return s.getDocument(previous.id);
    if (!!d.owner_id === !!d.new_owner)
      throw new Error("Choose an existing owner or enter one new customer.");
    if (!!d.product_id === !!d.new_product)
      throw new Error("Choose an existing product or enter one new product.");
    if (d.new_owner) {
      if (!user.permissions.includes("people"))
        throw new Error("Permission required: people");
      d.owner_id = s.createParty(user, { kind: "customer", ...d.new_owner }).id;
    }
    if (d.new_product) {
      d.product_id = s.createProduct(user, {
        ...d.new_product,
        sku: d.new_product.sku || "RES-" + id(),
        reorder_level: 0,
        opening_quantity: 0,
        unit_cost: 0,
      }).id;
      s.run("UPDATE products SET consignment_only=1 WHERE id=?", d.product_id);
    }
    party(s, d.owner_id);
    const product = s.one(
      "SELECT * FROM products WHERE id=? AND active=1",
      d.product_id,
    );
    if (!product) throw new Error("Product is unavailable.");
    if (
      !Number.isSafeInteger(d.quantity * d.owner_unit_amount) ||
      d.quantity * d.owner_unit_amount > 1e12
    )
      throw new Error("Owner agreement exceeds supported amount.");
    const doc = s.document("consignment_receipt", user, {
      ...d,
      party_id: d.owner_id,
    });
    const lineId = id(),
      batchId = id();
    s.run(
      "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost) VALUES (?,?,?,?,0,0)",
      lineId,
      doc.id,
      product.id,
      d.quantity,
    );
    s.run(
      "INSERT INTO batches(id,product_id,line_id,quantity,remaining,unit_cost,received_at,owner_id,owner_unit_amount) VALUES (?,?,?,?,?,0,?,?,?)",
      batchId,
      product.id,
      lineId,
      d.quantity,
      d.quantity,
      `${doc.date}T${new Date().toISOString().slice(11)}`,
      d.owner_id,
      d.owner_unit_amount,
    );
    s.move(doc, product, d.quantity, 0);
    s.audit(user, "Receive customer-owned stock", doc.id, {
      owner_id: d.owner_id,
      product_id: product.id,
      quantity: d.quantity,
      owner_unit_amount: d.owner_unit_amount,
    });
    return s.getDocument(doc.id);
  });
}
export function returnConsignment(s, user, input) {
  const d = z
    .object({
      batch_id: z.string(),
      quantity,
      date: date.optional(),
      note: z.string().trim().max(500).default(""),
      request_key,
    })
    .parse(input);
  return s.transaction(() => {
    const previous = s.existingRequest(user, d.request_key, [
      "consignment_return",
    ]);
    if (previous) return s.getDocument(previous.id);
    const batch = s.one(
      "SELECT * FROM batches WHERE id=? AND owner_id IS NOT NULL",
      d.batch_id,
    );
    if (!batch || d.quantity > batch.remaining)
      throw new Error("Return quantity exceeds customer-owned stock on hand.");
    const doc = s.document("consignment_return", user, {
      ...d,
      party_id: batch.owner_id,
    });
    const product = s.one(
      "SELECT * FROM products WHERE id=?",
      batch.product_id,
    );
    s.run(
      "UPDATE batches SET remaining=remaining-?,quantity=quantity-? WHERE id=?",
      d.quantity,
      d.quantity,
      batch.id,
    );
    s.run(
      "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost) VALUES (?,?,?,?,0,0)",
      id(),
      doc.id,
      product.id,
      d.quantity,
    );
    s.move(doc, product, -d.quantity, 0);
    s.audit(user, "Return unsold stock to customer", doc.id, {
      batch_id: batch.id,
      quantity: d.quantity,
    });
    return s.getDocument(doc.id);
  });
}
export function payConsignment(s, user, input) {
  const d = z
    .object({
      owner_id: z.string(),
      amount: amount.refine((v) => v > 0),
      direction: z.enum(["pay", "recover"]).default("pay"),
      date: date.optional(),
      note: z.string().trim().max(500).default(""),
      request_key,
    })
    .parse(input);
  return s.transaction(() => {
    const kind =
      d.direction === "pay" ? "consignment_payment" : "consignment_recovery";
    const previous = s.existingRequest(user, d.request_key, [kind]);
    if (previous) return s.getDocument(previous.id);
    party(s, d.owner_id);
    const balance = ownerBalance(s, d.owner_id);
    if (d.direction === "pay" ? d.amount > balance : d.amount > -balance)
      throw new Error("Amount exceeds the current owner balance.");
    const doc = s.document(kind, user, {
      ...d,
      party_id: d.owner_id,
      total: d.amount,
      paid: d.amount,
    });
    const latest = s.one(
      "SELECT MAX(date) date FROM journal WHERE party_id=? AND account='consignment_payables'",
      d.owner_id,
    ).date;
    if (latest && doc.date < latest)
      throw new Error(
        "Owner settlements must follow the latest owner-ledger date.",
      );
    if (d.direction === "pay") {
      let left = d.amount;
      const invoices = s.all(
        `SELECT d.id,SUM(j.credit-j.debit)
        -COALESCE((SELECT SUM(rj.debit-rj.credit) FROM journal rj JOIN documents r ON r.id=rj.document_id WHERE r.original_id=d.id AND rj.party_id=? AND rj.account='consignment_payables'),0)
        -COALESCE((SELECT SUM(a.amount) FROM consignment_payout_allocations a WHERE a.sale_id=d.id AND a.owner_id=?),0) due
        FROM documents d JOIN journal j ON j.document_id=d.id WHERE d.kind='sale' AND j.party_id=? AND j.account='consignment_payables' AND d.date<=? GROUP BY d.id HAVING due>0 ORDER BY d.date,d.created_at,d.id`,
        d.owner_id,
        d.owner_id,
        d.owner_id,
        doc.date,
      );
      for (const invoice of invoices) {
        const pay = Math.min(left, invoice.due);
        if (pay)
          s.run(
            "INSERT INTO consignment_payout_allocations VALUES (?,?,?,?,?)",
            id(),
            doc.id,
            invoice.id,
            d.owner_id,
            pay,
          );
        left -= pay;
        if (!left) break;
      }
      if (left)
        throw new Error(
          "Owner settlements could not be matched to sold stock.",
        );
      s.ledger(doc, [
        ["consignment_payables", d.amount, 0, d.owner_id],
        ["cash", 0, d.amount],
      ]);
    } else
      s.ledger(doc, [
        ["cash", d.amount, 0],
        ["consignment_payables", 0, d.amount, d.owner_id],
      ]);
    s.audit(user, kind, doc.id, { owner_id: d.owner_id, amount: d.amount });
    return s.getDocument(doc.id);
  });
}
export function consignments(s, input = {}) {
  const d = z
    .object({
      after: z.string().default(""),
      limit: z.number().int().min(1).max(100).default(10),
      view: z.enum(["stock", "owners"]).default("stock"),
    })
    .parse(input);
  const summary =
    s.one(`SELECT COALESCE((SELECT SUM(remaining) FROM batches WHERE owner_id IS NOT NULL),0) held_units,
    COALESCE(SUM(MAX(0,credit-debit)),0) due,COALESCE(SUM(MAX(0,debit-credit)),0) recoverable
    FROM party_totals WHERE account='consignment_payables'`);
  let rows;
  if (d.view === "owners")
    rows = s.all(
      `SELECT p.id,p.name,p.phone,COALESCE(t.credit-t.debit,0) balance,
    COALESCE((SELECT SUM(remaining) FROM batches WHERE owner_id=p.id),0) held_units
    FROM parties p LEFT JOIN party_totals t ON t.party_id=p.id AND t.account='consignment_payables'
    WHERE p.kind='customer' AND p.id>? AND (COALESCE(t.credit-t.debit,0)<>0 OR EXISTS(SELECT 1 FROM batches b WHERE b.owner_id=p.id AND b.remaining>0))
    ORDER BY p.id LIMIT ?`,
      d.after,
      d.limit + 1,
    );
  else
    rows = s.all(
      `SELECT b.id,b.owner_id,b.product_id,b.quantity,b.remaining,b.owner_unit_amount,SUBSTR(b.received_at,1,10) received_date,p.name,p.brand,p.model,p.sku,p.price,p.category,p.attributes,p.stock,p.image,p.barcode,o.name owner_name
    FROM batches b JOIN products p ON p.id=b.product_id JOIN parties o ON o.id=b.owner_id WHERE b.owner_id IS NOT NULL AND b.remaining>0 AND b.id>? ORDER BY b.id LIMIT ?`,
      d.after,
      d.limit + 1,
    );
  const more = rows.length > d.limit;
  if (more) rows.pop();
  return { rows, summary, next: more ? rows.at(-1).id : null };
}

export function consignmentSnapshot(s, asOf) {
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (asOf >= currentDate)
    return s.one(
      "SELECT COALESCE(SUM(MAX(0,credit-debit)),0) due,COALESCE(SUM(MAX(0,debit-credit)),0) recoverable FROM party_totals WHERE account='consignment_payables'",
    );
  return s.one(
    "SELECT COALESCE(SUM(MAX(0,balance)),0) due,COALESCE(SUM(MAX(0,-balance)),0) recoverable FROM (SELECT party_id,SUM(credit-debit) balance FROM journal WHERE account='consignment_payables' AND date<=? GROUP BY party_id)",
    asOf,
  );
}
