import {
  COMPANY_TYPE_HINTS,
  COMPANY_TYPE_LABELS,
  COMPANY_TYPES,
  countVariableFields,
  nfseStep,
  stepOrder
} from "../lib/nfse.js";

const app = document.getElementById("app");
const feedback = document.getElementById("feedback");

let data = { companies: {} };
let selectedCompanyId = null;
let pageContext = null;
let expandedFormKey = null;
let feedbackTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label, className, handler, title) {
  const button = element("button", className, label);
  button.type = "button";
  if (title) button.title = title;
  button.addEventListener("click", handler);
  return button;
}

function showFeedback(message, kind = "info") {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.className = `feedback ${kind}`;
  feedback.hidden = false;
  feedbackTimer = setTimeout(() => {
    feedback.hidden = true;
  }, 4500);
}

async function backgroundMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "A operação não pôde ser concluída.");
  }
  return response;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function contentMessage(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("Nenhuma aba ativa foi encontrada.");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error(
      "Nenhum formulário compatível respondeu nesta página. " +
      "Recarregue a aba e verifique se o formulário está visível."
    );
  }
}

async function loadData() {
  const response = await backgroundMessage({ type: "GET_DATA" });
  data = response.data;
}

async function loadPageContext() {
  try {
    const response = await contentMessage({ type: "GET_PAGE_CONTEXT" });
    pageContext = response?.ok ? response : null;
  } catch {
    pageContext = null;
  }
}

function header({ companyName, onBack } = {}) {
  const node = element("header", "app-header");
  if (onBack) {
    node.append(actionButton("←", "back-button", onBack, "Voltar para empresas"));
  }
  const brand = element("div", "brand");
  const mark = element("div", "brand-mark", "▤");
  const labels = element("div");
  labels.append(
    element("h1", "", companyName || "Form Saver"),
    element("p", "", companyName ? "Formulários da empresa" : "Preenchimento local e seguro")
  );
  brand.append(mark, labels);
  node.append(brand);
  if (!onBack) node.append(element("span"));
  return node;
}

function sortedCompanies() {
  return Object.values(data.companies).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );
}

function companyType(company) {
  return company?.type === COMPANY_TYPES.NFSE ? COMPANY_TYPES.NFSE : COMPANY_TYPES.CUSTOM;
}

function typeBadge(company) {
  const type = companyType(company);
  return element("span", `type-badge ${type}`, COMPANY_TYPE_LABELS[type]);
}

async function createCompany(name, type) {
  const response = await backgroundMessage({
    type: "CREATE_COMPANY",
    name,
    companyType: type
  });
  await loadData();
  selectedCompanyId = response.company.id;
  renderCompany();
  showFeedback("Empresa criada com sucesso.", "success");
}

function renderHome() {
  app.replaceChildren(header());
  const content = element("section", "content");
  const companies = sortedCompanies();
  const heading = element("div", "section-heading");
  heading.append(
    element("h2", "", "Empresas"),
    element("span", "count", String(companies.length))
  );
  content.append(heading);

  if (companies.length) {
    const list = element("div", "company-list");
    for (const company of companies) {
      const row = element("div", "company-row");
      const open = actionButton(company.name, "company-open", () => {
        selectedCompanyId = company.id;
        renderCompany();
      });
      const summary = element(
        "small",
        "",
        `${Object.keys(company.forms || {}).length} formulário(s) salvo(s)`
      );
      summary.append(typeBadge(company));
      open.append(summary);
      const rename = actionButton("✎", "icon-button", async () => {
        const name = prompt("Novo nome da empresa:", company.name);
        if (name === null || name.trim() === company.name) return;
        try {
          await backgroundMessage({ type: "RENAME_COMPANY", companyId: company.id, name });
          await loadData();
          renderHome();
          showFeedback("Empresa renomeada.", "success");
        } catch (error) {
          showFeedback(error.message, "error");
        }
      }, "Renomear empresa");
      const remove = actionButton("×", "icon-button danger", async () => {
        const confirmed = confirm(
          `Excluir “${company.name}”?\n\nTodos os formulários salvos para esta empresa serão removidos.`
        );
        if (!confirmed) return;
        try {
          await backgroundMessage({ type: "DELETE_COMPANY", companyId: company.id });
          await loadData();
          renderHome();
          showFeedback("Empresa excluída.", "success");
        } catch (error) {
          showFeedback(error.message, "error");
        }
      }, "Excluir empresa");
      row.append(open, rename, remove);
      list.append(row);
    }
    content.append(list);
  } else {
    content.append(element(
      "div",
      "empty-state",
      "Nenhuma empresa cadastrada. Crie uma empresa para começar a separar seus formulários."
    ));
  }

  const form = element("form", "new-company-form");
  const input = element("input");
  input.name = "companyName";
  input.placeholder = "Nome da nova empresa";
  input.maxLength = 100;
  input.required = true;
  const submit = actionButton("Criar", "primary-button", () => {});
  submit.type = "submit";
  const row = element("div", "new-company-row");
  row.append(input, submit);

  const choice = element("div", "type-choice");
  for (const type of [COMPANY_TYPES.CUSTOM, COMPANY_TYPES.NFSE]) {
    const option = element("label", "type-option");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "companyType";
    radio.value = type;
    radio.checked = type === COMPANY_TYPES.CUSTOM;
    const text = element("span");
    text.append(
      element("strong", "", COMPANY_TYPE_LABELS[type]),
      element("small", "", COMPANY_TYPE_HINTS[type])
    );
    option.append(radio, text);
    choice.append(option);
  }

  form.append(row, choice);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const selected = form.querySelector("input[name='companyType']:checked")?.value;
      await createCompany(input.value, selected);
    } catch (error) {
      showFeedback(error.message, "error");
      submit.disabled = false;
    }
  });
  content.append(form);
  app.append(content);
}

