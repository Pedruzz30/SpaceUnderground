import { t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

// Shown inside the shell when a route needs a permission the member does not
// have. The database would refuse the data anyway; this only says so plainly.
export const forbiddenPage = {
  title: () => t("security.forbidden.title"),
  breadcrumb: () => t("security.forbidden.breadcrumb"),
  render: () => `
    <section class="empty-state" data-forbidden>
      <span>403</span>
      <h2 data-i18n="security.forbidden.heading">${escapeHtml(t("security.forbidden.heading"))}</h2>
      <p data-i18n="security.forbidden.body">${escapeHtml(t("security.forbidden.body"))}</p>
      <a class="button" href="#/dashboard" data-i18n="common.backToDashboard">${escapeHtml(t("common.backToDashboard"))}</a>
    </section>
  `,
};

// The Team, Approvals and Audit modules need the security migration.
export const databaseUpdatePage = {
  title: () => t("security.dbUpdate.title"),
  breadcrumb: () => t("security.dbUpdate.breadcrumb"),
  render: () => `
    <section class="empty-state" data-database-update>
      <span>DB</span>
      <h2 data-i18n="security.dbUpdate.heading">${escapeHtml(t("security.dbUpdate.heading"))}</h2>
      <p data-i18n="security.dbUpdate.body">${escapeHtml(t("security.dbUpdate.body"))}</p>
      <a class="button" href="#/dashboard" data-i18n="common.backToDashboard">${escapeHtml(t("common.backToDashboard"))}</a>
    </section>
  `,
};
