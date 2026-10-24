import { useEffect, useState, type ReactNode } from "react";
import { ArrowRightIcon, KeyIcon, WifiHighIcon } from "@phosphor-icons/react";
import { BrandWordmark, BrandMark } from "./Brand";
import { CompanyCredit } from "./CompanyCredit";
import { useI18n } from "../i18n";
import { ErrorMessage, Field } from "./ui";

type ActivationStatus = {
  active: boolean;
  required: boolean;
  mode: string;
  error?: string;
};
const errorCodes = [
  "INVALID_KEY",
  "KEY_IN_USE",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "INVALID_RECEIPT",
  "DEVICE_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "ACTIVATION_BUSY",
  "SERVICE_UNAVAILABLE",
];
export function DesktopActivationGate({ children }: { children: ReactNode }) {
  const { t, dir } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!window.vault?.activationStatus) {
      setStatus({ active: true, required: false, mode: "browser" });
      return;
    }
    window.vault
      .activationStatus()
      .then((result) => {
        if (alive) setStatus(result);
      })
      .catch(() => {
        if (alive)
          setStatus({
            active: false,
            required: true,
            mode: "required",
            error: "SERVICE_UNAVAILABLE",
          });
      });
    return () => {
      alive = false;
    };
  }, [retry]);
  if (!status)
    return (
      <div className="boot-screen" dir={dir}>
        <BrandMark />
        <p>{t("activation.checking")}</p>
      </div>
    );
  if (status.active) return children;
  return (
    <ActivationScreen
      status={status}
      activated={setStatus}
      retry={() => {
        setStatus(null);
        setRetry((value) => value + 1);
      }}
    />
  );
}
function ActivationScreen({
  status,
  activated,
  retry,
}: {
  status: ActivationStatus;
  activated: (status: ActivationStatus) => void;
  retry: () => void;
}) {
  const { t, dir } = useI18n();
  const [key, setKey] = useState("");
  const [error, setError] = useState(status.error || "");
  const [busy, setBusy] = useState(false);
  const errorText = error
    ? t(
        "activation.errors." +
          (errorCodes.includes(error) ? error : "SERVICE_UNAVAILABLE"),
      )
    : "";
  return (
    <div className="auth-screen activation-screen" dir={dir}>
      <div className="auth-story">
        <div className="brand">
          <BrandWordmark />
        </div>
        <div>
          <span className="auth-eyebrow">{t("activation.eyebrow")}</span>
          <h1>{t("activation.headline")}</h1>
          <p>{t("activation.story")}</p>
          <span className="auth-offline">
            <WifiHighIcon size={18} />
            {t("activation.internet")}
          </span>
        </div>
        <small>{t("auth.footer")}</small>
      </div>
      <div className="auth-form-container">
        <form
          className="auth-form activation-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              if (!window.vault?.activate)
                throw new Error("SERVICE_UNAVAILABLE");
              activated(await window.vault.activate(key));
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "SERVICE_UNAVAILABLE",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="auth-form-icon">
            <KeyIcon size={30} />
          </span>
          <h2>{t("activation.title")}</h2>
          <p>{t("activation.hint")}</p>
          <Field label={t("activation.key")}>
            <input
              name="activationKey"
              dir="ltr"
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={100}
              placeholder="RADE-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              required
              disabled={busy}
            />
          </Field>
          <ErrorMessage error={errorText} />
          <button
            className="button button-dark full"
            disabled={busy || !key.trim()}
          >
            {t(busy ? "activation.activating" : "activation.activate")}
            <ArrowRightIcon size={16} />
          </button>
          {error && (
            <button
              className="text-button activation-retry"
              type="button"
              onClick={retry}
              disabled={busy}
            >
              {t("app.tryAgain")}
            </button>
          )}
          <p className="auth-note">{t("activation.after")}</p>
        </form>
        <CompanyCredit />
      </div>
    </div>
  );
}
