# Especificação de Requisitos — Extensão Chrome para Salvamento e Preenchimento de Formulários

## 1. Objetivo

Desenvolver uma extensão para Google Chrome, utilizando **Manifest V3**, que permita ao usuário cadastrar entidades chamadas **Empresas** e, para cada empresa, salvar e posteriormente restaurar os valores preenchidos em formulários de páginas web.

O principal caso de uso é o preenchimento recorrente de formulários divididos em múltiplas páginas ou etapas, como processos de emissão de nota fiscal, nos quais determinados dados permanecem iguais para uma mesma empresa.

A extensão deverá permitir que o usuário preencha um formulário manualmente uma única vez, salve os valores associados à empresa correspondente e, em acessos futuros à mesma página/formulário, restaure esses dados automaticamente mediante ação explícita do usuário.

A extensão não deve depender de backend, servidor externo ou banco de dados remoto. Os dados deverão ser armazenados localmente no navegador.

---

## 2. Conceitos principais

### Empresa

Uma Empresa é uma entidade lógica criada pelo usuário para agrupar conjuntos de formulários e seus respectivos valores.

Exemplos:

* Empresa 1
* Empresa ABC Ltda
* Cliente XPTO

Uma empresa pode possuir diversos formulários salvos, inclusive pertencentes a diferentes páginas de um mesmo site.

### Página

Uma Página representa o endereço onde determinado formulário foi salvo.

A identificação padrão da página deverá utilizar:

```text
origin + pathname
```

Exemplo:

```text
https://site.com/nfse/tomador
```

Parâmetros de query string e fragmentos de URL não devem fazer parte da identificação padrão.

Portanto:

```text
https://site.com/nfse/tomador?id=123
```

e:

```text
https://site.com/nfse/tomador?id=456
```

devem, por padrão, representar a mesma página:

```text
https://site.com/nfse/tomador
```

A implementação deve ser estruturada de forma que futuramente seja possível configurar parâmetros de query string relevantes, caso necessário.

### Formulário

Um formulário representa um elemento HTML `<form>` encontrado dentro da página.

A identificação deverá utilizar, prioritariamente:

1. `form.name`
2. `form.id`
3. fallback gerado pela extensão caso nenhum dos dois exista

A identidade lógica principal de um formulário salvo será:

```text
pageAddress + formIdentifier
```

Exemplo:

```text
https://site.com/nfse/tomador|formTomador
```

### Campo

São considerados campos salváveis inicialmente:

```text
input
select
textarea
```

Devem ser suportados, no mínimo:

* text
* number
* email
* tel
* url
* date
* datetime-local
* time
* month
* week
* checkbox
* radio
* select
* select multiple
* textarea

Campos do tipo:

```text
password
file
hidden
submit
button
reset
image
```

não devem ser salvos por padrão.

---

## 3. Fluxo principal

O fluxo esperado deve ser o seguinte.

### Primeiro uso

O usuário acessa qualquer página suportada.

Abre a extensão ou utiliza o menu de contexto do Chrome.

Cria uma nova empresa.

Exemplo:

```text
Empresa ABC
```

O usuário poderá criar quantas empresas desejar.

Em seguida, acessa uma página contendo um formulário.

Preenche manualmente os valores desejados.

Depois utiliza uma das seguintes opções:

```text
Extensão
→ Empresa ABC
→ Salvar formulário atual
```

ou:

```text
Botão direito
→ Form Saver
→ Salvar formulário atual
→ Empresa ABC
```

A extensão deverá identificar:

* endereço atual da página;
* formulário correspondente;
* campos pertencentes ao formulário;
* valores atuais dos campos.

Essas informações deverão ser persistidas para a empresa selecionada.

---

## 4. Uso recorrente

Posteriormente, ao acessar novamente uma página/formulário previamente salvo, o usuário deverá poder abrir a extensão.

A extensão mostrará a lista de empresas cadastradas.

Exemplo:

```text
Empresas

Empresa ABC
Empresa XYZ
Empresa Teste

+ Nova empresa
```

Ao clicar em uma empresa, a extensão deverá mostrar todos os formulários/páginas salvos para ela.

Exemplo:

```text
Empresa ABC

Formulários salvos

Dados do Tomador
/nfse/tomador

Dados do Serviço
/nfse/servico

Impostos
/nfse/impostos
```

Cada formulário deverá possuir pelo menos a ação:

```text
Preencher
```

Ao clicar em **Preencher**, a extensão deverá localizar o formulário correspondente na página atual e aplicar os valores previamente armazenados.

---

## 5. Ações disponíveis dentro de uma empresa

Ao selecionar uma empresa na extensão, deverão existir pelo menos as seguintes opções:

```text
Salvar formulário atual
```

e uma lista dos formulários já armazenados.

Para cada formulário salvo:

```text
Preencher
Atualizar
Excluir
```

### Preencher

Aplica os dados salvos ao formulário correspondente da página atual.

### Atualizar

Substitui os valores anteriormente salvos pelos valores atualmente presentes no formulário da página.

### Excluir

Remove apenas aquele formulário salvo da empresa.

A exclusão deve solicitar confirmação.

---

## 6. Cadastro de empresas

O cadastro de empresas deverá poder ser iniciado de duas maneiras.

### Pelo popup da extensão

Deve existir:

```text
+ Nova empresa
```

Ao selecionar essa opção, o usuário deverá informar pelo menos:

```text
Nome da empresa
```

Exemplo:

```text
Empresa ABC
```

### Pelo menu de contexto

Deve existir uma opção semelhante a:

```text
Botão direito
→ Form Saver
→ Cadastrar nova empresa
```

Essa ação deve abrir uma interface simples para informar o nome da empresa.

A implementação pode utilizar:

* popup próprio;
* página interna da extensão;
* modal controlado pela extensão;

desde que a experiência seja simples.

---

## 7. Menu de contexto do Chrome

A extensão deverá utilizar:

```javascript
chrome.contextMenus
```

O menu principal deverá ser semelhante a:

```text
Form Saver
├── Cadastrar nova empresa
├── Salvar formulário atual
│   ├── Empresa ABC
│   ├── Empresa XYZ
│   └── Empresa Teste
│
└── Preencher formulário atual
    ├── Empresa ABC
    ├── Empresa XYZ
    └── Empresa Teste
```

A lista deve ser atualizada dinamicamente de acordo com as empresas cadastradas.

Ao selecionar:

```text
Salvar formulário atual
→ Empresa ABC
```

a extensão deverá salvar o formulário correspondente à página atual para a Empresa ABC.

Ao selecionar:

```text
Preencher formulário atual
→ Empresa ABC
```

a extensão deverá procurar automaticamente um formulário salvo para:

```text
empresa
+
pageAddress
+
formIdentifier
```

e preenchê-lo.

O usuário não deverá precisar selecionar manualmente a página salva ao utilizar o menu de contexto.

---

## 8. Identificação do formulário no menu de contexto

Caso o usuário clique com o botão direito dentro de um campo pertencente a um `<form>`, esse formulário deverá ser considerado o formulário atual.

A identificação poderá ser feita utilizando:

```javascript
clickedElement.closest("form")
```

Quando possível.

Exemplo:

```html
<form name="formNotaFiscal">

    <input name="cnpj">

    <input name="razaoSocial">

</form>
```

Se o usuário clicar com o botão direito sobre o campo `cnpj`, o formulário a ser salvo deverá ser:

```text
formNotaFiscal
```

Caso não seja possível determinar o formulário através do elemento clicado, deverão ser utilizadas as regras de seleção definidas na seção seguinte.

---

## 9. Múltiplos formulários na mesma página

Uma página pode conter vários elementos `<form>`.

Exemplo:

```html
<form name="formBusca">
</form>

<form name="formNotaFiscal">
</form>
```

A extensão não deverá salvar automaticamente todos os formulários indiscriminadamente.

A seleção deverá seguir esta prioridade:

1. formulário contendo o elemento em que o usuário clicou com botão direito;
2. formulário contendo o elemento atualmente em foco;
3. único formulário existente na página;
4. caso existam múltiplos formulários e não seja possível inferir qual deve ser utilizado, apresentar uma lista para o usuário selecionar.

Exemplo:

```text
Selecione o formulário

formBusca
formNotaFiscal
```

