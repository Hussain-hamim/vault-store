import { PRODUCT_PHOTO_CATALOG } from "../../server/product-images.mjs";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  DesktopTowerIcon,
  WifiSlashIcon,
  ShieldCheckIcon,
  LifebuoyIcon,
  KeyboardIcon,
  BuildingsIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import brand from "../../shared/brand.json";
import { supportLinks } from "../../server/support.mjs";
import { BrandMark } from "./Brand";
import { useI18n } from "../i18n";
import { availableActions, shortcutLabel } from "../shortcuts.mjs";
import { Modal } from "./ui";

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
export function ShortcutList({ permissions }: { permissions: string[] }) {
  const { t } = useI18n();
  return (
    <div className="shortcut-list">
      <div className="shortcut-row">
        <span>{t("shortcuts.palette")}</span>
        <kbd>{shortcutLabel("Ctrl + K", isMac())}</kbd>
      </div>
      {availableActions(permissions)
        .filter((a) => a.combo)
        .map((a) => (
          <div className="shortcut-row" key={a.id}>
            <span>{t(a.label)}</span>
            <kbd dir="ltr">{shortcutLabel(a.combo, isMac())}</kbd>
          </div>
        ))}
      <div className="shortcut-row">
        <span>{t("help.closeShortcut")}</span>
        <kbd>Esc</kbd>
      </div>
      <p className="muted">{t("shortcuts.typingHint")}</p>
    </div>
  );
}
export function HelpContent({ permissions }: { permissions: string[] }) {
  const { t } = useI18n();
  return (
    <div className="help-content settings-help">
      {["products", "sale", "profit", "data"].map((id) => (
        <section key={id}>
          <h3>{t("help." + id + "Title")}</h3>
          <p>{t("help." + id + "Body")}</p>
        </section>
      ))}
      <ShortcutList permissions={permissions} />
    </div>
  );
}
export function CommandPalette({
  permissions,
  close,
  run,
}: {
  permissions: string[];
  close: () => void;
  run: (id: string) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const actions = availableActions(permissions).filter((a) =>
    t(a.label).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Modal
      title={t("shortcuts.palette")}
      subtitle={t("shortcuts.paletteHint")}
      onClose={close}
    >
      <div className="command-palette">
        <input
          ref={input}
          autoFocus
          aria-label={t("shortcuts.findAction")}
          placeholder={t("shortcuts.findAction")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = actions.length
                ? (selected +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    actions.length) %
                  actions.length
                : 0;
              setSelected(next);
              document
                .getElementById("command-" + actions[next]?.id)
                ?.scrollIntoView({ block: "nearest" });
            }
            if (e.key === "Enter" && actions[selected]) {
              e.preventDefault();
              run(actions[selected].id);
            }
          }}
          aria-controls="command-results"
          aria-activedescendant={
            actions[selected] ? "command-" + actions[selected].id : undefined
          }
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
        />
        <div
          id="command-results"
          role="listbox"
          aria-label={t("shortcuts.palette")}
          className="command-results"
        >
          {actions.map((a, i) => (
            <button
              role="option"
              aria-selected={i === selected}
              id={"command-" + a.id}
              className={i === selected ? "selected" : ""}
              key={a.id}
              onClick={() => run(a.id)}
            >
              <span>{t(a.label)}</span>
              {a.combo && (
                <kbd dir="ltr">{shortcutLabel(a.combo, isMac())}</kbd>
              )}
            </button>
          ))}
          {!actions.length && (
            <p className="empty-commands">{t("shortcuts.noResults")}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
export function CompanyPage({
  kind,
  navigate,
  help,
}: {
  kind: "about" | "support";
  navigate: (id: string) => void;
  help: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const links = supportLinks(brand.support);
  return (
    <section className="company-page page-content">
      <header className="company-hero">
        <BrandMark />
        <div>
          <span className="company-eyebrow">{brand.company}</span>
          <h1>{kind === "about" ? brand.name : t("company.supportTitle")}</h1>
          <p>
            {t(kind === "about" ? "company.tagline" : "company.supportIntro")}
          </p>
        </div>
        <span className="company-version" dir="ltr">
          v{brand.version}
        </span>
      </header>
      {kind === "about" ? (
        <>
          <div className="company-panel">
            <div className="company-section-title">
              <BuildingsIcon size={24} />
              <h2>{t("company.builtBy")}</h2>
            </div>
            <p>{t("company.aboutBody")}</p>
            <div className="company-capabilities">
              {[
                {
                  icon: DesktopTowerIcon,
                  title: "devices",
                  text: "devicesBody",
                },
                { icon: WifiSlashIcon, title: "offline", text: "offlineBody" },
                {
                  icon: ShieldCheckIcon,
                  title: "control",
                  text: "controlBody",
                },
              ].map((c) => (
                <article key={c.title}>
                  <c.icon size={26} weight="duotone" />
                  <h3>{t("company." + c.title)}</h3>
                  <p>{t("company." + c.text)}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="company-panel">
            <details className="photo-credits">
              <summary>{t("photos.credits")}</summary>
              <p>{t("photos.creditsHint")}</p>
              {PRODUCT_PHOTO_CATALOG.map((photo) => (
                <article key={photo.id}>
                  <strong>
                    {photo.brand} {photo.model}
                  </strong>
                  <small>
                    {photo.author} · {photo.license}
                  </small>
                  <small>{photo.changes}</small>
                  <a
                    href={photo.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (window.vault?.openExternal) {
                        e.preventDefault();
                        window.vault.openExternal(photo.source).catch(() => {});
                      }
                    }}
                  >
                    {photo.source}
                  </a>
                  <br />
                  <a
                    href={photo.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (window.vault?.openExternal) {
                        e.preventDefault();
                        window.vault
                          .openExternal(photo.licenseUrl)
                          .catch(() => {});
                      }
                    }}
                  >
                    {photo.licenseUrl}
                  </a>
                </article>
              ))}
            </details>
          </div>
          <div className="company-panel company-action">
            <div>
              <h2>{t("company.needHelp")}</h2>
              <p>{t("company.helpBody")}</p>
            </div>
            <button
              className="button button-dark"
              onClick={() => navigate("support")}
            >
              <LifebuoyIcon size={18} />
              {t("nav.support")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="company-support-grid">
            <div className="company-panel">
              <div className="company-section-title">
                <LifebuoyIcon size={24} />
                <h2>{t("company.contactTitle")}</h2>
              </div>
              <p>{t("company.contactBody")}</p>
              {links.length ? (
                <div className="company-contact-list">
                  {links.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={async (e) => {
                        if (window.vault?.openExternal) {
                          e.preventDefault();
                          try {
                            await window.vault.openExternal(link.url);
                          } catch {
                            setError(t("company.contactError"));
                          }
                        }
                      }}
                    >
                      <span>
                        <small>{t("company." + link.id)}</small>
                        <strong dir="ltr">{link.value}</strong>
                      </span>
                      <ArrowUpRightIcon size={20} />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="contact-pending">
                  <InfoIcon size={22} />
                  <p>{t("company.contactPending")}</p>
                </div>
              )}
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="company-panel">
              <div className="company-section-title">
                <KeyboardIcon size={24} />
                <h2>{t("company.quickHelp")}</h2>
              </div>
              <p>{t("company.shortcutsBody")}</p>
              <button className="button" onClick={help}>
                {t("nav.help")}
              </button>
              <p className="company-help-note">
                {t("company.supportDetails", { version: brand.version })}
              </p>
            </div>
          </div>
          <div className="company-panel">
            <h2>{t("company.commonQuestions")}</h2>
            {["data", "backup", "zoom"].map((id) => (
              <details key={id}>
                <summary>{t("company." + id + "Question")}</summary>
                <p>{t("company." + id + "Answer")}</p>
              </details>
            ))}
          </div>
        </>
      )}
      <footer className="company-footer">
        {brand.name} · {t("company.madeBy")} <strong>{brand.company}</strong>
      </footer>
    </section>
  );
}
