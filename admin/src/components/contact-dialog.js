import { t } from "../i18n/index.js";
import { recordContact } from "../services/client-service.js";
import { describeError } from "../services/errors.js";
import { CONTACT_CHANNELS } from "../utils/client-relationship.js";
import { todayKey } from "../utils/financial-metrics.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";

// "Record contact" from the Client Hub and from the client record: one dialog,
// one service call. Resolves with the updated client, or null if cancelled.
export function openContactDialog(client, { defaultChannel = "CALL" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    openModal({
      title: t("clientEditor.contact.title"),
      onDismiss: () => finish(null),
      body: `
        <form class="com-form contact-form" data-contact-form novalidate>
          <p class="com-dialog__deal"><strong>${escapeHtml(client.name)}</strong>${client.company ? ` · ${escapeHtml(client.company)}` : ""}</p>
          <div class="contact-form__channels" role="radiogroup" aria-label="${escapeAttribute(t("clientEditor.contact.channel"))}">
            ${CONTACT_CHANNELS.map(
              (channel) => `
                <label class="contact-channel">
                  <input type="radio" name="channel" value="${channel}"${channel === defaultChannel ? " checked" : ""}>
                  <span>${escapeHtml(t(`clientEditor.contact.channels.${channel}`))}</span>
                </label>
              `,
            ).join("")}
          </div>
          <div class="field">
            <label for="contact-day">${escapeHtml(t("clientEditor.contact.day"))}</label>
            <input id="contact-day" name="day" type="date" value="${escapeAttribute(todayKey())}" max="${escapeAttribute(todayKey())}">
            <p class="field-error" data-error-for="day" hidden></p>
          </div>
          <div class="field">
            <label for="contact-note">${escapeHtml(t("clientEditor.contact.note"))}</label>
            <textarea id="contact-note" name="note" rows="4" maxlength="1000" placeholder="${escapeAttribute(t("clientEditor.contact.notePlaceholder"))}"></textarea>
            <p class="field-error" data-error-for="note" hidden></p>
          </div>
        </form>
      `,
      actions: [
        { label: t("common.cancel"), role: "cancel", onSelect: () => finish(null) },
        {
          label: t("clientEditor.contact.save"),
          role: "confirm",
          variant: "primary",
          onSelect: async () => {
            const form = document.querySelector("[data-contact-form]");
            const data = new FormData(form);
            try {
              const updated = await recordContact(client.id, {
                channel: data.get("channel"),
                day: data.get("day"),
                note: data.get("note"),
              });
              showToast(t("clientEditor.contact.saved"));
              finish(updated);
              return true;
            } catch (error) {
              const target = error?.field ? form.querySelector(`[data-error-for="${error.field}"]`) : null;
              if (target) {
                target.textContent = error.message;
                target.hidden = false;
              } else {
                showToast(describeError(error, t("clientEditor.contact.saveError")));
              }
              return false;
            }
          },
        },
      ],
    });

    const form = document.querySelector("[data-contact-form]");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      document.querySelector("[data-modal-confirm]")?.click();
    });
    form?.addEventListener("input", (event) => {
      const error = form.querySelector(`[data-error-for="${event.target?.name}"]`);
      if (error) error.hidden = true;
    });
  });
}
