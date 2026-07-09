# Relatório do Módulo — Diagrama Bow Tie

## 1. Por que este sistema existe

Este módulo implementa a técnica de **Análise Bow Tie**, descrita no item **B.21** da
**ABNT NBR ISO/IEC 31010:2012 — Gestão de riscos: Técnicas para o processo de
avaliação de riscos**. Segundo a norma (B.21.1), a análise bow tie é *"uma
maneira esquemática simples de descrever e analisar os caminhos de um risco
desde as causas até as consequências"*, combinando o raciocínio de árvore de
falhas (causas) com o de árvore de eventos (consequências), com foco nas
**barreiras** entre as causas e o risco, e entre o risco e as consequências —
a norma chama esses dois lados de **controles de prevenção** (lado das causas)
e **controles de atenuação e recuperação** (lado das consequências), o que
neste módulo corresponde a "Barreira Preventiva" e "Barreira Mitigadora".

Dentro do sistema maior de gestão de riscos, este módulo existe para dar a
esse processo uma ferramenta de diagramação de verdade — não uma maquete: tela
infinita, arrastar-e-soltar, edição estruturada e persistência real em banco de
dados, para que o resultado do trabalho de identificação/análise de riscos
possa ser salvo, recuperado e (futuramente) consumido por outras partes do
sistema.

## 2. O que o sistema faz

Uma visão resumida; a lista completa e verificável está em `FUNCIONALIDADES.md`.

É uma aplicação full-stack dividida em `frontend/` (HTML5 + CSS3 + JavaScript
puro) e `backend/` (FastAPI + SQLite). O usuário abre a página servida pelo
FastAPI, arrasta elementos de uma sidebar (Evento Central, Causa, Barreira
Preventiva, Barreira Mitigadora, Consequência) para uma tela infinita em modo
claro, navega com pan (Espaço+clique, botão do meio, ou arrastar área vazia) e
zoom focal (Ctrl+roda/pinça), edita qualquer bloco com duplo clique através de
um modal próprio (texto e, para barreiras, a eficácia do controle de 0.0 a
1.0), e remove um bloco instantaneamente pelo "×" — sem nenhuma caixa de
diálogo nativa no meio do fluxo de edição. O diagrama pode ser salvo no banco
SQLite (`POST /api/diagrama/salvar`, com UPSERT), recuperado por ID
(`GET /api/diagrama/{id}`), exportado/importado independente do banco via um
modal que mostra o JSON completo (para copiar, colar ou baixar/escolher um
arquivo `.json`), e exportado como imagem vetorial `.svg` autônoma. Ao
fechar a aba ou trocar de janela, o estado é sincronizado automaticamente com
o servidor via `navigator.sendBeacon` (com fallback em `fetch(..., {keepalive:
true})`).

## 3. Como foi construído

### 3.1 Arquitetura geral

```
bowtie/
  frontend/           # servido pelo FastAPI, sem build step, sem dependências externas
    index.html
    style.css
    script.js
  backend/
    main.py           # rotas FastAPI
    database.py        # acesso SQLite (sqlite3 da biblioteca padrão)
    requirements.txt
```

O FastAPI serve o `index.html` na rota `GET /` e os arquivos estáticos
(`style.css`, `script.js`) montados em `/static`. Não há build step, bundler
ou framework de frontend — só HTML/CSS/JS puro, o que mantém o módulo fácil de
embutir em outro sistema (bastaria apontar o servidor de arquivos estáticos do
sistema principal para `frontend/`, ou rodar o FastAPI como um microsserviço
por trás de um proxy reverso).

### 3.2 Modelo de dados: lista plana de nós

Diferente de uma versão anterior deste módulo (que guardava causas e
consequências como listas aninhadas, cada uma com sua própria lista de
barreiras), esta versão usa uma **lista plana de nós**, exatamente como pedido
("a lista de nós"):

```json
{
  "id": "uuid-gerado-no-servidor-ou-cliente",
  "nome": "Nome do diagrama",
  "dados": {
    "pan": { "x": 60, "y": 60 },
    "zoom": 1,
    "nos": [
      { "id": "evt1", "tipo": "evento", "texto": "Evento indesejado", "x": 620, "y": 215 },
      { "id": "c1", "tipo": "causa", "texto": "Causa 1", "x": 80, "y": 140 },
      { "id": "b1", "tipo": "barreiraPreventiva", "texto": "Barreira 1", "x": 350, "y": 140, "eficacia": 0.7 },
      { "id": "k1", "tipo": "consequencia", "texto": "Consequência 1", "x": 1160, "y": 140 },
      { "id": "b2", "tipo": "barreiraMitigadora", "texto": "Barreira 1", "x": 890, "y": 140, "eficacia": 0.7 }
    ]
  }
}
```

