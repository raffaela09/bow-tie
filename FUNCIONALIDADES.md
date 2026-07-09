# Funcionalidades — Módulo Diagrama Bow Tie (Full-Stack)

Lista de funcionalidades implementadas e verificadas nesta versão. Textos da
interface em português. Arquitetura: `frontend/` (HTML5 + CSS3 + JS puro) +
`backend/` (FastAPI + SQLite) — detalhes de arquitetura e das fórmulas de
coordenadas em `RELATORIO.md`.

## 1. Back-end (FastAPI + SQLite)

- [x] `database.py` inicializa `bowtie_risks.db` com a tabela `diagramas`
      (`id TEXT PRIMARY KEY`, `nome TEXT`, `dados_json TEXT`,
      `atualizado_em TIMESTAMP`).
- [x] `salvar_diagrama()` faz UPSERT via
      `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` — grava um diagrama novo
      ou atualiza um existente com o mesmo `id`, sem duplicar linhas.
- [x] `GET /` serve o `index.html` do front-end.
- [x] `POST /api/diagrama/salvar` aceita o payload via modelo Pydantic
      (`id` opcional, `nome`, `dados`) e grava no banco.
- [x] `GET /api/diagrama/{id}` recupera um diagrama salvo (404 se não existir).
- [x] `GET /api/diagrama` lista os diagramas salvos (id, nome, data).
- [x] Arquivos estáticos (`style.css`, `script.js`) servidos via
      `StaticFiles` em `/static`.

## 2. Canvas infinito (modo claro)

- [x] Interface em **modo claro** (fundo cinza claro, painéis brancos, texto
      escuro) — canvas com **dot grid** que acompanha pan e zoom em tempo real
      (`background-size`/`background-position` recalculados a cada movimento).
- [x] **Pan dinâmico**: `Espaço` + clique esquerdo, **botão do meio do
      mouse** (em qualquer lugar, mesmo sobre um bloco), ou arrastar uma área
      vazia — cursor muda para `grabbing` durante o arraste. Rolagem simples
      do mouse também move a tela.
- [x] **Zoom focal**: `Ctrl` + roda do mouse (ou pinça no trackpad, que o
      navegador reporta como evento de rolagem com `ctrlKey=true`) — o ponto
      exato sob o cursor permanece fixo enquanto o zoom muda. Botões
      `+ Zoom`/`− Zoom` fazem o mesmo em direção ao centro da tela.
- [x] Botão **Ajustar** enquadra automaticamente todos os nós na área
      visível; **Reorganizar** recalcula um layout padrão em formato de bow
      tie.
- [x] Rodapé técnico com **Coordenadas: X, Y | Nível de zoom: XX%** em tempo
      real.

## 3. Drag & drop e ciclo de vida dos nós (sem alerts)

- [x] Sidebar com os 5 elementos regulamentares arrastáveis: **Evento
      Central**, **Causa**, **Barreira Preventiva**, **Barreira Mitigadora**,
      **Consequência**.
- [x] Ao soltar no canvas, a posição real no espaço infinito é calculada
      descontando pan e zoom vigentes (fórmula detalhada em `RELATORIO.md`,
      seção 3.3) — testado e validado com diferença sub-pixel em relação ao
      valor matematicamente esperado, em zoom ≠ 100%.
- [x] Uma barreira preventiva solta é associada **dinamicamente** (recalculado
      a cada desenho, não gravado) à causa mais próxima; uma barreira
      mitigadora, à consequência mais próxima — arrastar uma barreira para
      perto de outra causa/consequência a reassocia automaticamente.
- [x] **Remoção instantânea, sem `confirm()` nem `alert()`**: o botão "×" de
      cada nó remove o elemento do estado em memória e da tela imediatamente.
      Verificado via teste automatizado (Playwright) que **nenhum diálogo
      nativo dispara** durante o fluxo de remoção.
- [x] `Ctrl+Z` / `Ctrl+Y` continuam disponíveis como rede de segurança para
      reverter uma remoção ou edição, já que não há mais confirmação.
- [x] **Modal customizado de edição** (HTML/CSS puro, sobreposição
      centralizada — não usa o `<dialog>` nativo do navegador), aberto com
      duplo clique em qualquer nó:
  - Campo de texto, sempre presente.
  - Campo numérico de **eficácia do controle (0.0 a 1.0)**, exibido somente
    quando o nó é uma Barreira Preventiva ou Mitigadora.
  - `Enter` confirma, `Esc` cancela, clique fora do modal cancela.
- [x] Cada nó também exibe a eficácia (quando aplicável) diretamente na tela,
      como um rótulo discreto abaixo do texto.

## 4. Portabilidade: Exportar e Importar (estilo Draw.io)

- [x] **`localStorage` não é usado em nenhum momento** — o estado vive em
      memória (JavaScript) e é persistido apenas via backend ou arquivo.
