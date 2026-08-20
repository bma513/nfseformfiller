# Form Saver

Extensão Chrome Manifest V3 para salvar e restaurar valores de formulários, organizados por empresa. Não há backend, conta ou sincronização: os dados ficam em `chrome.storage.local`, vinculados ao perfil do Chrome onde a extensão foi instalada.

## O que a extensão faz

- Cria, renomeia e exclui empresas, em dois tipos: **Personalizada** e **NFS-e**.
- Salva vários formulários para cada empresa.
- Reconhece uma página por `origin + pathname`; query string e fragmento são ignorados.
- Reconhece formulários por `name`, depois `id` e, por fim, por uma impressão digital estável.
- Salva inputs comuns, checkbox, radio, select simples/múltiplo e textarea.
- Salva somente campos que possuem um valor efetivamente preenchido; radio sem seleção é ignorado. Checkbox é sempre salvo, marcado ou desmarcado, porque "desmarcado" costuma ser uma escolha deliberada.
- Preenche apenas o formulário compatível na página atual e nunca envia o formulário.
- Funciona pelo popup e pelo menu de contexto (botão direito).
- Preenche em ordem, aguardando cada campo dinâmico ficar realmente utilizável antes de seguir.
- Confere o valor depois de escrever e repete a tentativa quando o site descarta o que foi preenchido.
- Mostra o progresso na própria página, com botão de cancelar, e informa ao final quais campos ficaram sem preencher.
- Funciona também em formulários dentro de iframes.
- Dispara eventos `input` e `change` usando setters nativos, o que melhora a compatibilidade com React, Angular, Vue e aplicações similares.

Senhas, arquivos, campos ocultos, botões e campos identificados como dados de cartão não são armazenados.

Campos desabilitados ou somente leitura no momento da gravação também ficam de fora. O que está neles não é uma escolha do usuário, e sim o que o próprio site calculou — valor de imposto derivado da alíquota, nome do município vindo da consulta do CEP, dados do prestador vindos da conta. Guardá-los encheria o registro de valores que nunca poderiam ser reaplicados e faria cada preenchimento esperar em vão por campos que jamais serão liberados. Num documento fiscal isso é também uma proteção: é melhor deixar em branco para conferência do que escrever por cima de um valor que o site deveria calcular.

Um campo desabilitado durante o preenchimento é caso diferente e continua sendo aguardado: é justamente o campo que a etapa anterior vai liberar.

## Tipos de empresa

O tipo é escolhido na criação e pode ser trocado depois.

### Personalizada

É o comportamento de sempre: guarda todos os campos preenchidos e restaura exatamente os mesmos valores.

### NFS-e

Parte de uma constatação simples sobre emissão de nota: uma parte dos campos se repete em toda emissão — tomador, endereço, código de tributação, alíquotas — e outra parte muda sempre. Guardar a segunda parte não ajuda; restaurar a data da nota passada é pior do que deixar o campo em branco.

Numa empresa NFS-e esses campos não são gravados. No lugar disso, ao preencher, a extensão abre um diálogo na própria página pedindo os valores desta nota. Deixar um campo em branco significa não mexer nele.

São tratados como variáveis:

| campo | como aparece |
|---|---|
| `DataCompetencia` | data, já sugerida como a de hoje |
| `Evento.DataInicial`, `Evento.DataFinal` | data |
| `Valores.ValorServico` | valor em real |
| `ComercioExterior.ValorServicoMoedaEstrangeira` | valor em moeda estrangeira |
| `ServicoPrestado.Descricao`, `Evento.Descricao` | texto longo |

O rótulo mostrado no diálogo é o que aparece na tela do portal, não o nome interno do campo.

As regras casam com o nome ou o `id` do campo, aceitando as duas grafias que o portal usa (`Valores.ValorServico` e `Valores_ValorServico`). Campos parecidos que **não** entram: descontos, alíquotas, valores de tributo e o valor recebido pelo intermediário — esses ou se repetem ou são calculados pelo próprio site.

### Etapas da emissão