Cada nó é independente e só tem os campos que faz sentido ter: `evento`,
`causa` e `consequencia` são só `{id, tipo, texto, x, y}`; `barreiraPreventiva`
e `barreiraMitigadora` ganham também `eficacia` (0.0 a 1.0, editada no modal).

**A quem cada barreira "pertence" não é um campo armazenado — é calculado pela
posição.** Uma barreira preventiva é sempre considerada ligada à **causa mais
próxima dela** (distância euclidiana entre todas as causas do diagrama); uma
barreira mitigadora, à **consequência mais próxima**. Essa é a mesma lógica já
usada para decidir a ordem de uma cadeia de barreiras (também derivada da
distância). A vantagem prática: arrastar uma barreira para perto de outra
causa **a reassocia automaticamente**, sem precisar de nenhuma ação extra de
"reatribuir dono" — e apagar uma causa nunca deixa uma barreira "órfã e presa"
a um dono inexistente, porque não existe essa referência guardada; a barreira
simplesmente passa a se ligar à próxima causa mais próxima (ou fica sem linha,
se não houver nenhuma).

### 3.3 Motor gráfico: mapeamento de coordenadas cliente ↔ canvas

Esta é a parte matemática mais sensível do módulo, então vale detalhar a
fórmula exata. O canvas infinito é implementado com uma única transformação
CSS no elemento `#world`:

```css
transform: translate(panX px, panY px) scale(zoom);
```

Os nós são posicionados dentro dele com `left`/`top` em **coordenadas do
mundo** — a transformação do elemento pai é quem os translada e escala na
tela. Converter um clique (`clientX`, `clientY`, pixels de tela) para a
posição no mundo exige desfazer a transformação, na ordem inversa:

```
worldX = (clientX − rectOuter.left − panX) / zoom
worldY = (clientY − rectOuter.top  − panY) / zoom
```

Essa fórmula é usada em três lugares distintos, e ela é a mesma nos três:

1. **Drop da sidebar** — calcula onde criar o novo bloco a partir do ponto
   onde o mouse soltou o item arrastado.
2. **Arrastar um bloco existente** — a cada movimento do mouse, o delta em
   pixels de tela é dividido por `zoom` para virar delta em unidades do
   mundo (`novoX = origX + dxTela / zoom`), senão o bloco "escaparia" do
   cursor conforme o zoom muda.
3. **Rodapé técnico** — mostra a coordenada do mundo sob o cursor em tempo
   real, usando a mesma fórmula.

**Zoom focal (o ponto sob o cursor não pode se mover):** ao mudar o zoom, é
preciso recalcular `panX`/`panY` de forma que o ponto do mundo que estava sob
o cursor antes da mudança continue sob o cursor depois. Isolando `panX`/`panY`
na fórmula acima:

```
worldX = (cursorX − panXantigo) / zoomAntigo      // ponto do mundo sob o cursor, antes
panXnovo = cursorX − worldX × zoomNovo             // pan que mantém esse ponto sob o cursor, depois
```

(mesma coisa para `Y`.) Sem isso, o zoom "puxaria" o diagrama para o canto
superior esquerdo a cada passo — o defeito clássico de implementações
ingênuas de zoom em canvas. O zoom com os botões +/− usa a mesma fórmula,
só que com o centro da tela como ponto de ancoragem em vez do cursor.

**Desenho das linhas de conexão (caminho inverso, mundo → tela) usa um
atalho.** Em vez de aplicar a fórmula manualmente, o código lê
`getBoundingClientRect()` de cada bloco já renderizado (o navegador aplica a
transformação CSS automaticamente) e só subtrai a posição do container. Ou
seja, a matriz de transformação é aplicada **uma única vez, pelo CSS**; o
JavaScript só faz a conta manual no sentido tela→mundo, porque ali o ponto de
partida é sempre um evento do navegador (`clientX`/`clientY`), não um
elemento já renderizado.

**Pan** (Espaço+clique, botão do meio, arrastar área vazia, ou rolagem simples
do mouse) só altera `panX`/`panY`, somando o delta do movimento do mouse
diretamente em pixels de tela — não envolve `zoom`, porque o pan ocorre no
mesmo espaço em que o mouse se move.

### 3.4 Ciclo de vida dos nós

- **Criação**: arrastar um dos 5 chips da sidebar (`dragstart` grava o tipo em
  `dataTransfer`; o canvas escuta `dragover`/`drop`, calcula a posição pela
  fórmula acima e cria o nó).
