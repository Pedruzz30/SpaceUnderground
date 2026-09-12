// Formulario de solicitacao: selecao de produto, autofill de orcamento/prazo,
// validacao e envio ao Formspree.
import { subscribeLocaleChange, t } from "./i18n/index.js";

export function initProjectForm() {
  const projectForm = document.querySelector("[data-project-form]");

  if (projectForm) {
    const formStatus = projectForm.querySelector("[data-form-status]");
    const fields = [...projectForm.querySelectorAll("input, select, textarea")];
    const projectNeedField = projectForm.querySelector("#project-need");
    const nameField = projectForm.querySelector("#project-name");
    const emailField = projectForm.querySelector("#project-email");
    const messageField = projectForm.querySelector("#project-message");
    const budgetField = projectForm.querySelector("#project-budget");
    const timelineField = projectForm.querySelector("#project-timeline");
    const gotchaField = projectForm.querySelector("[name='_gotcha']");
    const submitButton = projectForm.querySelector("[type='submit']");
    const submitButtonText = submitButton?.querySelector("span");
    const budgetChoices = () => [...projectForm.querySelectorAll("[data-budget-choice]")];
    const timelineChoices = () => [...projectForm.querySelectorAll("[data-timeline-choice]")];
    const productOptions = () => [...projectForm.querySelectorAll("[data-product-option]")];
    const productCount = projectForm.querySelector("[data-product-count]");
    const productSummary = projectForm.querySelector("[data-product-summary]");
    const productSummaryTitle = productSummary?.querySelector("strong");
    const productSummaryKicker = productSummary?.querySelector("span");
    const productSummaryText = projectForm.querySelector("[data-product-summary-text]");

    const refreshLocalizedForm = () => {
      if (submitButtonText && !submitButton?.classList.contains("is-sending")) submitButtonText.textContent = t("contact.send");
      setProductChoice(projectNeedField?.value || "", { autofill: false });
    };

    const markInvalid = (field, wrapper, isInvalid) => {
      wrapper.classList.toggle("is-invalid", isInvalid);
      if (isInvalid) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    };

    const setFieldState = (field) => {
      const wrapper = field.closest(".form-field");
      if (!wrapper) return;
      markInvalid(field, wrapper, field.matches(":invalid") && field.dataset.touched === "true");
    };

    const setManualFieldState = (field, isInvalid) => {
      if (!field) return;
      const wrapper = field.closest(".form-field");
      if (!wrapper) return;
      markInvalid(field, wrapper, isInvalid);
    };

    const setChoiceState = (choices, value, attribute) => {
      choices.forEach((choice) => {
        choice.classList.toggle("is-selected", choice.dataset[attribute] === value);
      });
    };

    const setProductChoice = (value, { autofill = true } = {}) => {
      const currentProductOptions = productOptions();
      const selectedOption = currentProductOptions.find((option) => option.dataset.value === value);
      const details = selectedOption
        ? {
            label: selectedOption.querySelector("strong")?.textContent || "",
            text: selectedOption.querySelector("small")?.textContent || "",
          }
        : null;

      currentProductOptions.forEach((option) => {
        const isSelected = option === selectedOption;
        option.classList.toggle("is-selected", isSelected);
        option.setAttribute("aria-pressed", String(isSelected));
      });

      if (projectNeedField && projectNeedField.value !== value) {
        projectNeedField.value = value;
      }

      if (productCount) {
        const selectedIndex = selectedOption ? currentProductOptions.indexOf(selectedOption) + 1 : 0;
        productCount.textContent = `${String(selectedIndex).padStart(2, "0")} / ${String(currentProductOptions.length).padStart(2, "0")}`;
      }

      if (productSummaryKicker) productSummaryKicker.textContent = details ? t("commercial.selectedProject") : t("commercial.noProjectSelected");
      if (productSummaryTitle) productSummaryTitle.textContent = details ? details.label : t("commercial.summaryTitle");
      if (productSummaryText) {
        const budget = selectedOption?.dataset.budget || t("commercial.toDefine");
        const timeline = selectedOption?.dataset.timeline || t("commercial.toDefine");
        productSummaryText.textContent = details
          ? t("commercial.summarySelected", { description: details.text, budget, timeline })
          : t("commercial.summaryText");
      }

      if (autofill && selectedOption) {
        if (budgetField) budgetField.value = selectedOption.dataset.budget || "";
        if (timelineField) timelineField.value = selectedOption.dataset.timeline || "";
      }

      setChoiceState(budgetChoices(), budgetField?.value || "", "budgetChoice");
      setChoiceState(timelineChoices(), timelineField?.value || "", "timelineChoice");

      if (projectNeedField) setFieldState(projectNeedField);
    };

    projectForm.addEventListener("click", (event) => {
      const option = event.target.closest("[data-product-option]");
      if (option) {
        if (formStatus) formStatus.textContent = "";
        if (projectNeedField) projectNeedField.dataset.touched = "true";
        setProductChoice(option.dataset.value);
        return;
      }

      const budgetChoice = event.target.closest("[data-budget-choice]");
      if (budgetChoice) {
        if (!budgetField) return;
        budgetField.value = budgetChoice.dataset.budgetChoice || "";
        setChoiceState(budgetChoices(), budgetField.value, "budgetChoice");
        if (formStatus) formStatus.textContent = "";
        return;
      }

      const timelineChoice = event.target.closest("[data-timeline-choice]");
      if (timelineChoice) {
        if (!timelineField) return;
        timelineField.value = timelineChoice.dataset.timelineChoice || "";
        setChoiceState(timelineChoices(), timelineField.value, "timelineChoice");
        if (formStatus) formStatus.textContent = "";
      }
    });

    projectNeedField?.addEventListener("change", () => {
      setProductChoice(projectNeedField.value, { autofill: false });
    });

    fields.forEach((field) => {
      field.addEventListener("blur", () => {
        field.dataset.touched = "true";
        setFieldState(field);
      });

      field.addEventListener("input", () => {
        if (field.dataset.touched === "true") setFieldState(field);
        if (formStatus) formStatus.textContent = "";
        if (field === budgetField) setChoiceState(budgetChoices(), field.value, "budgetChoice");
        if (field === timelineField) setChoiceState(timelineChoices(), field.value, "timelineChoice");
      });

      field.addEventListener("change", () => {
        if (field.dataset.touched === "true") setFieldState(field);
        if (formStatus) formStatus.textContent = "";
      });
    });

    const validateProjectForm = () => {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidFields = [
        [nameField, !nameField?.value.trim()],
        [emailField, !emailPattern.test(emailField?.value.trim() || "")],
        [projectNeedField, !projectNeedField?.value],
        [messageField, !messageField?.value.trim()],
      ].filter(([, isInvalid]) => isInvalid);

      [nameField, emailField, projectNeedField, messageField].forEach((field) => {
        setManualFieldState(field, invalidFields.some(([invalidField]) => invalidField === field));
      });

      return invalidFields.map(([field]) => field);
    };

    const setSubmitState = (isSending) => {
      if (!submitButton) return;
      submitButton.disabled = isSending;
      submitButton.classList.toggle("is-sending", isSending);
      if (submitButtonText) submitButtonText.textContent = isSending ? t("contact.sending") : t("contact.send");
    };

    projectForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (gotchaField?.value) {
          if (formStatus) formStatus.textContent = t("contact.success");
        projectForm.reset();
        setProductChoice("", { autofill: false });
        return;
      }

      fields.forEach((field) => {
        field.dataset.touched = "true";
      });

      const invalidFields = validateProjectForm();

      if (invalidFields.length) {
        if (formStatus) formStatus.textContent = t("contact.invalid");
        invalidFields[0]?.focus();
        return;
      }

      setSubmitState(true);
      if (formStatus) formStatus.textContent = t("contact.sendingStatus");

      try {
        const response = await fetch(projectForm.action, {
          method: "POST",
          body: new FormData(projectForm),
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) throw new Error("Falha ao enviar o formulário.");

        if (formStatus) formStatus.textContent = t("contact.success");
        projectForm.reset();
        setProductChoice("", { autofill: false });
        fields.forEach((field) => {
          delete field.dataset.touched;
          setManualFieldState(field, false);
        });
      } catch (error) {
        if (formStatus) {
          formStatus.textContent = t("contact.failure");
        }
      } finally {
        setSubmitState(false);
      }
    });

    subscribeLocaleChange(refreshLocalizedForm);
  }
}
