// Formulario de solicitacao: selecao de produto, autofill de orcamento/prazo, validacao e envio ao Formspree.
// Todo texto que o visitante le fica em ingles (politica EN-first); os comentarios seguem em portugues.

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
    const budgetChoices = [...projectForm.querySelectorAll("[data-budget-choice]")];
    const timelineChoices = [...projectForm.querySelectorAll("[data-timeline-choice]")];
    const productOptions = [...projectForm.querySelectorAll("[data-product-option]")];
    const productCount = projectForm.querySelector("[data-product-count]");
    const productSummary = projectForm.querySelector("[data-product-summary]");
    const productSummaryTitle = productSummary?.querySelector("strong");
    const productSummaryKicker = productSummary?.querySelector("span");
    const productSummaryText = projectForm.querySelector("[data-product-summary-text]");

    const productDetails = {
      "landing-page": {
        label: "Landing Page",
        text: "Best for campaigns, launches and focused offers. Usually includes strategy, page structure, responsive interface and a conversion-ready contact path.",
      },
      portfolio: {
        label: "Portfolio",
        text: "Best for professionals, creators and brands that need a memorable digital identity with selected work, story and contact flow.",
      },
      "institutional-website": {
        label: "Institutional Website",
        text: "Best for companies that need a complete presence with multiple pages, clear navigation, service content and a scalable structure.",
      },
      "e-commerce": {
        label: "E-commerce",
        text: "Best for product catalogs and stores where discovery, usability, checkout intent and visual direction need to work together.",
      },
      "web-system": {
        label: "Web System",
        text: "Best for dashboards, internal platforms and custom tools where workflow, data and interface behavior matter more than decoration.",
      },
      other: {
        label: "Other",
        text: "Best for unusual scopes, early product ideas or builds that need a technical conversation before being named properly.",
      },
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
      const selectedOption = productOptions.find((option) => option.dataset.value === value);
      const details = productDetails[value];

      productOptions.forEach((option) => {
        const isSelected = option === selectedOption;
        option.classList.toggle("is-selected", isSelected);
        option.setAttribute("aria-pressed", String(isSelected));
      });

      if (projectNeedField && projectNeedField.value !== value) {
        projectNeedField.value = value;
      }

      if (productCount) {
        const selectedIndex = selectedOption ? productOptions.indexOf(selectedOption) + 1 : 0;
        productCount.textContent = `${String(selectedIndex).padStart(2, "0")} / ${String(productOptions.length).padStart(2, "0")}`;
      }

      if (productSummaryKicker) productSummaryKicker.textContent = details ? "PRODUCT SELECTED" : "NO PRODUCT SELECTED";
      if (productSummaryTitle) productSummaryTitle.textContent = details ? details.label : "Choose a build type to calibrate the request.";
      if (productSummaryText) {
        const budget = selectedOption?.dataset.budget || "To define";
        const timeline = selectedOption?.dataset.timeline || "To define";
        productSummaryText.textContent = details
          ? `${details.text} Budget range: ${budget}. Estimated time: ${timeline}.`
          : "Budget range and timeline hints will appear here. You can still edit the fields manually.";
      }

      if (autofill && selectedOption) {
        if (budgetField) budgetField.value = selectedOption.dataset.budget || "";
        if (timelineField) timelineField.value = selectedOption.dataset.timeline || "";
      }

      setChoiceState(budgetChoices, budgetField?.value || "", "budgetChoice");
      setChoiceState(timelineChoices, timelineField?.value || "", "timelineChoice");

      if (projectNeedField) setFieldState(projectNeedField);
    };

    productOptions.forEach((option) => {
      option.addEventListener("click", () => {
        if (formStatus) formStatus.textContent = "";
        projectNeedField.dataset.touched = "true";
        setProductChoice(option.dataset.value);
      });
    });

    projectNeedField?.addEventListener("change", () => {
      setProductChoice(projectNeedField.value, { autofill: false });
    });

    budgetChoices.forEach((choice) => {
      choice.addEventListener("click", () => {
        if (!budgetField) return;
        budgetField.value = choice.dataset.budgetChoice || "";
        setChoiceState(budgetChoices, budgetField.value, "budgetChoice");
        if (formStatus) formStatus.textContent = "";
      });
    });

    timelineChoices.forEach((choice) => {
      choice.addEventListener("click", () => {
        if (!timelineField) return;
        timelineField.value = choice.dataset.timelineChoice || "";
        setChoiceState(timelineChoices, timelineField.value, "timelineChoice");
        if (formStatus) formStatus.textContent = "";
      });
    });

    fields.forEach((field) => {
      field.addEventListener("blur", () => {
        field.dataset.touched = "true";
        setFieldState(field);
      });

      field.addEventListener("input", () => {
        if (field.dataset.touched === "true") setFieldState(field);
        if (formStatus) formStatus.textContent = "";
        if (field === budgetField) setChoiceState(budgetChoices, field.value, "budgetChoice");
        if (field === timelineField) setChoiceState(timelineChoices, field.value, "timelineChoice");
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
      if (submitButtonText) submitButtonText.textContent = isSending ? "Sending..." : "Send Project Request";
    };

    projectForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (gotchaField?.value) {
        if (formStatus) formStatus.textContent = "Request received. We reply within 1 business day.";
        projectForm.reset();
        setProductChoice("", { autofill: false });
        return;
      }

      fields.forEach((field) => {
        field.dataset.touched = "true";
      });

      const invalidFields = validateProjectForm();

      if (invalidFields.length) {
        if (formStatus) formStatus.textContent = "Check the highlighted fields before sending.";
        invalidFields[0]?.focus();
        return;
      }

      setSubmitState(true);
      if (formStatus) formStatus.textContent = "Sending your request...";

      try {
        const response = await fetch(projectForm.action, {
          method: "POST",
          body: new FormData(projectForm),
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) throw new Error("Form submission failed.");

        if (formStatus) formStatus.textContent = "Request received. We reply within 1 business day.";
        projectForm.reset();
        setProductChoice("", { autofill: false });
        fields.forEach((field) => {
          delete field.dataset.touched;
          setManualFieldState(field, false);
        });
      } catch (error) {
        if (formStatus) {
          formStatus.textContent = "Could not send. Write us directly at hello.SpaceUnderGround@gmail.com";
        }
      } finally {
        setSubmitState(false);
      }
    });
  }
}
