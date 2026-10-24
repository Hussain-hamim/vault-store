import { useEffect, useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { api, af, businessDate, exportCSV } from "../api";
import { useI18n } from "../i18n";
import { expenseAccountName } from "../expense-accounts";
import { ReportPrintButton } from "../printing/PrintDialog";
import { ErrorMessage, Field, Modal } from "./ui";
export function ExpenseAccountsDialog({
  close,
  changed,
}: {
  close: () => void;
  changed: () => void;
}) {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(businessDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(businessDate());
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [name, setName] = useState(""),
    [reload, setReload] = useState(0);
  const invalid = !from || !to || from > to || to > businessDate();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!invalid)
      api("expenseAccounts", { from, to })
        .then((data) => {
          if (active) {
            setRows(data.rows);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            setRows([]);
            setLoading(false);
          }
        });
    return () => {
      active = false;
    };
  }, [from, to, reload, invalid]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("expenseAccountCreate", { name });
      setName("");
      setReload((v) => v + 1);
      changed();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const document = () => ({
    kind: "report" as const,
    locale,
    title: t("expenseAccounts.title"),
    source: { type: "report" as const, permission: "finance" as const },
    subtitle: `${from} — ${to}`,
    sections: [
      {
        columns: [
          { label: t("expenseAccounts.account") },
          { label: t("expenseAccounts.periodSpent"), numeric: true },
          { label: t("expenseAccounts.lifetimeSpent"), numeric: true },
        ],
        rows: rows.map((row) => [
          expenseAccountName(row.name, t),
          af(row.period_total, 2),
          af(row.lifetime_total, 2),
        ]),
      },
    ],
    emptyLabel: t("reports.noRows"),
  });
  return (
    <Modal
      title={t("expenseAccounts.title")}
      subtitle={t("expenseAccounts.description")}
      onClose={close}
      wide
    >
      <div className="form-body">
        <form className="expense-account-create" onSubmit={create}>
          <Field label={t("expenseAccounts.newAccount")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder={t("expenseAccounts.namePlaceholder")}
            />
          </Field>
          <button className="button button-dark" disabled={busy}>
            <PlusIcon size={16} />
            {t("common.add")}
          </button>
        </form>
        <div className="expense-account-toolbar">
          <div className="report-date-range">
            <input
              aria-label={t("reports.startDate")}
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              aria-label={t("reports.endDate")}
              type="date"
              value={to}
              min={from}
              max={businessDate()}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <ReportPrintButton
            getDocument={document}
            disabled={loading || invalid || !!error}
          />
          <button
            className="button"
            disabled={loading || invalid || !!error}
            onClick={() =>
              exportCSV(
                "radefy-techmart-expense-accounts",
                rows.map((row) => ({
                  account: row.name,
                  period_AF: row.period_total / 100,
                  lifetime_AF: row.lifetime_total / 100,
                })),
              )
            }
          >
            {t("reports.csv")}
          </button>
        </div>
        <ErrorMessage error={invalid ? t("reports.invalidRange") : error} />
        {loading && !invalid ? (
          <p>{t("common.loading")}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("expenseAccounts.account")}</th>
                  <th>{t("expenseAccounts.periodSpent")}</th>
                  <th>{t("expenseAccounts.lifetimeSpent")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{expenseAccountName(row.name, t)}</td>
                    <td className="text-red">
                      <bdi dir="ltr">{af(row.period_total, 2)}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{af(row.lifetime_total, 2)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle">{t("expenseAccounts.note")}</p>
      </div>
      <div className="modal-actions">
        <button className="button" onClick={close}>
          {t("common.close")}
        </button>
      </div>
    </Modal>
  );
}
