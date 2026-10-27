import { unitFields, receiveUnits, link } from "./inventory-units.mjs";
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
const newProductSchema = z.object({
  name: z.string().trim().min(2).max(500),
  brand: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(500),
  sku: z.string().trim().max(500).optional(),
  category: z.string().trim().min(2).max(80),
  serialized: z.boolean().optional(),
  price: amount.default(0),
  image: z.string().max(500).default(""),
  photo_data: z.string().max(500000).optional(),
  condition: z.enum(["New", "Used", "Refurbished"]).default("Used"),
  attributes: z.record(z.string(), z.string().max(200)).default({}),
});
const receiveLineSchema = z
  .object({
    product_id: z.string().optional(),
    new_product: newProductSchema.optional(),
    quantity,
    owner_unit_amount: amount,
    ...unitFields,
  })
  .superRefine((line, ctx) => {
    if (!!line.product_id === !!line.new_product) {
      ctx.addIssue({
        code: "custom",
        message: "Each receive line needs a new product or an existing product.",
      });
    }
  });
export function receiveConsignment(s, user, input) {
  const d = z
    .object({
      owner_id: z.string().optional(),
      ...unitFields,
      new_owner: z
        .object({
          name: z.string().trim().min(2).max(500),
          phone: z.string().trim().max(500).default(""),
        })
        .optional(),
      product_id: z.string().optional(),
      new_product: newProductSchema.optional(),
      quantity: quantity.optional(),
      owner_unit_amount: amount.optional(),
      lines: z.array(receiveLineSchema).min(1).max(50).optional(),
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
    const lines = d.lines?.length
      ? d.lines
      : d.quantity != null && d.owner_unit_amount != null
        ? [
            {
              product_id: d.product_id,
              new_product: d.new_product,
              quantity: d.quantity,
              owner_unit_amount: d.owner_unit_amount,
              units: d.units,
              unit_ids: d.unit_ids,
            },
          ]
        : null;
    if (!lines?.length)
      throw new Error("Enter the customer product details for this intake.");
    if (lines.some((line) => !!line.product_id === !!line.new_product))
      throw new Error(
        "Choose an existing product or enter one new product.",
      );
    if (d.new_owner) {
      if (!user.permissions.includes("people"))
        throw new Error("Permission required: people");
      d.owner_id = s.createParty(user, { kind: "customer", ...d.new_owner }).id;
    }
    party(s, d.owner_id);
    for (const line of lines) {
      if (
        !Number.isSafeInteger(line.quantity * line.owner_unit_amount) ||
        line.quantity * line.owner_unit_amount > 1e12
      )
        throw new Error("Owner agreement exceeds supported amount.");
    }
    const doc = s.document("consignment_receipt", user, {
      ...d,
      party_id: d.owner_id,
      quantity: lines.reduce((n, line) => n + line.quantity, 0),
      owner_unit_amount: lines[0].owner_unit_amount,
    });
    const received = [];
    const stamped = `${doc.date}T${new Date().toISOString().slice(11)}`;
    for (const line of lines) {
      let productId = line.product_id;
      if (line.new_product) {
        productId = s.createProduct(user, {
          ...line.new_product,
          sku: line.new_product.sku || "RES-" + id(),
          reorder_level: 0,
          opening_quantity: 0,
          unit_cost: 0,
        }).id;
        s.run("UPDATE products SET consignment_only=1 WHERE id=?", productId);
      }
      const product = s.one(
        "SELECT * FROM products WHERE id=? AND active=1",
        productId,
      );
      if (!product) throw new Error("Product is unavailable.");
      const lineId = id(),
        batchId = id();
      s.run(
        "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost) VALUES (?,?,?,?,0,0)",
        lineId,
        doc.id,
        product.id,
        line.quantity,
      );
      s.run(
        "INSERT INTO batches(id,product_id,line_id,quantity,remaining,unit_cost,received_at,owner_id,owner_unit_amount) VALUES (?,?,?,?,?,0,?,?,?)",
        batchId,
        product.id,
        lineId,
        line.quantity,
        line.quantity,
        stamped,
        d.owner_id,
        line.owner_unit_amount,
      );
      if (product.serialized) {
        if (line.units && line.units.length !== line.quantity)
          throw new Error("Enter device details for the received quantity.");
        receiveUnits(
          s,
          product,
          batchId,
          line.quantity,
          { id: lineId },
          doc.kind,
          line.units,
        );
      }
      s.move(doc, product, line.quantity, 0);
      received.push({
        product_id: product.id,
        quantity: line.quantity,
        owner_unit_amount: line.owner_unit_amount,
      });
    }
    s.audit(user, "Receive customer-owned stock", doc.id, {
      owner_id: d.owner_id,
      lines: received,
    });
    return s.getDocument(doc.id);
  });
}
export function returnConsignment(s, user, input) {
  const d = z
    .object({
      batch_id: z.string(),
      ...unitFields,
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
    const returnLineId = id(),
      returnedUnits = [];
    if (product.serialized) {
      const ids = d.unit_ids || [];
      if (ids.length !== d.quantity || new Set(ids).size !== ids.length)
        throw new Error(
          "Select the exact customer-owned devices to hand back.",
        );
      for (const id of ids) {
        returnedUnits.push(
          s.one("SELECT * FROM inventory_units WHERE id=?", id),
        );
        if (
          s.run(
            "UPDATE inventory_units SET status='returned_supplier' WHERE id=? AND batch_id=? AND status='available'",
            id,
            batch.id,
          ).changes !== 1
        )
          throw new Error("Selected customer-owned device is unavailable.");
      }
    }
    s.run(
      "UPDATE batches SET remaining=remaining-?,quantity=quantity-? WHERE id=?",
      d.quantity,
      d.quantity,
      batch.id,
    );
    s.run(
      "INSERT INTO document_lines(id,document_id,product_id,quantity,price,cost) VALUES (?,?,?,?,0,0)",
      returnLineId,
      doc.id,
      product.id,
      d.quantity,
    );
    for (const unit of returnedUnits)
      link(s, { id: returnLineId }, unit, doc.kind);
    s.move(doc, product, -d.quantity, 0);
    s.audit(user, "Return unsold stock to customer", doc.id, {
      batch_id: batch.id,
      quantity: d.quantity,
    });
    return s.getDocument(doc.id);
  });
}
function postOwnerSettlement(s, doc, ownerId, amount, direction) {
  const latest = s.one(
    "SELECT MAX(date) date FROM journal WHERE party_id=? AND account='consignment_payables' AND document_id<>?",
    ownerId,
    doc.id,
  ).date;
  if (latest && doc.date < latest)
    throw new Error(
      "Owner settlements must follow the latest owner-ledger date.",
    );
  if (direction === "pay") {
    let left = amount;
    const invoices = s.all(
      `SELECT d.id,SUM(j.credit-j.debit)
      -COALESCE((SELECT SUM(rj.debit-rj.credit) FROM journal rj JOIN documents r ON r.id=rj.document_id WHERE r.original_id=d.id AND rj.party_id=? AND rj.account='consignment_payables'),0)
      -COALESCE((SELECT SUM(a.amount) FROM consignment_payout_allocations a WHERE a.sale_id=d.id AND a.owner_id=? AND a.payment_id<>?),0) due
      FROM documents d JOIN journal j ON j.document_id=d.id WHERE d.kind='sale' AND j.party_id=? AND j.account='consignment_payables' AND d.date<=? GROUP BY d.id HAVING due>0 ORDER BY d.date,d.created_at,d.id`,
      ownerId,
      ownerId,
      doc.id,
      ownerId,
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
          ownerId,
          pay,
        );
      left -= pay;
      if (!left) break;
    }
    if (left)
      throw new Error("Owner settlements could not be matched to sold stock.");
    s.ledger(doc, [
      ["consignment_payables", amount, 0, ownerId],
      ["cash", 0, amount],
    ]);
  } else
    s.ledger(doc, [
      ["cash", amount, 0],
      ["consignment_payables", 0, amount, ownerId],
    ]);
}
function clearOwnerSettlement(s, paymentId) {
  s.run(
    "DELETE FROM consignment_payout_allocations WHERE payment_id=?",
    paymentId,
  );
  s.run("DELETE FROM journal WHERE document_id=?", paymentId);
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
    postOwnerSettlement(s, doc, d.owner_id, d.amount, d.direction);
    s.audit(user, kind, doc.id, { owner_id: d.owner_id, amount: d.amount });
    return s.getDocument(doc.id);
  });
}
export function editConsignmentPay(s, user, input) {
  if (
    !user.permissions.includes("finance") ||
    !["Owner", "Manager"].includes(user.role)
  )
    throw new Error(
      "Editing owner settlements requires an owner or manager with finance permission.",
    );
  const d = z
    .object({
      id: z.string(),
      revision: z.number().int().min(0),
      amount: amount.refine((v) => v > 0),
      date: date.optional(),
      note: z.string().trim().max(500).default(""),
      request_key,
    })
    .parse(input);
  return s.transaction(() => {
    const previous = s.one(
      "SELECT * FROM invoice_operations WHERE request_key=?",
      d.request_key,
    );
    if (previous) {
      if (previous.user_id !== user.id || previous.action !== "consignment_pay_edit")
        throw new Error("Request key already used.");
      const result = JSON.parse(previous.result);
      if (result.id !== d.id)
        throw new Error("Request key already used for another payment.");
      return s.getDocument(result.id);
    }
    const old = s.getDocument(d.id);
    if (!["consignment_payment", "consignment_recovery"].includes(old.kind))
      throw new Error("Only owner payouts and recoveries can be edited here.");
    if (old.revision !== d.revision)
      throw new Error("This payment changed. Reload it before continuing.");
    const closed = s.setting("closedThrough");
    if (closed && (old.date <= closed || (d.date || old.date) <= closed))
      throw new Error("This accounting period is closed.");
    party(s, old.party_id);
    clearOwnerSettlement(s, old.id);
    const direction = old.kind === "consignment_payment" ? "pay" : "recover";
    const balance = ownerBalance(s, old.party_id);
    if (direction === "pay" ? d.amount > balance : d.amount > -balance)
      throw new Error("Amount exceeds the current owner balance.");
    const nextDate = d.date || old.date;
    s.run(
      "UPDATE documents SET date=?,total=?,paid=?,note=? WHERE id=?",
      nextDate,
      d.amount,
      d.amount,
      d.note,
      old.id,
    );
    s.run("DELETE FROM invoice_revisions WHERE document_id=?", old.id);
    s.run(
      "INSERT INTO invoice_revisions VALUES (?,?)",
      old.id,
      old.revision + 1,
    );
    const doc = s.getDocument(old.id);
    postOwnerSettlement(s, doc, old.party_id, d.amount, direction);
    s.audit(user, "Edit owner settlement", doc.id, {
      owner_id: old.party_id,
      amount: d.amount,
      previous: old.total,
    });
    const result = { id: doc.id };
    s.run(
      "INSERT INTO invoice_operations VALUES (?,?,?,?)",
      d.request_key,
      user.id,
      "consignment_pay_edit",
      JSON.stringify(result),
    );
    return s.getDocument(doc.id);
  });
}
export function consignments(s, input = {}) {
  const d = z
    .object({
      after: z.string().default(""),
      limit: z.number().int().min(1).max(100).default(10),
      view: z.enum(["stock", "owners", "payments"]).default("stock"),
      q: z.string().max(100).default(""),
    })
    .parse(input);
  const summary =
    s.one(`SELECT COALESCE((SELECT SUM(remaining) FROM batches WHERE owner_id IS NOT NULL),0) held_units,
    COALESCE(SUM(MAX(0,credit-debit)),0) due,COALESCE(SUM(MAX(0,debit-credit)),0) recoverable
    FROM party_totals WHERE account='consignment_payables'`);
  const like = d.q.trim()
    ? "%" + d.q.trim().replace(/[\\%_]/g, "\\$&") + "%"
    : "%";
  let rows;
  let next = null;
  if (d.view === "payments") {
    const clauses = [
      "d.kind IN ('consignment_payment','consignment_recovery')",
      "(p.name LIKE ? ESCAPE '\\' OR IFNULL(p.phone,'') LIKE ? ESCAPE '\\' OR d.number LIKE ? ESCAPE '\\' OR IFNULL(d.note,'') LIKE ? ESCAPE '\\')",
    ];
    const params = [like, like, like, like];
    if (d.after) {
      let cursor;
      try {
        cursor = z
          .tuple([z.string(), z.string()])
          .parse(
            JSON.parse(Buffer.from(d.after, "base64url").toString("utf8")),
          );
      } catch {
        throw new Error("Invalid pagination cursor.");
      }
      clauses.push("(d.created_at<? OR (d.created_at=? AND d.id<?))");
      params.push(cursor[0], cursor[0], cursor[1]);
    }
    rows = s.all(
      `SELECT d.id,d.number,d.kind,d.date,d.total,d.paid,d.note,d.party_id,d.created_at,
      COALESCE(r.revision,0) revision,
      p.name party_name,p.phone,
      COALESCE((SELECT SUM(credit-debit) FROM party_totals t WHERE t.party_id=d.party_id AND t.account='consignment_payables'),0) owner_balance
      FROM documents d JOIN parties p ON p.id=d.party_id
      LEFT JOIN invoice_revisions r ON r.document_id=d.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY d.created_at DESC,d.id DESC LIMIT ?`,
      ...params,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    if (more) rows.pop();
    next = more
      ? Buffer.from(
          JSON.stringify([rows.at(-1).created_at, rows.at(-1).id]),
        ).toString("base64url")
      : null;
  } else if (d.view === "owners") {
    rows = s.all(
      `SELECT p.id,p.name,p.phone,COALESCE(t.credit-t.debit,0) balance,
    COALESCE((SELECT SUM(remaining) FROM batches WHERE owner_id=p.id),0) held_units
    FROM parties p LEFT JOIN party_totals t ON t.party_id=p.id AND t.account='consignment_payables'
    WHERE p.kind='customer' AND p.id>? AND (COALESCE(t.credit-t.debit,0)<>0 OR EXISTS(SELECT 1 FROM batches b WHERE b.owner_id=p.id AND b.remaining>0))
    AND (p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')
    ORDER BY p.id LIMIT ?`,
      d.after,
      like,
      like,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    if (more) rows.pop();
    next = more ? rows.at(-1).id : null;
  } else {
    rows = s.all(
      `SELECT b.id,b.owner_id,b.product_id,b.quantity,b.remaining,b.owner_unit_amount,SUBSTR(b.received_at,1,10) received_date,p.name,p.brand,p.model,p.sku,p.price,p.category,p.attributes,p.stock,p.serialized,p.image,p.barcode,o.name owner_name
    FROM batches b JOIN products p ON p.id=b.product_id JOIN parties o ON o.id=b.owner_id
    WHERE b.owner_id IS NOT NULL AND b.remaining>0 AND b.id>?
    AND (o.name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.model LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR IFNULL(p.barcode,'') LIKE ? ESCAPE '\\')
    ORDER BY b.id LIMIT ?`,
      d.after,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      d.limit + 1,
    );
    const more = rows.length > d.limit;
    if (more) rows.pop();
    next = more ? rows.at(-1).id : null;
  }
  return { rows, summary, next };
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