---

## 10. Identificação dos campos

Os campos devem possuir um identificador estável para permitir que sejam encontrados novamente.

A prioridade de identificação deverá ser:

1. atributo `name`;
2. atributo `id`;
3. `aria-label`;
4. label associado ao campo;
5. outro mecanismo de fallback estável.

Exemplo:

```html
<input
    name="cnpj"
    id="field-cnpj"
>
```

O campo deverá ser armazenado prioritariamente como:

```text
cnpj
```

e não pelo ID.

A estrutura interna poderá armazenar também identificadores alternativos para melhorar a resiliência.

Exemplo conceitual:

```json
{
  "primary": {
    "type": "name",
    "value": "cnpj"
  },
  "fallbacks": [
    {
      "type": "id",
      "value": "field-cnpj"
    }
  ]
}
```

---

## 11. Identificação de página + formulário

A identificação de um formulário salvo deverá ser baseada obrigatoriamente em:

```text
address + form name
```

Considerando os fallbacks definidos anteriormente.

Exemplo:

```text
Address:
https://site.com/nfse/tomador

Form:
formTomador
```

Chave interna:

```text
https://site.com/nfse/tomador|formTomador
```

Quando não existir `form.name`, utilizar:

```text
address + form.id
```

Caso nenhum dos dois esteja disponível, criar um identificador interno consistente.

---

## 12. Salvamento dos campos

Ao selecionar **Salvar formulário atual**, a extensão deverá percorrer os elementos salváveis pertencentes exclusivamente ao formulário selecionado.

Exemplo:

```javascript
form.querySelectorAll(
  "input, select, textarea"
)
```

Cada campo deve possuir:

```text
identificador
tipo
valor
```

Dependendo do tipo, outras informações poderão ser necessárias.

### Checkbox

Salvar:

```text
checked
```

### Radio

Salvar qual opção está selecionada.

Preferencialmente utilizando:

```text
name + value
```

### Select

Salvar o valor selecionado.

### Select multiple

Salvar uma lista dos valores selecionados.

### Input comum

Salvar:

```text
value
```

---

## 13. Preenchimento dos campos

O preenchimento não deverá simplesmente alterar o atributo HTML.

Deverá simular adequadamente uma interação reconhecida pelas aplicações web modernas.

Por exemplo:

```javascript
element.value = savedValue;

element.dispatchEvent(
  new Event("input", {
    bubbles: true
  })
);

element.dispatchEvent(
  new Event("change", {
    bubbles: true
  })
);
```

A implementação deverá ser compatível, sempre que possível, com aplicações desenvolvidas em:

* JavaScript tradicional;
* React;
* Angular;
* Vue;
* frameworks similares.

Quando necessário, utilizar o setter nativo da propriedade `value` antes de emitir os eventos.

Exemplo conceitual:

```javascript
const setter =
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  ).set;

setter.call(element, savedValue);

element.dispatchEvent(
  new Event("input", {
    bubbles: true
  })
);

element.dispatchEvent(
  new Event("change", {
    bubbles: true
  })
);
```

---

## 14. Segurança

A extensão deverá seguir os seguintes princípios.

Não armazenar:

* senhas;
* arquivos selecionados em inputs;
* dados de campos password.

Não executar envio automático de formulário.

O preenchimento deverá apenas modificar campos.

A extensão não deverá executar automaticamente:

```text
submit
confirmar
emitir
salvar
avançar
```

ou qualquer botão equivalente do site.

Essas ações continuam sendo responsabilidade do usuário.

---

## 15. Armazenamento

Utilizar preferencialmente:

```javascript
chrome.storage.local
```

Não utilizar `localStorage` da página.

Não utilizar servidor remoto.

Não utilizar banco de dados externo.

Os dados deverão permanecer associados ao perfil do Chrome onde a extensão está instalada.

---

## 16. Modelo de dados sugerido

Utilizar IDs internos para as empresas.

Exemplo:

