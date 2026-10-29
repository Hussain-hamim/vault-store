import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";
import { useI18n } from "../i18n";
import { Field, ErrorMessage } from "./ui";
export function OwnerRecovery({
  settings = false,
  onClose,
  onSuccess,
  storeName,
}: {
  settings?: boolean;
  onClose?: () => void;
  onSuccess?: (session: any) => void;
  storeName?: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const errorText = (code: string) =>
    t(
      "recovery.errors." +
        ([
          "NETWORK_ERROR",
          "ENROLLMENT_REQUIRED",
          "INVALID_CODE",
          "RATE_LIMITED",
          "RETRY_PASSWORD",
          "INVALID_INPUT",
          "BUSY",
          "INVALID_RESPONSE",
          "STORAGE_UNAVAILABLE",
          "WRONG_STORE",
          "EXPIRED_CODE",
          "CODE_USED",
          "OWNER_CHANGED",
        ].includes(code)
          ? code
          : "SERVICE_UNAVAILABLE"),
    );
  useEffect(() => {
    let alive = true;
    window.vault
      ?.recovery?.("prepare")
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        if (alive) setError(t("recovery.errors.STORAGE_UNAVAILABLE"));
      });
    return () => {
      alive = false;
    };
  }, [t]);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await window.vault!.recovery!(settings ? "sync" : "prepare", {
          token: getToken(),
        }),
      );
    } catch (e: any) {
      setError(errorText(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      if (settings) {
        const result = await api<any>("ownerPasswordChange", {
          password: data.get("password"),
        });
        setToken(result.token);
        setSaved(true);
        form.reset();
      } else {
        const result = await window.vault!.recovery!("recover", {
          code: String(data.get("code") || "").trim(),
        });
        onSuccess?.(result);
      }
    } catch (e: any) {
      setError(errorText(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="owner-recovery panel"
      style={{
        padding: 20,
        maxWidth: 560,
        margin: "12px auto",
        overflowWrap: "anywhere",
      }}
    >
      <h3>{t(settings ? "recovery.title" : "recovery.loginTitle")}</h3>
      <p className="recovery-store">
        <strong>{status?.storeName || storeName}</strong>
        {status?.username && <span> · {status.username}</span>}
      </p>
      <p>{t(settings ? "recovery.settingsHint" : "recovery.simpleHint")}</p>
      {!settings && (
        <form onSubmit={submit}>
          <Field label={t("recovery.code")}>
            <input
              name="code"
              required
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              onChange={() => setError("")}
            />
          </Field>
          <button
            className="button button-dark full"
            disabled={busy || !status?.registered}
          >
            {t(busy ? "recovery.working" : "recovery.openStore")}
          </button>
        </form>
      )}
      {settings && (
        <>
          <p>
            {t(status?.registered ? "recovery.registered" : "recovery.pending")}
          </p>
          <form onSubmit={submit}>
            <Field label={t("recovery.newPassword")}>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />{" "}
              {t("recovery.showPassword")}
            </label>
            <button className="button" disabled={busy}>
              {t("recovery.changePassword")}
            </button>
          </form>
          {saved && <p role="status">{t("recovery.passwordSaved")}</p>}
        </>
      )}
      {!status?.registered && status && (
        <>
          <p>{t("recovery.pending")}</p>
          <button className="button full" disabled={busy} onClick={check}>
            {t("recovery.sync")}
          </button>
        </>
      )}
      <ErrorMessage
        error={
          error ||
          (!status?.registered && status?.error ? errorText(status.error) : "")
        }
      />
      <details style={{ marginTop: 16 }}>
        <summary>{t("recovery.supportDetails")}</summary>
        <Field label={t("recovery.reference")}>
          <input
            aria-label={t("recovery.reference")}
            readOnly
            value={status?.installationId || ""}
            dir="ltr"
          />
        </Field>
        <p>
          {t("recovery.device")}: <bdi>{status?.deviceHash}</bdi>
        </p>
        <p>
          {t("recovery.publicKey")}: <bdi>{status?.publicKey}</bdi>
        </p>
        {status?.lastSync && (
          <p>
            {t("recovery.lastSync")}:{" "}
            {new Date(status.lastSync).toLocaleString()}
          </p>
        )}
      </details>
      {onClose && (
        <button className="button full" disabled={busy} onClick={onClose}>
          {t("recovery.back")}
        </button>
      )}
    </section>
  );
}
