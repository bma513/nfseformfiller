import {
  STORAGE_KEY,
  createCompany,
  createUser,
  deleteCompany,
  deleteForm,
  deleteSharedField,
  deleteUser,
  getData,
  renameCompany,
  renameUser,
  saveSharedFields,
  upsertForm
} from "../lib/storage.js";
import {
  STEPS,
  countVariableFields,
  mergeSharedFields,
  nfseStep,
  unknownFields
} from "../lib/nfse.js";

const MENU = {
  ROOT: "nfse-root",
  MANAGE: "nfse-manage",
  SAVE_ROOT: "nfse-save-root",
  FILL_ROOT: "nfse-fill-root",
  SAVE_PREFIX: "nfse-save:",
  FILL_PREFIX: "nfse-fill:"
};

let menuTimer;
let menuBuild = Promise.resolve();

function managePageUrl() {
  return chrome.runtime.getURL("manage/manage.html");
}

function createMenu(properties) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function sortedUsers(data) {
  return Object.values(data.users || {}).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR")
  );
}

function sortedCompanies(user) {
  return Object.values(user.companies || {}).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR")
  );
}

// O menu tem quatro níveis: raiz, ação, usuário e empresa. É o caminho que o
// usuário descreve em voz alta — "salvar, fulano, empresa tal".
async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();
  const data = await getData();
  const users = sortedUsers(data);
  const contexts = ["page", "editable", "selection", "link", "image"];

  await createMenu({ id: MENU.ROOT, title: "NFS-e Form Filler", contexts });
  await createMenu({
    id: MENU.MANAGE,
    parentId: MENU.ROOT,
    title: "Cadastrar usuário ou empresa…",
    contexts
  });

  if (!users.length) return;

  await createMenu({
    id: "nfse-sep",
    parentId: MENU.ROOT,
    type: "separator",
    contexts
  });
  await createMenu({
    id: MENU.SAVE_ROOT,
    parentId: MENU.ROOT,
    title: "Salvar formulário atual",
    contexts
  });
  await createMenu({
    id: MENU.FILL_ROOT,
    parentId: MENU.ROOT,
    title: "Preencher formulário atual",
    contexts
  });

  for (const action of [
    { root: MENU.SAVE_ROOT, prefix: MENU.SAVE_PREFIX },
    { root: MENU.FILL_ROOT, prefix: MENU.FILL_PREFIX }
  ]) {
    for (const user of users) {
      const userMenuId = `${action.prefix}user:${user.id}`;
      await createMenu({
        id: userMenuId,
        parentId: action.root,
        title: user.name,
        contexts
      });

      const companies = sortedCompanies(user);
      if (!companies.length) {
        await createMenu({
          id: `${userMenuId}:vazio`,
          parentId: userMenuId,
          title: "Nenhuma empresa cadastrada",
          enabled: false,
          contexts
        });
        continue;
      }
      for (const company of companies) {
        await createMenu({
          id: `${action.prefix}${user.id}|${company.id}`,
          parentId: userMenuId,
          title: company.name,
          contexts
        });
      }
    }
  }
}

function queueMenuRebuild() {
  menuBuild = menuBuild
    .catch(() => undefined)
    .then(rebuildContextMenus)
    .catch((error) => console.error("NFS-e Form Filler: erro nos menus.", error));
  return menuBuild;
}

function scheduleMenuRebuild() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(queueMenuRebuild, 120);
}

