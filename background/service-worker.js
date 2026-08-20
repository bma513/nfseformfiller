import {
  STORAGE_KEY,
  createCompany,
  deleteCompany,
  deleteForm,
  getData,
  renameCompany,
  setCompanyType,
  upsertForm
} from "../lib/storage.js";
import { COMPANY_TYPE_LABELS, countVariableFields, nfseStep } from "../lib/nfse.js";

const MENU = {
  ROOT: "form-saver-root",
  NEW_COMPANY: "form-saver-new-company",
  SAVE_ROOT: "form-saver-save-root",
  FILL_ROOT: "form-saver-fill-root",
  SAVE_PREFIX: "form-saver-save:",
  FILL_PREFIX: "form-saver-fill:"
};

let menuTimer;
let menuBuild = Promise.resolve();

function createMenu(properties) {
  try {
    chrome.contextMenus.create(properties);
  } catch (error) {
    console.error("Form Saver: não foi possível criar um item de menu.", error);
  }
}

async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();
  createMenu({ id: MENU.ROOT, title: "Form Saver", contexts: ["all"] });
  createMenu({
    id: MENU.NEW_COMPANY,
    parentId: MENU.ROOT,
    title: "Cadastrar nova empresa",
    contexts: ["all"]
  });
  createMenu({
    id: MENU.SAVE_ROOT,
    parentId: MENU.ROOT,
    title: "Salvar formulário atual",
    contexts: ["all"]
  });
  createMenu({
    id: MENU.FILL_ROOT,
    parentId: MENU.ROOT,
    title: "Preencher formulário atual",
    contexts: ["all"]
  });

  const data = await getData();
  const companies = Object.values(data.companies).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  if (!companies.length) {
    createMenu({
      id: "form-saver-save-empty",
      parentId: MENU.SAVE_ROOT,
      title: "Nenhuma empresa cadastrada",
      enabled: false,
      contexts: ["all"]
    });
    createMenu({
      id: "form-saver-fill-empty",
      parentId: MENU.FILL_ROOT,
      title: "Nenhuma empresa cadastrada",
      enabled: false,
      contexts: ["all"]
    });
    return;
  }

  for (const company of companies) {
    createMenu({
      id: `${MENU.SAVE_PREFIX}${company.id}`,
      parentId: MENU.SAVE_ROOT,
      title: company.name,
      contexts: ["all"]
    });
    createMenu({
      id: `${MENU.FILL_PREFIX}${company.id}`,
      parentId: MENU.FILL_ROOT,
      title: company.name,
      contexts: ["all"]
    });
  }
}

function scheduleMenuRebuild() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    queueMenuRebuild();
  }, 50);
}

function queueMenuRebuild() {
  menuBuild = menuBuild
    .catch(() => undefined)
    .then(rebuildContextMenus)
    .catch((error) => console.error("Form Saver: erro nos menus.", error));
  return menuBuild;
}

async function sendToTab(tabId, message) {
  if (!tabId) {
    throw new Error("Nenhuma aba ativa foi encontrada.");
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    throw new Error(
      "Esta página não permite o uso da extensão. Tente em uma página HTTP ou HTTPS comum."
    );
  }
}

async function notifyTab(tabId, message, kind = "info") {
  try {
    await sendToTab(tabId, { type: "SHOW_TOAST", message, kind });
  } catch (error) {
    console.warn(error.message);
  }
}

