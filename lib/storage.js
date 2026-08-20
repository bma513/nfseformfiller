import { applyCompanyType, COMPANY_TYPES, normalizeCompanyType } from "./nfse.js";

const STORAGE_KEY = "formSaverData";
const SCHEMA_VERSION = 1;

function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, companies: {} };
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `company-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getData() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY];
  if (!data || typeof data !== "object" || !data.companies) {
    return emptyData();
  }
  const companies = {};
  for (const [id, company] of Object.entries(data.companies)) {
    companies[id] = { ...company, type: normalizeCompanyType(company.type) };
  }
  return { schemaVersion: SCHEMA_VERSION, companies };
}

async function saveData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  return data;
}

export async function createCompany(name, type = COMPANY_TYPES.CUSTOM) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome da empresa.");
  }

  const data = await getData();
  const duplicate = Object.values(data.companies).some(
    (company) => company.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  );
  if (duplicate) {
    throw new Error("Já existe uma empresa com esse nome.");
  }

  const now = new Date().toISOString();
  const id = makeId();
  data.companies[id] = {
    id,
    name: normalizedName,
    type: normalizeCompanyType(type),
    createdAt: now,
    updatedAt: now,
    forms: {}
  };
  await saveData(data);
  return data.companies[id];
}

export async function renameCompany(companyId, name) {
  const normalizedName = cleanName(name);
  if (!normalizedName) {
    throw new Error("Informe o nome da empresa.");
  }

  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  const duplicate = Object.values(data.companies).some(
    (item) => item.id !== companyId &&
      item.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  );
  if (duplicate) {
    throw new Error("Já existe uma empresa com esse nome.");
  }

  company.name = normalizedName;
  company.updatedAt = new Date().toISOString();
  await saveData(data);
  return company;
}

export async function setCompanyType(companyId, type) {
  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }

  const normalizedType = normalizeCompanyType(type);
  company.type = normalizedType;
  for (const [key, savedForm] of Object.entries(company.forms || {})) {
    company.forms[key] = applyCompanyType(savedForm, normalizedType);
  }
  company.updatedAt = new Date().toISOString();
  await saveData(data);
  return company;
}

export async function deleteCompany(companyId) {
  const data = await getData();
  if (!data.companies[companyId]) {
    throw new Error("Empresa não encontrada.");
  }
  delete data.companies[companyId];
  await saveData(data);
}

export async function upsertForm(companyId, savedForm) {
  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  if (!savedForm?.key || !savedForm?.pageAddress || !savedForm?.formIdentifier) {
    throw new Error("Os dados do formulário são inválidos.");
  }

  const existing = company.forms[savedForm.key];
  const now = new Date().toISOString();
  const typedForm = applyCompanyType(savedForm, company.type);
  company.forms[savedForm.key] = {
    ...typedForm,
    createdAt: existing?.createdAt || savedForm.createdAt || now,
    updatedAt: now
  };
  company.updatedAt = now;
  await saveData(data);
  return company.forms[savedForm.key];
}

export async function deleteForm(companyId, formKey) {
  const data = await getData();
  const company = data.companies[companyId];
  if (!company) {
    throw new Error("Empresa não encontrada.");
  }
  if (!company.forms[formKey]) {
    throw new Error("Formulário salvo não encontrado.");
  }
  delete company.forms[formKey];
  company.updatedAt = new Date().toISOString();
  await saveData(data);
}

export { STORAGE_KEY };
