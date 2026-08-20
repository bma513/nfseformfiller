// Regras específicas do tipo de empresa "NFS-e".
//
// Uma empresa personalizada guarda tudo o que estava preenchido. Uma empresa
// NFS-e distingue duas naturezas de campo: o que se repete a cada nota (tomador,
// endereço, código de tributação, alíquotas) e o que muda toda vez (data de
// competência, valores, descrição do serviço). O segundo grupo não é guardado —
// é perguntado no momento do preenchimento.

export const COMPANY_TYPES = {
  CUSTOM: "custom",
  NFSE: "nfse"
};

export const COMPANY_TYPE_LABELS = {
  [COMPANY_TYPES.CUSTOM]: "Personalizada",
  [COMPANY_TYPES.NFSE]: "NFS-e"
};

export const COMPANY_TYPE_HINTS = {
  [COMPANY_TYPES.CUSTOM]:
    "Guarda todos os campos preenchidos e restaura exatamente os mesmos valores.",
  [COMPANY_TYPES.NFSE]:
    "Reconhece as etapas da nota, não guarda data nem valores e pergunta esses campos a cada preenchimento."
};

export function normalizeCompanyType(type) {
  return type === COMPANY_TYPES.NFSE ? COMPANY_TYPES.NFSE : COMPANY_TYPES.CUSTOM;
}

// --- Etapas da emissão ----------------------------------------------------

const STEPS = [
  {
    pattern: /\/DPS\/Pessoas\/?$/i,
    order: 1,
    label: "1 · Pessoas",
    description: "Prestador, tomador e intermediário"
  },
  {
    pattern: /\/DPS\/Servico\/?$/i,
    order: 2,
    label: "2 · Serviço",
    description: "Local, código de tributação e descrição"
  },
  {
    pattern: /\/DPS\/Tributacao\/?$/i,
    order: 3,
    label: "3 · Tributação",
    description: "Valores, ISSQN e tributos federais"
  }
];

export function nfseStep(pageAddress) {
  let pathname = String(pageAddress || "");
  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // pageAddress já pode vir como caminho puro.
  }
  return STEPS.find((step) => step.pattern.test(pathname)) || null;
}

export function isNfsePage(pageAddress) {
  return Boolean(nfseStep(pageAddress));
}

// Ordena os formulários salvos na sequência em que a nota é emitida, em vez de
// alfabeticamente. Etapas desconhecidas vão para o fim.
export function stepOrder(pageAddress) {
  return nfseStep(pageAddress)?.order ?? 99;
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

// Identificadores chegam como "Valores.ValorServico" (name) ou
// "Valores_ValorServico" (id): as duas formas precisam casar com a mesma regra.
function candidateNames(savedField) {
  const options = [
    savedField.identifier?.primary,
    ...(savedField.identifier?.fallbacks || [])
  ].filter(Boolean);
  const names = [];
  for (const option of options) {
    if (option.type !== "name" && option.type !== "id") continue;
    names.push(option.value);
    names.push(option.value.replace(/_/g, "."));
  }
  return names;
}

export function variableRuleFor(savedField) {
  const names = candidateNames(savedField);
  if (!names.length) return null;
  return VARIABLE_RULES.find((rule) => names.some((name) => rule.pattern.test(name))) || null;
}

// O melhor rótulo é o que a pessoa vê na tela. Só quando o campo não tem
// rótulo associado é que entra o texto da regra, com o nome do campo para
// desambiguar formulários que têm mais de uma data ou mais de uma descrição.
function variableLabel(rule, savedField) {
  const options = [
    savedField.identifier?.primary,
    ...(savedField.identifier?.fallbacks || [])
  ].filter(Boolean);
  const visible = options.find(
    (option) => option.type === "label" || option.type === "aria-label"
  );
  if (visible) return visible.value;

  // Só as regras genéricas precisam do nome do campo para desambiguar; as
  // específicas já dizem exatamente do que se trata.
  if (!rule.generic) return rule.label;
  const suffix = (candidateNames(savedField)[0] || "").split(".").pop();
  return suffix ? `${rule.label} · ${suffix}` : rule.label;
}

// Marca os campos variáveis e descarta o valor guardado. Idempotente: aplicar
// duas vezes no mesmo formulário não muda nada.
export function markVariableFields(savedForm) {
  const fields = (savedForm.fields || []).map((field) => {
    const rule = variableRuleFor(field);
    if (!rule) {
      if (!field.variable) return field;
      // Campo que deixou de ser variável volta a ser um campo comum.
      const { variable, variableLabel: label, variableKind, ...rest } = field;
      return rest;
    }
    const {
      value,
      optionText,
      optionTexts,
      checked,
      ...rest
    } = field;
    return {
      ...rest,
      variable: true,
      variableLabel: variableLabel(rule, field),
      variableKind: rule.kind
    };
  });
  return { ...savedForm, fields };
}

// Desfaz a marcação, sem recuperar os valores: eles nunca foram guardados.
export function clearVariableFields(savedForm) {
  const fields = (savedForm.fields || []).map((field) => {
    if (!field.variable) return field;
    const { variable, variableLabel: label, variableKind, ...rest } = field;
    return { ...rest, value: "" };
  });
  return { ...savedForm, fields };
}

export function countVariableFields(savedForm) {
  return (savedForm.fields || []).filter((field) => field.variable).length;
}

// Aplica a natureza da empresa a um formulário recém-extraído ou já salvo.
export function applyCompanyType(savedForm, type) {
  return normalizeCompanyType(type) === COMPANY_TYPES.NFSE
    ? markVariableFields(savedForm)
    : clearVariableFields(savedForm);
}