- [x] **Exportar JSON** abre um modal com o JSON completo do diagrama atual
      num campo de texto (somente leitura, todo selecionado):
  - Botão **Copiar** — copia para a área de transferência
    (`navigator.clipboard`, com `document.execCommand("copy")` como
    contingência em navegadores sem a API).
  - Botão **Baixar arquivo** — baixa o mesmo conteúdo como `.json` (o
    comportamento anterior, mantido como opção dentro do modal).
- [x] **Importar JSON** abre o mesmo modal em modo de colagem: campo de texto
      vazio e editável (com dica de "cole aqui"), botão **Escolher
      arquivo...** (abre o seletor de arquivos do sistema e só preenche o
      campo de texto com o conteúdo lido — não importa sozinho) e botão
      **Importar**, que aplica o que estiver no campo de texto (colado à mão
      ou carregado de um arquivo) — substitui o canvas atual e reinicia o
      histórico de desfazer.
- [x] **Esc** fecha o modal de exportar/importar; clicar fora dele também
      fecha.
- [x] **Exportar Imagem (SVG)**: continua baixando diretamente (sem modal),
      gera um arquivo `.svg` autônomo e válido, com as mesmas formas/cores/
      conexões do diagrama, abrindo em qualquer navegador ou editor vetorial —
      verificado que o arquivo gerado começa com a tag `<svg>` e é bem
      formado.

## 5. Sincronização no fechamento da sessão

- [x] Toda alteração de conteúdo marca um estado interno "sujo" (`sujo =
      true`), verificado por `beforeunload` e por `visibilitychange` (quando
      `document.visibilityState === "hidden"`).
- [x] Ao disparar, tenta `navigator.sendBeacon("/api/diagrama/salvar", blob)`
      primeiro; se indisponível, cai para
      `fetch(..., { method: "POST", keepalive: true })`.
- [x] Só envia se houver alterações pendentes desde o último salvamento —
      evita tráfego desnecessário ao simplesmente fechar uma aba sem editar
      nada.

## Botões da barra de ferramentas

- Visualização: `− Zoom`, `+ Zoom`, `Ajustar`, `Reorganizar`.
- Nome do diagrama (campo de texto, usado no salvamento).
- Servidor: `Salvar` (grava no backend e mostra o ID retornado), campo de ID
  + `Carregar` (busca um diagrama salvo pelo ID).
- Histórico: `↺ Desfazer` / `↻ Refazer`.
- Validação: `Validar diagrama` (mostra um toast com o resultado —
  `validarDiagramaAtual()` também exposta em `window.BowTieDiagrama` e como
  `window.validarDiagramaAtual()` para integração externa).
- Sidebar: `Exportar JSON`, `Importar JSON`, `Exportar Imagem (SVG)`,
  `Novo diagrama`.

## Esquema de dados

```json
{
  "id": "uuid-ou-null",
  "nome": "Nome do diagrama",
  "dados": {
    "pan": { "x": 0, "y": 0 },
    "zoom": 1,
    "nos": [
      { "id": "string", "tipo": "evento|causa|consequencia|barreiraPreventiva|barreiraMitigadora",
        "texto": "string", "x": 0, "y": 0, "eficacia": 0.0 }
    ]
  }
}
```

`eficacia` só existe (e só é editável no modal) para nós do tipo
`barreiraPreventiva` ou `barreiraMitigadora`.

## Testado (Playwright, contra o servidor FastAPI real)

- Carregamento da página via `GET /` e dos estáticos via `/static/*`.
- Drag-and-drop dos 5 tipos de elemento da sidebar.
- Precisão do mapeamento de coordenadas em zoom ≠ 100%.
- Modal de edição (texto + eficácia) abrindo, preenchendo e salvando.
- Remoção instantânea sem nenhum diálogo nativo disparado.
- Validação com toast de sucesso/erro.
- Modal de exportar JSON (conteúdo correto, somente leitura, botão Copiar
  testado via `navigator.clipboard`, botão Baixar gerando arquivo real em
  disco).
- Modal de importar JSON: colar texto e importar; escolher um arquivo (o
  campo de texto é preenchido mas o estado só muda ao clicar Importar,
  confirmado explicitamente); fechar com Esc e com o botão Fechar.
- Exportar SVG real (arquivo verificado em disco).
- Salvar no servidor (`POST`), recarregar a página do zero e carregar o mesmo
  diagrama pelo ID (`GET`) — estado restaurado corretamente.

## Não incluído nesta versão (ver `RELATORIO.md`, seção 5)

- Perigo, fator de intensificação e função de gestão (presentes numa versão
  anterior deste módulo; ver justificativa da remoção em `RELATORIO.md`,
  seção 3.8).
- Autenticação nas rotas da API.
- Tela de listagem/gestão de diagramas salvos.
- Portas lógicas E/OU para múltiplas causas simultâneas.
