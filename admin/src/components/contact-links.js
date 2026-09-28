import { t } from "../i18n/index.js";
import { mailtoLink, telLink, whatsappLink } from "../utils/client-relationship.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// Line icons drawn at 16px with the current text colour, so they follow the
// button's hover and focus colour like any other label.
const ICONS = {
  email: '<path d="M3 5.5h14v9H3z"/><path d="m3.5 6 6.5 5 6.5-5"/>',
  whatsapp: '<path d="M4.2 15.8 5 13A6.5 6.5 0 1 1 7.4 15.3z"/><path d="M8 8.2c.3 1.6 1.9 3.3 3.7 3.8l.9-.9 1.3.6c-.2 1-1 1.5-2 1.4-2.6-.4-4.6-2.5-5-5-.1-.9.5-1.8 1.4-2l.6 1.3z"/>',
  phone: '<path d="M6.2 3.5h2l1 3.2-1.5 1.2a8.5 8.5 0 0 0 4.4 4.4l1.2-1.5 3.2 1v2A1.7 1.7 0 0 1 14.8 15 11.8 11.8 0 0 1 4.5 4.7 1.2 1.2 0 0 1 6.2 3.5z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// Only channels the record can actually use are offered: no email link for a
// typo'd address, no WhatsApp for a number too short to dial.
export function contactLinks(client, { labels = false } = {}) {
  const name = client.name || "";
  const links = [
    ["email", mailtoLink(client.email), t("clients.sendEmail", { name }), t("clientEditor.email"), ""],
    ["whatsapp", whatsappLink(client.phone), t("clients.openWhatsapp", { name }), "WhatsApp", ' target="_blank" rel="noreferrer"'],
    ["phone", telLink(client.phone), t("clients.call", { name }), t("clientEditor.phone"), ""],
  ].filter(([, href]) => href);
  if (!links.length) return "";
  return `
    <span class="contact-links${labels ? " contact-links--labelled" : ""}">
      ${links
        .map(
          ([kind, href, aria, text, extra]) => `
            <a class="contact-link contact-link--${kind}" href="${escapeAttribute(href)}" aria-label="${escapeAttribute(aria)}" title="${escapeAttribute(aria)}"${extra}>
              ${icon(kind)}${labels ? `<span>${escapeHtml(text)}</span>` : ""}
            </a>
          `,
        )
        .join("")}
    </span>
  `;
}