- **Edição**: duplo clique em qualquer nó abre um **modal customizado**,
  construído em HTML/CSS puro (uma `<div class="modal-overlay">` centralizada,
  não o elemento nativo `<dialog>`), com um campo de texto sempre presente e,
  se o nó for uma barreira, um campo numérico de eficácia (0.0–1.0). Salvar
  fecha o modal, grava no estado em memória e registra um passo no histórico
  de desfazer.
- **Remoção**: o botão "×" (aparece ao passar o mouse) remove o nó
  **imediatamente do estado em memória e da tela**, sem `confirm()` — conforme
  pedido explicitamente. Como não há confirmação, o **Ctrl+Z continua
  disponível e funcionando** como rede de segurança para reverter uma remoção
  acidental.
- **Movimento livre**: arrastar qualquer nó atualiza sua posição em tempo
  real; as linhas de conexão são recalculadas a cada frame do arraste.

### 3.5 Backend: FastAPI + SQLite

- `database.py` inicializa `bowtie_risks.db` com a tabela `diagramas` (`id`,
  `nome`, `dados_json`, `atualizado_em`) e expõe `salvar_diagrama` (UPSERT via
  `INSERT ... ON CONFLICT(id) DO UPDATE`) e `obter_diagrama`.
- **`id` é `TEXT PRIMARY KEY`, não `INTEGER AUTOINCREMENT`.** Essa foi uma
  decisão deliberada, diferente do que um schema ingênuo sugeriria: como a
  sincronização automática no fechamento da aba usa `sendBeacon` (que **não
  lê a resposta do servidor**), se o `id` fosse gerado pelo banco no primeiro
  salvamento, o cliente nunca saberia qual `id` usar nos salvamentos
  seguintes, e cada fechamento de aba sem um salvamento explícito prévio
  criaria uma linha nova. Com `id` em texto, o backend aceita um `id` opcional
  vindo do cliente e, se ausente, gera um `uuid4()` — mas o recomendado é o
  primeiro `Salvar` explícito (que lê a resposta e grava `estado.id` no
  JavaScript) acontecer antes de qualquer fechamento, para que os
  salvamentos automáticos seguintes sejam sempre um UPSERT limpo sobre um
  `id` já conhecido.
- `main.py` expõe `GET /` (serve o `index.html`), `POST /api/diagrama/salvar`
  (Pydantic `DiagramaPayload`), `GET /api/diagrama/{id}` e `GET /api/diagrama`
  (lista simples, útil para depuração).
- **Sincronização no fechamento**: `beforeunload` e `visibilitychange`
  (quando `document.visibilityState === "hidden"`) disparam
  `navigator.sendBeacon("/api/diagrama/salvar", blob)`; se `sendBeacon` não
  estiver disponível, cai para `fetch(..., { keepalive: true })` — a opção
  `keepalive` é o que permite a requisição sobreviver ao descarregamento da
  página, algo que um `fetch` comum não garante. Só dispara se houver
  alterações pendentes (`sujo === true`), para não gerar tráfego à toa.

### 3.6 Portabilidade: Exportar/Importar JSON e Exportar SVG

O `localStorage` **não é usado em nenhum momento** — a única forma de levar um
diagrama para fora do navegador sem passar pelo banco é o arquivo `.json`
baixado/carregado manualmente (mesmo formato do payload salvo no banco), ou o
texto colado à mão.

- **Exportar JSON** não baixa mais o arquivo direto ao clicar — abre um
  **modal** (`#modalJsonOverlay`, o mesmo componente reutilizado do modal de
  edição de nó, com um modo "exportar" e um modo "importar") com um campo de
  texto **somente leitura**, já preenchido com o JSON completo do diagrama
  atual e com o texto todo selecionado. De lá, o usuário pode:
  - **Copiar** — `navigator.clipboard.writeText()`, com
    `document.execCommand("copy")` como contingência em navegadores sem essa
    API;
  - **Baixar arquivo** — continua disponível, é a mesma função de antes
    (`exportarJSON()`), só que agora chamada de dentro do modal em vez de
    diretamente pelo botão da sidebar.
- **Importar JSON** abre o mesmo modal, em modo "importar": campo de texto
  vazio e **editável**, para colar o conteúdo à mão, mais um botão
  **Escolher arquivo...** que abre o seletor de arquivos do sistema — mas,
  diferente do fluxo anterior, escolher um arquivo **só lê o conteúdo para
  dentro do campo de texto**, não importa sozinho. Um botão **Importar**
  único aplica o que estiver no campo de texto nesse momento, não importa se
  chegou lá colado ou carregado de um arquivo — unificando os dois caminhos
  numa única função (`importarJSONTexto`) e dando ao usuário a chance de
  revisar/editar o JSON antes de confirmar. Substitui o estado em memória e
  reinicia o histórico de desfazer. `Esc` ou clique fora do modal fecha sem
  aplicar nada.