Uma empresa NFS-e reconhece as etapas `/DPS/Pessoas`, `/DPS/Servico` e `/DPS/Tributacao`. O popup mostra em qual delas você está, marca cada formulário salvo com a etapa correspondente e ordena a lista na sequência da emissão, em vez de alfabeticamente.

### Converter uma empresa existente

Abra a empresa no popup e use **Converter para NFS-e** no cartão do topo. A conversão reprocessa todos os formulários já salvos: os campos variáveis passam a ser perguntados e os valores hoje guardados neles são descartados.

A volta para **Personalizada** também funciona, mas não recupera valor nenhum — eles nunca chegaram a ser gravados. Salve os formulários de novo para preenchê-los.

Empresas criadas antes desta versão continuam funcionando como Personalizadas, sem nenhuma migração necessária.

## Instalação no Chrome

Não há etapa de build nem dependências para instalar.

1. Abra `chrome://extensions` no Chrome.
2. Ative **Developer mode** (Modo do desenvolvedor) no canto superior direito.
3. Clique em **Load unpacked** (Carregar sem compactação).
4. Selecione esta pasta, a que contém o arquivo `manifest.json`.
5. Opcionalmente, fixe **Form Saver** na barra de ferramentas pelo menu de extensões do Chrome.

Depois de alterar o código, volte a `chrome://extensions`, clique em **Reload** no cartão da extensão e recarregue as páginas abertas. O content script só é adicionado a páginas carregadas depois da instalação/reinicialização da extensão.

## Como usar pelo popup

### Criar e gerenciar empresas

1. Clique no ícone da extensão.
2. Informe o nome no campo **Nome da nova empresa** e clique em **Criar**.
3. Use o lápis ao lado da empresa para renomeá-la.
4. Use o `×` para excluir a empresa. A confirmação informa que todos os formulários vinculados também serão removidos.

### Salvar um formulário

1. Abra uma página HTTP/HTTPS e preencha o formulário normalmente.
2. Abra a extensão e selecione a empresa.
3. Em páginas com vários formulários, selecione o formulário correto na lista. Se um campo estiver em foco, seu formulário já aparecerá selecionado.
4. Clique em **Salvar formulário atual**.
5. Se já houver dados salvos para a mesma página e o mesmo formulário, confirme **Substituir**. Não são criadas duplicatas.

### Preencher, atualizar ou excluir

1. Abra a página em que o formulário foi salvo.
2. Abra a extensão e selecione a empresa.
3. O cartão compatível recebe o selo **Página atual ✓**.
4. Clique em **Preencher** para restaurar os dados.
5. Para substituir os dados salvos pelos valores atuais da página, clique em **Atualizar**.
6. Clique em **Ver/editar campos** para inspecionar identificadores, tipos e valores armazenados.
7. Nesse painel é possível alterar valores manualmente, marcar/desmarcar campos booleanos, editar seleções múltiplas com um valor por linha, remover campos individuais e alterar o nome exibido do formulário.
8. Clique em **Excluir** para remover somente aquele formulário.

Todos os formulários da empresa são listados. Em cartões pertencentes a outra página, **Preencher** e **Atualizar** ficam desabilitados para evitar aplicar dados no lugar errado.

## Como usar pelo botão direito

O menu **Form Saver** contém:

- **Cadastrar nova empresa**: abre uma página simples de cadastro.
- **Salvar formulário atual → Empresa**: salva os valores para a empresa escolhida.
- **Preencher formulário atual → Empresa**: procura e restaura o formulário compatível daquela empresa.

Ao clicar com o botão direito dentro de um campo, o formulário que contém esse campo tem prioridade. Caso contrário, a extensão usa o formulário com foco ou o único formulário da página. Se ainda houver ambiguidade, uma caixa de seleção é exibida dentro da página. Uma confirmação semelhante é exibida antes de substituir um registro existente.

## Arquitetura

