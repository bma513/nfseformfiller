(() => {
  "use strict";

  const EXCLUDED_INPUT_TYPES = new Set([
    "password",
    "file",
    "hidden",
    "submit",
    "button",
    "reset",
    "image"
  ]);
  const FIELD_SELECTOR = "input, select, textarea";

  // Atributos capazes de indicar que um campo dinâmico mudou de estado.
  const WATCHED_ATTRIBUTES = [
    "disabled",
    "readonly",
    "hidden",
    "style",
    "class",
    "aria-disabled",
    "aria-hidden",
    "value",
    "selected"
  ];

  // Primeira passada rápida; as seguintes reprocessam o que ficou pendente e
  // só continuam enquanto houver progresso. Cadeias de select dependentes
  // (país → município → código → item) precisam de mais de duas rodadas.
  const PASS_TIMEOUTS = [3000, 8000, 10000, 10000, 10000];
  const MINIMUM_PASSES = 2;
  const GLOBAL_FILL_TIMEOUT = 120000;
  const APPLY_ATTEMPTS = 3;
  const FIELD_SETTLE_DELAY = 120;
  const POLL_INTERVAL = 120;
  const COMBOBOX_OPTION_TIMEOUT = 2000;

  // Um <select> escondido atrás de um componente próprio: caixa visível que
  // abre um painel com busca e lista. Escrever no <select> não repinta nada.
  const WIDGET_TRIGGER_HINTS = [
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    ".select2-selection",
    ".ng-select-container",
    ".p-dropdown",
    ".ui-selectonemenu",
    ".mat-mdc-select-trigger",
    ".mat-select-trigger",
    ".chosen-single",
    ".selectize-input",
    ".dropdown-toggle"
  ].join(",");

  const WIDGET_OPTION_HINTS = [
    "[role='option']",
    ".select2-results__option",
    ".ng-option",
    ".p-dropdown-item",
    ".ui-selectonemenu-item",
    ".mat-mdc-option",
    ".mat-option",
    ".chosen-results li",
    ".selectize-dropdown-content .option",
    ".dropdown-menu li",
    ".dropdown-item"
  ].join(",");

  const WIDGET_PANEL_TIMEOUT = 4000;

  const COMBOBOX_HINTS = [
    ".select2-search__field",
    ".ui-autocomplete-input",
    "[class*='autocomplete' i]",
    "[class*='typeahead' i]",
    "[class*='combobox' i]",
    "[class*='lookup' i]"
  ].join(",");

  let lastContextForm = null;
  let activeFill = null;

  const isTopFrame = window.top === window;

  function pageAddress() {
    return `${location.origin}${location.pathname}`;
  }

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactText(value) {
    return normalizedText(value).replace(/[^0-9a-zà-ÿ]/gi, "").toLowerCase();
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  // requestAnimationFrame não dispara em abas ao fundo; o timeout garante a continuidade.
  function nextFrame() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 60);
    });
  }

  // --- Cache de identificação ---------------------------------------------
  // Durante um preenchimento, identificar formulários e campos acontece a cada
  // ciclo de espera. O cache evita repetir querySelectorAll em toda a página.

  let identifierCache = null;
  let fingerprintCache = null;

  function beginIdentifierCache() {
    identifierCache = new WeakMap();
    fingerprintCache = new WeakMap();
    const observer = new MutationObserver(() => {
      identifierCache = new WeakMap();
      fingerprintCache = new WeakMap();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });
    return () => {
      observer.disconnect();
      identifierCache = null;
      fingerprintCache = null;
    };
  }

  function associatedLabel(element) {
    const explicit = Array.from(element.labels || [])
      .map((label) => normalizedText(label.textContent))
      .find(Boolean);
    if (explicit) return explicit;

    const wrappingLabel = element.closest("label");
    return normalizedText(wrappingLabel?.textContent);
  }

  function computeFieldFingerprint(element) {
    const pieces = [
      element.tagName.toLowerCase(),
      element.type || "",
      element.getAttribute("autocomplete") || "",
      element.getAttribute("placeholder") || "",
      element.getAttribute("data-testid") || "",
      associatedLabel(element)
    ];
    return hash(pieces.map(normalizedText).join("|"));
  }

  function fieldFingerprint(element) {
    if (fingerprintCache) {
      const cached = fingerprintCache.get(element);
      if (cached !== undefined) return cached;
    }
    const computed = computeFieldFingerprint(element);
    if (fingerprintCache) fingerprintCache.set(element, computed);
    return computed;
  }

  function computeRawFormIdentifier(form) {
    if (normalizedText(form.getAttribute("name"))) {
      return { type: "name", value: normalizedText(form.getAttribute("name")) };
    }
    if (normalizedText(form.id)) {
      return { type: "id", value: normalizedText(form.id) };
    }

    const ariaLabel = normalizedText(form.getAttribute("aria-label"));
    const action = (() => {
      try {
        const url = new URL(form.getAttribute("action") || location.href, location.href);
        return `${url.origin}${url.pathname}`;
      } catch {
        return form.getAttribute("action") || "";
      }
    })();
    const fieldSignature = Array.from(form.querySelectorAll(FIELD_SELECTOR))
      .slice(0, 12)
      .map((field) =>
        normalizedText(
          field.getAttribute("name") ||
          field.id ||
          field.getAttribute("aria-label") ||
          associatedLabel(field) ||
          fieldFingerprint(field)
        )
      )
      .join("|");
    return {
      type: "fallback",
      value: `form-${hash(`${ariaLabel}|${action}|${form.method}|${fieldSignature}`)}`
    };
  }

  function rawFormIdentifier(form) {
    if (identifierCache) {
      const cached = identifierCache.get(form);
      if (cached) return cached;
    }
    const computed = computeRawFormIdentifier(form);
    if (identifierCache) identifierCache.set(form, computed);
    return computed;
  }

  function sameBaseIdentifier(left, right) {
    return left?.type === right?.type && left?.value === right?.value;
  }

  function formIdentifier(form) {
    const forms = Array.from(document.forms);
    const base = rawFormIdentifier(form);
    const matching = forms.filter((item) => sameBaseIdentifier(rawFormIdentifier(item), base));
    const occurrence = matching.length > 1 ? matching.indexOf(form) : 0;
    return occurrence > 0 || matching.length > 1 ? { ...base, occurrence } : base;
  }

  function sameIdentifier(left, right) {
    return sameBaseIdentifier(left, right) &&
      Number(left?.occurrence || 0) === Number(right?.occurrence || 0);
  }

  function formDisplayName(form, index) {
    return normalizedText(
      form.getAttribute("data-form-name") ||
      form.getAttribute("aria-label") ||
      form.getAttribute("name") ||
      form.id
    ) || `Formulário ${index + 1}`;
  }

  function describeForms() {
    return Array.from(document.forms).map((form, index) => ({
      identifier: formIdentifier(form),
      displayName: formDisplayName(form, index),
      fieldCount: Array.from(form.querySelectorAll(FIELD_SELECTOR)).filter(isCapturableField).length
    }));
  }

  function findForm(identifier) {
    return Array.from(document.forms).find((form) =>
      sameIdentifier(formIdentifier(form), identifier)
    ) || null;
  }

  function isSensitiveField(element) {
    const autocomplete = normalizedText(element.getAttribute("autocomplete")).toLowerCase();
    if (autocomplete.startsWith("cc-")) return true;

    const hints = [
      element.name,
      element.id,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      autocomplete
    ].map(normalizedText).join(" ").toLowerCase();
    return /(?:credit.?card|card.?number|cart[aã]o|\bcvv\b|\bcvc\b)/i.test(hints);
  }

  function isSavableField(element) {
    if (!(element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement)) {
      return false;
    }
    if (element instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(element.type)) {
      return false;
    }
    return !isSensitiveField(element);
  }

  // Campo desabilitado ou somente leitura no momento da gravação não guarda
  // uma escolha do usuário: guarda o que o próprio site calculou. Salvá-lo
  // enche o registro de valores que nunca poderão ser reaplicados e faz cada
  // preenchimento esperar em vão por um campo que jamais será liberado.
  function isReadOnlyField(element) {
    return Boolean(element.readOnly) || element.hasAttribute("readonly");
  }

  function isCapturableField(element) {
    if (!isSavableField(element)) return false;
    if (isReadOnlyField(element)) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
      // Num grupo, o que importa é existir ao menos uma opção utilizável.
      return radioGroupFor(element.form, element).some((radio) => !radio.disabled);
    }
    return !element.disabled;
  }

  function identifierOptions(element) {
    const options = [
      ["name", element.getAttribute("name")],
      ["id", element.id],
      ["aria-label", element.getAttribute("aria-label")],
      ["label", associatedLabel(element)],
      ["data-testid", element.getAttribute("data-testid")],
      ["autocomplete", element.getAttribute("autocomplete")],
      ["placeholder", element.getAttribute("placeholder")],
      ["fingerprint", fieldFingerprint(element)]
    ]
      .map(([type, value]) => ({ type, value: normalizedText(value) }))
      .filter((item) => item.value);

    return {
      primary: options[0],
      fallbacks: options.slice(1)
    };
  }

  function fieldIdentityKey(element) {
    const identifier = identifierOptions(element).primary;
    return `${identifier.type}:${identifier.value}`;
  }

  // Rótulo legível usado para relatar quais campos não puderam ser preenchidos.
  function savedFieldLabel(savedField) {
    const options = [
      savedField.identifier?.primary,
      ...(savedField.identifier?.fallbacks || [])
    ]
      .filter(Boolean)
      // Um placeholder como "-" identifica o campo na tela, mas não serve de
      // nome num relatório: exige ao menos uma letra ou dígito.
      .filter((option) => /[0-9a-zà-ÿ]/i.test(option.value));
    for (const type of ["label", "aria-label", "placeholder", "name", "id", "data-testid"]) {
      const found = options.find((option) => option.type === type);
      if (found) return found.value;
    }
    return options[0]?.value || "campo";
  }

  function radioGroupFor(form, element) {
    const name = element.name;
    return Array.from(form.elements).filter(
      (item) => item instanceof HTMLInputElement && item.type === "radio" && item.name === name
    );
  }

  function serializeField(element) {
    const base = {
      identifier: identifierOptions(element),
      elementType: element.tagName.toLowerCase(),
      inputType: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase()
    };

    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      return { ...base, checked: element.checked, optionValue: element.value };
    }
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (element.name) {
        const group = radioGroupFor(element.form, element);
        return {
          ...base,
          value: group.find((item) => item.checked)?.value ?? null,
          radioGroup: true
        };
      }
      return { ...base, checked: element.checked, optionValue: element.value };
    }
    if (element instanceof HTMLSelectElement && element.multiple) {
      const selected = Array.from(element.selectedOptions);
      return {
        ...base,
        multiple: true,
        value: selected.map((option) => option.value),
        // O texto serve de segunda chance quando o portal regenera os values.
        optionTexts: selected.map((option) => normalizedText(option.textContent))
      };
    }
    if (element instanceof HTMLSelectElement) {
      return {
        ...base,
        value: element.value,
        optionText: normalizedText(element.selectedOptions[0]?.textContent)
      };
    }
    return { ...base, value: element.value };
  }

  function hasFilledValue(savedField) {
    // Checkbox desmarcado é um estado deliberado, não ausência de valor.
    if (savedField.inputType === "checkbox") return true;
    if (savedField.inputType === "radio") {
      return savedField.radioGroup
        ? savedField.value !== null && savedField.value !== ""
        : savedField.checked === true;
    }
    if (savedField.multiple) {
      return Array.isArray(savedField.value) && savedField.value.length > 0;
    }
    return savedField.value !== null &&
      savedField.value !== undefined &&
      String(savedField.value).trim() !== "";
  }

  function extractForm(form) {
    const fields = [];
    const processedRadioGroups = new Set();
    for (const element of form.querySelectorAll(FIELD_SELECTOR)) {
      if (!isCapturableField(element)) continue;
      if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
        const groupKey = fieldIdentityKey(element);
        if (processedRadioGroups.has(groupKey)) continue;
        processedRadioGroups.add(groupKey);
      }
      const savedField = serializeField(element);
      if (hasFilledValue(savedField)) {
        fields.push(savedField);
      }
    }

    const identifier = formIdentifier(form);
    const address = pageAddress();
    const identifierKey = `${identifier.type}:${identifier.value}` +
      (identifier.occurrence !== undefined ? `#${identifier.occurrence}` : "");
    return {
      key: `${address}|${identifierKey}`,
      pageAddress: address,
      pageTitle: document.title,
      formIdentifier: identifier,
      displayName: formDisplayName(form, Array.from(document.forms).indexOf(form)),
      fields
    };
  }

  function elementIdentifierValue(element, type) {
    switch (type) {
      case "name": return normalizedText(element.getAttribute("name"));
      case "id": return normalizedText(element.id);
      case "aria-label": return normalizedText(element.getAttribute("aria-label"));
      case "label": return associatedLabel(element);
      case "data-testid": return normalizedText(element.getAttribute("data-testid"));
      case "autocomplete": return normalizedText(element.getAttribute("autocomplete"));
      case "placeholder": return normalizedText(element.getAttribute("placeholder"));
      case "fingerprint": return fieldFingerprint(element);
      default: return "";
    }
  }

  function locateField(form, savedField) {
    const identifiers = [
      savedField.identifier?.primary,
      ...(savedField.identifier?.fallbacks || [])
    ].filter(Boolean);
    const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR)).filter(isSavableField);
    let ambiguousFallback = null;

    for (const identifier of identifiers) {
      let matches = fields.filter(
        (element) => elementIdentifierValue(element, identifier.type) === identifier.value
      );
      if (savedField.elementType) {
        matches = matches.filter(
          (element) => element.tagName.toLowerCase() === savedField.elementType
        );
      }
      if (savedField.inputType && savedField.elementType === "input") {
        matches = matches.filter((element) => element.type === savedField.inputType);
      }
      if (savedField.inputType === "radio" && savedField.radioGroup && matches.length) {
        return matches[0];
      }
      if (savedField.optionValue !== undefined && matches.length > 1) {
        const optionMatches = matches.filter((element) => element.value === savedField.optionValue);
        if (optionMatches.length === 1) return optionMatches[0];
        if (optionMatches.length > 1) matches = optionMatches;
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1 && !ambiguousFallback) ambiguousFallback = matches[0];
    }
    return ambiguousFallback;
  }

  // --- Prontidão do campo --------------------------------------------------

  function isElementVisible(element) {
    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    return Boolean(element.offsetParent) || element.getClientRects().length > 0;
  }

  function findOption(select, value, text) {
    const options = Array.from(select.options);
    const byValue = options.find((option) => option.value === value);
    if (byValue) return byValue;
    if (!text) return null;
    const target = normalizedText(text);
    return options.find((option) => normalizedText(option.textContent) === target) ||
      options.find((option) => compactText(option.textContent) === compactText(target)) ||
      null;
  }

  // Um <select> alimentado por AJAX existe habilitado e vazio: escrever nele não
  // faz nada. Só está pronto quando a opção salva realmente existe.
  function selectHasSavedOption(select, savedField) {
    if (savedField.multiple) {
      const values = Array.isArray(savedField.value) ? savedField.value : [];
      const texts = Array.isArray(savedField.optionTexts) ? savedField.optionTexts : [];
      if (!values.length) return true;
      return values.some((value, index) => findOption(select, value, texts[index]));
    }
    const value = savedField.value;
    if (value === null || value === undefined || value === "") return true;
    return Boolean(findOption(select, value, savedField.optionText));
  }

  // "ready"      → todas as condições atendidas
  // "acceptable" → utilizável, porém invisível ou somente leitura
  // "waiting"    → não adianta escrever ainda
  function fieldReadiness(element, savedField) {
    if (element.disabled) return "waiting";
    if (normalizedText(element.getAttribute("aria-disabled")).toLowerCase() === "true") {
      return "waiting";
    }
    if (element instanceof HTMLSelectElement) {
      if (isDecoratedSelect(element)) {
        // Com a opção já presente, basta escrever no select e mandar o
        // componente se repintar. Sem ela, a lista é remota e só existe
        // dentro do painel: não adianta esperar pelo elemento nativo.
        return selectHasSavedOption(element, savedField) ? "ready" : "acceptable";
      }
      if (!selectHasSavedOption(element, savedField)) return "waiting";
    }
    if (isReadOnlyField(element)) return "acceptable";
    if (!isElementVisible(element)) return "acceptable";
    return "ready";
  }

  // Acorda cedo quando o DOM muda, em vez de dormir um intervalo fixo.
  function createDomWaker() {
    let mutated = false;
    const observer = new MutationObserver(() => {
      mutated = true;
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES
    });
    return {
      next(maximum) {
        mutated = false;
        return new Promise((resolve) => {
          const startedAt = Date.now();
          const tick = () => {
            if (mutated || Date.now() - startedAt >= maximum) {
              resolve();
              return;
            }
            setTimeout(tick, 40);
          };
          setTimeout(tick, 40);
        });
      },
      stop() {
        observer.disconnect();
      }
    };
  }

  async function waitForReadyField(savedForm, savedField, options = {}) {
    const timeout = options.timeout || 8000;
    const startedAt = Date.now();
    const graceAt = startedAt + Math.min(timeout * 0.4, 1500);
    const waker = createDomWaker();
    let acceptable = null;
    let lastSeen = null;
    let retriedPreviousField = false;

    try {
      for (;;) {
        const form = findForm(savedForm.formIdentifier);
        const element = form ? locateField(form, savedField) : null;
        if (form && element) {
          lastSeen = { form, element };
          const readiness = fieldReadiness(element, savedField);
          if (readiness === "ready") return { form, element };
          if (readiness === "acceptable") {
            acceptable = { form, element };
            // Somente leitura não vira gravável com o tempo: não há o que esperar.
            if (isReadOnlyField(element)) return acceptable;
          }
        }

        const now = Date.now();
        if (options.token?.cancelled) return null;
        if (acceptable && now >= graceAt) return acceptable;
        if (now - startedAt >= timeout) break;
        if (options.deadline && now >= options.deadline) break;

        // Validadores assíncronos às vezes só reagem à segunda interação.
        if (!retriedPreviousField && now - startedAt >= 700 && options.previousField) {
          retriedPreviousField = true;
          const previousForm = findForm(savedForm.formIdentifier);
          const previousElement = previousForm
            ? locateField(previousForm, options.previousField)
            : null;
          if (previousForm && previousElement && !previousElement.disabled) {
            const stuckList = element instanceof HTMLSelectElement &&
              element.options.length <= 1 &&
              previousElement instanceof HTMLSelectElement;
            if (stuckList) {
              await forceSelectChange(previousElement, options.previousField);
            } else {
              await applySavedField(previousForm, previousElement, options.previousField);
            }
          }
        }
        await waker.next(POLL_INTERVAL);
      }
    } finally {
      waker.stop();
    }
    // Esgotado o prazo, ainda vale tentar no elemento encontrado: a tentativa
    // fracassada diz exatamente o que havia no campo, e isso vira o motivo
    // relatado ao usuário em vez de um silencioso "não encontrado".
    if (acceptable) return acceptable;
    return lastSeen ? { ...lastSeen, degraded: true } : null;
  }

  // --- Aplicação de valores ------------------------------------------------

  const applied = () => ({ ok: true });
  const failed = (reason) => ({ ok: false, reason });

  function nativeSetter(element, property, value) {
    let prototype = Object.getPrototypeOf(element);
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor?.set) {
        descriptor.set.call(element, value);
        return;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    element[property] = value;
  }

  function focusField(element) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  function dispatchKey(element, type, key) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key,
      bubbles: true,
      composed: true,
      cancelable: true
    }));
  }

  function dispatchInputLike(element, type, value) {
    const event = typeof InputEvent === "function"
      ? new InputEvent(type, {
          bubbles: true,
          composed: true,
          cancelable: type === "beforeinput",
          inputType: "insertReplacementText",
          data: typeof value === "string" ? value : null
        })
      : new Event(type, { bubbles: true, composed: true });
    element.dispatchEvent(event);
  }

  function dispatchChange(element) {
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  // Resumo da lista de um select, usado para explicar por que a opção não coube.
  function optionSummary(select) {
    const texts = Array.from(select.options)
      .map((option) => normalizedText(option.textContent) || option.value)
      .filter(Boolean);
    if (!texts.length) return "a lista estava vazia";
    const shown = texts.slice(0, 6).join(" | ");
    return texts.length > 6 ? shown + " | …(" + texts.length + " opções)" : shown;
  }

  function describeCurrentValue(element) {
    if (element instanceof HTMLSelectElement) {
      const selected = Array.from(element.selectedOptions)
        .map((option) => normalizedText(option.textContent) || option.value);
      return selected.length ? selected.join(", ") : "nada selecionado";
    }
    if (element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")) {
      return element.checked ? "marcado" : "desmarcado";
    }
    return normalizedText(element.value) || "vazio";
  }

  // Máscaras e buscas por CNPJ/CEP costumam reagir a keydown/keyup, não a input.
  async function applyTextValue(element, rawValue, { keepFocus = false } = {}) {
    const value = rawValue === null || rawValue === undefined ? "" : String(rawValue);
    focusField(element);
    const key = value.length ? value[value.length - 1] : "Backspace";
    dispatchKey(element, "keydown", key);
    dispatchInputLike(element, "beforeinput", value);
    nativeSetter(element, "value", value);
    dispatchInputLike(element, "input", value);
    dispatchKey(element, "keyup", key);
    // O React aplica o state de forma assíncrona; sair do campo antes disso
    // dispara a validação de "campo obrigatório" com o campo já preenchido.
    await nextFrame();
    dispatchChange(element);
    if (!keepFocus) element.blur();
    return applied();
  }

  function comboboxListbox(element) {
    const ids = ((element.getAttribute("aria-controls") || "") + " " +
      (element.getAttribute("aria-owns") || ""))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) return node;
    }
    return null;
  }

  function isComboboxField(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    // <datalist> funciona com o valor puro, sem seleção de sugestão.
    if (element.list) return false;
    if (normalizedText(element.getAttribute("role")).toLowerCase() === "combobox") return true;
    if (element.hasAttribute("aria-autocomplete")) return true;
    if (element.matches(COMBOBOX_HINTS)) return true;
    const listbox = comboboxListbox(element);
    if (!listbox) return false;
    const listboxRole = normalizedText(listbox.getAttribute("role")).toLowerCase();
    return listboxRole === "listbox" || listboxRole === "menu" ||
      Boolean(listbox.querySelector("[role='option'], li"));
  }

  function comboboxOptions(element) {
    const listbox = comboboxListbox(element);
    const scope = listbox || document;
    const selector = listbox
      ? "[role='option'], li, [data-value]"
      : "[role='option'], .select2-results__option, .ui-menu-item, .autocomplete-item";
    return Array.from(scope.querySelectorAll(selector))
      .filter((node) => node.getAttribute("aria-disabled") !== "true")
      .filter(isElementVisible);
  }

  async function waitForComboboxOption(element, value) {
    const startedAt = Date.now();
    const target = compactText(value);
    while (Date.now() - startedAt < COMBOBOX_OPTION_TIMEOUT) {
      const options = comboboxOptions(element);
      if (options.length) {
        return options.find((option) => compactText(option.textContent) === target) ||
          options.find((option) => compactText(option.textContent).startsWith(target)) ||
          options[0];
      }
      await wait(100);
    }
    return null;
  }

  function simulatePointer(node) {
    const base = { bubbles: true, composed: true, cancelable: true, view: window };
    node.dispatchEvent(new MouseEvent("mouseover", base));
    if (typeof PointerEvent === "function") {
      node.dispatchEvent(new PointerEvent("pointerdown", base));
    }
    node.dispatchEvent(new MouseEvent("mousedown", base));
    if (typeof PointerEvent === "function") {
      node.dispatchEvent(new PointerEvent("pointerup", base));
    }
    node.dispatchEvent(new MouseEvent("mouseup", base));
    node.dispatchEvent(new MouseEvent("click", base));
  }

  // Campos "digite e escolha na lista" precisam da sugestão clicada; só escrever
  // o texto deixa o identificador interno do portal vazio.
  async function applyComboboxValue(element, savedField) {
    const value = String(savedField.value ?? "");
    // Sair do campo fecharia a lista antes da escolha.
    await applyTextValue(element, value, { keepFocus: true });
    const option = await waitForComboboxOption(element, value);
    if (!option) {
      element.blur();
      return applied();
    }
    simulatePointer(option);
    await nextFrame();
    await wait(80);
    if (document.activeElement === element) element.blur();
    return applied();
  }

  async function applyRadioGroup(form, element, savedField) {
    const group = radioGroupFor(form, element);
    const selected = group.find((radio) => radio.value === savedField.value);
    if (!selected) {
      const available = group.map((radio) => radio.value).join(" | ") || "nenhuma";
      return failed(
        "a opção \"" + savedField.value + "\" não existe no grupo. Opções: " + available
      );
    }
    if (selected.disabled) return failed("a opção estava bloqueada");
    if (!selected.checked) {
      focusField(selected);
      selected.click();
    } else {
      focusField(selected);
      dispatchInputLike(selected, "input", savedField.value);
      dispatchChange(selected);
    }
    await nextFrame();
    selected.blur();
    return applied();
  }

  async function applyToggle(element, savedField) {
    const shouldBeChecked = Boolean(savedField.checked);
    focusField(element);
    let usedClick = false;
    if (element.checked !== shouldBeChecked) {
      element.click();
      usedClick = true;
    }
    if (element.checked !== shouldBeChecked) {
      nativeSetter(element, "checked", shouldBeChecked);
      dispatchInputLike(element, "input", null);
      dispatchChange(element);
    } else if (!usedClick) {
      dispatchInputLike(element, "input", null);
      dispatchChange(element);
    }
    await nextFrame();
    element.blur();
    return applied();
  }

  async function applyMultiSelect(element, savedField) {
    const values = Array.isArray(savedField.value) ? savedField.value : [];
    const texts = Array.isArray(savedField.optionTexts) ? savedField.optionTexts : [];
    const wanted = new Set();
    values.forEach((value, index) => {
      const option = findOption(element, value, texts[index]);
      if (option) wanted.add(option);
    });
    if (!wanted.size && values.length) {
      return failed("nenhuma das opções salvas existe na lista. Opções: " + optionSummary(element));
    }
    focusField(element);
    for (const option of element.options) {
      option.selected = wanted.has(option);
    }
    dispatchInputLike(element, "input", null);
    await nextFrame();
    dispatchChange(element);
    element.blur();
    return applied();
  }

  // Alguns componentes acompanham a propriedade selected da option, não o value.
  function selectOption(element, option) {
    nativeSetter(element, "value", option.value);
    for (const item of element.options) {
      item.selected = item === option;
    }
    dispatchInputLike(element, "input", option.value);
    dispatchChange(element);
    notifyDecorator(element);
  }

  // Eventos personalizados que as bibliotecas de dropdown usam para reler o
  // select. São inofensivos onde não existem: ninguém os escuta.
  const DECORATOR_EVENTS = ["chosen:updated", "change.select2", "liszt:updated"];

  function notifyDecorator(element) {
    for (const name of DECORATOR_EVENTS) {
      element.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    }
  }

  async function applySingleSelect(element, savedField) {
    if (isDecoratedSelect(element)) {
      return applyDecoratedSelect(element, savedField);
    }
    const option = findOption(element, savedField.value, savedField.optionText);
    if (!option) {
      const wanted = savedField.optionText
        ? "\"" + savedField.optionText + "\" (valor " + savedField.value + ")"
        : "de valor \"" + savedField.value + "\"";
      return failed("a opção " + wanted + " não existe na lista. Opções: " + optionSummary(element));
    }
    focusField(element);
    selectOption(element, option);
    await nextFrame();
    dispatchChange(element);
    element.blur();
    return applied();
  }

  function isDecoratedSelect(element) {
    if (!(element instanceof HTMLSelectElement)) return false;
    if (!isElementVisible(element)) return true;
    if (element.getAttribute("aria-hidden") === "true") return true;
    if (element.classList.contains("select2-hidden-accessible")) return true;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return true;
    return false;
  }

  function findWidgetTrigger(select) {
    let node = select.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const candidate = Array.from(node.querySelectorAll(WIDGET_TRIGGER_HINTS))
        .find(isElementVisible);
      if (candidate) return candidate;
    }
    // Componente sob medida, sem classe conhecida: o ancestral visível mais
    // próximo costuma receber o clique e repassá-lo por propagação.
    node = select.parentElement;
    while (node && node !== document.body) {
      if (isElementVisible(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function widgetDisplayText(trigger) {
    return trigger ? normalizedText(trigger.textContent) : "";
  }

  // Os componentes com busca focam o campo de digitação ao abrir; é o sinal
  // mais confiável para encontrá-lo sem depender da estrutura do painel.
  function focusedSearchInput(select) {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement &&
      active !== select &&
      !active.disabled &&
      !EXCLUDED_INPUT_TYPES.has(active.type) &&
      isElementVisible(active)) {
      return active;
    }
    return null;
  }

  function visibleWidgetOptions() {
    return Array.from(document.querySelectorAll(WIDGET_OPTION_HINTS))
      .filter((node) => node.getAttribute("aria-disabled") !== "true")
      .filter(isElementVisible);
  }

  const NO_RESULT_MARKERS = [
    ".select2-results__message",
    ".chosen-no-results",
    ".ng-dropdown-panel .ng-option-disabled",
    ".selectize-dropdown .no-results"
  ].join(",");

  const NO_RESULT_TEXT = new RegExp(
    "(nao foram encontrados|nenhum resultado|sem resultados|no results|nothing found)"
  );

  // "Carregando…" e "Não foram encontrados resultados" ocupam o mesmo lugar no
  // painel; só o segundo encerra a espera.
  function widgetReportsNoResults() {
    return Array.from(document.querySelectorAll(NO_RESULT_MARKERS))
      .filter(isElementVisible)
      .some((node) => NO_RESULT_TEXT.test(compactText(node.textContent)));
  }

  // Nunca escolhe "a primeira da lista": um município errado é pior do que um
  // campo vazio, então só um casamento exato ou um prefixo único é aceito.
  async function waitForWidgetOption(wanted) {
    const target = compactText(wanted);
    const startedAt = Date.now();
    while (Date.now() - startedAt < WIDGET_PANEL_TIMEOUT) {
      const options = visibleWidgetOptions();
      const exact = options.find((option) => compactText(option.textContent) === target);
      if (exact) return exact;
      const prefixed = options.filter(
        (option) => compactText(option.textContent).startsWith(target)
      );
      if (prefixed.length === 1) return prefixed[0];
      // Passados os primeiros instantes, um "nada encontrado" é definitivo
      // para este termo e adianta partir para o próximo.
      if (Date.now() - startedAt >= 600 && widgetReportsNoResults()) return null;
      await wait(120);
    }
    return null;
  }

  const TERM_SEPARATOR = new RegExp("[-\u2013\u2014/(]");
  const TERM_LIMIT = 24;

  // Corta no limite sem partir palavra ao meio: metade de uma palavra costuma
  // não casar com a busca do servidor.
  function clipTerm(text) {
    const trimmed = text.trim();
    if (trimmed.length <= TERM_LIMIT) return trimmed;
    const cut = trimmed.slice(0, TERM_LIMIT);
    const space = cut.lastIndexOf(" ");
    return (space >= 4 ? cut.slice(0, space) : cut).trim();
  }

  // "01.01.01 - Análise e desenvolvimento" rende três tentativas: o código, a
  // descrição e, por último, o texto cru. Buscas remotas indexam ora um, ora
  // outro, e a escolha continua exigindo casamento exato do texto completo.
  function searchTerms(wanted) {
    const head = wanted.split(TERM_SEPARATOR)[0];
    const tail = wanted.slice(head.length).replace(TERM_SEPARATOR, "");
    const terms = [];
    if (head.trim().length >= 3) terms.push(clipTerm(head));
    if (tail.trim().length >= 3) terms.push(clipTerm(tail));
    terms.push(clipTerm(wanted));
    return Array.from(new Set(terms)).filter(Boolean);
  }

  function closeWidget(trigger) {
    const key = { key: "Escape", bubbles: true, composed: true, cancelable: true };
    (trigger || document.body).dispatchEvent(new KeyboardEvent("keydown", key));
    document.body.dispatchEvent(new KeyboardEvent("keydown", key));
  }

  async function applyDecoratedSelect(select, savedField) {
    const option = findOption(select, savedField.value, savedField.optionText);
    const wanted = normalizedText(savedField.optionText) ||
      normalizedText(option?.textContent);
    const trigger = findWidgetTrigger(select);

    // Alguns componentes acompanham o change do select nativo; se der certo,
    // não há motivo para abrir o painel.
    if (option) {
      focusField(select);
      selectOption(select, option);
      await nextFrame();
      await wait(150);
      if (!wanted || compactText(widgetDisplayText(trigger)).includes(compactText(wanted))) {
        return applied();
      }
    }

    if (!wanted) {
      return failed(
        "é um componente com lista própria e o texto da opção não está salvo. " +
        "Salve o formulário novamente para gravar o texto da opção"
      );
    }
    if (!trigger) return failed("não foi possível localizar o componente visível deste campo");

    simulatePointer(trigger);
    await nextFrame();
    await wait(200);

    const search = focusedSearchInput(select);
    if (!search) {
      // Componente sem busca: a lista já está toda no painel.
      const single = await waitForWidgetOption(wanted);
      if (!single) {
        closeWidget(trigger);
        return failed("a lista do componente não trouxe \"" + wanted + "\"");
      }
      simulatePointer(single);
      await nextFrame();
      await wait(250);
      return applied();
    }

    const tried = [];
    for (const term of searchTerms(wanted)) {
      tried.push(term);
      await applyTextValue(search, term, { keepFocus: true });
      await wait(350);
      const choice = await waitForWidgetOption(wanted);
      if (choice) {
        simulatePointer(choice);
        await nextFrame();
        await wait(250);
        return applied();
      }
      if (!isElementVisible(search)) break;
    }

    closeWidget(trigger);
    return failed(
      "a busca do componente não trouxe \"" + wanted + "\" " +
      "(termos tentados: " + tried.join(", ") + ")"
    );
  }

  // Quando o valor salvo já era o valor corrente, o framework não enxerga
  // mudança e o carregador da lista dependente nunca roda. Passar por outra
  // opção e voltar produz a mudança real que destrava a cadeia.
  async function forceSelectChange(element, savedField) {
    const target = findOption(element, savedField.value, savedField.optionText);
    if (!target) return;
    const other = Array.from(element.options).find((option) => option !== target);
    if (other) {
      selectOption(element, other);
      await nextFrame();
      await wait(120);
    }
    selectOption(element, target);
    await nextFrame();
  }

  async function applySavedField(form, element, savedField) {
    if (isReadOnlyField(element)) {
      return {
        ok: false,
        skipped: true,
        reason: "o próprio site calcula este campo"
      };
    }
    if (savedField.inputType === "radio" && savedField.radioGroup) {
      return applyRadioGroup(form, element, savedField);
    }
    if (savedField.inputType === "checkbox" ||
      (savedField.inputType === "radio" && !savedField.radioGroup)) {
      return applyToggle(element, savedField);
    }
    if (element instanceof HTMLSelectElement) {
      return savedField.multiple
        ? applyMultiSelect(element, savedField)
        : applySingleSelect(element, savedField);
    }
    if (isComboboxField(element)) {
      return applyComboboxValue(element, savedField);
    }
    return applyTextValue(element, savedField.value);
  }

  // --- Conferência do resultado --------------------------------------------

  function valuesEquivalent(actual, expected, alternate) {
    const left = normalizedText(actual);
    const right = normalizedText(expected);
    if (left === right) return true;
    if (alternate && left === normalizedText(alternate)) return true;
    // Máscaras (CNPJ, CEP, telefone) alteram a pontuação, não os dados.
    const compactLeft = compactText(left);
    if (compactLeft && compactLeft === compactText(right)) return true;
    if (alternate && compactLeft && compactLeft === compactText(alternate)) return true;
    return false;
  }

  function fieldMatchesSaved(element, savedField) {
    if (savedField.inputType === "radio" && savedField.radioGroup) {
      const form = element.form;
      if (!form) return false;
      const selected = radioGroupFor(form, element).find((radio) => radio.checked);
      return (selected?.value ?? null) === savedField.value;
    }
    if (savedField.inputType === "checkbox" ||
      (savedField.inputType === "radio" && !savedField.radioGroup)) {
      return element.checked === Boolean(savedField.checked);
    }
    if (element instanceof HTMLSelectElement && savedField.multiple) {
      const texts = Array.isArray(savedField.optionTexts) ? savedField.optionTexts : [];
      const values = Array.isArray(savedField.value) ? savedField.value : [];
      const selected = new Set(Array.from(element.selectedOptions));
      return values.every((value, index) => {
        const option = findOption(element, value, texts[index]);
        // Uma opção que nem existe mais não conta como divergência.
        return !option || selected.has(option);
      });
    }
    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions[0];
      if (!selected) return false;
      const valueMatches = valuesEquivalent(selected.value, savedField.value, null) ||
        (Boolean(savedField.optionText) &&
          normalizedText(selected.textContent) === normalizedText(savedField.optionText));
      if (!valueMatches) return false;
      // Num select decorado, o valor certo no elemento escondido não prova que
      // o componente visível — e o modelo do site — receberam a escolha.
      if (isDecoratedSelect(element)) {
        const shown = compactText(widgetDisplayText(findWidgetTrigger(element)));
        const expected = compactText(
          normalizedText(savedField.optionText) || normalizedText(selected.textContent)
        );
        if (shown && expected) return shown.includes(expected);
      }
      return true;
    }
    return valuesEquivalent(element.value, savedField.value, null);
  }

  // Escrever não é o mesmo que ficar escrito: máscara, re-render ou validação
  // assíncrona podem descartar o valor. Confere e tenta de novo.
  async function applyAndVerify(savedForm, target, savedField, token) {
    let form = target.form;
    let element = target.element;
    let lastFailure = null;

    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
      if (token?.cancelled) return failed("preenchimento cancelado");
      const result = await applySavedField(form, element, savedField);
      if (!result.ok) return result;

      await nextFrame();
      await wait(60);

      const currentForm = findForm(savedForm.formIdentifier);
      const currentElement = currentForm ? locateField(currentForm, savedField) : null;
      // O campo sumiu logo após ser escrito; a varredura final decide.
      if (!currentElement) return applied();
      if (fieldMatchesSaved(currentElement, savedField)) return applied();

      lastFailure = "o site descartou o valor; o campo ficou com \"" +
        describeCurrentValue(currentElement) + "\"";
      if (currentElement.disabled) {
        return failed("o campo foi bloqueado logo depois de receber o valor");
      }

      form = currentForm;
      element = currentElement;
    }
    return failed(lastFailure || "o valor não foi aceito após várias tentativas");
  }

  // --- Orquestração do preenchimento ---------------------------------------

  // Radio, checkbox e select são os gatilhos típicos de uma etapa nova, e a
  // etapa costuma custar uma ida ao servidor: o campo seguinte merece prazo
  // maior já na primeira passada.
  const REVEALING_TYPES = new Set(["radio", "checkbox", "select"]);

  function timeoutForField(passOptions, previousField) {
    if (previousField && REVEALING_TYPES.has(previousField.inputType)) {
      return Math.max(passOptions.timeout, 6000);
    }
    return passOptions.timeout;
  }

  async function runFillPass(savedForm, indices, passOptions, context) {
    let previousField = null;

    for (const index of indices) {
      if (context.token.cancelled || Date.now() >= context.deadline) break;
      const field = savedForm.fields[index];

      context.processed += 1;
      const attempt = context.pass > 0 ? " · " + (context.pass + 1) + "ª tentativa" : "";
      context.status.update(
        context.processed + "/" + context.total + attempt + " · " + savedFieldLabel(field)
      );

      const target = await waitForReadyField(savedForm, field, {
        timeout: timeoutForField(passOptions, previousField),
        previousField,
        token: context.token,
        deadline: context.deadline
      });
      if (!target) {
        // Um campo variável que nunca aparece não pertence a esta nota; não é
        // falha, é assunto de outra emissão.
        if (field.variable) {
          context.ignored.set(index, "não faz parte desta nota");
        } else {
          context.reasons.set(index, "o campo não apareceu na página a tempo");
        }
        continue;
      }

      if (field.variable) {
        const informado = await askForVariableValue(field);
        if (informado === null) {
          context.token.cancelled = true;
          break;
        }
        const value = normalizedText(informado);
        if (!value) {
          context.ignored.set(index, "deixado em branco");
          continue;
        }
        // A resposta vira valor comum: as passadas seguintes não perguntam de novo.
        const { variable, variableLabel, variableKind, ...resto } = field;
        savedForm.fields[index] = { ...resto, value };
      }

      const result = await applyAndVerify(
        savedForm,
        target,
        savedForm.fields[index],
        context.token
      );
      if (!result.ok) {
        if (result.skipped) {
          context.ignored.set(index, result.reason);
        } else {
          context.reasons.set(index, result.reason);
        }
        continue;
      }

      context.reasons.delete(index);
      context.applied.add(index);
      previousField = savedForm.fields[index];
      await nextFrame();
      await wait(FIELD_SETTLE_DELAY);
    }
  }

  // Índices que ainda merecem outra passada. O que foi ignorado sai da fila:
  // insistir só gastaria o tempo de espera de novo.
  function pendingIndices(savedForm, context) {
    const form = findForm(savedForm.formIdentifier);
    const todos = savedForm.fields.map((campo, index) => index);
    return todos.filter((index) => {
      if (context.ignored.has(index)) return false;
      const field = savedForm.fields[index];
      if (field.variable) return true;
      if (!form) return true;
      const element = locateField(form, field);
      return !element || !fieldMatchesSaved(element, field);
    });
  }

  async function runFill(entrada, token, status) {
    // Cópia de trabalho: respostas dos campos variáveis entram aqui e valem
    // para as passadas seguintes, sem tocar no que está guardado.
    const savedForm = { ...entrada, fields: [...(entrada.fields || [])] };
    const context = {
      token,
      status,
      deadline: Date.now() + GLOBAL_FILL_TIMEOUT,
      total: savedForm.fields.length,
      processed: 0,
      applied: new Set(),
      reasons: new Map(),
      ignored: new Map(),
      pass: 0
    };

    let pending = savedForm.fields.map((campo, index) => index);
    for (let pass = 0; pass < PASS_TIMEOUTS.length && pending.length; pass += 1) {
      if (token.cancelled || Date.now() >= context.deadline) break;
      context.pass = pass;
      await runFillPass(savedForm, pending, { timeout: PASS_TIMEOUTS[pass] }, context);
      // Cada passada revisa tudo: campos zerados por uma reação tardia do site
      // voltam para a fila junto com os que nunca ficaram prontos.
      const remaining = pendingIndices(savedForm, context);
      const progressed = remaining.length < pending.length;
      pending = remaining;
      context.processed = 0;
      context.total = pending.length;
      // Uma cadeia de listas dependentes destrava um elo por rodada; sem
      // nenhum elo novo, insistir só gasta o tempo do usuário.
      if (pass + 1 >= MINIMUM_PASSES && !progressed) break;
    }

    const form = findForm(savedForm.formIdentifier);
    const verified = [];
    const unverified = [];
    const ignored = [];
    const missing = [];
    savedForm.fields.forEach((field, index) => {
      if (context.ignored.has(index)) {
        ignored.push({ field, reason: context.ignored.get(index) });
        return;
      }
      const element = form ? locateField(form, field) : null;
      if (element && fieldMatchesSaved(element, field)) {
        verified.push({ field });
      } else if (context.applied.has(index)) {
        unverified.push({ field });
      } else {
        missing.push({
          field,
          reason: context.reasons.get(index) || "o campo não apareceu na página a tempo"
        });
      }
    });

    return {
      ok: true,
      cancelled: token.cancelled,
      filled: verified.length,
      unverified: unverified.length,
      ignored: ignored.length,
      missing: missing.length,
      // Campo ignorado não é tarefa pendente: sai da conta do total.
      total: savedForm.fields.length - ignored.length,
      missingFields: missing.map((item) => ({
        label: savedFieldLabel(item.field),
        reason: item.reason
      })),
      ignoredFields: ignored.map((item) => ({
        label: savedFieldLabel(item.field),
        reason: item.reason
      })),
      unverifiedFields: unverified.map(({ field }) => savedFieldLabel(field))
    };
  }

  function describeMissingFields(fields) {
    return (fields || [])
      .map((item) => (item.reason ? item.label + " (" + item.reason + ")" : item.label))
      .join("; ");
  }

  function describeFillResult(result) {
    if (result.cancelled) {
      return {
        message: "Preenchimento cancelado. " + result.filled + " campo(s) preenchido(s).",
        kind: "info"
      };
    }
    const parts = [result.filled + " de " + result.total + " campo(s) preenchido(s)."];
    if (result.unverified) {
      parts.push(
        result.unverified + " sem confirmação: " + result.unverifiedFields.join(", ") + "."
      );
    }
    if (result.ignored) {
      parts.push("Ignorado(s): " + describeMissingFields(result.ignoredFields) + ".");
    }
    if (result.missing) {
      parts.push("Faltou preencher: " + describeMissingFields(result.missingFields) + ".");
    }
    return {
      message: parts.join(" "),
      kind: result.missing ? "error" : result.unverified ? "info" : "success"
    };
  }

  async function fillForm(savedForm) {
    if (savedForm.pageAddress !== pageAddress()) {
      return { ok: false, error: "O formulário salvo não corresponde à página atual." };
    }
    if (!findForm(savedForm.formIdentifier)) {
      return { ok: false, error: "O formulário salvo não foi encontrado nesta página." };
    }
    if (activeFill) {
      return { ok: false, error: "Já existe um preenchimento em andamento nesta página." };
    }

    const token = { cancelled: false };
    activeFill = token;
    try {
      const stopCache = beginIdentifierCache();
      const status = createFillStatus(() => {
        token.cancelled = true;
      });
      try {
        const result = await runFill(savedForm, token, status);
        const described = describeFillResult(result);
        status.finish(described.message, described.kind);
        return result;
      } catch (error) {
        status.finish("Falha ao preencher o formulário.", "error");
        throw error;
      } finally {
        stopCache();
      }
    } finally {
      activeFill = null;
    }
  }

  // --- Interface na página -------------------------------------------------

  function overlayShell() {
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(15,23,42,.42)",
      "display:flex", "align-items:center", "justify-content:center", "font-family:Arial,sans-serif"
    ].join(";");
    const panel = document.createElement("div");
    panel.style.cssText = [
      "width:min(420px,calc(100vw - 32px))", "max-height:calc(100vh - 32px)", "overflow:auto",
      "background:#fff", "color:#172033", "border-radius:14px", "box-shadow:0 20px 60px rgba(0,0,0,.28)",
      "padding:20px", "box-sizing:border-box"
    ].join(";");
    overlay.append(panel);
    document.documentElement.append(overlay);
    return { overlay, panel };
  }

  function button(label, primary = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.style.cssText = [
      "border:1px solid #cbd5e1", `background:${primary ? "#2563eb" : "#fff"}`,
      `color:${primary ? "#fff" : "#172033"}`, "border-radius:8px", "padding:9px 13px",
      "font:600 14px Arial,sans-serif", "cursor:pointer"
    ].join(";");
    return element;
  }

  // O popup fecha ao perder o foco; o progresso precisa viver na própria página.
  function createFillStatus(onCancel) {
    document.getElementById("form-saver-status")?.remove();
    const panel = document.createElement("div");
    panel.id = "form-saver-status";
    panel.style.cssText = [
      "position:fixed", "right:20px", "bottom:20px", "z-index:2147483647",
      "background:#1e293b", "color:#fff", "border-radius:10px", "padding:12px 16px",
      "max-width:min(420px,calc(100vw - 40px))", "box-shadow:0 10px 30px rgba(0,0,0,.25)",
      "font:600 14px/1.4 Arial,sans-serif", "display:flex", "align-items:center", "gap:12px"
    ].join(";");
    const text = document.createElement("span");
    text.textContent = "Preenchendo…";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    cancel.style.cssText = [
      "border:1px solid rgba(255,255,255,.5)", "background:transparent", "color:#fff",
      "border-radius:8px", "padding:5px 10px", "font:600 13px Arial,sans-serif", "cursor:pointer"
    ].join(";");
    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      text.textContent = "Cancelando…";
      onCancel();
    });
    panel.append(text, cancel);
    document.documentElement.append(panel);

    return {
      update(message) {
        text.textContent = `Preenchendo ${message}`;
      },
      finish(message, kind) {
        cancel.remove();
        text.textContent = message;
        panel.style.background = kind === "error"
          ? "#b91c1c"
          : kind === "success" ? "#047857" : "#1e293b";
        setTimeout(() => panel.remove(), kind === "error" ? 30000 : 8000);
      }
    };
  }

  // Um campo que não pertence ao formulário padrão do portal pode ser uma
  // particularidade da prefeitura, e nesse caso vale para todo mundo, ou um
  // dado só daquela empresa. Só quem está salvando sabe dizer.
  function askAboutSharedFields(fields) {
    return new Promise((resolve) => {
      const { overlay, panel } = overlayShell();
      const title = document.createElement("h2");
      title.textContent = fields.length === 1
        ? "Um campo fora do formulário padrão"
        : `${fields.length} campos fora do formulário padrão`;
      title.style.cssText = "font:700 18px Arial,sans-serif;margin:0 0 6px";
      const hint = document.createElement("p");
      hint.textContent =
        "Marque os que devem valer como padrão para todos os usuários. " +
        "Os não marcados ficam guardados apenas nesta empresa.";
      hint.style.cssText = "font:14px/1.5 Arial,sans-serif;color:#64748b;margin:0 0 16px";
      panel.append(title, hint);

      const caixas = [];
      for (const field of fields) {
        const linha = document.createElement("label");
        linha.style.cssText = [
          "align-items:flex-start", "border:1px solid #e1e1e1", "border-radius:8px",
          "cursor:pointer", "display:flex", "gap:10px", "margin:0 0 8px", "padding:10px 12px"
        ].join(";");
        const caixa = document.createElement("input");
        caixa.type = "checkbox";
        caixa.style.cssText = "margin:2px 0 0";
        const texto = document.createElement("span");
        texto.textContent = field.label;
        texto.style.cssText = "font:14px/1.4 Arial,sans-serif;color:#222";
        linha.append(caixa, texto);
        panel.append(linha);
        caixas.push({ key: field.key, caixa });
      }

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px";
      const nenhum = button("Só nesta empresa");
      const confirmar = button("Salvar", true);
      nenhum.addEventListener("click", () => {
        overlay.remove();
        resolve([]);
      });
      confirmar.addEventListener("click", () => {
        const escolhidos = caixas.filter((item) => item.caixa.checked).map((item) => item.key);
        overlay.remove();
        resolve(escolhidos);
      });
      actions.append(nenhum, confirmar);
      panel.append(actions);
    });
  }

  function todayAsDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return day + "/" + month + "/" + now.getFullYear();
  }

  // A máscara do portal lê o que se digita como centavos: "5000" vira 50,00.
  // Formatar aqui faz o diálogo mostrar exatamente o que vai para a página.
  function formatMoney(bruto) {
    const digitos = String(bruto).replace(/[^0-9]/g, "").replace(/^0+/, "");
    const acolchoado = (digitos || "0").padStart(3, "0");
    const centavos = acolchoado.slice(-2);
    const inteiros = acolchoado
      .slice(0, -2)
      .replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ".");
    return inteiros + "," + centavos;
  }

  function variableFieldControl(savedField) {
    if (savedField.variableKind === "text") {
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.style.cssText = [
        "width:100%", "box-sizing:border-box", "border:1px solid #cbd5e1",
        "border-radius:8px", "padding:8px 10px", "font:14px/1.45 Arial,sans-serif",
        "resize:vertical"
      ].join(";");
      return textarea;
    }
    const input = document.createElement("input");
    input.type = "text";
    if (savedField.variableKind === "date") {
      input.value = todayAsDate();
      input.placeholder = "dd/mm/aaaa";
    } else if (savedField.variableKind === "money") {
      input.placeholder = "0,00";
      input.inputMode = "numeric";
      input.addEventListener("input", () => {
        // Apagar tudo tem de deixar o campo vazio, que é como se pede para
        // não mexer nele. Formatar aqui devolveria "0,00" e preencheria zero.
        if (!/[0-9]/.test(input.value)) {
          input.value = "";
          return;
        }
        const posicaoDoFim = input.value.length - input.selectionStart;
        input.value = formatMoney(input.value);
        const novaPosicao = Math.max(0, input.value.length - posicaoDoFim);
        input.setSelectionRange(novaPosicao, novaPosicao);
      });
    }
    input.style.cssText = [
      "width:100%", "box-sizing:border-box", "border:1px solid #cbd5e1",
      "border-radius:8px", "padding:9px 10px", "font:14px Arial,sans-serif"
    ].join(";");
    return input;
  }

  // Campos que mudam a cada nota não ficam guardados; são pedidos no momento em
  // que o campo aparece de verdade na página. Perguntar tudo de antemão levava
  // a pedir coisas que não entram nesta nota — a data do evento, por exemplo,
  // continua salva de uma emissão antiga mesmo com o bloco de evento fechado.
  // Devolve o texto informado, "" para deixar como está, ou null se cancelou.
  function askForVariableValue(savedField) {
    return new Promise((resolve) => {
      const { overlay, panel } = overlayShell();
      const title = document.createElement("h2");
      title.textContent = "Dados desta nota";
      title.style.cssText = "font:700 18px Arial,sans-serif;margin:0 0 6px";
      const hint = document.createElement("p");
      hint.textContent = "Este campo muda a cada emissão e não fica guardado.";
      hint.style.cssText = "font:14px/1.5 Arial,sans-serif;color:#64748b;margin:0 0 16px";

      const wrapper = document.createElement("label");
      wrapper.style.cssText = "display:block;margin:0 0 14px";
      const caption = document.createElement("span");
      caption.textContent = savedField.variableLabel || savedFieldLabel(savedField);
      caption.style.cssText =
        "display:block;font:600 13px Arial,sans-serif;color:#334155;margin:0 0 6px";
      const control = variableFieldControl(savedField);
      wrapper.append(caption, control);

      const note = document.createElement("p");
      note.textContent = "Em branco: o campo fica como está na página.";
      note.style.cssText = "font:12px/1.5 Arial,sans-serif;color:#94a3b8;margin:0 0 16px";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
      const cancel = button("Cancelar preenchimento");
      const confirm = button("Continuar", true);
      cancel.addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
      confirm.addEventListener("click", () => {
        const value = control.value;
        overlay.remove();
        resolve(value);
      });
      control.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || savedField.variableKind === "text") return;
        event.preventDefault();
        confirm.click();
      });
      actions.append(cancel, confirm);
      panel.append(title, hint, wrapper, note, actions);
      control.focus();
    });
  }

  function pickForm(forms) {
    return new Promise((resolve) => {
      const { overlay, panel } = overlayShell();
      const title = document.createElement("h2");
      title.textContent = "Selecione o formulário";
      title.style.cssText = "font:700 18px Arial,sans-serif;margin:0 0 6px";
      const hint = document.createElement("p");
      hint.textContent = "A página contém mais de um formulário.";
      hint.style.cssText = "font:14px Arial,sans-serif;color:#64748b;margin:0 0 14px";
      panel.append(title, hint);

      for (const item of forms) {
        const choice = button(`${item.displayName} · ${item.fieldCount} campo(s)`);
        choice.style.cssText += ";display:block;width:100%;text-align:left;margin:8px 0";
        choice.addEventListener("click", () => {
          overlay.remove();
          resolve(item.identifier);
        });
        panel.append(choice);
      }
      const cancel = button("Cancelar");
      cancel.style.cssText += ";margin-top:8px";
      cancel.addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
      panel.append(cancel);
    });
  }

  function confirmAction({ title, message, confirmLabel }) {
    return new Promise((resolve) => {
      const { overlay, panel } = overlayShell();
      const heading = document.createElement("h2");
      heading.textContent = title || "Confirmar ação";
      heading.style.cssText = "font:700 18px Arial,sans-serif;margin:0 0 8px";
      const text = document.createElement("p");
      text.textContent = message || "Deseja continuar?";
      text.style.cssText = "font:14px/1.5 Arial,sans-serif;color:#475569;margin:0 0 18px";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
      const cancel = button("Cancelar");
      const confirm = button(confirmLabel || "Confirmar", true);
      cancel.addEventListener("click", () => {
        overlay.remove();
        resolve(false);
      });
      confirm.addEventListener("click", () => {
        overlay.remove();
        resolve(true);
      });
      actions.append(cancel, confirm);
      panel.append(heading, text, actions);
    });
  }

  function showToast(message, kind = "info") {
    document.getElementById("form-saver-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "form-saver-toast";
    const background = kind === "error" ? "#b91c1c" : kind === "success" ? "#047857" : "#1e293b";
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed", "right:20px", "bottom:20px", "z-index:2147483647", `background:${background}`,
      "color:white", "border-radius:10px", "padding:12px 16px", "max-width:min(420px,calc(100vw - 40px))",
      "box-shadow:0 10px 30px rgba(0,0,0,.25)", "font:600 14px/1.4 Arial,sans-serif"
    ].join(";");
    document.documentElement.append(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  async function chooseCurrentForm({ preferContext = false, allowPicker = false } = {}) {
    const forms = Array.from(document.forms);
    if (!forms.length) return null;

    if (preferContext && lastContextForm?.pageAddress === pageAddress()) {
      const contextual = findForm(lastContextForm.identifier);
      if (contextual) return contextual;
    }
    const focused = document.activeElement?.closest?.("form");
    if (focused) return focused;
    if (forms.length === 1) return forms[0];
    if (!allowPicker) return null;

    const selection = await pickForm(describeForms());
    return selection ? findForm(selection) : null;
  }

  document.addEventListener("contextmenu", (event) => {
    const form = event.target?.closest?.("form");
    lastContextForm = form
      ? { pageAddress: pageAddress(), identifier: formIdentifier(form) }
      : null;
  }, true);

  // --- Mensagens -----------------------------------------------------------
  // Com all_frames, todo frame recebe a mensagem. Só responde o frame que tem o
  // formulário; o frame principal responde por último, como rede de segurança,
  // para que o remetente nunca fique sem resposta.

  const FORM_MESSAGES = new Set([
    "GET_PAGE_CONTEXT",
    "GET_CURRENT_FORM",
    "EXTRACT_CURRENT_FORM"
  ]);
  const hasChildFrames = () => window.frames.length > 0;

  function frameOwnsMessage(message) {
    if (FORM_MESSAGES.has(message.type)) {
      return document.forms.length > 0;
    }
    if (message.type === "FILL_FORM") {
      return message.savedForm?.pageAddress === pageAddress() &&
        Boolean(findForm(message.savedForm.formIdentifier));
    }
    if (message.type === "CANCEL_FILL") return Boolean(activeFill);
    if (message.type === "SHOW_TOAST" ||
      message.type === "CONFIRM_ACTION" ||
      message.type === "CONFIRM_SHARED_FIELDS") {
      return isTopFrame;
    }
    return false;
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "GET_PAGE_CONTEXT": {
        const form = await chooseCurrentForm({ preferContext: false, allowPicker: false });
        return {
          ok: true,
          pageAddress: pageAddress(),
          pageTitle: document.title,
          forms: describeForms(),
          selectedForm: form ? formIdentifier(form) : null
        };
      }
      case "GET_CURRENT_FORM": {
        const form = await chooseCurrentForm(message);
        return form
          ? { ok: true, pageAddress: pageAddress(), form: { identifier: formIdentifier(form) } }
          : { ok: false, error: "Não foi possível identificar um formulário." };
      }
      case "EXTRACT_CURRENT_FORM": {
        const form = message.formIdentifier
          ? findForm(message.formIdentifier)
          : await chooseCurrentForm(message);
        return form
          ? { ok: true, form: extractForm(form) }
          : { ok: false, error: "Não foi possível identificar um formulário." };
      }
      case "FILL_FORM":
        return fillForm(message.savedForm);
      case "CANCEL_FILL": {
        const running = Boolean(activeFill);
        if (activeFill) activeFill.cancelled = true;
        return { ok: true, cancelled: running };
      }
      case "CONFIRM_ACTION":
        return { confirmed: await confirmAction(message) };
      case "CONFIRM_SHARED_FIELDS":
        return { ok: true, keys: await askAboutSharedFields(message.fields || []) };
      case "SHOW_TOAST":
        showToast(message.message, message.kind);
        return { ok: true };
      default:
        return null;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const owns = frameOwnsMessage(message || {});
    // Um preenchimento leva dezenas de segundos e o remetente aceita a primeira
    // resposta que chegar: o frame principal só pode responder por ele quando
    // não existe outro frame capaz de ser o dono.
    const fallback = isTopFrame && (
      FORM_MESSAGES.has(message?.type) ||
      ((message?.type === "FILL_FORM" || message?.type === "CANCEL_FILL") && !hasChildFrames())
    );
    // Frames sem relação com a mensagem devolvem false para liberar a porta.
    if (!owns && !fallback) return false;

    const respond = async () => {
      // Atraso curto no frame principal para o frame dono responder primeiro.
      if (!owns) await wait(250);
      return handleMessage(message);
    };

    respond()
      .then((response) => {
        sendResponse(response || {
          ok: false,
          error: "Nenhum formulário disponível nesta página."
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
