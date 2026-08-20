// Regras do emissor nacional da NFS-e.
//
// A extensão distingue três naturezas de campo:
//
//   fixo     — se repete a cada nota (tomador, endereço, código de tributação).
//              É o que fica guardado por empresa.
//   variável — muda toda vez (data, valores, descrição). Não é guardado; é
//              perguntado no momento do preenchimento.
//   fora do template — não pertence ao formulário padrão do portal. Ao salvar,
//              a extensão pergunta se aquele valor vale para todos os usuários.

import { TEMPLATE_FIELDS } from "./template.js";

// --- Etapas da emissão ----------------------------------------------------

export const STEPS = [
  {
    id: "pessoas",
    order: 1,
    label: "Pessoas",
    title: "1 · Pessoas",
    description: "Prestador, tomador e intermediário",
    pattern: /\/DPS\/Pessoas\/?$/i,
    url: "https://www.nfse.gov.br/EmissorNacional/DPS/Pessoas"
  },
  {
    id: "servico",
    order: 2,
    label: "Serviço",
    title: "2 · Serviço",
    description: "Local, código de tributação e descrição",
    pattern: /\/DPS\/Servico\/?$/i,
    url: "https://www.nfse.gov.br/EmissorNacional/DPS/Servico"
  },
  {
    id: "tributacao",
    order: 3,
    label: "Tributação",
    title: "3 · Tributação",
    description: "Valores, ISSQN e tributos federais",
    pattern: /\/DPS\/Tributacao\/?$/i,
    url: "https://www.nfse.gov.br/EmissorNacional/DPS/Tributacao"
  }
];

function pathnameOf(pageAddress) {
  const raw = String(pageAddress || "");
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

export function nfseStep(pageAddress) {
  const pathname = pathnameOf(pageAddress);
  return STEPS.find((step) => step.pattern.test(pathname)) || null;
}

export function isNfsePage(pageAddress) {
  return Boolean(nfseStep(pageAddress));
}

export function stepOrder(pageAddress) {
  return nfseStep(pageAddress)?.order ?? 99;
}

// --- Identificação de campo ----------------------------------------------

export function fieldKey(savedField) {
  const primary = savedField?.identifier?.primary;
  return primary ? `${primary.type}:${primary.value}` : "";
}

// Identificadores chegam como "Valores.ValorServico" (name) ou
// "Valores_ValorServico" (id): as duas grafias precisam casar com a mesma regra.
function candidateNames(savedField) {
  const options = [
    savedField?.identifier?.primary,
    ...(savedField?.identifier?.fallbacks || [])
  ].filter(Boolean);
  const names = [];
  for (const option of options) {
    if (option.type !== "name" && option.type !== "id") continue;
    names.push(option.value);
    names.push(option.value.replace(/_/g, "."));
  }
  return names;
}

export function fieldDisplayLabel(savedField) {
  const options = [
    savedField?.identifier?.primary,
    ...(savedField?.identifier?.fallbacks || [])
  ].filter(Boolean);
  for (const type of ["label", "aria-label", "placeholder", "name", "id"]) {
    const found = options.find((option) => option.type === type);
    if (found) return found.value;
  }
  return options[0]?.value || "campo";
}

// --- Campos fora do formulário padrão ------------------------------------

export function templateNamesFor(pageAddress) {
  const step = nfseStep(pageAddress);
  return step ? TEMPLATE_FIELDS[step.id] || [] : [];
}

// Fora de uma etapa conhecida não há template com que comparar, e nesse caso
// nada é tratado como novidade: seria pergunta para todo campo.
export function isTemplateField(savedField, pageAddress) {
  const names = templateNamesFor(pageAddress);
  if (!names.length) return true;
  const candidates = candidateNames(savedField);
  return candidates.some((name) => names.includes(name));
}

export function unknownFields(savedForm) {
  return (savedForm?.fields || [])
    .filter((field) => !isTemplateField(field, savedForm.pageAddress))
    .map((field) => ({
      key: fieldKey(field),
      label: fieldDisplayLabel(field),
      field
    }))
    .filter((item) => item.key);
}

// --- Campos variáveis -----------------------------------------------------

const VARIABLE_RULES = [
  {
    pattern: /(^|\.)DataCompetencia$/i,
    label: "Data de competência",
    kind: "date"
  },
  {
    pattern: /(^|\.)Data(Inicial|Final|Emissao|Prestacao)$/i,
    label: "Data",
    kind: "date",
    generic: true
  },
  {
    pattern: /(^|\.)ValorServicoMoedaEstrangeira$/i,
    label: "Valor em moeda estrangeira (US$)",
    kind: "money"
  },
  {
    pattern: /(^|\.)ValorServico$/i,
    label: "Valor do serviço (R$)",
    kind: "money"
  },
  {
    pattern: /(^|\.)Descricao$/i,
    label: "Descrição do serviço",
    kind: "text",
    generic: true
  }
];

export function variableRuleFor(savedField) {
  const names = candidateNames(savedField);
  if (!names.length) return null;
  return VARIABLE_RULES.find((rule) => names.some((name) => rule.pattern.test(name))) || null;
}

// O melhor rótulo é o que a pessoa vê na tela. Só quando o campo não tem
// rótulo associado é que entra o texto da regra.
function variableLabelFor(rule, savedField) {
  const options = [
    savedField?.identifier?.primary,
    ...(savedField?.identifier?.fallbacks || [])
  ].filter(Boolean);
  const visible = options.find(
    (option) => option.type === "label" || option.type === "aria-label"
  );
  if (visible) return visible.value;

  // Só as regras genéricas precisam do nome do campo para desambiguar.
  if (!rule.generic) return rule.label;
  const suffix = (candidateNames(savedField)[0] || "").split(".").pop();
  return suffix ? `${rule.label} · ${suffix}` : rule.label;
}

// Marca os campos variáveis e descarta o valor guardado. Idempotente.
export function markVariableFields(savedForm) {
  const fields = (savedForm?.fields || []).map((field) => {
    const rule = variableRuleFor(field);
    if (!rule) return field;
    const { value, optionText, optionTexts, checked, ...rest } = field;
    return {
      ...rest,
      variable: true,
      variableLabel: variableLabelFor(rule, field),
      variableKind: rule.kind
    };
  });
  return { ...savedForm, fields };
}

export function countVariableFields(savedForm) {
  return (savedForm?.fields || []).filter((field) => field.variable).length;
}

// --- Padrões compartilhados ----------------------------------------------

// Campo fora do template que o usuário mandou replicar vale para todo mundo,
// mas nunca sobrepõe o que a empresa guardou para si.
export function mergeSharedFields(savedForm, sharedForPage) {
  const shared = Object.values(sharedForPage || {});
  if (!shared.length) return savedForm;

  const present = new Set((savedForm?.fields || []).map(fieldKey));
  const extras = shared.filter((field) => !present.has(fieldKey(field)));
  if (!extras.length) return savedForm;

  return { ...savedForm, fields: [...(savedForm.fields || []), ...extras] };
}
