export function dueInvoices(s, user, day) {
  if (!user.permissions.includes("people")) return [];
  return s.all(
    `SELECT d.id,d.number,d.due_date,p.id party_id,p.name,p.phone,
    MAX(0,d.total-d.paid-COALESCE((SELECT SUM(r.total) FROM documents r WHERE r.original_id=d.id AND r.kind='sale_return'),0)) balance
    FROM documents d JOIN parties p ON p.id=d.party_id
    WHERE d.kind='sale' AND d.due_date IS NOT NULL AND d.due_date<=? AND p.active=1 AND p.walk_in=0
    AND balance>0 ORDER BY d.due_date,d.id`,
    day,
  );
}
export const kabulDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