```json
{
  "companies": {
    "uuid-company-1": {
      "id": "uuid-company-1",
      "name": "Empresa ABC",
      "createdAt": "2026-08-14T15:00:00Z",
      "updatedAt": "2026-08-14T15:00:00Z",

      "forms": {
        "https://site.com/nfse/tomador|formTomador": {
          "pageAddress": "https://site.com/nfse/tomador",
          "pageTitle": "Emissão NFSe - Tomador",

          "formIdentifier": {
            "type": "name",
            "value": "formTomador"
          },

          "displayName": "Dados do Tomador",

          "createdAt": "2026-08-14T15:01:00Z",
          "updatedAt": "2026-08-14T15:01:00Z",

          "fields": {
            "cnpj": {
              "identifier": {
                "type": "name",
                "value": "cnpj"
              },
              "elementType": "input",
              "inputType": "text",
              "value": "12345678000190"
            },

            "razaoSocial": {
              "identifier": {
                "type": "name",
                "value": "razaoSocial"
              },
              "elementType": "input",
              "inputType": "text",
              "value": "Empresa ABC Ltda"
            }
          }
        }
      }
    }
  }
}
```

A estrutura exata poderá ser alterada pelo desenvolvedor desde que preserve os conceitos e requisitos funcionais descritos neste documento.

---

## 17. Interface do popup

A interface deverá ser simples e funcional.

### Tela principal

Exemplo:

```text
┌──────────────────────────────────┐
│ Form Saver                       │
│                                  │
│ Empresas                         │
│                                  │
│ > Empresa ABC                    │
│ > Empresa XYZ                    │
│ > Empresa Teste                  │
│                                  │
│ + Nova empresa                   │
└──────────────────────────────────┘
```

### Tela da empresa

Ao clicar em uma empresa:

```text
┌──────────────────────────────────┐
│ ← Empresas                       │
│                                  │
│ Empresa ABC                      │
│                                  │
│ Página atual                     │
│ /nfse/tomador                    │
│ formTomador                      │
│                                  │
│ [ Salvar formulário atual ]      │
│                                  │
│ Formulários salvos               │
│                                  │
│ Dados do Tomador                 │
│ /nfse/tomador                    │
│ [ Preencher ]                    │
│                                  │
│ Dados do Serviço                 │
│ /nfse/servico                    │
│ [ Preencher ]                    │
│                                  │
│ Impostos                         │
│ /nfse/impostos                   │
│ [ Preencher ]                    │
└──────────────────────────────────┘
```

---

## 18. Formulário correspondente à página atual

Quando a empresa selecionada possuir um formulário cuja chave corresponda à página atual, esse formulário deverá receber destaque na interface.

Exemplo:

```text
Dados do Tomador

Página atual ✓

[ Preencher ]
[ Atualizar ]
```

Isso deve facilitar o uso cotidiano.

---

## 19. Página salva que não corresponde à página atual

A extensão deverá listar todos os formulários armazenados para a empresa.

Entretanto, o botão **Preencher** deverá estar habilitado apenas quando for possível encontrar o formulário correspondente na página atual.

Por exemplo, se o usuário estiver em:

```text
/nfse/tomador
```

e visualizar:

```text
Dados do Serviço
/nfse/servico
```

a extensão pode exibir o registro, porém indicar:

```text
Não corresponde à página atual
```

Não deve tentar aplicar campos de outro formulário em uma página diferente.

---

## 20. Salvamento de formulário já existente

Se o usuário executar:

```text
Salvar formulário atual
```

para uma combinação de:

```text
empresa
+
pageAddress
+
formIdentifier
```

que já exista, a extensão deverá solicitar:

```text
Este formulário já possui dados salvos para esta empresa.

Deseja substituir os dados existentes?

[ Cancelar ]
[ Substituir ]
```

Não criar duplicatas.

---

## 21. Gerenciamento de empresas

A extensão deverá permitir:

* criar empresa;
* renomear empresa;
* excluir empresa.

Ao excluir uma empresa, todos os formulários associados a ela serão removidos.

A exclusão deverá solicitar confirmação explícita.

Exemplo:

```text
Excluir "Empresa ABC"?

Todos os formulários salvos para esta empresa serão removidos.

[ Cancelar ]
[ Excluir ]
```

---

## 22. Feedback ao usuário

Todas as operações devem informar claramente seu resultado.

Exemplos:

```text
Formulário salvo com sucesso.
```