```text
manifest.json                 Manifest V3, permissões e pontos de entrada
background/
  service-worker.js          Storage, mensagens e menus de contexto dinâmicos
content/
  content-script.js          Descoberta, extração, seleção e preenchimento
lib/
  storage.js                 Modelo de dados e operações em chrome.storage.local
  nfse.js                    Tipos de empresa, etapas da nota e campos variáveis
icons/
  icon-16.png                Ícone da barra e dos menus do Chrome
  icon-32.png
  icon-48.png
  icon-128.png               Ícone da página de extensões/instalação
  icon-source.png            Arte original em alta resolução
popup/
  popup.html                 Estrutura do popup
  popup.css                  Interface do popup
  popup.js                   Empresas e ações de formulário
manage/
  manage.html                Cadastro iniciado pelo menu de contexto
  manage.css
  manage.js
tests/
  manual-test.html           Página local para validar os cenários principais
requirements.md              Especificação original
README.md                    Esta documentação
readm.md                     Atalho mantido para o nome solicitado
```

O popup nunca acessa diretamente o DOM da página. Ele pede ao content script para inspecionar ou preencher o formulário e envia as mutações de dados ao service worker. O service worker centraliza as alterações no storage e recria os menus quando uma empresa muda.

### Modelo de dados

O storage mantém um objeto `formSaverData` com esta hierarquia:

```text
companies
└── companyId
    ├── name, type, createdAt, updatedAt
    └── forms
        └── pageAddress|formIdentifier
            ├── metadados da página e do formulário
            └── fields[]
```

Os campos são uma lista, em vez de um mapa, para suportar checkbox e radio com nomes repetidos. Cada item guarda um identificador primário e alternativas (`name`, `id`, `aria-label`, label associada e outros fallbacks).

### Identificação e preenchimento

- Página: `location.origin + location.pathname`.
- Formulário: `name` → `id` → fingerprint baseado em atributos e campos. Ocorrências duplicadas são diferenciadas.
- Campo: `name` → `id` → `aria-label` → label → atributos auxiliares → fingerprint.
- Radio: armazena o valor selecionado do grupo.
- Checkbox: armazena `checked` e o valor da opção para distinguir grupos.
- Select múltiplo: armazena uma lista de valores.
- Frameworks: usa o setter nativo de `value`/`checked` e emite `input` e `change` com propagação.
- Frameworks: usa o setter nativo de `value`/`checked` e emite `input` e `change` com propagação.
- Máscaras e consultas automáticas: além de `input` e `change`, emite `keydown`, `beforeinput` e `keyup`, que são os eventos ouvidos por bibliotecas de máscara e por buscas de CNPJ/CEP. A saída do campo só acontece um quadro depois da escrita, para o framework processar o valor antes de a validação disparar.
- Combobox: campos com `role="combobox"`, `aria-autocomplete` ou marcação equivalente recebem o texto, aguardam a lista de sugestões e têm a opção correspondente clicada, porque só escrever o texto deixa o identificador interno do portal vazio.
- `select` alimentado por AJAX: o campo só é considerado pronto quando a opção salva realmente existe na lista. Um `select` vazio nunca é dado como preenchido.
- `select` decorado por um componente próprio: escrever no `select` de trás não repinta o componente nem avisa o modelo do site. A detecção não depende só de visibilidade, porque as bibliotecas escondem de formas diferentes — Chosen usa `display: none`, Select2 mantém o elemento no layout recortado a um pixel, com `aria-hidden`. São tratados como decorados os `select` invisíveis, os marcados com `aria-hidden`, os da classe do Select2 e os reduzidos a menos de dois pixels.
- Componente com a lista já no `select` (caso do Chosen): a extensão escreve o valor no elemento e emite os eventos personalizados que fazem a biblioteca reler o campo, entre eles `chosen:updated`. Não é preciso abrir o painel.
- Componente com lista remota (caso do Select2 com AJAX): o `select` guarda apenas a opção escolhida, e a lista só existe dentro do painel. A extensão abre o componente, digita um prefixo do texto da opção no campo de busca — localizado por receber o foco na abertura, o sinal mais confiável — e clica na linha correspondente. A escolha exige casamento exato do texto, ou um prefixo que só case com uma linha: nunca "a primeira da lista", porque um município errado é pior do que um campo vazio.
- Listas dependentes em cadeia (país → município → código → item): cada rodada destrava um elo, e as passadas continuam enquanto houver progresso. Se o valor salvo já era o valor corrente, o framework não enxerga mudança e o carregador da lista seguinte não roda; nesse caso a extensão passa por outra opção e volta, produzindo a mudança real que destrava a cadeia.
- `select`: além do `value`, o texto da opção é salvo e serve de segunda chance quando o portal regenera os identificadores entre acessos.