function sameIdentifier(left, right) {
  return left?.type === right?.type && left?.value === right?.value &&
    Number(left?.occurrence || 0) === Number(right?.occurrence || 0);
}

function currentFormExists(savedForm) {
  return pageContext?.pageAddress === savedForm.pageAddress &&
    pageContext.forms.some((item) => sameIdentifier(item.identifier, savedForm.formIdentifier));
}

function pagePath(address) {
  try {
    const url = new URL(address);
    return `${url.host}${url.pathname}`;
  } catch {
    return address;
  }
}

function cloneValue(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function savedFieldName(savedField, index) {
  const identifier = savedField.identifier?.primary;
  return identifier?.value || `Campo ${index + 1}`;
}

function savedFieldType(savedField) {
  if (savedField.multiple) return "select múltiplo";
  if (savedField.inputType === "radio" && savedField.radioGroup) return "radio";
  return savedField.inputType || savedField.elementType || "campo";
}

// Campo variável não guarda valor: o editor mostra isso em vez de um controle
// de edição, para não sugerir que dá para fixar um valor aqui.
function variableFieldNote(savedField) {
  const note = element("div", "variable-note");
  note.append(
    element("strong", "", savedField.variableLabel || "Campo variável"),
    element("span", "", "Perguntado a cada preenchimento; nada fica guardado.")
  );
  return note;
}

function fieldValueControl(savedField) {
  if (savedField.variable) return variableFieldNote(savedField);
  if (savedField.inputType === "checkbox" ||
    (savedField.inputType === "radio" && !savedField.radioGroup)) {
    const wrapper = element("label", "boolean-control");
    const input = element("input");
    input.type = "checkbox";
    input.checked = Boolean(savedField.checked);
    const description = element("span", "", input.checked ? "Marcado" : "Desmarcado");
    input.addEventListener("change", () => {
      savedField.checked = input.checked;
      description.textContent = input.checked ? "Marcado" : "Desmarcado";
    });
    wrapper.append(input, description);
    return wrapper;
  }

  if (savedField.multiple || savedField.elementType === "textarea") {
    const textarea = element("textarea", "field-value-input");
    textarea.rows = savedField.multiple ? 3 : 2;
    textarea.value = savedField.multiple
      ? (Array.isArray(savedField.value) ? savedField.value.join("\n") : "")
      : String(savedField.value ?? "");
    textarea.placeholder = savedField.multiple
      ? "Um valor por linha"
      : "Valor salvo";
    textarea.addEventListener("input", () => {
      savedField.value = savedField.multiple
        ? textarea.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
        : textarea.value;
    });
    return textarea;
  }

  const input = element("input", "field-value-input");
  input.type = "text";
  input.value = String(savedField.value ?? "");
  input.placeholder = "Valor salvo";
  input.addEventListener("input", () => {
    savedField.value = input.value;
  });
  return input;
}

function renderFieldEditor(company, savedForm) {
  const draftFields = cloneValue(savedForm.fields || []);
  const editor = element("form", "field-editor");
  const editorHeading = element("div", "editor-heading");
  const title = element("h5", "", "Campos armazenados");
  const count = element("span", "count", String(draftFields.length));
  editorHeading.append(title, count);

  const nameLabel = element("label", "editor-label", "Nome exibido do formulário");
  const nameInput = element("input", "field-value-input");
  nameInput.name = "displayName";
  nameInput.value = savedForm.displayName;
  nameInput.maxLength = 120;
  nameInput.required = true;
  nameLabel.append(nameInput);

  const help = element(
    "p",
    "editor-help",
    "Os identificadores são somente leitura. Em seleções múltiplas, informe um valor por linha."
  );
  const rows = element("div", "field-editor-list");

  const renderRows = () => {
    rows.replaceChildren();
    count.textContent = String(draftFields.length);
    if (!draftFields.length) {
      rows.append(element("p", "editor-empty", "Nenhum campo mantido neste formulário."));
      return;
    }

    draftFields.forEach((savedField, index) => {
      const row = element("div", "saved-field-row");
      const rowHeading = element("div", "saved-field-heading");
      const labels = element("div", "saved-field-labels");
      labels.append(
        element("strong", "", savedFieldName(savedField, index)),
        element(
          "span",
          "",
          `${savedField.identifier?.primary?.type || "fallback"} · ${savedFieldType(savedField)}`
        )
      );
      const remove = actionButton("Remover", "field-remove", () => {
        draftFields.splice(index, 1);
        renderRows();
      }, "Remover este campo salvo");
      rowHeading.append(labels, remove);
      row.append(rowHeading, fieldValueControl(savedField));
      rows.append(row);
    });
  };

  renderRows();
  const actions = element("div", "editor-actions");
  const cancel = actionButton("Fechar", "secondary-button", () => {
    expandedFormKey = null;
    renderCompany();
  });
  const save = actionButton("Salvar alterações", "primary-button", () => {});
  save.type = "submit";
  actions.append(cancel, save);
  editor.append(editorHeading, nameLabel, help, rows, actions);

  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = nameInput.value.trim();
    if (!displayName) {
      showFeedback("Informe um nome para o formulário.", "error");
      return;
    }
    if (!draftFields.length) {
      showFeedback("Mantenha pelo menos um campo ou exclua o formulário completo.", "error");
      return;
    }

    save.disabled = true;
    try {
      await backgroundMessage({
        type: "UPSERT_FORM",
        companyId: company.id,
        savedForm: {
          ...savedForm,
          displayName,
          fields: draftFields
        }
      });
      await loadData();
      renderCompany();
      showFeedback("Valores salvos atualizados manualmente.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
      save.disabled = false;
    }
  });
  return editor;
}

