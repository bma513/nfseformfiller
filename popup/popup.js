import {
  STEPS,
  countVariableFields,
  fieldDisplayLabel,
  mergeSharedFields,
  nfseStep,
  stepOrder,
  unknownFields
} from "../lib/nfse.js";

const app = document.getElementById("app");
const feedback = document.getElementById("feedback");

let dados = { users: {}, sharedFields: {} };
let usuarioId = null;
let empresaId = null;
let contexto = null;
let formularioAberto = null;
let feedbackTimer;

function elemento(tag, className, texto) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

function botao(rotulo, className, handler, title) {
  const node = elemento("button", `botao ${className || ""}`.trim(), rotulo);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", handler);
  return node;
}

function mostrar(texto, tipo = "info") {
  clearTimeout(feedbackTimer);
  feedback.textContent = texto;
  feedback.className = `aviso ${tipo}`;
  feedback.hidden = false;
  feedbackTimer = setTimeout(() => {
    feedback.hidden = true;
  }, 6000);
}

async function paraFundo(payload) {
  const resposta = await chrome.runtime.sendMessage(payload);
  if (!resposta?.ok) {
    throw new Error(resposta?.error || "A operação não pôde ser concluída.");
  }
  return resposta;
}

async function abaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

async function paraPagina(payload) {
  const aba = await abaAtiva();
  if (!aba?.id) throw new Error("Nenhuma aba ativa foi encontrada.");
  try {
    return await chrome.tabs.sendMessage(aba.id, payload);
  } catch {
    throw new Error(
      "Nenhum formulário respondeu nesta página. Abra uma etapa da emissão e recarregue a aba."
    );
  }
}

async function carregar() {
  const resposta = await paraFundo({ type: "GET_DATA" });
  dados = resposta.data;
  if (usuarioId && !dados.users[usuarioId]) usuarioId = null;
  if (empresaId && !dados.users[usuarioId]?.companies?.[empresaId]) empresaId = null;
}

async function carregarContexto() {
  try {
    const resposta = await paraPagina({ type: "GET_PAGE_CONTEXT" });
    contexto = resposta?.ok ? resposta : null;
  } catch {
    contexto = null;
  }
}

