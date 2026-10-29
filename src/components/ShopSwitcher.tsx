import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { ErrorMessage, Field } from "./ui";

type Shops = {
  current: string;
  profiles: { id: string; name: string; username: string }[];
};

export function ShopSwitcher() {
  const { t } = useI18n();
  const [shops, setShops] = useState<Shops | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    window.vault
      ?.accounts?.("list")
      .then((result) => {
        if (alive) setShops(result);
      })
      .catch((failure: Error) => {
        if (alive) setError(failure.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      {shops && shops.profiles.length > 1 && (
        <Field label={t("rememberedAccounts.shop")}>
          <select
            aria-label={t("rememberedAccounts.shop")}
            value={shops.current}
            disabled={busy}
            onChange={async (event) => {
              const id = event.target.value;
              setBusy(true);
              setError("");
              try {
                await window.vault!.accounts!("profile", id);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : t("app.tryAgain"),
                );
                setBusy(false);
              }
            }}
          >
            {shops.profiles.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name} · {shop.username}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ErrorMessage error={error} />
    </>
  );
}