function selectedFormIdentifier(select) {
  const index = Number(select.value);
  return Number.isInteger(index) && pageContext?.forms[index]
    ? pageContext.forms[index].identifier
    : null;
}

async function saveCurrentForm(company, select, existingForm = null) {
  const identifier = existingForm?.formIdentifier || selectedFormIdentifier(select);
  if (!identifier) {
    showFeedback("Selecione o formulário que deseja salvar.", "error");
    return;
  }
  try {
    const extraction = await contentMessage({
      type: "EXTRACT_CURRENT_FORM",
      formIdentifier: identifier
    });
    if (!extraction?.ok) throw new Error(extraction?.error);
    if (!extraction.form.fields.length) {
      throw new Error("Nenhum campo preenchido foi encontrado neste formulário.");
    }

    const existing = company.forms[extraction.form.key];
    if (!existingForm && existing && !confirm(
      "Este formulário já possui dados salvos para esta empresa.\n\nDeseja substituir os dados existentes?"
    )) {
      return;
    }
    await backgroundMessage({
      type: "UPSERT_FORM",
      companyId: company.id,
      savedForm: extraction.form
    });
    await loadData();
    renderCompany();
    showFeedback(
      `${extraction.form.fields.length} campo(s) salvo(s) com sucesso.`,
      "success"
    );
  } catch (error) {
    showFeedback(error.message || "Não foi possível salvar o formulário.", "error");
  }
}

// Cada campo ausente vem com o motivo apurado durante o preenchimento.
function describeMissingFields(fields) {
  return (fields || [])
    .map((item) => (item.reason ? `${item.label} (${item.reason})` : item.label))
    .join("; ");
}

