import { dueInvoices, kabulDay } from "./due-invoices.mjs";
import { z } from "zod";
/** Current actionable conditions, never sample rows or an unread-message counter. */
export function notifications(s, user, input = {}) {
  const d = z
    .object({
      kind: z.enum(["stock", "customers", "due", "overdue"]).default("stock"),
      limit: z.number().int().min(1).max(100).default(10),
      cursor: z.string().max(1500).nullable().optional(),
      revision: z.number().int().nonnegative().optional(),
      summaryOnly: z.boolean().default(false),
      asOf: z.string().optional(),
    })
    .parse(input);
  const stockAllowed = user.permissions.some((p) =>
    ["inventory", "sales", "purchases"].includes(p),
  );
  const peopleAllowed = user.permissions.includes("people");
  const revision = s.one("SELECT COALESCE(MAX(id),0) n FROM audit").n;
  if (d.revision !== undefined && d.revision !== revision)
    throw new Error("NOTIFICATIONS_CHANGED");
  const stock = stockAllowed
    ? s.one(
        "SELECT COUNT(*) total,COALESCE(SUM(stock=0),0) zero FROM products WHERE active=1 AND consignment_only=0 AND stock<=reorder_level",
      )
    : { total: 0, zero: 0 };
  const customers = peopleAllowed
    ? s.one(
        "SELECT COUNT(*) total,COALESCE(SUM(t.debit-t.credit),0) amount FROM party_totals t JOIN parties p ON p.id=t.party_id WHERE t.account='receivables' AND t.debit>t.credit AND p.kind='customer' AND p.walk_in=0 AND COALESCE(p.active,1)=1",
      )
    : { total: 0, amount: 0 };
  if (!Number.isSafeInteger(customers.amount))
    throw new Error("Customer balance total exceeds supported precision.");
  const asOf = kabulDay();
  if (d.asOf && d.asOf !== asOf) throw new Error("NOTIFICATIONS_CHANGED");
  const invoices = dueInvoices(s, user, asOf);
  const due = invoices.filter((r) => r.due_date === asOf),
    overdue = invoices.filter((r) => r.due_date < asOf);
  const summary = {
    due: new Set(due.map((r) => r.party_id)).size,
    overdue: new Set(overdue.map((r) => r.party_id)).size,
    dueInvoices: invoices.length,
    dueAmount: invoices.reduce((a, r) => a + r.balance, 0),
    stock: stock.total,
    zero: stock.zero,
    customers: customers.total,
    amount: customers.amount,
    total: stock.total + customers.total,
  };
  const result = {
    summary,
    asOf,
    revision,
    permissions: { stock: stockAllowed, customers: peopleAllowed },
    rows: [],
    next: null,
  };
  if (d.summaryOnly) return result;
  if (
    (d.kind === "stock" && !stockAllowed) ||
    (d.kind !== "stock" && !peopleAllowed)
  )
    throw new Error("Permission required for these notifications.");
  if (d.kind === "due" || d.kind === "overdue") {
    const grouped = new Map();
    for (const row of d.kind === "due" ? due : overdue) {
      if (!grouped.has(row.party_id))
        grouped.set(row.party_id, {
          id: row.party_id,
          name: row.name,
          phone: row.phone,
          balance: 0,
          invoices: [],
        });
      const party = grouped.get(row.party_id);
      party.balance += row.balance;
      party.invoices.push(row);
    }
    const all = [...grouped.values()].sort(
      (a, b) => b.balance - a.balance || a.id.localeCompare(b.id),
    );
    const offset = d.cursor
      ? z.number().int().min(0).parse(JSON.parse(d.cursor))
      : 0;
    return {
      ...result,
      rows: all.slice(offset, offset + d.limit),
      next: offset + d.limit < all.length ? String(offset + d.limit) : null,
    };
  }
  let rows;
  if (d.kind === "stock") {
    let after = "",
      params = [];
    if (d.cursor) {
      const c = z
        .tuple([z.number().int().min(0).max(1), z.string(), z.string()])
        .parse(JSON.parse(d.cursor));
      after = " AND ((stock=0) < ? OR ((stock=0)=? AND (sku,id)>(?,?)))";
      params = [c[0], ...c];
    }
    rows = s.all(
      "SELECT id,name,brand,model,sku,stock,reorder_level,category FROM products WHERE active=1 AND consignment_only=0 AND stock<=reorder_level" +
        after +
        " ORDER BY (stock=0) DESC,sku,id LIMIT ?",
      ...params,
      d.limit + 1,
    );
  } else {
    let after = "",
      params = [];
    if (d.cursor) {
      const c = z
        .tuple([z.number().int().nonnegative(), z.string()])
        .parse(JSON.parse(d.cursor));
      after = " AND (t.debit-t.credit<? OR (t.debit-t.credit=? AND p.id>?))";
      params = [c[0], ...c];
    }
    rows = s.all(
      "SELECT p.id,p.name,p.phone,p.kind,p.walk_in,t.debit-t.credit balance FROM party_totals t JOIN parties p ON p.id=t.party_id WHERE t.account='receivables' AND t.debit>t.credit AND p.kind='customer' AND p.walk_in=0 AND COALESCE(p.active,1)=1" +
        after +
        " ORDER BY balance DESC,p.id LIMIT ?",
      ...params,
      d.limit + 1,
    );
  }
  const more = rows.length > d.limit;
  if (more) rows.pop();
  const last = rows.at(-1);
  return {
    ...result,
    rows,
    next: more
      ? JSON.stringify(
          d.kind === "stock"
            ? [Number(last.stock === 0), last.sku, last.id]
            : [last.balance, last.id],
        )
      : null,
  };
}