async function saveFromContextMenu(companyId, tabId) {
  const extraction = await sendToTab(tabId, {
    type: "EXTRACT_CURRENT_FORM",
    preferContext: true,
    allowPicker: true
  });
  if (!extraction?.ok) {
    throw new Error(extraction?.error || "Não foi possível identificar um formulário.");
  }
  if (!extraction.form.fields.length) {
    throw new Error("Nenhum campo preenchido foi encontrado neste formulário.");
  }

  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  if (company.forms[extraction.form.key]) {
    const confirmation = await sendToTab(tabId, {
      type: "CONFIRM_ACTION",
      title: "Substituir formulário salvo?",
      message: "Este formulário já possui dados salvos para esta empresa. Deseja substituir os dados existentes?",
      confirmLabel: "Substituir"
    });
    if (!confirmation?.confirmed) {
      return;
    }
  }

  const stored = await upsertForm(companyId, extraction.form);
  const variables = countVariableFields(stored);
  const step = nfseStep(stored.pageAddress);
  const detalhe = [
    `${stored.fields.length} campo(s)`,
    variables ? `${variables} perguntado(s) no preenchimento` : "",
    step ? `etapa ${step.label}` : ""
  ].filter(Boolean).join(", ");
  await notifyTab(tabId, `Formulário salvo (${detalhe}).`, "success");
}

async function fillFromContextMenu(companyId, tabId) {
  const current = await sendToTab(tabId, {
    type: "GET_CURRENT_FORM",
    preferContext: true,
    allowPicker: true
  });
  if (!current?.ok || !current.form) {
    throw new Error(current?.error || "Não foi possível identificar um formulário.");
  }

  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  const savedForm = Object.values(company.forms).find(
    (form) => form.pageAddress === current.pageAddress &&
      form.formIdentifier.type === current.form.identifier.type &&
      form.formIdentifier.value === current.form.identifier.value &&
      Number(form.formIdentifier.occurrence || 0) ===
        Number(current.form.identifier.occurrence || 0)
  );
  if (!savedForm) {
    throw new Error("Nenhum formulário compatível foi encontrado para esta empresa.");
  }

  const result = await sendToTab(tabId, { type: "FILL_FORM", savedForm });
  if (!result?.ok) {
    throw new Error(result?.error || "Não foi possível preencher o formulário.");
  }
  const parts = [`${result.filled} de ${result.total} campo(s) preenchido(s).`];
  if (result.unverified) {
    parts.push(
      `${result.unverified} sem confirmação: ${(result.unverifiedFields || []).join(", ")}.`
    );
  }
  if (result.missing) {
    const detail = (result.missingFields || [])
      .map((item) => (item.reason ? `${item.label} (${item.reason})` : item.label))
      .join("; ");
    parts.push(`Faltou preencher: ${detail}.`);
  }
  await notifyTab(tabId, parts.join(" "), result.missing ? "error" : "success");
}

chrome.runtime.onInstalled.addListener(() => {
  queueMenuRebuild();
});

chrome.runtime.onStartup.addListener(() => {
  queueMenuRebuild();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    scheduleMenuRebuild();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);
  if (menuId === MENU.NEW_COMPANY) {
    chrome.tabs.create({ url: chrome.runtime.getURL("manage/manage.html?create=1") });
    return;
  }

  const operation = menuId.startsWith(MENU.SAVE_PREFIX)
    ? saveFromContextMenu(menuId.slice(MENU.SAVE_PREFIX.length), tab?.id)
    : menuId.startsWith(MENU.FILL_PREFIX)
      ? fillFromContextMenu(menuId.slice(MENU.FILL_PREFIX.length), tab?.id)
      : null;

  operation?.catch((error) => {
    notifyTab(tab?.id, error.message, "error");
  });
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_DATA":
      return { ok: true, data: await getData() };
    case "CREATE_COMPANY":
      return { ok: true, company: await createCompany(message.name, message.companyType) };
    case "SET_COMPANY_TYPE":
      return {
        ok: true,
        company: await setCompanyType(message.companyId, message.companyType)
      };
    case "RENAME_COMPANY":
      return {
        ok: true,
        company: await renameCompany(message.companyId, message.name)
      };
    case "DELETE_COMPANY":
      await deleteCompany(message.companyId);
      return { ok: true };
    case "UPSERT_FORM":
      return {
        ok: true,
        form: await upsertForm(message.companyId, message.savedForm)
      };
    case "DELETE_FORM":
      await deleteForm(message.companyId, message.formKey);
      return { ok: true };
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((response) => {
      if (response) sendResponse(response);
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

queueMenuRebuild();