// Mesmo texto do aviso mostrado na página, para o popup e para o menu.
function describeFillResult(result) {
  if (result.cancelled) {
    return `Preenchimento cancelado. ${result.filled} campo(s) preenchido(s).`;
  }
  const parts = [`${result.filled} de ${result.total} campo(s) preenchido(s).`];
  if (result.unverified) {
    parts.push(
      `${result.unverified} sem confirmação: ${(result.unverifiedFields || []).join(", ")}.`
    );
  }
  if (result.missing) {
    parts.push(`Faltou preencher: ${describeMissingFields(result.missingFields)}.`);
  }
  return parts.join(" ");
}

async function fillSavedForm(savedForm) {
  try {
    // O preenchimento é sequencial e pode demorar; a própria página mostra o
    // progresso, o botão de cancelar e o resultado, caso o popup já tenha fechado.
    showFeedback("Preenchendo… acompanhe o progresso na página.", "info");
    const result = await contentMessage({ type: "FILL_FORM", savedForm });
    if (!result?.ok) throw new Error(result?.error);
    showFeedback(
      describeFillResult(result),
      result.missing ? "error" : "success"
    );
  } catch (error) {
    showFeedback(error.message || "Não foi possível preencher o formulário.", "error");
  }
}

function renderCurrentPage(company, content) {
  const card = element("section", `current-card${pageContext ? "" : " unsupported"}`);
  card.append(element("p", "eyebrow", "Página atual"));
  if (!pageContext) {
    card.append(
      element("p", "page-path", "Página indisponível para a extensão."),
      element("p", "muted", "Use uma página HTTP ou HTTPS comum.")
    );
    content.append(card);
    return;
  }

  card.append(element("p", "page-path", pagePath(pageContext.pageAddress)));
  if (!pageContext.forms.length) {
    card.append(element("p", "muted", "Nenhum elemento <form> foi encontrado."));
    content.append(card);
    return;
  }

  const select = element("select", "form-select");
  select.setAttribute("aria-label", "Formulário atual");
  if (pageContext.forms.length > 1 && !pageContext.selectedForm) {
    const placeholder = element("option", "", "Selecione um formulário…");
    placeholder.value = "";
    select.append(placeholder);
  }
  pageContext.forms.forEach((item, index) => {
    const option = element(
      "option",
      "",
      `${item.displayName} · ${item.fieldCount} campo(s)`
    );
    option.value = String(index);
    option.selected = sameIdentifier(item.identifier, pageContext.selectedForm) ||
      (pageContext.forms.length === 1 && index === 0);
    select.append(option);
  });
  const save = actionButton("Salvar formulário atual", "primary-button full", () =>
    saveCurrentForm(company, select)
  );
  card.append(select, save);
  content.append(card);
  return select;
}

async function convertCompany(company, type) {
  const target = COMPANY_TYPE_LABELS[type];
  const aviso = type === COMPANY_TYPES.NFSE
    ? "Data, valores e descrição do serviço deixarão de ser guardados e passarão a ser perguntados a cada preenchimento. Os valores hoje armazenados nesses campos serão descartados."
    : "Os campos variáveis voltam a ser campos comuns, porém vazios: os valores nunca chegaram a ser guardados. Salve o formulário de novo para preenchê-los.";
  if (!confirm(`Converter “${company.name}” para ${target}?\n\n${aviso}`)) return;

  try {
    await backgroundMessage({
      type: "SET_COMPANY_TYPE",
      companyId: company.id,
      companyType: type
    });
    await loadData();
    renderCompany();
    showFeedback(`Empresa convertida para ${target}.`, "success");
  } catch (error) {
    showFeedback(error.message, "error");
  }
}

function renderTypeCard(company) {
  const type = companyType(company);
  const card = element("section", "type-card");
  const heading = element("div", "type-card-heading");
  heading.append(element("p", "eyebrow", "Tipo da empresa"), typeBadge(company));
  card.append(heading, element("p", "muted", COMPANY_TYPE_HINTS[type]));

  if (type === COMPANY_TYPES.NFSE) {
    const step = pageContext ? nfseStep(pageContext.pageAddress) : null;
    card.append(element(
      "p",
      "step-hint",
      step
        ? `Página atual: etapa ${step.label} — ${step.description}.`
        : "A página atual não é uma das etapas conhecidas da emissão."
    ));
  }

  const other = type === COMPANY_TYPES.NFSE ? COMPANY_TYPES.CUSTOM : COMPANY_TYPES.NFSE;
  card.append(actionButton(
    `Converter para ${COMPANY_TYPE_LABELS[other]}`,
    "secondary-button full",
    () => convertCompany(company, other),
    COMPANY_TYPE_HINTS[other]
  ));
  return card;
}

