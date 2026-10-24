import {
  COMPANY_LOGO_HOOK,
  COMPANY_LOGO_LEG,
} from "../../shared/company-logo.mjs";
import brand from "../../shared/brand.json";
import { supportLinks } from "../../server/support.mjs";
import { useI18n } from "../i18n";

export function CompanyLogo() {
  return (
    <svg
      className="company-logo"
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={COMPANY_LOGO_HOOK} />
      <path fillRule="evenodd" d={COMPANY_LOGO_LEG} />
    </svg>
  );
}

export function CompanyCredit() {
  const { t } = useI18n();
  return (
    <aside className="auth-company-credit" aria-label={t("company.builtBy")}>
      <div className="auth-company-heading">
        <CompanyLogo />
        <strong>{t("company.builtBy")}</strong>
      </div>
      <div className="auth-company-links">
        {supportLinks(brand.support).map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (window.vault?.openExternal) {
                event.preventDefault();
                window.vault.openExternal(link.url).catch(() => {});
              }
            }}
          >
            <span>{t("company." + link.id)}</span>
            <bdi>
              {link.id === "website" ? "radefysystems.com" : link.value}
            </bdi>
          </a>
        ))}
      </div>
    </aside>
  );
}
