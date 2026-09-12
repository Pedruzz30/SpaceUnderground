import { showToast } from "../components/toast.js";
import { bindLocaleFields, localeFieldAttrs, localeHint, localeTabs } from "../components/locale-fields.js";
import { describeError } from "../services/errors.js";
import { getPlans, updatePlan } from "../services/plan-service.js";
import { logActivity } from "../services/activity-service.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function field(labelKey, name, value = "", attrs = "") {
  return `
    <div class="field">
      <label for="plan-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <input id="plan-${name}" name="${name}" value="${escapeAttribute(value)}" ${attrs}>
    </div>
  `;
}

// Editorial fields are bilingual; structural ones are not. A plan's name
// ("Plus", "Pro", "Max"), slug, numeric range, position, accent, status and
// visibility describe the product itself and read the same in both locales.
function editorialField(scope, labelKey, name, value = "") {
  return `
    <div class="field">
      <label for="plan-${name}-${scope}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <input id="plan-${name}-${scope}" value="${escapeAttribute(value)}" ${localeFieldAttrs(scope, name)}>
    </div>
  `;
}

function featureRow(feature, index, total, scope) {
  const key = feature.id ? `feature:${feature.id}` : `feature:new:${index}`;
  return `
    <label class="feature-row">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <input value="${escapeAttribute(feature.text)}" data-feature-id="${escapeAttribute(feature.id || "")}" data-feature-key="${escapeAttribute(key)}" ${localeFieldAttrs(scope, key)}>
      <button type="button" class="button" data-move-feature-up="${index}" ${index === 0 ? "disabled" : ""} data-i18n="services.moveUp">${escapeHtml(t("services.moveUp"))}</button>
      <button type="button" class="button" data-move-feature-down="${index}" ${index === total - 1 ? "disabled" : ""} data-i18n="services.moveDown">${escapeHtml(t("services.moveDown"))}</button>
      <button type="button" class="button button--danger" data-remove-feature="${index}" data-i18n="services.remove">${escapeHtml(t("services.remove"))}</button>
    </label>
  `;
}

function renderPlan(plan) {
  const featureCount = plan.features?.length || 0;
  const scope = `plan-${plan.id}`;

  return `
    <article class="plan-editor" data-plan-id="${escapeAttribute(plan.id)}">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(plan.monogram || plan.slug)}</span>
          <h3>${escapeHtml(plan.name)}</h3>
        </div>
        <div class="plan-editor__badges">
          <strong class="badge ${plan.visible ? "badge--success" : "badge--muted"}" data-i18n="${plan.visible ? "common.visible" : "common.hidden"}">${escapeHtml(plan.visible ? t("common.visible") : t("common.hidden"))}</strong>
          <strong class="badge" data-feature-count>${escapeHtml(plural("services.featureCount", featureCount))}</strong>
        </div>
      </header>
      <form data-plan-form="${escapeAttribute(plan.id)}" data-locale-scope-root="${escapeAttribute(scope)}">
        <div class="form-grid">
          ${field("services.name", "name", plan.name, "required")}
          ${field("services.range", "range", plan.range)}
          ${field("services.status", "status", plan.status)}
          ${field("services.accent", "accent", plan.accent)}
          ${field("services.position", "position", plan.position, 'type="number" min="0"')}

          <div class="field field--wide plan-editor__locale">
            <span class="field-label" data-i18n="services.editorialCopy">${escapeHtml(t("services.editorialCopy"))}</span>
            ${localeTabs(scope)}
            ${localeHint(scope)}
          </div>

          ${editorialField(scope, "services.timeline", "timeline", plan.timeline)}
          ${editorialField(scope, "services.scope", "scope", plan.scope)}
          ${editorialField(scope, "services.scopeShort", "scopeShort", plan.scopeShort)}

          <div class="field field--wide">
            <label for="plan-description-${escapeAttribute(plan.id)}" data-i18n="services.description">${escapeHtml(t("services.description"))}</label>
            <textarea id="plan-description-${escapeAttribute(plan.id)}" rows="4" ${localeFieldAttrs(scope, "description")}>${escapeHtml(plan.description)}</textarea>
          </div>

          <fieldset class="field field--wide">
            <legend data-i18n="services.visibility">${escapeHtml(t("services.visibility"))}</legend>
            <div class="checks">
              <label><input type="checkbox" name="visible" ${plan.visible ? "checked" : ""}> <span data-i18n="services.showOnPublicSite">${escapeHtml(t("services.showOnPublicSite"))}</span></label>
            </div>
          </fieldset>

          <div class="field field--wide">
            <span class="field-label" data-i18n="services.features">${escapeHtml(t("services.features"))}</span>
            <div class="feature-list" data-feature-list>
              ${(plan.features || []).map((feature, index) => featureRow(feature, index, featureCount, scope)).join("")
                || `<p class="empty-inline" data-i18n="services.noFeatures">${escapeHtml(t("services.noFeatures"))}</p>`}
            </div>
            <button class="button" type="button" data-add-feature data-i18n="services.addFeature">${escapeHtml(t("services.addFeature"))}</button>
          </div>
        </div>
        <aside class="plan-preview">
          <span>${escapeHtml(plan.scopeShort || plan.scope || t("services.plan"))}</span>
          <strong>${escapeHtml(plan.name || t("services.untitledPlan"))}</strong>
          <p>${escapeHtml(plan.description || t("services.noPublicDescription"))}</p>
          <small>${escapeHtml(plan.range || t("services.rangePending"))} · ${escapeHtml(plan.timeline || t("services.timelinePending"))}</small>
        </aside>
        <div class="form-actions">
          <button class="button button--primary" type="submit" data-action-save data-i18n="services.savePlan">${escapeHtml(t("services.savePlan"))}</button>
        </div>
      </form>
    </article>
  `;
}