```text
12 campos preenchidos.
```

```text
2 campos salvos não foram encontrados nesta página.
```

```text
Nenhum formulário compatível encontrado.
```

```text
Não foi possível identificar um formulário.
```

---

## 23. Preenchimento parcial

Caso alguns campos salvos não existam mais na página, a extensão não deverá abortar todo o preenchimento.

Exemplo:

```text
15 campos armazenados
13 campos preenchidos
2 campos não encontrados
```

Os demais campos deverão ser preenchidos normalmente.

---

## 24. Alterações no site

O mecanismo de identificação deve tentar ser resiliente a pequenas alterações no site.

Por exemplo, se um campo foi originalmente salvo utilizando:

```text
name="cnpj"
```

e seu ID for posteriormente alterado, a extensão ainda deverá encontrá-lo pelo `name`.

Para isso, os identificadores secundários podem ser armazenados juntamente com o identificador principal.

---

## 25. Arquitetura esperada

A extensão deverá utilizar **Manifest V3**.

Estrutura sugerida:

```text
extension/
│
├── manifest.json
│
├── background/
│   └── service-worker.js
│
├── content/
│   └── content-script.js
│
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── lib/
│   ├── storage.js
│   ├── forms.js
│   ├── fields.js
│   └── utils.js
│
└── icons/
```

Não é obrigatório seguir exatamente essa organização, mas responsabilidades devem ser separadas adequadamente.

---

## 26. Responsabilidades do Service Worker

O service worker deverá ser responsável por:

* inicializar a extensão;
* criar e atualizar os context menus;
* recuperar empresas do storage;
* responder às ações dos context menus;
* comunicar-se com o content script;
* manter menus sincronizados após criação, exclusão ou renomeação de empresas.

---

## 27. Responsabilidades do Content Script

O content script deverá ser responsável por:

* detectar formulários existentes;
* identificar formulário ativo;
* extrair valores;
* gerar identificação dos campos;
* localizar campos previamente salvos;
* preencher campos;
* disparar eventos necessários;
* retornar relatório das operações.

---

## 28. Responsabilidades do Popup

O popup deverá ser responsável por:

* listar empresas;
* cadastrar empresa;
* selecionar empresa;
* renomear empresa;
* excluir empresa;
* listar formulários da empresa;
* identificar página/form atual;
* salvar formulário atual;
* preencher formulário salvo;
* atualizar formulário;
* excluir formulário.

---

## 29. Permissões

Utilizar somente as permissões necessárias.

Provavelmente serão necessárias:

```json
{
  "permissions": [
    "storage",
    "contextMenus",
    "activeTab",
    "scripting"
  ]
}
```

Avaliar também `host_permissions`.

Evitar:

```text
<all_urls>
```

se for possível implementar um modelo de permissão menos amplo.

Entretanto, como o objetivo da extensão é funcionar em diferentes sites, pode ser necessário solicitar acesso às páginas em que o usuário deseja utilizá-la.

Escolher a solução compatível com Manifest V3 que proporcione boa experiência sem solicitar permissões desnecessárias.

---

## 30. Requisito importante: funcionamento genérico

A extensão não deverá possuir regras hardcoded especificamente para um site de emissão de nota fiscal.

O caso da nota fiscal é apenas o primeiro uso.

A solução deverá funcionar genericamente em páginas HTML que utilizem formulários e campos identificáveis.

A regra principal deve permanecer:

```text
Empresa
+
Address
+
Form Name
+
Field Name
```

com fallbacks quando algum atributo não existir.

---

## 31. Não incluir inicialmente

Não implementar na primeira versão:

* sincronização em nuvem;
* servidor;
* autenticação;
* compartilhamento entre usuários;
* preenchimento baseado em inteligência artificial;
* submissão automática;
* automação de navegação entre páginas;
* clique automático em botões;
* captura de senha;
* captura de cartão de crédito;
* importação automática a partir de sites externos.

A prioridade da primeira versão é confiabilidade e simplicidade.

---

## 32. Requisitos técnicos

O código deverá:

* utilizar JavaScript ou TypeScript;
* ser compatível com Chrome Manifest V3;
* evitar bibliotecas pesadas sem necessidade;
* possuir módulos separados por responsabilidade;
* possuir tratamento de erros;
* possuir comentários apenas onde agregarem valor;
* possuir código legível e simples de manter;
* evitar seletores frágeis baseados exclusivamente na posição DOM.

Se TypeScript for utilizado, fornecer também toda a configuração necessária para build.

---

## 33. Testes mínimos

Implementar ou documentar testes para pelo menos os seguintes cenários.

### Cenário 1

Página com um único formulário contendo inputs simples.

Salvar e preencher corretamente.

### Cenário 2

Página com dois formulários.

Selecionar corretamente qual formulário salvar.

### Cenário 3

Checkbox.

Salvar e restaurar estado.

### Cenário 4

Radio button.

Salvar e restaurar opção selecionada.

### Cenário 5

Select.

Salvar e restaurar opção.

### Cenário 6

Textarea.

Salvar e restaurar texto.

### Cenário 7

Campo salvo não existe mais.

Preencher os demais e reportar o campo ausente.

### Cenário 8

Formulário já salvo.

Solicitar substituição.

### Cenário 9

Duas empresas possuem valores diferentes para o mesmo formulário.

Os dados devem permanecer totalmente separados.

### Cenário 10

URL muda apenas query string.

O formulário continua sendo reconhecido como pertencente à mesma página.

Exemplo:

```text
/nfse/tomador?id=100
```

e:

```text
/nfse/tomador?id=200
```

### Cenário 11

Aplicação React ou similar.

O valor preenchido deve ser reconhecido pelo framework.

---

## 34. Critérios de aceite

A implementação será considerada funcional quando for possível executar o seguinte fluxo completo:

1. instalar a extensão localmente no Chrome;
2. acessar um site contendo formulários;
3. abrir a extensão;
4. criar `Empresa A`;
5. criar `Empresa B`;
6. preencher manualmente um formulário;
7. salvar o formulário para `Empresa A`;
8. alterar manualmente os valores;
9. salvar para `Empresa B`;
10. recarregar a página;
11. selecionar `Empresa A`;
12. clicar em `Preencher`;
13. verificar que os valores da Empresa A foram restaurados;
14. recarregar;
15. selecionar `Empresa B`;
16. clicar em `Preencher`;
17. verificar que os valores da Empresa B foram restaurados;
18. repetir o processo para diversas páginas diferentes;
19. encontrar todas essas páginas listadas dentro de cada empresa;
20. executar também salvamento e preenchimento através do menu do botão direito.

---

## 35. Entregáveis

Gerar um projeto completo e executável contendo:

* todo o código-fonte;
* `manifest.json`;
* popup funcional;
* context menus;
* content script;
* service worker;
* persistência em `chrome.storage.local`;
* gerenciamento de empresas;
* salvamento de formulários;
* preenchimento de formulários;
* README.

O README deverá explicar:

1. arquitetura da solução;
2. estrutura dos arquivos;
3. como instalar a extensão utilizando `chrome://extensions`;
4. como habilitar Developer Mode;
5. como carregar a extensão utilizando `Load unpacked`;
6. como utilizar a extensão;
7. limitações conhecidas;
8. como debugar o popup, service worker e content script.

---

## 36. Diretriz para desenvolvimento

Implemente primeiro um MVP funcional end-to-end, mantendo o código modular o suficiente para evoluções posteriores.

Evite criar abstrações excessivas antes da necessidade.

Priorize nesta ordem:

1. identificação consistente de página/formulário;
2. identificação consistente dos campos;
3. salvamento correto;
4. preenchimento correto;
5. funcionamento em aplicações modernas;
6. boa experiência no popup;
7. menu de contexto;
8. robustez contra pequenas mudanças no DOM.

Antes de finalizar, revise o projeto procurando principalmente erros relacionados a:

* Manifest V3;
* comunicação entre popup, service worker e content script;
* permissões;
* ciclo de vida do service worker;
* atualização dinâmica dos context menus;
* campos React controlados;
* radio e checkbox;
* páginas com múltiplos formulários;
* colisões entre formulários de diferentes empresas.

Entregue a implementação completa, evitando pseudocódigo em funcionalidades essenciais.