async function sendToTab(tabId, message) {
  if (!tabId) {
    throw new Error("Nenhuma aba ativa foi encontrada.");
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error(
      "Esta página não permite o uso da extensão. Abra uma etapa da emissão da NFS-e."
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

// --- Salvar ---------------------------------------------------------------

// Um campo que não está no template do portal é novidade: ou a prefeitura
// acrescentou algo, ou o emissor mudou. Perguntar de quem é aquele valor
// evita tanto perder a informação quanto espalhá-la sem querer.
async function askAboutUnknownFields(tabId, savedForm) {
  const desconhecidos = unknownFields(savedForm);
  if (!desconhecidos.length) return [];

  const answer = await sendToTab(tabId, {
    type: "CONFIRM_SHARED_FIELDS",
    fields: desconhecidos.map(({ key, label }) => ({ key, label }))
  });
  const chosen = new Set(answer?.keys || []);
  return desconhecidos.filter((item) => chosen.has(item.key)).map((item) => item.field);
}

async function persistForm(userId, companyId, tabId, savedForm) {
  const compartilhar = await askAboutUnknownFields(tabId, savedForm);
  const stored = await upsertForm(userId, companyId, savedForm);
  if (compartilhar.length) {
    await saveSharedFields(savedForm.pageAddress, compartilhar);
  }
  return { stored, compartilhados: compartilhar.length };
}

function describeSave(stored, compartilhados) {
  const step = nfseStep(stored.pageAddress);
  const partes = [`${stored.fields.length} campo(s)`];
  const variaveis = countVariableFields(stored);
  if (variaveis) partes.push(`${variaveis} perguntado(s) ao preencher`);
  if (compartilhados) partes.push(`${compartilhados} replicado(s) para todos`);
  if (step) partes.push(`etapa ${step.title}`);
  return `Formulário salvo (${partes.join(", ")}).`;
}

async function saveFromContextMenu(userId, companyId, tabId) {
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
  const company = data.users[userId]?.companies?.[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  if (company.forms[extraction.form.key]) {
    const confirmation = await sendToTab(tabId, {
      type: "CONFIRM_ACTION",
      title: "Substituir formulário salvo?",
      message: "Esta etapa já possui dados salvos para esta empresa. Deseja substituir?",
      confirmLabel: "Substituir"
    });
    if (!confirmation?.confirmed) return;
  }

  const { stored, compartilhados } = await persistForm(
    userId,
    companyId,
    tabId,
    extraction.form
  );
  await notifyTab(tabId, describeSave(stored, compartilhados), "success");
}

// --- Preencher ------------------------------------------------------------

function sameIdentifier(left, right) {
  return left?.type === right?.type && left?.value === right?.value &&
    Number(left?.occurrence || 0) === Number(right?.occurrence || 0);
}

function findSavedForm(company, pageAddress, identifier) {
  return Object.values(company.forms || {}).find(
    (form) => form.pageAddress === pageAddress &&
      (!identifier || sameIdentifier(form.formIdentifier, identifier))
  ) || null;
}

async function fillSavedForm(tabId, data, company, pageAddress, identifier) {
  const savedForm = findSavedForm(company, pageAddress, identifier);
  if (!savedForm) {
    throw new Error("Esta empresa não tem dados salvos para esta etapa.");
  }

  const prepared = mergeSharedFields(savedForm, data.sharedFields?.[pageAddress]);
  const result = await sendToTab(tabId, { type: "FILL_FORM", savedForm: prepared });
  if (!result?.ok) {
    throw new Error(result?.error || "Não foi possível preencher o formulário.");
  }

  if (result.cancelled) {
    await notifyTab(tabId, "Preenchimento cancelado.", "info");
    return result;
  }
  const partes = [`${result.filled} de ${result.total} campo(s) preenchido(s).`];
  if (result.unverified) {
    partes.push(
      `${result.unverified} sem confirmação: ${(result.unverifiedFields || []).join(", ")}.`
    );
  }
  if (result.missing) {
    const detalhe = (result.missingFields || [])
      .map((item) => (item.reason ? `${item.label} (${item.reason})` : item.label))
      .join("; ");
    partes.push(`Faltou preencher: ${detalhe}.`);
  }
  await notifyTab(tabId, partes.join(" "), result.missing ? "error" : "success");
  return result;
}

async function fillFromContextMenu(userId, companyId, tabId) {
  const current = await sendToTab(tabId, {
    type: "GET_CURRENT_FORM",
    preferContext: true,
    allowPicker: true
  });
  if (!current?.ok || !current.form) {
    throw new Error(current?.error || "Não foi possível identificar um formulário.");
  }

  const data = await getData();
  const company = data.users[userId]?.companies?.[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  await fillSavedForm(tabId, data, company, current.pageAddress, current.form.identifier);
}

// Chamado pela página inicial: acha uma aba aberta na etapa pedida, ativa e
// preenche. Sem aba, não há o que fazer — o portal exige um rascunho aberto.
async function fillStepFromManager(userId, companyId, stepId) {
  const step = STEPS.find((item) => item.id === stepId);
  if (!step) throw new Error("Etapa desconhecida.");

  const tabs = await chrome.tabs.query({ url: ["https://*/*", "http://*/*"] });
  const alvo = tabs.find((tab) => {
    try {
      return step.pattern.test(new URL(tab.url).pathname);
    } catch {
      return false;
    }
  });
  if (!alvo) {
    throw new Error(
      `Nenhuma aba aberta na etapa ${step.label}. Abra a emissão no portal e tente de novo.`
    );
  }

  await chrome.tabs.update(alvo.id, { active: true });
  await chrome.windows.update(alvo.windowId, { focused: true });

  const data = await getData();
  const company = data.users[userId]?.companies?.[companyId];
  if (!company) throw new Error("Empresa não encontrada.");

  const pageAddress = (() => {
    const url = new URL(alvo.url);
    return `${url.origin}${url.pathname}`;
  })();
  return fillSavedForm(alvo.id, data, company, pageAddress, null);
}

// --- Eventos --------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  queueMenuRebuild();
  const data = await getData();
  if (!Object.keys(data.users || {}).length) {
    chrome.tabs.create({ url: managePageUrl() });
  }
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
  if (menuId === MENU.MANAGE) {
    chrome.tabs.create({ url: managePageUrl() });
    return;
  }

  const prefix = menuId.startsWith(MENU.SAVE_PREFIX)
    ? MENU.SAVE_PREFIX
    : menuId.startsWith(MENU.FILL_PREFIX) ? MENU.FILL_PREFIX : null;
  if (!prefix) return;

  const alvo = menuId.slice(prefix.length);
  if (alvo.startsWith("user:") || !alvo.includes("|")) return;
  const [userId, companyId] = alvo.split("|");

  const operation = prefix === MENU.SAVE_PREFIX
    ? saveFromContextMenu(userId, companyId, tab?.id)
    : fillFromContextMenu(userId, companyId, tab?.id);

  operation.catch((error) => notifyTab(tab?.id, error.message, "error"));
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_DATA":
      return { ok: true, data: await getData() };
    case "CREATE_USER":
      return { ok: true, user: await createUser(message.name) };
    case "RENAME_USER":
      return { ok: true, user: await renameUser(message.userId, message.name) };
    case "DELETE_USER":
      await deleteUser(message.userId);
      return { ok: true };
    case "CREATE_COMPANY":
      return { ok: true, company: await createCompany(message.userId, message.name) };
    case "RENAME_COMPANY":
      return {
        ok: true,
        company: await renameCompany(message.userId, message.companyId, message.name)
      };
    case "DELETE_COMPANY":
      await deleteCompany(message.userId, message.companyId);
      return { ok: true };
    case "UPSERT_FORM":
      return {
        ok: true,
        form: await upsertForm(message.userId, message.companyId, message.savedForm)
      };
    case "DELETE_FORM":
      await deleteForm(message.userId, message.companyId, message.formKey);
      return { ok: true };
    case "SAVE_SHARED_FIELDS":
      await saveSharedFields(message.pageAddress, message.fields);
      return { ok: true };
    case "DELETE_SHARED_FIELD":
      await deleteSharedField(message.pageAddress, message.key);
      return { ok: true };
    case "FILL_STEP":
      return {
        ok: true,
        result: await fillStepFromManager(message.userId, message.companyId, message.stepId)
      };
    case "OPEN_MANAGER":
      chrome.tabs.create({ url: managePageUrl() });
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