export const servicesPage = {
  title: () => t("services.title"),
  breadcrumb: () => t("services.breadcrumb"),
  render: () => `
    <section class="page-heading">
      <span data-i18n="services.eyebrow">${t("services.eyebrow")}</span>
      <h2 data-i18n="services.heading">${t("services.heading")}</h2>
      <p data-i18n="services.intro">${t("services.intro")}</p>
    </section>
    <section class="plans-editor-grid" data-plans-list aria-busy="true">
      <article class="panel"><p class="empty-inline" data-i18n="services.loading">${t("services.loading")}</p></article>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-plans-list]");
    let plans = [];

    function bindPlanForms() {
      root.querySelectorAll("[data-plan-form]").forEach((form) => {
        const planId = form.dataset.planForm;
        const plan = plans.find((item) => String(item.id) === String(planId));
        const scope = form.dataset.localeScopeRoot;

        // Feature translations live on each feature row, not on the plan, so
        // they are folded into the group under the same key the row carries.
        const initialTranslations = { ...(plan?.translations?.en ?? {}) };
        (plan?.features ?? []).forEach((feature) => {
          const text = feature.translations?.en?.text;
          if (feature.id && text) initialTranslations[`feature:${feature.id}`] = text;
        });

        const locale = bindLocaleFields({
          root: form,
          scope,
          initial: initialTranslations,
        });

        const renumberFeatures = () => {
          const rows = [...form.querySelectorAll(".feature-row")];
          rows.forEach((row, index) => {
            row.querySelector("span").textContent = String(index + 1).padStart(2, "0");
            const up = row.querySelector("[data-move-feature-up]");
            const down = row.querySelector("[data-move-feature-down]");
            const remove = row.querySelector("[data-remove-feature]");
            if (up) {
              up.dataset.moveFeatureUp = String(index);
              up.disabled = index === 0;
            }
            if (down) {
              down.dataset.moveFeatureDown = String(index);
              down.disabled = index === rows.length - 1;
            }
            if (remove) remove.dataset.removeFeature = String(index);
          });
          const counter = form.querySelector("[data-feature-count]");
          if (counter) counter.textContent = plural("services.featureCount", rows.length);
        };

        form.querySelector("[data-add-feature]")?.addEventListener("click", () => {
          const list = form.querySelector("[data-feature-list]");
          const count = list.querySelectorAll("input[data-feature-id]").length;
          if (list.querySelector(".empty-inline")) list.innerHTML = "";
          list.insertAdjacentHTML("beforeend", featureRow({ id: "", text: "" }, count, count + 1, scope));
          renumberFeatures();
          // A row added while the English tab is open joins the group as an
          // English draft; the pt-BR side stays empty until it is filled in.
          locale?.rescan();
        });

        form.addEventListener("click", (event) => {
          const remove = event.target.closest("[data-remove-feature]");
          if (remove) {
            const input = remove.closest(".feature-row")?.querySelector("[data-feature-key]");
            if (input) locale?.forget(input.dataset.featureKey);
            remove.closest(".feature-row")?.remove();
            renumberFeatures();
            return;
          }
          const up = event.target.closest("[data-move-feature-up]");
          const down = event.target.closest("[data-move-feature-down]");
          if (!up && !down) return;
          const row = (up || down).closest(".feature-row");
          if (up) row?.previousElementSibling?.before(row);
          if (down) row?.nextElementSibling?.after(row);
          renumberFeatures();
        });

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(form).entries());
          const baseValues = locale?.baseValues() ?? {};
          const translationValues = locale?.translationValues() ?? {};

          const featureInputs = [...form.querySelectorAll("input[data-feature-id]")];
          const features = featureInputs
            .map((input, index) => {
              const key = input.dataset.featureKey;
              return {
                id: input.dataset.featureId || null,
                position: index,
                text: String(baseValues[key] ?? "").trim(),
                translations: translationValues[key] ? { en: { text: translationValues[key] } } : {},
              };
            })
            .filter((feature) => feature.text);

          // Feature copy is carried per row, so it is not duplicated into the
          // plan's own translations object.
          const planTranslations = Object.fromEntries(
            Object.entries(translationValues).filter(([key]) => !key.startsWith("feature:")),
          );

          const patch = {
            name: data.name.trim(),
            range: data.range.trim(),
            status: data.status.trim(),
            accent: data.accent.trim(),
            position: data.position,
            timeline: String(baseValues.timeline ?? "").trim(),
            scope: String(baseValues.scope ?? "").trim(),
            scopeShort: String(baseValues.scopeShort ?? "").trim(),
            description: baseValues.description ?? "",
            visible: form.elements.visible.checked,
            features,
            // Merging keeps any locale the Admin does not edit yet intact.
            translations: {
              ...(plan?.translations ?? {}),
              ...(Object.keys(planTranslations).length ? { en: planTranslations } : {}),
            },
          };
          if (!Object.keys(planTranslations).length) delete patch.translations.en;

          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          try {
            await updatePlan(planId, patch);
            await logActivity("Plan updated", `${patch.name} updated`, { action: "plan.updated", entityType: "plan", entityId: planId });
            showToast(t("services.planSaved"));
          } catch (error) {
            showToast(describeError(error, t("services.saveError")));
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    // Plans are rendered once. A locale change re-labels the chrome through
    // applyStaticTranslations() and only refreshes the feature counters, so
    // in-progress edits in either language are left alone.
    onLocaleChange(root, () => {
      root.querySelectorAll("[data-plan-form]").forEach((form) => {
        const counter = form.querySelector("[data-feature-count]");
        if (counter) counter.textContent = plural("services.featureCount", form.querySelectorAll(".feature-row").length);
      });
    });

    try {
      plans = await getPlans();
      root.innerHTML = plans.length
        ? plans.map(renderPlan).join("")
        : `<article class="panel"><p class="empty-inline" data-i18n="services.noPlans">${t("services.noPlans")}</p></article>`;
      bindPlanForms();
    } catch (error) {
      root.innerHTML = `<article class="panel"><p class="empty-inline">${escapeHtml(describeError(error, t("services.loadError")))}</p></article>`;
    } finally {
      root.removeAttribute("aria-busy");
    }
  },
};
