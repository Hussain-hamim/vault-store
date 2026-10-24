import { useLayoutEffect, useState } from "react";
import { useI18n } from "./i18n";

import { THEMES, readTheme, themeStorageKey } from "./appearance-model.mjs";

export function useUserTheme(userId?: string) {
  useLayoutEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = readTheme(userId);
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, [userId]);
}
export function AppearanceSettings({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(() => readTheme(userId));
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const sync = () => setSelected(readTheme(userId));
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);
  return (
    <section className="settings-form">
      <h3>{t("appearance.title")}</h3>
      <p className="muted">{t("appearance.hint")}</p>
      {failed && <p role="alert">{t("appearance.saveFailed")}</p>}
      <div className="appearance-grid">
        {THEMES.map((theme) => (
          <button
            type="button"
            key={theme.id}
            className="theme-card"
            aria-pressed={selected === theme.id}
            onClick={() => {
              try {
                localStorage.setItem(themeStorageKey(userId), theme.id);
                setFailed(false);
              } catch {
                setFailed(true);
              }
              document.documentElement.dataset.theme = theme.id;
              setSelected(theme.id);
            }}
          >
            <span className="theme-swatches" aria-hidden="true">
              {theme.colors.map((color) => (
                <span key={color} style={{ background: color }} />
              ))}
            </span>
            <strong>{t(`appearance.${theme.id}`)}</strong>
            <small>
              {selected === theme.id
                ? `✓ ${t("appearance.selected")}`
                : "\u00a0"}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