### Preenchimento sequencial

O preenchimento acontece em até cinco passadas, e para assim que uma rodada deixa de destravar campos novos.

Na primeira, os campos são percorridos na ordem salva. Cada um espera até três segundos para ficar utilizável, e a espera termina assim que o DOM muda — não há intervalo fixo. Um campo está utilizável quando existe, não está `disabled` nem `aria-disabled`, e, no caso de `select`, quando a opção salva já foi carregada. Campos invisíveis ou somente leitura são aceitos depois de uma carência curta, o que cobre `select` substituído por widget e campos preenchidos pelo próprio site.

Depois de escrever, a extensão relê o campo e compara com o valor salvo, tolerando as diferenças de pontuação introduzidas por máscaras. Se não bateu, tenta de novo, até três vezes.

Nas passadas seguintes entram os campos que nunca ficaram prontos e também os que foram preenchidos e depois zerados por uma reação tardia do site. A espera sobe para oito e depois dez segundos por campo. Há um limite global de dois minutos, e o preenchimento pode ser cancelado a qualquer momento pelo aviso exibido na página.

Durante a espera, a extensão repete uma vez a interação no campo anterior, para cobrir validadores assíncronos que só reagem à segunda interação.

Quando o campo anterior é radio, checkbox ou `select` — os gatilhos típicos de uma etapa nova, que costuma custar uma ida ao servidor — o campo seguinte ganha prazo maior já na primeira passada.

Ao final, o resultado separa três situações: campos confirmados, campos escritos mas sem confirmação possível, e campos ausentes. Cada campo ausente vem com o rótulo e o motivo apurado, por exemplo `Motivo da não informação do NIF (a opção de valor "1" não existe na lista. Opções: Selecione…)`. O aviso de erro permanece trinta segundos na página.

## Permissões e privacidade

- `storage`: persistir empresas e formulários localmente.
- `contextMenus`: oferecer as ações no botão direito.
- `activeTab`: comunicar-se com a aba em uso após uma ação explícita.

O content script é carregado em todos os frames da página. Quando a mensagem chega, apenas o frame que realmente contém o formulário responde; o frame principal responde no lugar dele somente quando não existe outro frame candidato.
- `http://*/*` e `https://*/*`: carregar o content script nas páginas comuns, requisito necessário para memorizar em qual campo o menu de contexto foi aberto.

A extensão não solicita acesso a páginas `file://`, páginas internas do Chrome, Chrome Web Store ou outros esquemas protegidos. Não há requisição de rede no código e nenhum dado sai do navegador.

## Teste manual

Uma página de exercício está em `tests/manual-test.html`. Como a extensão atua em HTTP/HTTPS, sirva a raiz do projeto com qualquer servidor estático. Por exemplo, se Python estiver instalado:

```powershell
python -m http.server 8080
```

Abra `http://localhost:8080/tests/manual-test.html` e recarregue essa aba depois de instalar a extensão. A página permite validar:

1. inputs simples;
2. escolha entre dois formulários;
3. checkbox;
4. radio;
5. select simples e múltiplo;
6. textarea;
7. remoção de campo e preenchimento parcial;
8. substituição de formulário existente;
9. valores diferentes para duas empresas;
10. reconhecimento com query strings diferentes;
11. detecção dos eventos usados por interfaces reativas.
12. formulário progressivo em que um campo habilita o próximo via JavaScript.
13. `select` de município carregado por AJAX depois da escolha do estado;
14. campo com máscara de CNPJ, conferindo que o valor salvo sem pontuação é aceito;
15. campo somente leitura preenchido pelo próprio site após a consulta do CNPJ;
16. combobox com lista de sugestões, que exige a opção ser escolhida;
17. etapa oculta que só aparece depois do município;
18. checkbox marcado por padrão que precisa ser restaurado desmarcado.

