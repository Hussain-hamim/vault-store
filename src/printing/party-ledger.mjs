function afnFromRate(amount = 0, rate = 0) {
  if (!amount || !rate) return 0;
  return Math.round((amount * rate) / 10_000);
}

/** Shared customer/supplier ledger print/PDF document with red/green tones. */
export function partyLedgerPrintDocument({
  party,
  entries,
  pageStartBalance,
  kind,
  locale,
  t,
  money,
  foreignMoney,
  labelFor,
}) {
  const signed = (e) =>
    kind === "customer" ? e.debit - e.credit : e.credit - e.debit;
  let running = pageStartBalance ?? party.balance ?? 0;
  const rows = [];
  const tones = [];
  for (const e of entries || []) {
    const rowRunning = running;
    running -= signed(e);
    const debitTone = e.debit
      ? kind === "customer"
        ? "negative"
        : "positive"
      : "neutral";
    const creditTone = e.credit
      ? kind === "customer"
        ? "positive"
        : "negative"
      : "neutral";
    const balTone = rowRunning > 0 ? "negative" : "positive";
    const fx =
      ["payment", "receipt"].includes(e.kind) && e.paid_foreign != null
        ? ` · ${foreignMoney(e.paid_foreign, e.currency)} → ${money(afnFromRate(e.paid_foreign, e.fx_rate), 2)}`
        : "";
    rows.push([
      e.date,
      `${labelFor(e)}${e.number ? ` · ${e.number}` : ""}${fx}`,
      e.debit ? money(e.debit, 2) : "—",
      e.credit ? money(e.credit, 2) : "—",
      money(rowRunning, 2),
    ]);
    tones.push(["neutral", "neutral", debitTone, creditTone, balTone]);
  }
  return {
    kind: "report",
    preferenceGroup: `${kind}-ledger`,
    locale,
    title: t("ledger.title"),
    subtitle: [party.name, party.phone].filter(Boolean).join(" · "),
    source: { type: "report", permission: "people" },
    emptyLabel: t("reports.noRows"),
    note: t("printing.ledgerPage"),
    summary: [
      {
        label: t("common.outstanding"),
        value: money(party.balance, 2),
        tone: party.balance > 0 ? "negative" : "positive",
      },
    ],
    sections: [
      {
        columns: [
          { label: t("common.date") },
          { label: t("ledger.reference") },
          { label: t("ledger.debit"), numeric: true },
          { label: t("ledger.credit"), numeric: true },
          { label: t("ledger.balance"), numeric: true },
        ],
        rows,
        tones,
      },
    ],
  };
}