function ordenar(colecao) {
  return Object.values(colecao || {}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function usuario() {
  return dados.users[usuarioId] || null;
}

function empresa() {
  return usuario()?.companies?.[empresaId] || null;
}

function cabecalho(titulo, subtitulo, onVoltar) {
  const node = elemento("header", "topo");
  if (onVoltar) {
    node.append(botao("‹", "voltar", onVoltar, "Voltar"));
  }
  const marca = elemento("div", "marca");
  marca.append(elemento("span", "marca-sigla", "NFS-e"));
  const textos = elemento("div");
  textos.append(
    elemento("strong", "", titulo),
    elemento("span", "", subtitulo)
  );
  marca.append(textos);
  node.append(marca);
  return node;
}

function abrirCadastro() {
  paraFundo({ type: "OPEN_MANAGER" }).catch((erro) => mostrar(erro.message, "erro"));
}

// --- Tela de usuários -----------------------------------------------------

function renderUsuarios() {
  const usuarios = ordenar(dados.users);
  app.replaceChildren(cabecalho("Form Filler", "Escolha o usuário"));
  const conteudo = elemento("section", "conteudo");

  if (!usuarios.length) {
    conteudo.append(elemento(
      "p",
      "vazio",
      "Nenhum usuário cadastrado. O cadastro do usuário vem primeiro; as empresas ficam dentro dele."
    ));
    conteudo.append(botao("Abrir cadastro", "largo", abrirCadastro));
    app.append(conteudo);
    return;
  }

  const lista = elemento("div", "lista");
  for (const item of usuarios) {
    const total = Object.keys(item.companies || {}).length;
    const linha = botao("", "invisivel item", () => {
      usuarioId = item.id;
      empresaId = null;
      render();
    });
    linha.replaceChildren(
      elemento("strong", "", item.name),
      elemento("small", "", `${total} empresa(s)`)
    );
    lista.append(linha);
  }
  conteudo.append(lista, botao("Cadastrar usuário ou empresa", "secundario largo", abrirCadastro));
  app.append(conteudo);
}

// --- Tela de empresas -----------------------------------------------------

function renderEmpresas() {
  const atual = usuario();
  app.replaceChildren(cabecalho(atual.name, "Escolha a empresa", () => {
    usuarioId = null;
    render();
  }));
  const conteudo = elemento("section", "conteudo");
  const empresas = ordenar(atual.companies);

  if (!empresas.length) {
    conteudo.append(elemento(
      "p",
      "vazio",
      "Nenhuma empresa para este usuário."
    ));
  } else {
    const lista = elemento("div", "lista");
    for (const item of empresas) {
      const salvas = Object.keys(item.forms || {}).length;
      const linha = botao("", "invisivel item", () => {
        empresaId = item.id;
        render();
      });
      linha.replaceChildren(
        elemento("strong", "", item.name),
        elemento("small", "", `${salvas} de ${STEPS.length} etapa(s) salva(s)`)
      );
      lista.append(linha);
    }
    conteudo.append(lista);
  }
  conteudo.append(botao("Cadastrar usuário ou empresa", "secundario largo", abrirCadastro));
  app.append(conteudo);
}

// --- Salvar e preencher ---------------------------------------------------

function mesmoIdentificador(esquerda, direita) {
  return esquerda?.type === direita?.type && esquerda?.value === direita?.value &&
    Number(esquerda?.occurrence || 0) === Number(direita?.occurrence || 0);
}

function formularioNaPagina(savedForm) {
  return contexto?.pageAddress === savedForm.pageAddress &&
    contexto.forms.some((item) => mesmoIdentificador(item.identifier, savedForm.formIdentifier));
}

async function salvarEtapaAtual(identificador, substituir) {
  const alvo = empresa();
  try {
    const extracao = await paraPagina({
      type: "EXTRACT_CURRENT_FORM",
      formIdentifier: identificador
    });
    if (!extracao?.ok) throw new Error(extracao?.error);
    if (!extracao.form.fields.length) {
      throw new Error("Nenhum campo preenchido foi encontrado nesta etapa.");
    }

    const existente = alvo.forms[extracao.form.key];
    if (existente && !substituir && !confirm(
      "Esta etapa já tem dados salvos para esta empresa.\n\nDeseja substituir?"
    )) {
      return;
    }

    // Campo fora do formulário padrão do portal: quem salva decide se aquilo
    // vale para todos os usuários ou só para esta empresa.
    const novos = unknownFields(extracao.form);
    let replicados = 0;
    if (novos.length) {
      const resposta = await paraPagina({
        type: "CONFIRM_SHARED_FIELDS",
        fields: novos.map(({ key, label }) => ({ key, label }))
      });
      const escolhidos = new Set(resposta?.keys || []);
      const campos = novos.filter((item) => escolhidos.has(item.key)).map((item) => item.field);
      if (campos.length) {
        await paraFundo({
          type: "SAVE_SHARED_FIELDS",
          pageAddress: extracao.form.pageAddress,
          fields: campos
        });
        replicados = campos.length;
      }
    }

    const guardado = await paraFundo({
      type: "UPSERT_FORM",
      userId: usuarioId,
      companyId: empresaId,
      savedForm: extracao.form
    });
    await carregar();
    render();
    const variaveis = countVariableFields(guardado.form);
    const partes = [`${guardado.form.fields.length} campo(s) salvo(s)`];
    if (variaveis) partes.push(`${variaveis} perguntado(s) ao preencher`);
    if (replicados) partes.push(`${replicados} replicado(s) para todos`);
    mostrar(`${partes.join(", ")}.`, "sucesso");
  } catch (erro) {
    mostrar(erro.message || "Não foi possível salvar a etapa.", "erro");
  }
}

async function preencher(savedForm) {
  try {
    mostrar("Preenchendo… acompanhe o progresso na página.", "info");
    const preparado = mergeSharedFields(savedForm, dados.sharedFields?.[savedForm.pageAddress]);
    const resultado = await paraPagina({ type: "FILL_FORM", savedForm: preparado });
    if (!resultado?.ok) throw new Error(resultado?.error);
    if (resultado.cancelled) {
      mostrar("Preenchimento cancelado.", "info");
      return;
    }
    const partes = [`${resultado.filled} de ${resultado.total} campo(s) preenchido(s).`];
    if (resultado.unverified) {
      partes.push(
        `${resultado.unverified} sem confirmação: ${(resultado.unverifiedFields || []).join(", ")}.`
      );
    }
    if (resultado.missing) {
      const detalhe = (resultado.missingFields || [])
        .map((item) => (item.reason ? `${item.label} (${item.reason})` : item.label))
        .join("; ");
      partes.push(`Faltou preencher: ${detalhe}.`);
    }
    mostrar(partes.join(" "), resultado.missing ? "erro" : "sucesso");
  } catch (erro) {
    mostrar(erro.message || "Não foi possível preencher a etapa.", "erro");
  }
}

// --- Editor de campos -----------------------------------------------------

function clonar(valor) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(valor)
    : JSON.parse(JSON.stringify(valor));
}

function controleDeValor(campo) {
  if (campo.variable) {
    const nota = elemento("div", "nota-variavel");
    nota.append(
      elemento("strong", "", campo.variableLabel || "Campo variável"),
      elemento("span", "", "Perguntado a cada preenchimento; nada fica guardado.")
    );
    return nota;
  }

  if (campo.inputType === "checkbox" ||
    (campo.inputType === "radio" && !campo.radioGroup)) {
    const wrapper = elemento("label", "controle-booleano");
    const entrada = elemento("input");
    entrada.type = "checkbox";
    entrada.checked = Boolean(campo.checked);
    const descricao = elemento("span", "", entrada.checked ? "Marcado" : "Desmarcado");
    entrada.addEventListener("change", () => {
      campo.checked = entrada.checked;
      descricao.textContent = entrada.checked ? "Marcado" : "Desmarcado";
    });
    wrapper.append(entrada, descricao);
    return wrapper;
  }

  if (campo.multiple || campo.elementType === "textarea") {
    const area = elemento("textarea");
    area.rows = campo.multiple ? 3 : 2;
    area.value = campo.multiple
      ? (Array.isArray(campo.value) ? campo.value.join("\n") : "")
      : String(campo.value ?? "");
    area.placeholder = campo.multiple ? "Um valor por linha" : "Valor salvo";
    area.addEventListener("input", () => {
      campo.value = campo.multiple
        ? area.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
        : area.value;
    });
    return area;
  }

  const entrada = elemento("input");
  entrada.type = "text";
  entrada.value = String(campo.value ?? "");
  entrada.placeholder = "Valor salvo";
  entrada.addEventListener("input", () => {
    campo.value = entrada.value;
  });
  return entrada;
}

function renderEditor(savedForm) {
  const rascunho = clonar(savedForm.fields || []);
  const editor = elemento("form", "editor");
  const linhas = elemento("div", "editor-linhas");

  const desenhar = () => {
    linhas.replaceChildren();
    if (!rascunho.length) {
      linhas.append(elemento("p", "vazio", "Nenhum campo mantido nesta etapa."));
      return;
    }
    rascunho.forEach((campo, indice) => {
      const linha = elemento("div", "editor-campo");
      const topo = elemento("div", "editor-campo-topo");
      const rotulos = elemento("div");
      rotulos.append(
        elemento("strong", "", fieldDisplayLabel(campo)),
        elemento("span", "", campo.identifier?.primary?.value || "")
      );
      topo.append(rotulos, botao("Remover", "perigo pequeno", () => {
        rascunho.splice(indice, 1);
        desenhar();
      }));
      linha.append(topo, controleDeValor(campo));
      linhas.append(linha);
    });
  };
  desenhar();

  const acoes = elemento("div", "editor-acoes");
  acoes.append(
    botao("Fechar", "secundario", () => {
      formularioAberto = null;
      render();
    }),
    (() => {
      const salvar = botao("Salvar alterações", "", () => {});
      salvar.type = "submit";
      return salvar;
    })()
  );
  editor.append(linhas, acoes);

  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!rascunho.length) {
      mostrar("Mantenha pelo menos um campo ou exclua a etapa inteira.", "erro");
      return;
    }
    try {
      await paraFundo({
        type: "UPSERT_FORM",
        userId: usuarioId,
        companyId: empresaId,
        savedForm: { ...savedForm, fields: rascunho }
      });
      await carregar();
      render();
      mostrar("Campos atualizados.", "sucesso");
    } catch (erro) {
      mostrar(erro.message, "erro");
    }
  });
  return editor;
}

