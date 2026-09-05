// Formulario de solicitacao: selecao de produto, autofill de orcamento/prazo,
// validacao e envio ao Formspree. Textos visiveis ficam em portugues.

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
        text: "Ideal para campanhas, lançamentos, ofertas e serviços que precisam de uma página objetiva e focada em conversão.",
      },
      portfolio: {
        label: "Portfólio",
        text: "Ideal para profissionais, criadores e marcas que precisam apresentar trabalho, identidade e contato de forma memorável.",
      },
      "institutional-website": {
        label: "Site Institucional",
        text: "Ideal para empresas que precisam de presença completa, múltiplas páginas, navegação clara e estrutura preparada para crescer.",
      },
      "e-commerce": {
        label: "E-commerce",
        text: "Ideal para catálogos e lojas virtuais em que descoberta de produtos, experiência de compra e conversão precisam funcionar juntas.",
      },
      "web-system": {
        label: "Sistema Web",
        text: "Ideal para dashboards, plataformas, portais e ferramentas internas em que fluxo, dados, permissões e operação são parte central do produto.",
      },
      automation: {
        label: "Automação / Integrações",
        text: "Ideal para conectar serviços, automatizar tarefas recorrentes, sincronizar dados, criar alertas e reduzir trabalho manual.",
      },
      "ai-solution": {
        label: "IA / Assistente Inteligente",
        text: "Ideal para assistentes, agentes, voz, visão, memória, classificação inteligente ou IA integrada a um sistema existente.",
      },
      other: {
        label: "Projeto Personalizado",
        text: "Ideal para uma necessidade fora dos formatos comuns e que precisa de uma conversa técnica antes de definir arquitetura e investimento.",
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

      if (productSummaryKicker) productSummaryKicker.textContent = details ? "PROJETO SELECIONADO" : "NENHUM PROJETO SELECIONADO";
      if (productSummaryTitle) productSummaryTitle.textContent = details ? details.label : "Escolha um tipo de projeto para calibrar a solicitação.";
      if (productSummaryText) {
        const budget = selectedOption?.dataset.budget || "A definir";
        const timeline = selectedOption?.dataset.timeline || "A definir";
        productSummaryText.textContent = details
          ? `${details.text} Investimento de referência: ${budget}. Prazo estimado: ${timeline}.`
          : "Faixa de investimento e prazo estimado aparecerão aqui. Você ainda poderá editar os campos manualmente.";
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
        if (projectNeedField) projectNeedField.dataset.touched = "true";
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
      if (submitButtonText) submitButtonText.textContent = isSending ? "Enviando..." : "Enviar Solicitação";
    };

    projectForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (gotchaField?.value) {
        if (formStatus) formStatus.textContent = "Solicitação recebida. Respondemos em até 1 dia útil.";
        projectForm.reset();
        setProductChoice("", { autofill: false });
        return;
      }

      fields.forEach((field) => {
        field.dataset.touched = "true";
      });

      const invalidFields = validateProjectForm();

      if (invalidFields.length) {
        if (formStatus) formStatus.textContent = "Confira os campos destacados antes de enviar.";
        invalidFields[0]?.focus();
        return;
      }

      setSubmitState(true);
      if (formStatus) formStatus.textContent = "Enviando sua solicitação...";

      try {
        const response = await fetch(projectForm.action, {
          method: "POST",
          body: new FormData(projectForm),
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) throw new Error("Falha ao enviar o formulário.");

        if (formStatus) formStatus.textContent = "Solicitação recebida. Respondemos em até 1 dia útil.";
        projectForm.reset();
        setProductChoice("", { autofill: false });
        fields.forEach((field) => {
          delete field.dataset.touched;
          setManualFieldState(field, false);
        });
      } catch (error) {
        if (formStatus) {
          formStatus.textContent = "Não foi possível enviar. Escreva diretamente para hello.SpaceUnderGround@gmail.com";
        }
      } finally {
        setSubmitState(false);
      }
    });
  }
}
