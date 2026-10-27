import brand from "../../shared/brand.json" with { type: "json" };
export function invoicePrintModel(
  doc,
  store,
  { locale, t, money, foreignMoney, specs, rate },
) {
  const purchase = ["purchase", "purchase_return"].includes(doc.kind);
  const kindKeys = {
    sale: "ledger.sale",
    purchase: "ledger.purchase",
    sale_return: "ledger.returnSale",
    purchase_return: "ledger.returnPurchase",
    expense: "ledger.expense",
    receipt: "ledger.paymentIn",
    payment: "ledger.paymentOut",
    owner: "nav.capital",
    consignment_receipt: "resale.receive",
    consignment_return: "resale.returnOwner",
    consignment_payment: "resale.payOwner",
    consignment_recovery: "resale.recover",
    opening: "ledger.opening",
    adjustment: "ledger.adjustment",
  };
  return {
    kind: "invoice",
    billStyle: doc.kind === "sale" ? "saleShop" : "standard",
    companyCredit: {
      label: t("company.builtBy"),
      whatsapp: brand.support.whatsapp,
    },
    locale,
    store,
    source: { type: "invoice", id: doc.id },
    title: t(kindKeys[doc.kind] || "invoice.title"),
    reference: doc.number,
    subtitle: doc.date,
    purchase,
    signatureLabel: doc.kind === "sale" ? t("invoice.customerSignature") : "",
    emptyLabel: t("reports.noRows"),
    metadata: [
      {
        label: t(
          purchase || doc.kind === "payment"
            ? "invoice.supplier"
            : "invoice.customer",
        ),
        value: [doc.party_name, doc.party_phone].filter(Boolean).join(" · ") || "—",
      },
      { label: t("invoice.recordedBy"), value: doc.user_name || "—" },
      ...([
        "purchase",
        "sale",
        "payment",
        "receipt",
        "sale_return",
        "purchase_return",
      ].includes(doc.kind) && doc.paid_foreign != null
        ? [
            {
              label: t(
                doc.kind === "purchase_return"
                  ? "currencies.refundReceived"
                  : ["sale_return", "purchase_return"].includes(doc.kind)
                    ? "currencies.refundPaid"
                    : ["payment", "receipt"].includes(doc.kind)
                      ? "payment.amount"
                      : doc.kind === "sale"
                        ? "currencies.paidAtSale"
                        : "currencies.paidAtPurchase",
              ),
              value: `${foreignMoney(doc.paid_foreign)} → ${money(Math.round((doc.paid_foreign * doc.fx_rate) / 10000), 2)}`,
              numeric: true,
            },
          ]
        : []),
      ...((purchase ||
        (["sale", "sale_return"].includes(doc.kind) &&
          doc.currency &&
          doc.currency !== "AFN")) &&
      doc.fx_rate
        ? [
            {
              label: t("currencies.exchangeRate"),
              value: rate(doc.fx_rate),
              numeric: true,
            },
          ]
        : []),
      ...(doc.kind === "sale" && doc.previous_balance != null
        ? [
            {
              label: t("sales.previousBalance"),
              value: money(doc.previous_balance, 2),
              numeric: true,
            },
            {
              label: t("sales.newBalance"),
              value: money(doc.new_balance ?? doc.party_balance ?? 0, 2),
              numeric: true,
            },
          ]
        : []),
    ],
    lineLabels: [
      t("invoice.product"),
      t("invoice.quantity"),
      ...(purchase
        ? [
            t("currencies.unitCost", {
              code:
                (doc.kind === "purchase_return"
                  ? doc.lines?.[0]?.currency
                  : doc.currency) || "AED",
            }),
          ]
        : []),
      t(purchase ? "invoice.unitCostAf" : "invoice.unitPrice"),
      t("invoice.discount"),
      t("invoice.total"),
    ],
    lines: (doc.lines || []).map((l) => ({
      name: l.name,
      identity: [
        l.brand,
        l.model,
        l.sku,
        ...(l.units || []).map((u) => u.serial || u.code),
      ]
        .filter(Boolean)
        .join(" · "),
      specs: [
        ...specs(l).map((s) => s.key + ": " + s.value),
        ...(l.units || []).map((u) =>
          [u.serial || u.code, u.condition, u.battery, u.notes, u.accessories]
            .filter(Boolean)
            .join(" · "),
        ),

        ...(l.owner_unit_amount !== undefined
          ? [t("resale.ownerUnitAmount") + ": " + money(l.owner_unit_amount, 2)]
          : []),
      ],
      quantity: l.quantity,
      price: money(l.price, 2),
      discount: money(l.discount, 2),
      total: money(l.quantity * l.price - l.discount, 2),
      costAed:
        (l.cost_foreign ?? l.cost_aed)
          ? foreignMoney(
              l.cost_foreign ?? l.cost_aed,
              l.currency || doc.currency || "AED",
            )
          : "—",
      discountNote: l.discount
        ? `${t("invoice.discount")}: ${money(l.discount, 2)}`
        : "",
    })),
    summary: ["consignment_receipt", "consignment_return"].includes(doc.kind)
      ? []
      : ["sale_return", "purchase_return"].includes(doc.kind)
        ? [
            { label: t("invoice.total"), value: money(doc.total, 2) },
            {
              label: t("currencies.returnCredit"),
              value: money(doc.total - doc.paid, 2),
            },
            {
              label: t(
                doc.kind === "purchase_return"
                  ? "currencies.refundReceived"
                  : "currencies.refundPaid",
              ),
              value: money(doc.paid, 2),
            },
          ]
        : [
            { label: t("invoice.total"), value: money(doc.total, 2) },
            {
              label: t("invoice.returned"),
              value: money(doc.returned || 0, 2),
            },
            { label: t("invoice.paid"), value: money(doc.paid, 2) },
            {
              label: t("invoice.outstanding"),
              value: money(
                Math.max(0, doc.total - (doc.returned || 0) - doc.paid),
                2,
              ),
            },
          ],
    note: [
      doc.note,
      ...(["consignment_receipt", "consignment_return"].includes(doc.kind)
        ? [t("resale.custodyNote")]
        : []),
    ]
      .filter(Boolean)
      .join("\n"),
    endNote: t("invoice.afnNote"),
  };
}
/** One report definition supplies the screen, PDF/print, and numeric CSV rows. */
export function reportPrintModel(
  tab,
  data,
  inventory,
  capital,
  { t, locale, money, account, from, to, today, reorder },
) {
  const current = [
    "inventoryVal",
    "stockAging",
    "receivables",
    "payables",
    "reorder",
    "zeroStock",
    "availableStock",
  ].includes(tab);
  const doc = {
    kind: "report",
    locale,
    title: t(`reports.${tab}`),
    source: { type: "report", permission: "reports" },
    subtitle: current
      ? t("ui.asOf", { date: reorder?.as_of || today })
      : ["balanceSheet", "trialBalance", "capitalNet"].includes(tab)
        ? t("ui.asOf", { date: to })
        : `${from} — ${to}`,
    sections: [],
    metrics: [],
    emptyLabel: t("reports.noRows"),
    endNote: t("invoice.afnNote"),
  };
  const format = (v, kind) =>
    kind === "money"
      ? money(v, 2)
      : kind === "percent"
        ? `${v.toFixed(1)}%`
        : v;
  const table = (keys, kinds, rawRows, note = "", tones = []) => {
    doc.sections.push({
      columns: keys.map((key, i) => ({
        label: t(key),
        numeric: kinds[i] !== "text",
        kind: kinds[i],
      })),
      rawRows,
      rows: rawRows.map((row) => row.map((v, i) => format(v, kinds[i]))),
      note,
      tones: rawRows.map((row, r) =>
        row.map((v, c) =>
          typeof v === "number" && v < 0
            ? "negative"
            : (typeof tones[c] === "function" ? tones[c](v, r) : tones[c]) ||
              "neutral",
        ),
      ),
    });
  };
  const metric = (label, value, tone = "blue", kind = "money") =>
    doc.metrics.push({
      label: t(label),
      value: format(value, kind),
      tone: value < 0 ? "negative" : tone,
    });
  const profitTone = (n) => (n < 0 ? "negative" : "positive");
  const totals = data?.totals || {};
  if (tab === "profitLoss") {
    table(
      ["reports.colAccount", "common.total"],
      ["text", "money"],
      [
        [t("reports.netSales"), totals.sales],
        [t("reports.cogs"), totals.cogs],
        [t("reports.grossProfit"), totals.gross],
        [t("reports.otherIncome"), totals.other],
        [t("reports.operatingExpenses"), totals.expenses],
        [t("reports.netProfit"), totals.net],
      ],
      t("reports.plFootnote"),
      [
        "neutral",
        (_, r) =>
          [
            "blue",
            "amber",
            profitTone(totals.gross),
            "positive",
            "amber",
            profitTone(totals.net),
          ][r],
      ],
    );
    metric("reports.netSales", totals.sales);
    metric("reports.grossProfit", totals.gross, profitTone(totals.gross));
    metric("reports.operatingExpenses", totals.expenses, "amber");
    metric("reports.netProfit", totals.net, profitTone(totals.net));
  } else if (tab === "daily") {
    table(
      [
        "common.date",
        "reports.colSales",
        "reports.colCogsShort",
        "reports.grossProfit",
        "reports.operatingExpenses",
        "reports.otherIncome",
        "reports.netProfit",
      ],
      ["text", "money", "money", "money", "money", "money", "money"],
      data.days.map((d) => [
        d.date,
        d.sales,
        d.cogs,
        d.sales - d.cogs,
        d.expenses,
        d.other,
        d.sales - d.cogs - d.expenses + d.other,
      ]),
      t("reports.dailyFormula"),
      ["neutral", "blue", "amber", "positive", "amber", "positive", "positive"],
    );
    metric("reports.netSales", totals.sales);
    metric("reports.operatingExpenses", totals.expenses, "amber");
    metric("reports.netProfit", totals.net, profitTone(totals.net));
  } else if (tab === "productProfit") {
    table(
      [
        "reports.colProduct",
        "reports.colUnitsSoldNet",
        "reports.colRevenue",
        "reports.colCogsShort",
        "reports.grossProfit",
        "reports.colMargin",
      ],
      ["text", "number", "money", "money", "money", "percent"],
      data.best.map((p) => [
        p.name,
        p.quantity,
        p.revenue,
        p.cost,
        p.revenue - p.cost,
        p.revenue ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
      ]),
      t("reports.topProductsNote"),
      ["neutral", "blue", "blue", "amber", "positive", "positive"],
    );
    metric("reports.netSales", totals.sales);
    metric("reports.grossProfit", totals.gross, profitTone(totals.gross));
  } else if (tab === "invoiceProfit") {
    const rows = data.invoices || [];
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    table(
      [
        "documents.reference",
        "common.date",
        "reports.colContact",
        "reports.colType",
        "reports.colRevenue",
        "reports.colCogsShort",
        "reports.grossProfit",
        "reports.colMargin",
      ],
      ["text", "text", "text", "text", "money", "money", "money", "percent"],
      rows.map((r) => [
        r.number,
        r.date,
        r.party_name || "—",
        r.kind === "sale_return"
          ? t("documents.returned")
          : t("nav.sales"),
        r.revenue,
        r.cost,
        r.revenue - r.cost,
        r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
      ]),
      t("reports.invoiceProfitNote"),
      [
        "neutral",
        "neutral",
        "neutral",
        "blue",
        "blue",
        "amber",
        "positive",
        "positive",
      ],
    );
    metric("reports.colRevenue", revenue);
    metric("reports.colCogsShort", cost, "amber");
    metric("reports.grossProfit", revenue - cost, profitTone(revenue - cost));
  } else if (tab === "resaleProfit") {
    const rows = data.resale || [];
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const owner = rows.reduce((s, r) => s + r.owner_share, 0);
    table(
      [
        "documents.reference",
        "common.date",
        "reports.colProduct",
        "resale.owner",
        "reports.colUnitsSoldNet",
        "reports.colRevenue",
        "reports.ownerShare",
        "reports.shopProfit",
        "reports.colMargin",
      ],
      [
        "text",
        "text",
        "text",
        "text",
        "number",
        "money",
        "money",
        "money",
        "percent",
      ],
      rows.map((r) => {
        const profit = r.revenue - r.owner_share;
        return [
          r.number,
          r.date,
          r.product_name,
          r.owner_name,
          r.quantity,
          r.revenue,
          r.owner_share,
          profit,
          r.revenue ? (profit / r.revenue) * 100 : 0,
        ];
      }),
      t("reports.resaleProfitNote"),
      [
        "neutral",
        "neutral",
        "neutral",
        "neutral",
        "blue",
        "blue",
        "amber",
        "positive",
        "positive",
      ],
    );
    metric("reports.colRevenue", revenue);
    metric("reports.ownerShare", owner, "amber");
    metric(
      "reports.shopProfit",
      revenue - owner,
      profitTone(revenue - owner),
    );
  } else if (tab === "cashMoney") {
    const m = data.money || {};
    const kindLabel = (kind) => {
      const keys = {
        sale: "nav.sales",
        sale_return: "documents.returned",
        purchase: "nav.purchases",
        purchase_return: "documents.returned",
        expense: "nav.expenses",
        payment: "people.paySupplier",
        receipt: "people.receivePayment",
        owner: "capital.title",
        adjustment: "ledger.adjustment",
        consignment_payment: "resale.payOwner",
        consignment_recovery: "resale.recover",
      };
      return keys[kind] ? t(keys[kind]) : kind;
    };
    const position = [
      [t("accounts.cash"), m.cash || 0],
      [t("accounts.receivables"), m.receivables || 0],
      [t("accounts.inventory"), m.inventory || 0],
      [t("resale.recoverable"), m.consignment_recoverable || 0],
      [t("accounts.payables"), -(m.payables || 0)],
      [t("resale.owedToOwners"), -(m.consignment_payables || 0)],
      [t("capital.netWorth"), m.net_worth || 0],
    ];
    const flows = (m.by_kind || []).map((r) => [
      `${t("reports.periodCash")}: ${kindLabel(r.kind)}`,
      r.cash_in - r.cash_out,
    ]);
    const rows = [...position, ...flows];
    table(
      ["reports.colItem", "common.total"],
      ["text", "money"],
      rows,
      t("reports.cashMoneyNote"),
      [
        "neutral",
        (_, r) =>
          r < position.length ? profitTone(position[r][1]) : "blue",
      ],
    );
    metric("accounts.cash", m.cash || 0, profitTone(m.cash || 0));
    metric("reports.cashIn", m.cash_in || 0, "positive");
    metric("reports.cashOut", m.cash_out || 0, "amber");
    metric(
      "reports.cashNet",
      m.cash_net || 0,
      profitTone(m.cash_net || 0),
    );
    metric("capital.netWorth", m.net_worth || 0, profitTone(m.net_worth || 0));
  } else if (tab === "expenseBreak") {
    table(
      ["expenses.category", "common.total"],
      ["text", "money"],
      data.expenses.map((r) => [
        r.source_kind === "adjustment" ||
        (!r.source_kind && r.category === "adjustment")
          ? t("ledger.adjustment")
          : [
                "Rent",
                "Salaries",
                "Utilities",
                "Food",
                "Transport",
                "Repairs",
                "Other",
                "Marketing",
              ].includes(r.category)
            ? t(`expense.${r.category.toLowerCase()}`)
            : r.category,
        r.amount,
      ]),
      t("reports.expenseNote"),
      ["neutral", "amber"],
    );
    metric("reports.operatingExpenses", totals.expenses, "amber");
  } else if (tab === "trialBalance") {
    const sum = (key) => data.trial.reduce((s, r) => s + r[key], 0);
    const debit = sum("debit"),
      credit = sum("credit");
    table(
      [
        "reports.colAccount",
        "reports.colTotalDebits",
        "reports.colTotalCredits",
        "reports.colNetBalance",
      ],
      ["text", "money", "money", "money"],
      [
        ...data.trial.map((r) => [
          account(r.account),
          r.debit,
          r.credit,
          r.balance,
        ]),
        [t("common.total"), debit, credit, sum("balance")],
      ],
      t(debit === credit ? "reports.balanced" : "reports.reconNeeded"),
      ["neutral", "blue", "amber", "blue"],
    );
    metric("reports.colTotalDebits", debit);
    metric("reports.colTotalCredits", credit, "amber");
    metric(
      "reports.difference",
      debit - credit,
      debit === credit ? "positive" : "negative",
    );
    doc.reconciled = debit === credit;
  } else if (tab === "balanceSheet") {
    const bal = (key) =>
      data.trial.find((r) => r.account === key)?.balance || 0;
    const profit = -[
      "sales",
      "cost_of_goods",
      "expenses",
      "other_income",
    ].reduce((s, key) => s + bal(key), 0);
    const owners = data.consignment || {
      due: Math.max(0, -bal("consignment_payables")),
      recoverable: Math.max(0, bal("consignment_payables")),
    };
    const assets =
      bal("cash") + bal("receivables") + bal("inventory") + owners.recoverable;
    const le = -bal("payables") + owners.due - bal("equity") + profit;
    table(
      ["reports.colAccount", "common.total"],
      ["text", "money"],
      [
        ...["cash", "receivables", "inventory"].map((a) => [
          account(a),
          bal(a),
        ]),
        ...(owners.recoverable
          ? [[t("resale.recoverable"), owners.recoverable]]
          : []),
        [t("capital.totalAssets"), assets],
        [t("reports.bsSupplierPayables"), -bal("payables")],
        ...(owners.due ? [[t("resale.owedToOwners"), owners.due]] : []),
        [t("reports.bsOwnerEquity"), -bal("equity")],
        [t("reports.bsCumulativeEarnings"), profit],
        [t("reports.bsTotalLiabEquity"), le],
      ],
      t(assets === le ? "reports.balanced" : "reports.reconNeeded"),
      ["neutral", (_, r) => (r === 4 ? "amber" : "blue")],
    );
    metric("capital.totalAssets", assets);
    metric("reports.bsTotalLiabEquity", le, "positive");
    metric(
      "reports.difference",
      assets - le,
      assets === le ? "positive" : "negative",
    );
    doc.reconciled = assets === le;
  } else if (tab === "capitalNet") {
    table(
      [
        "capital.month",
        "reports.colInvested",
        "reports.colWithdrawn",
        "capital.profit",
        "capital.netWorth",
        "capital.change",
      ],
      ["text", "money", "money", "money", "money", "money"],
      (capital.months || []).map((m) => [
        m.month,
        m.invested,
        m.withdrawn,
        m.profit,
        m.net_worth,
        m.change,
      ]),
      t("reports.capitalNetNote"),
      ["neutral", "blue", "amber", "positive", "blue", "positive"],
    );
    for (const [label, key] of [
      ["capital.cash", "cash"],
      ["reports.ownerCapital", "capital"],
      ["reports.earningsKept", "earnings"],
      ["capital.netWorth", "net_worth"],
    ])
      metric(
        label,
        capital.current[key],
        key === "earnings" ? "positive" : "blue",
      );
    doc.summary = doc.metrics.map(({ label, value, tone }) => ({
      label,
      value,
      tone,
    }));
  } else if (["inventoryVal", "stockAging"].includes(tab)) {
    const rows = [...(inventory.stock || [])];
    if (tab === "stockAging")
      rows.sort(
        (a, b) =>
          (a.oldest || "9999").localeCompare(b.oldest || "9999") ||
          a.sku.localeCompare(b.sku),
      );
    table(
      [
        "reports.colProduct",
        "reports.colQuantity",
        "reports.colInventoryValue",
        "reports.colOldestReceipt",
        "reports.colAge",
      ],
      ["text", "number", "money", "text", "text"],
      rows.map((p) => [
        `${p.name} · ${p.sku}`,
        p.stock,
        p.value,
        p.oldest || "—",
        p.oldest
          ? t("reports.ageDays", {
              n: Math.max(
                0,
                Math.floor(
                  (Date.parse(today) - Date.parse(p.oldest)) / 86400000,
                ),
              ),
            })
          : "—",
      ]),
      t("reports.stockNote"),
      ["neutral", "blue", "blue", "neutral", "amber"],
    );
    metric(
      "reports.listedValue",
      rows.reduce((s, p) => s + p.value, 0),
    );
    metric(
      "reports.listedUnits",
      rows.reduce((s, p) => s + p.stock, 0),
      "blue",
      "number",
    );
  } else if (["receivables", "payables"].includes(tab)) {
    const rows = (
      tab === "receivables" ? inventory.customers : inventory.suppliers
    ).filter((p) => p.balance !== 0);
    table(
      [
        "reports.colContact",
        "common.phone",
        "common.outstanding",
        "reports.colOverdue",
      ],
      ["text", "text", "money", "money"],
      rows.map((p) => [p.name, p.phone || "—", p.balance, p.overdue]),
      t("reports.debtNote"),
      [
        "neutral",
        "neutral",
        tab === "receivables" ? "blue" : "amber",
        "negative",
      ],
    );
    metric(
      "reports.listedOutstanding",
      rows.reduce((s, p) => s + p.balance, 0),
      tab === "receivables" ? "blue" : "amber",
    );
    metric(
      "reports.colOverdue",
      rows.reduce((s, p) => s + p.overdue, 0),
      "negative",
    );
  } else if (tab === "availableStock") {
    const r = reorder;
    table(
      [
        "reports.colProduct",
        "reports.colCategory",
        "reports.onHand",
        "reports.reorderPoint",
        "reports.stockValue",
      ],
      ["text", "text", "number", "number", "money"],
      r.rows.map((p) => [
        [
          p.name,
          [p.brand, p.model, p.sku, p.barcode].filter(Boolean).join(" · "),
        ]
          .filter(Boolean)
          .join("\n"),
        p.category || "",
        p.stock,
        p.reorder_level,
        p.estimated_cost,
      ]),
      t("reports.availableStockNote") + "\n" + t("reports.estimateNote"),
      ["neutral", "neutral", "blue", "neutral", "blue"],
    );
    metric("reports.products", r.summary.products, "blue", "number");
    metric("reports.listedUnits", r.summary.units, "blue", "number");
    metric("reports.stockValue", r.summary.estimated_cost, "blue");
    doc.summary = doc.metrics.map(({ label, value, tone }) => ({
      label,
      value,
      tone,
    }));
    if (r.summary.unpriced)
      doc.note = t("reports.unpricedNote", { n: r.summary.unpriced });
  } else if (["reorder", "zeroStock"].includes(tab)) {
    const r = reorder;
    table(
      [
        "reports.colProduct",
        "common.status",
        "reports.onHand",
        "reports.reorderPoint",
        "reports.orderQty",
        "reports.estimatedCost",
      ],
      ["text", "text", "number", "number", "number", "money"],
      r.rows.map((p) => [
        [p.name, [p.brand, p.model, p.sku].filter(Boolean).join(" · ")]
          .filter(Boolean)
          .join("\n"),
        t(p.stock === 0 ? "reports.outOfStock" : "reports.lowStock"),
        p.stock,
        p.reorder_level,
        p.suggested_quantity,
        p.estimated_cost,
      ]),
      (tab === "zeroStock" ? t("reports.zeroStockNote") + "\n" : "") +
        t("reports.reorderFormula") +
        "\n" +
        t("reports.estimateNote"),
      [
        "neutral",
        (_, i) => (r.rows[i].stock === 0 ? "negative" : "amber"),
        "amber",
        "neutral",
        "blue",
        "blue",
      ],
    );
    metric("reports.outOfStock", r.summary.out_of_stock, "negative", "number");
    if (tab !== "zeroStock")
      metric("reports.lowStock", r.summary.low_stock, "amber", "number");
    metric(
      "reports.unitsToOrder",
      r.summary.suggested_quantity,
      "blue",
      "number",
    );
    metric("reports.estimatedCost", r.summary.estimated_cost, "blue");
    doc.summary = doc.metrics.map(({ label, value, tone }) => ({
      label,
      value,
      tone,
    }));
    if (r.summary.unpriced)
      doc.note = t("reports.unpricedNote", { n: r.summary.unpriced });
  }
  return doc;
}
export function reportCSVRows(doc) {
  return doc.sections.flatMap((section) =>
    section.rawRows.map((row) =>
      Object.fromEntries(
        section.columns.map((column, i) => [
          column.label + (column.kind === "money" ? " (AFN)" : ""),
          column.kind === "money" ? row[i] / 100 : row[i],
        ]),
      ),
    ),
  );
}