// --- Tela das etapas ------------------------------------------------------

function formularioDaEtapa(alvo, etapa) {
  return Object.values(alvo.forms || {}).find(
    (form) => nfseStep(form.pageAddress)?.id === etapa.id
  ) || null;
}

function renderEtapas() {
  const alvo = empresa();
  const dono = usuario();
  app.replaceChildren(cabecalho(alvo.name, dono.name, () => {
    empresaId = null;
    formularioAberto = null;
    render();
  }));
  const conteudo = elemento("section", "conteudo");

  const etapaAtual = contexto ? nfseStep(contexto.pageAddress) : null;
  const aviso = elemento("p", "situacao");
  aviso.textContent = etapaAtual
    ? `Você está na etapa ${etapaAtual.order} · ${etapaAtual.label}.`
    : "A aba atual não é uma etapa da emissão da NFS-e.";
  conteudo.append(aviso);

  const etapasOrdenadas = [...STEPS].sort((a, b) => a.order - b.order);
  for (const etapa of etapasOrdenadas) {
    const savedForm = formularioDaEtapa(alvo, etapa);
    const naPagina = etapaAtual?.id === etapa.id;
    const cartao = elemento("article", `cartao${naPagina ? " atual" : ""}`);

    const topo = elemento("div", "cartao-topo");
    topo.append(
      elemento("span", "etapa-numero", String(etapa.order)),
      elemento("h3", "", etapa.label)
    );
    if (naPagina) topo.append(elemento("span", "etapa-selo", "aba atual"));
    cartao.append(topo);

    if (savedForm) {
      const variaveis = countVariableFields(savedForm);
      cartao.append(elemento(
        "p",
        "cartao-meta",
        `${savedForm.fields.length} campo(s)` +
          (variaveis ? ` · ${variaveis} perguntado(s) ao preencher` : "")
      ));
    } else {
      cartao.append(elemento("p", "cartao-meta", "Sem dados salvos."));
    }

    const acoes = elemento("div", "cartao-acoes");
    const compativel = Boolean(savedForm) && formularioNaPagina(savedForm);
    const preencherBotao = botao("Preencher", "", () => preencher(savedForm));
    preencherBotao.disabled = !compativel;
    if (!compativel && savedForm) {
      preencherBotao.title = "Abra esta etapa no portal para preencher.";
    }

    const podeSalvar = naPagina && Boolean(contexto?.forms?.length);
    // O content script já indica qual formulário está em foco; a primeira
    // posição só entra quando ele não soube decidir.
    const alvoDaPagina = contexto?.selectedForm || contexto?.forms?.[0]?.identifier;
    const salvarBotao = botao(
      savedForm ? "Atualizar" : "Salvar desta página",
      "secundario",
      () => salvarEtapaAtual(alvoDaPagina, Boolean(savedForm))
    );
    salvarBotao.disabled = !podeSalvar;
    if (!podeSalvar) {
      salvarBotao.title = "Abra esta etapa no portal para salvar os dados dela.";
    }
    acoes.append(preencherBotao, salvarBotao);

    if (savedForm) {
      acoes.append(botao(
        formularioAberto === savedForm.key ? "Ocultar campos" : "Ver campos",
        "secundario",
        () => {
          formularioAberto = formularioAberto === savedForm.key ? null : savedForm.key;
          render();
        }
      ));
      acoes.append(botao("Excluir", "perigo", async () => {
        if (!confirm(`Excluir os dados salvos da etapa ${etapa.label}?`)) return;
        try {
          await paraFundo({
            type: "DELETE_FORM",
            userId: usuarioId,
            companyId: empresaId,
            formKey: savedForm.key
          });
          await carregar();
          render();
          mostrar("Etapa excluída.", "sucesso");
        } catch (erro) {
          mostrar(erro.message, "erro");
        }
      }));
    }
    cartao.append(acoes);
    if (savedForm && formularioAberto === savedForm.key) {
      cartao.append(renderEditor(savedForm));
    }
    conteudo.append(cartao);
  }

  // Etapas fora do padrão continuam acessíveis, mesmo sem selo de etapa.
  const foraDoPadrao = Object.values(alvo.forms || {}).filter(
    (form) => !nfseStep(form.pageAddress)
  );
  if (foraDoPadrao.length) {
    conteudo.append(elemento("h3", "titulo-secundario", "Outras páginas salvas"));
    for (const savedForm of foraDoPadrao.sort((a, b) =>
      stepOrder(a.pageAddress) - stepOrder(b.pageAddress))) {
      const cartao = elemento("article", "cartao");
      cartao.append(
        elemento("h3", "", savedForm.displayName),
        elemento("p", "cartao-meta", `${savedForm.fields.length} campo(s)`)
      );
      const preencherBotao = botao("Preencher", "", () => preencher(savedForm));
      preencherBotao.disabled = !formularioNaPagina(savedForm);
      cartao.append(preencherBotao);
      conteudo.append(cartao);
    }
  }

  app.append(conteudo);
}

function render() {
  if (!usuarioId) return renderUsuarios();
  if (!empresaId) return renderEmpresas();
  return renderEtapas();
}

Promise.all([carregar(), carregarContexto()])
  .then(render)
  .catch((erro) => {
    app.replaceChildren(
      cabecalho("Form Filler", "Erro ao iniciar"),
      elemento("p", "vazio", erro.message)
    );
  });