function renderCompany() {
  const company = data.companies[selectedCompanyId];
  if (!company) {
    selectedCompanyId = null;
    renderHome();
    return;
  }

  app.replaceChildren(header({
    companyName: company.name,
    onBack: () => {
      selectedCompanyId = null;
      expandedFormKey = null;
      renderHome();
    }
  }));
  const content = element("section", "content");
  content.append(renderTypeCard(company));
  const select = renderCurrentPage(company, content);
  const isNfse = companyType(company) === COMPANY_TYPES.NFSE;
  const forms = Object.values(company.forms || {}).sort((left, right) => {
    const currentDelta = Number(currentFormExists(right)) - Number(currentFormExists(left));
    if (currentDelta) return currentDelta;
    // Numa empresa NFS-e a ordem útil é a da emissão, não a alfabética.
    if (isNfse) {
      const stepDelta = stepOrder(left.pageAddress) - stepOrder(right.pageAddress);
      if (stepDelta) return stepDelta;
    }
    return left.displayName.localeCompare(right.displayName, "pt-BR");
  });
  const heading = element("div", "section-heading");
  heading.append(
    element("h3", "", "Formulários salvos"),
    element("span", "count", String(forms.length))
  );
  content.append(heading);

  if (!forms.length) {
    content.append(element(
      "div",
      "empty-state",
      "Preencha um formulário na página e use “Salvar formulário atual”."
    ));
  } else {
    const list = element("div", "saved-list");
    for (const savedForm of forms) {
      const isCurrent = currentFormExists(savedForm);
      const card = element("article", `form-card${isCurrent ? " current" : ""}`);
      const titleRow = element("div", "form-title-row");
      const step = isNfse ? nfseStep(savedForm.pageAddress) : null;
      titleRow.append(element("h4", "form-title", savedForm.displayName));
      if (step) titleRow.append(element("span", "step-badge", step.label));
      if (isCurrent) titleRow.append(element("span", "current-badge", "Página atual ✓"));
      const variables = countVariableFields(savedForm);
      const meta = [
        pagePath(savedForm.pageAddress),
        `${savedForm.fields.length} campo(s)`,
        variables ? `${variables} perguntado(s) ao preencher` : ""
      ].filter(Boolean).join(" · ");
      card.append(titleRow, element("p", "form-meta", meta));
      if (!isCurrent) {
        card.append(element("p", "mismatch", "Não corresponde à página/formulário atual"));
      }

      const actions = element("div", "card-actions");
      const fill = actionButton("Preencher", "primary-button", () => fillSavedForm(savedForm));
      fill.disabled = !isCurrent;
      const update = actionButton("Atualizar", "secondary-button", () =>
        saveCurrentForm(company, select, savedForm)
      );
      update.disabled = !isCurrent;
      const inspect = actionButton(
        expandedFormKey === savedForm.key ? "Ocultar campos" : "Ver/editar campos",
        "secondary-button",
        () => {
          expandedFormKey = expandedFormKey === savedForm.key ? null : savedForm.key;
          renderCompany();
        }
      );
      const remove = actionButton("Excluir", "danger-button", async () => {
        if (!confirm(`Excluir o formulário salvo “${savedForm.displayName}”?`)) return;
        try {
          await backgroundMessage({
            type: "DELETE_FORM",
            companyId: company.id,
            formKey: savedForm.key
          });
          await loadData();
          renderCompany();
          showFeedback("Formulário excluído.", "success");
        } catch (error) {
          showFeedback(error.message, "error");
        }
      });
      actions.append(fill, update, inspect, remove);
      card.append(actions);
      if (expandedFormKey === savedForm.key) {
        card.append(renderFieldEditor(company, savedForm));
      }
      list.append(card);
    }
    content.append(list);
  }
  app.append(content);
}

async function initialize() {
  try {
    await Promise.all([loadData(), loadPageContext()]);
    renderHome();
  } catch (error) {
    app.replaceChildren(
      header(),
      element("div", "empty-state", `Erro ao iniciar: ${error.message}`)
    );
  }
}

initialize();
