import { STEPS, countVariableFields, fieldDisplayLabel, nfseStep } from "../lib/nfse.js";

const feedback = document.getElementById("feedback");
const usuariosNode = document.getElementById("usuarios");
const empresasNode = document.getElementById("empresas");
const etapasNode = document.getElementById("etapas");
const compartilhadosNode = document.getElementById("compartilhados");
const painelEmpresa = document.getElementById("painel-empresa");
const painelEtapas = document.getElementById("painel-etapas");
const painelCompartilhados = document.getElementById("painel-compartilhados");
const usuarioAtualNode = document.getElementById("usuario-atual");

let dados = { users: {}, sharedFields: {} };
let usuarioId = null;
let empresaId = null;
let renomeando = null;
let feedbackTimer;

function elemento(tag, className, texto) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

function botao(rotulo, className, handler) {
  const node = elemento("button", `botao ${className || ""}`.trim(), rotulo);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

function linhaDeEdicao(nomeAtual, aoSalvar) {
  const form = elemento("form", "item edicao");
  const entrada = elemento("input");
  entrada.value = nomeAtual;
  entrada.maxLength = 100;
  entrada.required = true;
  entrada.setAttribute("aria-label", "Novo nome");
  const salvar = elemento("button", "botao", "Salvar");
  salvar.type = "submit";
  const cancelar = botao("Cancelar", "secundario", () => {
    renomeando = null;
    render();
  });
  const acoes = elemento("div", "acoes-item");
  acoes.append(salvar, cancelar);
  form.append(entrada, acoes);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    aoSalvar(entrada.value);
  });
  entrada.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    renomeando = null;
    render();
  });
  queueMicrotask(() => {
    entrada.focus();
    entrada.select();
  });
  return form;
}