Para o cenário 10, salve em `manual-test.html?id=100` e tente preencher em `manual-test.html?id=200`.

## Como depurar

### Popup

1. Abra `chrome://extensions`.
2. No cartão da extensão, clique em **Inspect views: popup** enquanto o popup estiver aberto; ou clique com o botão direito dentro do popup e escolha **Inspect**.
3. Use as abas Console, Sources e Network do DevTools.

O popup fecha quando perde o foco; mantenha seu DevTools aberto durante a investigação.

### Service worker

1. Abra `chrome://extensions`.
2. No cartão da extensão, clique no link **service worker**.
3. Verifique o Console e defina breakpoints em `background/service-worker.js`.

O Chrome encerra e reinicia o service worker quando ele fica ocioso. O código não depende de variáveis em memória para dados persistentes; os menus também são reconstruídos na instalação, inicialização e em alterações do storage.

### Content script

1. Abra o DevTools da página testada (`F12`).
2. Em Sources, procure **Content scripts → Form Saver**.
3. Defina breakpoints em `content/content-script.js`.
4. Mensagens e erros associados à página aparecem no Console do DevTools dessa página.

### Inspecionar ou limpar os dados

No DevTools do service worker ou popup:

```javascript
chrome.storage.local.get("formSaverData").then(console.log)
```

Para remover somente os dados da extensão durante testes:

```javascript
chrome.storage.local.remove("formSaverData")
```

Após a remoção, os menus de contexto são atualizados automaticamente.

## Formulários divididos em etapas

Cada etapa costuma ter endereço próprio. No emissor nacional da NFS-e, por exemplo, os três passos são `/DPS/Pessoas`, `/DPS/Servico` e `/DPS/Tributacao`. Como a extensão reconhece a página por `origin + pathname`, cada etapa vira um formulário salvo separado dentro da mesma empresa: salve uma vez em cada uma e depois preencha uma a uma.

A query string é ignorada, então o identificador do rascunho na URL não atrapalha: o que foi salvo num rascunho serve para os seguintes.

Vale rever os campos salvos e remover os que mudam a cada emissão — data de competência, número do documento, número do pedido. Use **Ver/editar campos** e o botão **Remover** do campo. O que sobra é o que de fato se repete.

## Limitações conhecidas

- Controles customizados que não usam `input`, `select` ou `textarea` não são capturados. Componentes que apenas decoram um `select` real são suportados; componentes construídos só com `div` não.
- Para operar um componente de lista remota, a extensão precisa do texto da opção, porque o valor sozinho não é pesquisável. Formulários salvos antes desta versão guardam apenas o valor: salve-os de novo para gravar também o texto.
- Formulários dentro de Shadow DOM fechado não podem ser inspecionados.
- Formulários dentro de iframes funcionam, mas a lista de seleção do popup mostra apenas os formulários de um frame por vez.
- Sites podem aplicar validações próprias, máscaras ou bloquear eventos sintéticos. Os setters nativos atendem aos frameworks mais comuns, mas componentes muito específicos podem exigir integração adicional.
- O tempo máximo para um campo dinâmico aparecer ou ser habilitado é de três segundos na primeira passada e oito na segunda, com limite global de dois minutos.
- A escolha em um combobox aguarda até dois segundos pela lista de sugestões; sem lista, o campo fica apenas com o texto digitado.
- Um formulário sem `name`/`id` e sem campos ou atributos estáveis pode mudar de fingerprint após grandes alterações no DOM.
- Páginas internas do navegador, Chrome Web Store, visualizador de PDF e páginas abertas antes da instalação/reload da extensão não aceitam o content script.
- O storage é local ao perfil do Chrome e não é sincronizado nem criptografado pela extensão. Qualquer pessoa com acesso ao perfil do navegador pode acessar esses dados.

## Segurança

A extensão apenas altera valores dos campos. Ela nunca envia teclas de confirmação, não clica em botões de ação, não avança etapas e não executa `submit`. O único clique simulado acontece sobre o próprio campo — checkbox, radio e a sugestão de um combobox. Revise os valores preenchidos e conclua qualquer envio manualmente.
