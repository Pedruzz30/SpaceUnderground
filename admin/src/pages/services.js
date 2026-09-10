import { showToast } from "../components/toast.js";
import { describeError } from "../services/errors.js";
import { getPlans, updatePlan } from "../services/plan-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function field(label, name, value = "", attrs = "") {
  return `
    <div class="field">
      <label for="plan-${name}">${escapeHtml(label)}</label>
      <input id="plan-${name}" name="${name}" value="${escapeAttribute(value)}" ${attrs}>
    </div>
  `;
}

function renderPlan(plan) {
  return `
    <article class="plan-editor" data-plan-id="${escapeAttribute(plan.id)}">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(plan.monogram || plan.slug)}</span>
          <h3>${escapeHtml(plan.name)}</h3>
        </div>
        <strong class="badge ${plan.visible ? "badge--success" : "badge--muted"}">${plan.visible ? "VISIBLE" : "HIDDEN"}</strong>
      </header>
      <form data-plan-form="${escapeAttribute(plan.id)}">
        <div class="form-grid">
          ${field("Name", "name", plan.name, "required")}
          ${field("Range", "range", plan.range)}
          ${field("Timeline", "timeline", plan.timeline)}
          ${field("Status", "status", plan.status)}
          ${field("Scope", "scope", plan.scope)}
          ${field("Scope Short", "scopeShort", plan.scopeShort)}
          ${field("Accent", "accent", plan.accent)}
          ${field("Position", "position", plan.position, 'type="number" min="0"')}
          <div class="field field--wide">
            <label for="plan-description-${escapeAttribute(plan.id)}">Description</label>
            <textarea id="plan-description-${escapeAttribute(plan.id)}" name="description" rows="4">${escapeHtml(plan.description)}</textarea>
          </div>
          <fieldset class="field field--wide">
            <legend>Visibility</legend>
            <div class="checks">
              <label><input type="checkbox" name="visible" ${plan.visible ? "checked" : ""}> Show on public site</label>
            </div>
          </fieldset>
          <div class="field field--wide">
            <span class="field-label">Features</span>
            <div class="feature-list" data-feature-list>
              ${(plan.features || []).map((feature, index) => `
                <label class="feature-row">
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <input value="${escapeAttribute(feature.text)}" data-feature-id="${escapeAttribute(feature.id || "")}">
                  <button type="button" class="button button--danger" data-remove-feature="${index}">Remove</button>
                </label>
              `).join("") || '<p class="empty-inline">No features yet.</p>'}
            </div>
            <button class="button" type="button" data-add-feature>+ Add Feature</button>
          </div>
        </div>
        <div class="form-actions">
          <button class="button button--primary" type="submit">Save Plan</button>
        </div>
      </form>
    </article>
  `;
}

export const servicesPage = {
  title: "Services",
  breadcrumb: "CONTENT / SERVICES",
  render: () => `
    <section class="page-heading">
      <span>SERVICES / PLANS</span>
      <h2>Commercial plans.</h2>
      <p>Edit pricing, scope, timeline and feature lists.</p>
    </section>
    <section class="plans-editor-grid" data-plans-list aria-busy="true">
      <article class="panel"><p class="empty-inline">Loading plans...</p></article>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-plans-list]");
    let plans = [];

    function bindPlanForms() {
      root.querySelectorAll("[data-plan-form]").forEach((form) => {
        const planId = form.dataset.planForm;
        form.querySelector("[data-add-feature]")?.addEventListener("click", () => {
          const list = form.querySelector("[data-feature-list]");
          const count = list.querySelectorAll("input[data-feature-id]").length;
          const label = document.createElement("label");
          label.className = "feature-row";
          label.innerHTML = `<span>${String(count + 1).padStart(2, "0")}</span><input value="" data-feature-id=""><button type="button" class="button button--danger" data-remove-feature="${count}">Remove</button>`;
          if (list.querySelector(".empty-inline")) list.innerHTML = "";
          list.append(label);
        });

        form.addEventListener("click", (event) => {
          const button = event.target.closest("[data-remove-feature]");
          if (!button) return;
          button.closest(".feature-row")?.remove();
        });

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(form).entries());
          const features = [...form.querySelectorAll("input[data-feature-id]")]
            .map((input, index) => ({ id: input.dataset.featureId || null, position: index, text: input.value.trim() }))
            .filter((feature) => feature.text);
          const patch = {
            name: data.name.trim(),
            range: data.range.trim(),
            timeline: data.timeline.trim(),
            status: data.status.trim(),
            scope: data.scope.trim(),
            scopeShort: data.scopeShort.trim(),
            accent: data.accent.trim(),
            position: data.position,
            description: data.description,
            visible: form.elements.visible.checked,
            features,
          };

          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          try {
            await updatePlan(planId, patch);
            await logActivity("Plan updated", `${patch.name} updated`, { action: "plan.updated", entityType: "plan", entityId: planId });
            showToast("Plan saved.");
          } catch (error) {
            showToast(describeError(error, "Unable to save plan."));
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    try {
      plans = await getPlans();
      root.innerHTML = plans.length ? plans.map(renderPlan).join("") : '<article class="panel"><p class="empty-inline">No plans yet.</p></article>';
      bindPlanForms();
    } catch (error) {
      root.innerHTML = `<article class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load plans."))}</p></article>`;
    } finally {
      root.removeAttribute("aria-busy");
    }
  },
};