function estaRenomeando(tipo, id) {
  return renomeando?.tipo === tipo && renomeando?.id === id;
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

async function mensagem(payload) {
  const resposta = await chrome.runtime.sendMessage(payload);
  if (!resposta?.ok) throw new Error(resposta?.error || "A operação falhou.");
  return resposta;
}

async function carregar() {
  const resposta = await mensagem({ type: "GET_DATA" });
  dados = resposta.data;
  if (usuarioId && !dados.users[usuarioId]) usuarioId = null;
  const usuario = dados.users[usuarioId];
  if (empresaId && !usuario?.companies?.[empresaId]) empresaId = null;
}

function ordenar(colecao) {
  return Object.values(colecao || {}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function usuarioSelecionado() {
  return dados.users[usuarioId] || null;
}

function empresaSelecionada() {
  return usuarioSelecionado()?.companies?.[empresaId] || null;
}

// --- Usuários -------------------------------------------------------------

function renderUsuarios() {
  const usuarios = ordenar(dados.users);
  usuariosNode.replaceChildren();
  if (!usuarios.length) {
    usuariosNode.append(elemento(
      "p",
      "vazio",
      "Nenhum usuário cadastrado. Comece cadastrando um usuário acima."
    ));
    return;
  }

  const lista = elemento("div", "lista");
  for (const usuario of usuarios) {
    if (estaRenomeando("user", usuario.id)) {
      lista.append(linhaDeEdicao(usuario.name, async (nome) => {
        try {
          await mensagem({ type: "RENAME_USER", userId: usuario.id, name: nome });
          renomeando = null;
          await carregar();
          render();
          mostrar("Usuário renomeado.", "sucesso");
        } catch (erro) {
          mostrar(erro.message, "erro");
        }
      }));
      continue;
    }
    const total = Object.keys(usuario.companies || {}).length;
    const linha = elemento("div", `item${usuario.id === usuarioId ? " ativo" : ""}`);
    const abrir = botao("", "invisivel", () => {
      usuarioId = usuario.id;
      empresaId = null;
      render();
    });
    abrir.replaceChildren(
      elemento("strong", "", usuario.name),
      elemento("small", "", `${total} empresa(s)`)
    );
    const renomear = botao("Renomear", "secundario", () => {
      renomeando = { tipo: "user", id: usuario.id };
      render();
    });
    const excluir = botao("Excluir", "perigo", async () => {
      if (!confirm(
        `Excluir “${usuario.name}”?\n\nTodas as empresas e formulários deste usuário serão removidos.`
      )) return;
      try {
        await mensagem({ type: "DELETE_USER", userId: usuario.id });
        if (usuarioId === usuario.id) usuarioId = null;
        await carregar();
        render();
        mostrar("Usuário excluído.", "sucesso");
      } catch (erro) {
        mostrar(erro.message, "erro");
      }
    });
    const acoes = elemento("div", "acoes-item");
    acoes.append(renomear, excluir);
    linha.append(abrir, acoes);
    lista.append(linha);
  }
  usuariosNode.append(lista);
}

// --- Empresas -------------------------------------------------------------

function renderEmpresas() {
  const usuario = usuarioSelecionado();
  painelEmpresa.hidden = !usuario;
  if (!usuario) return;

  usuarioAtualNode.textContent = usuario.name;
  const empresas = ordenar(usuario.companies);
  empresasNode.replaceChildren();
  if (!empresas.length) {
    empresasNode.append(elemento(
      "p",
      "vazio",
      "Nenhuma empresa para este usuário. Cadastre a primeira acima."
    ));
    return;
  }

  const lista = elemento("div", "lista");
  for (const empresa of empresas) {
    if (estaRenomeando("company", empresa.id)) {
      lista.append(linhaDeEdicao(empresa.name, async (nome) => {
        try {
          await mensagem({
            type: "RENAME_COMPANY",
            userId: usuario.id,
            companyId: empresa.id,
            name: nome
          });
          renomeando = null;
          await carregar();
          render();
          mostrar("Empresa renomeada.", "sucesso");
        } catch (erro) {
          mostrar(erro.message, "erro");
        }
      }));
      continue;
    }
    const forms = Object.values(empresa.forms || {});
    const linha = elemento("div", `item${empresa.id === empresaId ? " ativo" : ""}`);
    const abrir = botao("", "invisivel", () => {
      empresaId = empresa.id;
      render();
    });
    abrir.replaceChildren(
      elemento("strong", "", empresa.name),
      elemento("small", "", `${forms.length} de ${STEPS.length} etapa(s) salva(s)`)
    );
    const renomear = botao("Renomear", "secundario", () => {
      renomeando = { tipo: "company", id: empresa.id };
      render();
    });
    const excluir = botao("Excluir", "perigo", async () => {
      if (!confirm(`Excluir “${empresa.name}”?\n\nOs formulários salvos serão removidos.`)) return;
      try {
        await mensagem({
          type: "DELETE_COMPANY",
          userId: usuario.id,
          companyId: empresa.id
        });
        if (empresaId === empresa.id) empresaId = null;
        await carregar();
        render();
        mostrar("Empresa excluída.", "sucesso");
      } catch (erro) {
        mostrar(erro.message, "erro");
      }
    });
    const acoes = elemento("div", "acoes-item");
    acoes.append(renomear, excluir);
    linha.append(abrir, acoes);
    lista.append(linha);
  }
  empresasNode.append(lista);
}

// --- Etapas ---------------------------------------------------------------

function formularioDaEtapa(empresa, etapa) {
  return Object.values(empresa.forms || {}).find(
    (form) => nfseStep(form.pageAddress)?.id === etapa.id
  ) || null;
}

function renderEtapas() {
  const usuario = usuarioSelecionado();
  const empresa = empresaSelecionada();
  painelEtapas.hidden = !empresa;
  if (!empresa) return;

  etapasNode.replaceChildren();
  for (const etapa of STEPS) {
    const form = formularioDaEtapa(empresa, etapa);
    const cartao = elemento("article", `etapa${form ? "" : " sem-dados"}`);
    const cabecalho = elemento("div", "etapa-cabecalho");
    cabecalho.append(
      elemento("span", "etapa-numero", String(etapa.order)),
      elemento("h3", "", etapa.label)
    );
    cartao.append(cabecalho, elemento("p", "etapa-descricao", etapa.description));

    if (form) {
      const variaveis = countVariableFields(form);
      cartao.append(elemento(
        "p",
        "etapa-meta",
        `${form.fields.length} campo(s) salvo(s)` +
          (variaveis ? ` · ${variaveis} perguntado(s) ao preencher` : "")
      ));
      cartao.append(botao("Preencher esta etapa", "largo", async (event) => {
        const alvo = event.currentTarget;
        alvo.disabled = true;
        alvo.textContent = "Preenchendo…";
        try {
          await mensagem({
            type: "FILL_STEP",
            userId: usuario.id,
            companyId: empresa.id,
            stepId: etapa.id
          });
          mostrar(`Etapa ${etapa.label} preenchida. Confira o resultado na aba do portal.`, "sucesso");
        } catch (erro) {
          mostrar(erro.message, "erro");
        } finally {
          alvo.disabled = false;
          alvo.textContent = "Preencher esta etapa";
        }
      }));
    } else {
      cartao.append(elemento(
        "p",
        "etapa-meta",
        "Sem dados salvos. Preencha esta etapa no portal e salve pelo menu do botão direito."
      ));
      const link = elemento("a", "etapa-link", "Abrir o portal");
      link.href = etapa.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      cartao.append(link);
    }
    etapasNode.append(cartao);
  }
}

// --- Campos compartilhados ------------------------------------------------

function renderCompartilhados() {
  const paginas = Object.entries(dados.sharedFields || {});
  const total = paginas.reduce((soma, [, campos]) => soma + Object.keys(campos).length, 0);
  painelCompartilhados.hidden = !total;
  if (!total) return;

  compartilhadosNode.replaceChildren();
  for (const [pageAddress, campos] of paginas) {
    const etapa = nfseStep(pageAddress);
    const bloco = elemento("div", "compartilhado-bloco");
    bloco.append(elemento("h3", "", etapa ? etapa.label : pageAddress));
    for (const [key, campo] of Object.entries(campos)) {
      const linha = elemento("div", "item");
      const texto = elemento("div", "compartilhado-texto");
      texto.append(
        elemento("strong", "", fieldDisplayLabel(campo)),
        elemento("small", "", String(campo.value ?? (campo.checked ? "marcado" : "")))
      );
      const remover = botao("Remover", "perigo", async () => {
        try {
          await mensagem({ type: "DELETE_SHARED_FIELD", pageAddress, key });
          await carregar();
          render();
          mostrar("Campo replicado removido.", "sucesso");
        } catch (erro) {
          mostrar(erro.message, "erro");
        }
      });
      linha.append(texto, remover);
      bloco.append(linha);
    }
    compartilhadosNode.append(bloco);
  }
}

function render() {
  renderUsuarios();
  renderEmpresas();
  renderEtapas();
  renderCompartilhados();
}

document.getElementById("form-usuario").addEventListener("submit", async (event) => {
  event.preventDefault();
  const campo = document.getElementById("nome-usuario");
  try {
    const resposta = await mensagem({ type: "CREATE_USER", name: campo.value });
    campo.value = "";
    usuarioId = resposta.user.id;
    empresaId = null;
    await carregar();
    render();
    mostrar("Usuário cadastrado. Agora cadastre as empresas dele.", "sucesso");
  } catch (erro) {
    mostrar(erro.message, "erro");
  }
});

document.getElementById("form-empresa").addEventListener("submit", async (event) => {
  event.preventDefault();
  const campo = document.getElementById("nome-empresa");
  try {
    const resposta = await mensagem({
      type: "CREATE_COMPANY",
      userId: usuarioId,
      name: campo.value
    });
    campo.value = "";
    empresaId = resposta.company.id;
    await carregar();
    render();
    mostrar("Empresa cadastrada.", "sucesso");
  } catch (erro) {
    mostrar(erro.message, "erro");
  }
});

carregar()
  .then(render)
  .catch((erro) => mostrar(erro.message, "erro"));
