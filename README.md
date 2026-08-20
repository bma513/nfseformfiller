# NFS-e Form Filler

Extensão Chrome (Manifest V3) para guardar e restaurar as etapas da emissão de nota no [emissor nacional da NFS-e](https://www.nfse.gov.br/EmissorNacional). Não há backend, conta ou sincronização: os dados ficam em `chrome.storage.local`, presos ao perfil do Chrome onde a extensão foi instalada.

## A ideia

Emitir nota é preencher três formulários longos em que a maior parte dos campos é sempre a mesma. Tomador, endereço, código de tributação e alíquotas se repetem; data, valores e descrição do serviço mudam toda vez.

A extensão guarda o primeiro grupo e se recusa a guardar o segundo. Restaurar a data da nota passada seria pior do que deixar o campo em branco, então esses campos são perguntados no momento do preenchimento.

## Hierarquia

```text
usuário
└── empresa
    └── etapa salva (Pessoas, Serviço, Tributação)
        └── campos
```

O cadastro do usuário vem primeiro. Um usuário reúne as empresas para as quais emite nota, e cada empresa guarda as três etapas. Vários usuários convivem no mesmo perfil do Chrome — útil quando a mesma pessoa cuida da emissão de mais de um contribuinte.

Existe ainda um nível acima, transversal: os **campos replicados**, descritos adiante.

## Instalação

Não há etapa de build nem dependências.

1. Abra `chrome://extensions`.
2. Ative **Developer mode** (Modo do desenvolvedor).
3. Clique em **Load unpacked** (Carregar sem compactação).
4. Selecione a pasta que contém o `manifest.json`.

Na primeira instalação, a página de cadastro abre sozinha. Depois de alterar o código, volte a `chrome://extensions`, clique em **Reload** e recarregue as abas abertas — o content script só entra em páginas carregadas depois disso.

## Como usar

### Cadastro

A página inicial (`manage/manage.html`, também acessível pelo menu do botão direito e pelas opções da extensão) cadastra usuários e, dentro do usuário escolhido, empresas. Com uma empresa selecionada, ela mostra as três etapas: quais já têm dados salvos e quantos campos cada uma guarda.

O botão **Preencher esta etapa** procura uma aba já aberta naquela etapa, traz o foco para ela e preenche. Não há como criar o rascunho a partir daqui: o portal exige uma emissão em andamento, com o identificador na URL.

### Salvar uma etapa

1. Abra a emissão no portal e preencha a etapa normalmente.
2. Abra a extensão, escolha o usuário e a empresa.
3. No cartão da etapa correspondente, clique em **Salvar desta página**.

Pelo botão direito o caminho é **NFS-e Form Filler → Salvar formulário atual → usuário → empresa**.

### Preencher

Com a etapa aberta no portal, clique em **Preencher** no cartão, ou use **NFS-e Form Filler → Preencher formulário atual → usuário → empresa**.

Os campos que mudam a cada nota são perguntados um a um, no momento em que cada um aparece de verdade na página. Campo deixado em branco permanece como está.

## Campos variáveis

Não são guardados; são perguntados a cada preenchimento.

| campo | como aparece no diálogo |
|---|---|
| `DataCompetencia` | data, já sugerida como a de hoje |
| `Evento.DataInicial`, `Evento.DataFinal` | data |
| `Valores.ValorServico` | valor em real |
| `ComercioExterior.ValorServicoMoedaEstrangeira` | valor em moeda estrangeira |
| `ServicoPrestado.Descricao`, `Evento.Descricao` | texto longo |

O rótulo mostrado é o que aparece na tela do portal, não o nome interno do campo. As regras casam com o `name` ou o `id`, aceitando as duas grafias que o portal usa (`Valores.ValorServico` e `Valores_ValorServico`).

A pergunta acontece **durante** o preenchimento, quando o campo fica disponível — não de uma vez no começo. A diferença importa: as datas do bloco de evento continuam salvas de uma emissão antiga e, como o valor de um campo variável é descartado, não há como distinguir “ainda em uso” de “sobra”. Perguntando na hora, o que não entra nesta nota simplesmente não é perguntado.

Campos de valor são formatados enquanto se digita, na mesma convenção da máscara do portal, que lê a digitação como centavos: `5000` vira `50,00` e `500000` vira `5.000,00`. O que aparece no diálogo é exatamente o que vai para a página.

Campos parecidos que **não** entram: descontos, alíquotas, valores de tributo e o valor recebido pelo intermediário. Esses ou se repetem, ou o próprio site calcula.

## Campos fora do formulário padrão

A extensão conhece os campos das três etapas do emissor nacional — 104 em Pessoas, 74 em Serviço e 60 em Tributação, extraídos do portal e listados em `lib/template.js`.

Ao salvar, um campo que não está nessa lista é tratado como novidade: ou a prefeitura acrescentou algo próprio, ou o emissor mudou. A extensão mostra os campos novos e pergunta quais devem valer como padrão **para todos os usuários**.

Os marcados ficam guardados fora da hierarquia de usuários e entram em qualquer preenchimento daquela etapa. Os não marcados ficam apenas na empresa em que foram salvos. Um campo replicado nunca sobrepõe o que a empresa guardou para si — ele só entra quando a empresa não tem valor próprio para aquele campo.

A lista de campos replicados fica na página inicial, com a opção de remover.

## Como o preenchimento funciona

O portal usa duas bibliotecas de dropdown, e cada uma exige um caminho diferente.

- **Chosen** (`display: none`, lista completa no `select`): a extensão escreve o valor no elemento e emite `chosen:updated`, o evento que faz a biblioteca reler o campo. Não é preciso abrir o painel.
- **Select2 com busca remota** (`aria-hidden`, `select` recortado a um pixel, só a opção escolhida dentro dele): a lista só existe no painel. A extensão abre o componente, digita um prefixo do texto da opção no campo de busca e clica na linha. A escolha exige casamento exato do texto — nunca "a primeira da lista", porque um município errado é pior do que um campo vazio.

O preenchimento é sequencial e acontece em até cinco passadas, parando assim que uma rodada deixa de destravar campos novos. Cadeias de listas dependentes — país → município, código de tributação → item da NBS — destravam um elo por rodada.

Cada campo espera até ficar realmente utilizável: existir, não estar `disabled`, e, no caso de `select` comum, ter a opção salva já carregada. Depois de escrever, a extensão relê o campo e compara com o valor salvo, tolerando as diferenças de pontuação das máscaras — `12.345.678/0001-90` bate com `12345678000190`. Se não bateu, tenta de novo.

O progresso aparece na própria página, com botão de cancelar, porque o popup fecha ao perder o foco.

Ao final, o resultado separa quatro situações:

| situação | significado |
|---|---|
| confirmado | escrito e conferido no campo |
| sem confirmação | escrito, mas o campo sumiu antes de dar para conferir |
| ignorado | não era tarefa: campo somente leitura que o site calcula, campo variável deixado em branco ou campo variável que não pertence a esta nota |
| ausente | falha de verdade, com o motivo apurado |

Ignorado não conta como falha nem entra no total. Ausente vem com a explicação, como `a opção de valor "1" não existe na lista. Opções: Selecione…`.

### O que não é guardado

Senhas, arquivos, campos ocultos, botões e campos identificados como dados de cartão.

Também ficam de fora os campos desabilitados ou somente leitura no momento da gravação. O que está neles não é escolha do usuário, e sim o que o portal calculou — valor do ISSQN derivado da alíquota, nome do município vindo da consulta do CEP, dados do prestador vindos da conta. Num documento fiscal isso é proteção: melhor deixar em branco para conferência do que escrever por cima de um valor que o site deveria calcular.

Por fim, ficam de fora os campos do **emitente** — tudo que começa com `Prestador.`. Esse bloco vem do cadastro da conta, não de uma escolha de quem emite. O portal marca a maior parte dele como somente leitura, mas o endereço (CEP, logradouro, número, complemento, bairro) é editável: aparece preenchido, aceita digitação e seria guardado como se fosse dado da empresa. Guardá-lo não ajuda e ainda faria o preenchimento reescrever o que o portal acabou de trazer.

Um campo desabilitado durante o *preenchimento* é caso diferente e continua sendo aguardado: é justamente o campo que a etapa anterior vai liberar.

## Arquitetura

```text
manifest.json                 Manifest V3, permissões e pontos de entrada
background/
  service-worker.js          Storage, mensagens e menus de contexto aninhados
content/
  content-script.js          Descoberta, extração, diálogos e preenchimento
lib/
  storage.js                 Modelo de dados e operações em chrome.storage.local
  nfse.js                    Etapas, campos variáveis e campos replicados
  template.js                Campos do formulário padrão, por etapa
  theme.css                  Identidade visual, com as cores do portal
popup/
  popup.html / .css / .js    Usuário → empresa → etapas
manage/
  manage.html / .css / .js   Página inicial: cadastro e escolha de etapa
icons/
tests/
  manual-test.html           Página local para validar os cenários principais
requirements.md              Especificação original
```

O popup nunca toca no DOM da página. Ele pede ao content script para inspecionar ou preencher e manda as mudanças de dados ao service worker, que centraliza o storage e reconstrói os menus quando algo muda.

### Modelo de dados

```text
schemaVersion: 2
users
└── userId
    ├── name, createdAt, updatedAt
    └── companies
        └── companyId
            ├── name, createdAt, updatedAt
            └── forms
                └── pageAddress|formIdentifier
                    ├── metadados da página e do formulário
                    └── fields[]
sharedFields
└── pageAddress
    └── fieldKey → campo replicado para todos os usuários
```

Os campos são uma lista, não um mapa, para suportar checkbox e radio com nomes repetidos. Cada item guarda um identificador primário e alternativas (`name`, `id`, `aria-label`, label associada e outros).

### Identidade visual

As cores vêm das próprias variáveis CSS do portal: `--verde-principal: #55805b` nos títulos de seção, `--botao-primario: #344389` nos botões de ação, `--verde-secundario: #e5f1e7` nos realces e `--cinza-principal: #f9f9f9` nos painéis.

## Migração de versões anteriores

Dados gravados pela versão anterior continuam valendo. Na primeira leitura, as empresas que ficavam na raiz passam a pertencer a um usuário chamado **Usuário principal**, o antigo tipo de empresa é descartado e os formulários recebem o tratamento da NFS-e — data, valores e descrição deixam de ser guardados e passam a ser perguntados.

A conversão acontece uma vez e é gravada. Nada precisa ser feito à mão.

O mesmo vale para regras novas de captura: quando uma delas passa a valer, a extensão reaplica sobre o que já está gravado na primeira leitura seguinte, e não só sobre o que vier a ser salvo. A versão do esquema registra o que já foi aplicado, para a varredura acontecer uma vez e não a cada leitura. Foi assim que os campos do emitente saíram dos formulários salvos antes dessa regra existir.

## Permissões e privacidade

- `storage`: guardar usuários, empresas e formulários localmente.
- `contextMenus`: oferecer as ações no botão direito.
- `activeTab`: falar com a aba em uso depois de uma ação explícita.
- `http://*/*` e `https://*/*`: carregar o content script, requisito para lembrar em qual campo o menu de contexto foi aberto.

O content script entra em todos os frames da página. Quando uma mensagem chega, só responde o frame que realmente contém o formulário; o principal responde no lugar dele apenas quando não existe outro frame candidato.

Não há requisição de rede no código e nenhum dado sai do navegador. O storage é local ao perfil do Chrome, não é sincronizado nem criptografado: quem tiver acesso ao perfil tem acesso a esses dados.

## Como depurar

**Popup**: em `chrome://extensions`, clique em **Inspect views: popup** com o popup aberto, ou clique com o botão direito dentro dele e escolha **Inspect**. O popup fecha ao perder o foco; mantenha o DevTools aberto.

**Service worker**: em `chrome://extensions`, clique no link **service worker**. O Chrome o encerra quando fica ocioso; o código não depende de variáveis em memória para dados persistentes.

**Content script**: DevTools da página (`F12`), aba Sources, **Content scripts → NFS-e Form Filler**.

Para inspecionar ou limpar os dados, no console do service worker:

```javascript
chrome.storage.local.get("formSaverData").then(console.log)
chrome.storage.local.remove("formSaverData")
```

## Limitações conhecidas

- Controles que não usam `input`, `select` ou `textarea` não são capturados. Componentes que apenas decoram um `select` real são suportados; os construídos só com `div` não.
- Para operar um componente de lista remota a extensão precisa do texto da opção. Formulários salvos antes desta versão guardam só o valor: salve-os de novo.
- O tempo de espera por campo vai de três a dez segundos conforme a passada, com limite global de dois minutos.
- A escolha em um combobox aguarda até quatro segundos pela lista; sem lista, o campo fica com o texto digitado.
- Shadow DOM fechado não pode ser inspecionado.
- Páginas internas do navegador, Chrome Web Store, visualizador de PDF e páginas abertas antes da instalação não aceitam o content script.

## Segurança

A extensão apenas altera valores de campos. Ela nunca envia teclas de confirmação, não clica em botões de ação, não avança etapas e não executa `submit`. O único clique simulado acontece sobre o próprio campo — checkbox, radio e a opção de um componente de lista.

Revise os valores preenchidos e conclua a emissão manualmente.
