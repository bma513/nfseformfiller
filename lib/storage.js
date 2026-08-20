import {
  isAutoFilledField,
  markVariableFields,
  stripAutoFilledFields
} from "./nfse.js";

const STORAGE_KEY = "formSaverData";

// 1 — empresas na raiz, sem usuário.
// 2 — usuários com empresas dentro.
// 3 — campos do emitente removidos dos formulários já salvos.
const SCHEMA_VERSION = 3;

function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, users: {}, sharedFields: {} };
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// A versão 1 guardava empresas na raiz, sem usuário, e podia ter empresas do
// tipo "personalizada", que não existe mais. Tudo isso continua válido: as
// empresas passam a pertencer a um usuário criado aqui, e os formulários
// recebem o tratamento da NFS-e, com data e valores deixando de ser guardados.
function migrate(data) {
  const companies = data.companies || {};
  const migrated = emptyData();
  if (!Object.keys(companies).length) return migrated;

  const id = makeId("user");
  const now = new Date().toISOString();
  migrated.users[id] = {
    id,
    name: "Usuário principal",
    createdAt: now,
    updatedAt: now,
    companies: Object.fromEntries(
      Object.entries(companies).map(([companyId, company]) => {
        const { type, forms, ...rest } = company;
        const migratedForms = Object.fromEntries(
          Object.entries(forms || {}).map(([key, savedForm]) => [
            key,
            markVariableFields(stripAutoFilledFields(savedForm))
          ])
        );
        return [companyId, { ...rest, userId: id, forms: migratedForms }];
      })
    )
  };
  return migrated;
}

// Reaplica nos dados já gravados as regras que hoje valem na gravação.
function sanitize(data) {
  for (const user of Object.values(data.users || {})) {
    for (const company of Object.values(user.companies || {})) {
      for (const [key, savedForm] of Object.entries(company.forms || {})) {
        company.forms[key] = markVariableFields(stripAutoFilledFields(savedForm));
      }
    }
  }
  for (const [pageAddress, campos] of Object.entries(data.sharedFields || {})) {
    for (const [key, field] of Object.entries(campos)) {
      if (isAutoFilledField(field)) delete campos[key];
    }
    if (!Object.keys(campos).length) delete data.sharedFields[pageAddress];
  }
  return data;
}

export async function getData() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY];
  if (!data || typeof data !== "object") {
    return emptyData();
  }
  if (data.users) {
    const atual = {
      schemaVersion: SCHEMA_VERSION,
      users: data.users,
      sharedFields: data.sharedFields || {}
    };
    // Uma limpeza nova precisa alcançar o que já está gravado, não só o que
    // vier a ser salvo daqui em diante. A versão do esquema diz o que já foi
    // aplicado, para a varredura acontecer uma vez e não a cada leitura.
    if (Number(data.schemaVersion || 0) < SCHEMA_VERSION) {
      sanitize(atual);
      await saveData(atual);
    }
    return atual;
  }

  // Migrar a cada leitura geraria um id de usuário diferente por chamada e
  // quebraria toda referência guardada: converte uma vez e grava.
  const migrated = migrate(data);
  await saveData(migrated);
  return migrated;
}

async function saveData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  return data;
}

function requireUser(data, userId) {
  const user = data.users[userId];
  if (!user) throw new Error("Usuário não encontrado.");
  return user;
}

function requireCompany(data, userId, companyId) {
  const user = requireUser(data, userId);
  const company = user.companies?.[companyId];
  if (!company) throw new Error("Empresa não encontrada.");
  return { user, company };
}

function assertUniqueName(collection, name, exceptId) {
  const duplicate = Object.values(collection || {}).some(
    (item) => item.id !== exceptId &&
      item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (duplicate) {
    throw new Error("Já existe um cadastro com esse nome.");
  }
}

// --- Usuários -------------------------------------------------------------

export async function createUser(name) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome do usuário.");
  }

  const data = await getData();
  assertUniqueName(data.users, normalizedName);

  const now = new Date().toISOString();
  const id = makeId("user");
  data.users[id] = {
    id,
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    companies: {}
  };
  await saveData(data);
  return data.users[id];
}

export async function renameUser(userId, name) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome do usuário.");
  }

  const data = await getData();
  const user = requireUser(data, userId);
  assertUniqueName(data.users, normalizedName, userId);
  user.name = normalizedName;
  user.updatedAt = new Date().toISOString();
  await saveData(data);
  return user;
}

export async function deleteUser(userId) {
  const data = await getData();
  requireUser(data, userId);
  delete data.users[userId];
  await saveData(data);
}

// --- Empresas -------------------------------------------------------------

export async function createCompany(userId, name) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome da empresa.");
  }

  const data = await getData();
  const user = requireUser(data, userId);
  user.companies = user.companies || {};
  assertUniqueName(user.companies, normalizedName);

  const now = new Date().toISOString();
  const id = makeId("company");
  user.companies[id] = {
    id,
    userId,
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    forms: {}
  };
  user.updatedAt = now;
  await saveData(data);
  return user.companies[id];
}

export async function renameCompany(userId, companyId, name) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome da empresa.");
  }

  const data = await getData();
  const { user, company } = requireCompany(data, userId, companyId);
  assertUniqueName(user.companies, normalizedName, companyId);
  company.name = normalizedName;
  company.updatedAt = new Date().toISOString();
  user.updatedAt = company.updatedAt;
  await saveData(data);
  return company;
}

export async function deleteCompany(userId, companyId) {
  const data = await getData();
  const { user } = requireCompany(data, userId, companyId);
  delete user.companies[companyId];
  user.updatedAt = new Date().toISOString();
  await saveData(data);
}

// --- Formulários ----------------------------------------------------------

export async function upsertForm(userId, companyId, savedForm) {
  const data = await getData();
  const { user, company } = requireCompany(data, userId, companyId);
  if (!savedForm?.key || !savedForm?.pageAddress || !savedForm?.formIdentifier) {
    throw new Error("Os dados do formulário são inválidos.");
  }

  const existing = company.forms[savedForm.key];
  const now = new Date().toISOString();
  company.forms[savedForm.key] = {
    ...markVariableFields(stripAutoFilledFields(savedForm)),
    createdAt: existing?.createdAt || savedForm.createdAt || now,
    updatedAt: now
  };
  company.updatedAt = now;
  user.updatedAt = now;
  await saveData(data);
  return company.forms[savedForm.key];
}

export async function deleteForm(userId, companyId, formKey) {
  const data = await getData();
  const { user, company } = requireCompany(data, userId, companyId);
  if (!company.forms[formKey]) {
    throw new Error("Formulário salvo não encontrado.");
  }
  delete company.forms[formKey];
  company.updatedAt = new Date().toISOString();
  user.updatedAt = company.updatedAt;
  await saveData(data);
}

// --- Campos compartilhados entre todos os usuários ------------------------

export async function saveSharedFields(pageAddress, fields) {
  const data = await getData();
  data.sharedFields = data.sharedFields || {};
  const page = data.sharedFields[pageAddress] || {};
  for (const field of fields || []) {
    const primary = field?.identifier?.primary;
    if (!primary) continue;
    page[`${primary.type}:${primary.value}`] = field;
  }
  data.sharedFields[pageAddress] = page;
  await saveData(data);
  return page;
}

export async function deleteSharedField(pageAddress, key) {
  const data = await getData();
  const page = data.sharedFields?.[pageAddress];
  if (!page || !page[key]) return;
  delete page[key];
  if (!Object.keys(page).length) delete data.sharedFields[pageAddress];
  await saveData(data);
}

export { STORAGE_KEY };