- **Exportar Imagem (SVG)** continua baixando direto, sem modal (não foi
  pedido para essa ação) — gera um arquivo `.svg` autônomo (sem depender do
  DOM nem de nenhuma biblioteca) a partir dos dados atuais, desenhando os
  mesmos formatos e as mesmas linhas de conexão do canvas, com tamanhos
  nominais por tipo de nó (já que um SVG estático não herda o tamanho
  automático das caixas HTML) e a mesma lógica de dono-mais-próximo para
  decidir as conexões. Abre em qualquer navegador ou editor vetorial
  (Inkscape, Illustrator etc.) sem depender deste sistema.

### 3.7 Fundamentação técnica (ABNT NBR ISO/IEC 31010:2012, Anexo B.21)

| Item da norma | Como foi implementado |
|---|---|
| a) Risco identificado como nó central | Nó de tipo `evento` (deve haver exatamente um) |
| b) Causas consideram fontes de risco | Nós de tipo `causa`, criados pela sidebar |
| e) Barreiras entre causa e evento ("controles de prevenção") | Nós `barreiraPreventiva`, com campo de eficácia (0.0–1.0) |
| f) Consequências e linhas irradiando do evento | Nós `consequencia` |
| g) Barreiras entre evento e consequência ("controles de atenuação e recuperação") | Nós `barreiraMitigadora`, com campo de eficácia |

### 3.8 Decisões e simplificações assumidas

- **Perigo, fator de intensificação e função de gestão (presentes em uma
  versão anterior deste módulo) não fazem parte desta reconstrução.** A
  especificação desta rodada enumerou explicitamente os 5 elementos
  regulamentares esperados na sidebar (Evento Central, Causa, Barreira
  Preventiva, Barreira Mitigadora, Consequência); dado que o modelo de dados
  foi reconstruído do zero (lista plana de nós, sem `localStorage`, com
  backend), optou-se por implementar exatamente o que foi pedido em vez de
  tentar reencaixar conceitos de uma arquitetura anterior incompatível — o que
  arriscaria um meio-termo confuso. Como o novo modelo é genérico (qualquer
  `tipo` de nó segue o mesmo ciclo de vida: arrastar da sidebar, editar no
  modal, remover pelo "×"), adicionar esses elementos de volta no futuro é
  uma questão de registrar um novo `tipo`, não de redesenhar a arquitetura.
- **`confirm()` mantido apenas em "Novo diagrama"`, não nos nós.** A instrução
  de remover alertas/confirmações foi lida no escopo em que apareceu — o botão
  "×" de remoção de um nó durante a edição, que agora é realmente instantâneo.
  "Novo diagrama" descarta a tela inteira (uma ação rara e mais destrutiva que
  apagar um nó, e sem uma rede de segurança de "desfazer" depois de recarregar
  a página), então manteve-se uma confirmação nativa ali como exceção
  deliberada — sinalizada aqui em vez de removida silenciosamente.
- **Chips rotulados exatamente como pedido** ("Barreira Preventiva" /
  "Barreira Mitigadora"), mesmo a norma não usando esses adjetivos
  literalmente (ela usa "controles de prevenção" e "controles de atenuação e
  recuperação") — mapeamento direto e documentado na tabela da seção 3.7.
- **Toques de notificação (toasts) no lugar de `alert()`/`prompt()`** para
  mensagens não-bloqueantes (confirmação de salvamento, erro de importação,
  aviso de barreira sem causa/consequência correspondente, resultado da
  validação) — consistente com o espírito de "sem alerts no fluxo".

## 4. Como executar

```bash
cd bowtie/backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Abrir `http://127.0.0.1:8000/`. O banco `bowtie_risks.db` é criado
automaticamente na primeira execução, na pasta `backend/`.

## 5. Próximos passos sugeridos (fora do escopo atual)

- Autenticação/autorização nas rotas da API (hoje qualquer cliente pode ler e
  gravar qualquer `id`).
- Listagem/gestão de diagramas na própria UI (a rota `GET /api/diagrama` já
  existe, mas não há tela para navegar entre diagramas salvos).
- Reintroduzir perigo, fator de intensificação e função de gestão como novos
  `tipo` de nó, seguindo o mesmo ciclo de vida genérico já existente.
- Portas lógicas E/OU entre causas (limitação nativa do bow tie, citada em
  B.21.6 da norma).
- Testes automatizados de backend (hoje a validação foi manual, via
  requisições HTTP reais durante o desenvolvimento).
