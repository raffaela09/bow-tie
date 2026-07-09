(function () {
  "use strict";

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2.5;
  var LIMITE_HISTORICO = 100;
  var TAMANHO_GRADE_BASE = 24;

  var contador = 100;
  function novoId(prefixo) {
    contador += 1;
    return prefixo + contador + "_" + Date.now().toString(36);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function escaparHtml(texto) {
    var div = document.createElement("div");
    div.textContent = texto == null ? "" : String(texto);
    return div.innerHTML;
  }

  function cssEscape(valor) {
    return window.CSS && CSS.escape ? CSS.escape(valor) : String(valor).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  var RESPONSABILIDADE = {
    evento: "Evento Central",
    causa: "Causa",
    consequencia: "Consequência",
    barreiraPreventiva: "Barreira Preventiva",
    barreiraMitigadora: "Barreira Mitigadora",
    degradacao: "Fator de Degradação",
    "texto-livre": "Texto",
    comentario: "Comentário"
  };

  function ehBarreira(n) {
    return !!n && (n.tipo === "barreiraPreventiva" || n.tipo === "barreiraMitigadora");
  }

  // ---------- Layout padrão (lista plana de nós) ----------

  function aplicarLayoutPadrao(nos) {
    var xCausa = 80, xEvento = 620, xConsequencia = 1160;
    var yBase = 140, passo = 150;

    var causas = nos.filter(function (n) { return n.tipo === "causa"; });
    var consequencias = nos.filter(function (n) { return n.tipo === "consequencia"; });
    var evento = nos.find(function (n) { return n.tipo === "evento"; });

    var maxLinhas = Math.max(causas.length, consequencias.length, 1);
    var yEvento = yBase + ((maxLinhas - 1) * passo) / 2;
    if (evento) { evento.x = xEvento; evento.y = yEvento; }

    causas.forEach(function (c, i) {
      c.x = xCausa; c.y = yBase + i * passo;
      var barreiras = nos.filter(function (n) { return n.tipo === "barreiraPreventiva" && maisProximo(n, causas) === c; });
      var total = barreiras.length;
      barreiras.forEach(function (b, j) {
        var frac = (j + 1) / (total + 1);
        b.x = c.x + frac * (xEvento - c.x);
        b.y = c.y;
      });
    });

    consequencias.forEach(function (k, i) {
      k.x = xConsequencia; k.y = yBase + i * passo;
      var barreiras = nos.filter(function (n) { return n.tipo === "barreiraMitigadora" && maisProximo(n, consequencias) === k; });
      var total = barreiras.length;
      barreiras.forEach(function (b, j) {
        var frac = (j + 1) / (total + 1);
        b.x = xEvento + frac * (k.x - xEvento);
        b.y = k.y;
      });
    });

    // Fatores de degradação: ramificam abaixo da barreira (nunca à direita — colidiria com a
    // linha reta barreira->consequência para barreiras mitigadoras).
    var todasBarreiras = nos.filter(ehBarreira);
    var offsetYDegradacao = 95, passoXDegradacao = 180;
    todasBarreiras.forEach(function (b) {
      var filhas = nos.filter(function (n) { return n.tipo === "degradacao" && n.barreiraId === b.id; });
      var total = filhas.length;
      filhas.forEach(function (d, j) {
        d.y = b.y + offsetYDegradacao;
        d.x = b.x + (j - (total - 1) / 2) * passoXDegradacao;
      });
    });
  }

  function maisProximo(ponto, lista) {
    if (!lista.length) return null;
    var melhor = lista[0];
    var melhorDist = dist(ponto, lista[0]);
    for (var i = 1; i < lista.length; i++) {
      var d = dist(ponto, lista[i]);
      if (d < melhorDist) { melhorDist = d; melhor = lista[i]; }
    }
    return melhor;
  }

  function estadoPadrao() {
    var nos = [
      { id: novoId("evt"), tipo: "evento", texto: "Evento indesejado", x: 0, y: 0 },
      { id: novoId("c"), tipo: "causa", texto: "Causa 1", x: 0, y: 0 },
      { id: novoId("c"), tipo: "causa", texto: "Causa 2", x: 0, y: 0 },
      { id: novoId("k"), tipo: "consequencia", texto: "Consequência 1", x: 0, y: 0 }
    ];
    var b1 = { id: novoId("b"), tipo: "barreiraPreventiva", texto: "Barreira 1", x: 0, y: 0, eficacia: 0.7, __causa: nos[1].id };
    nos.push(b1);
    nos.push({ id: novoId("b"), tipo: "barreiraPreventiva", texto: "Barreira 1", x: 0, y: 0, eficacia: 0.7, __causa: nos[2].id });
    nos.push({ id: novoId("b"), tipo: "barreiraMitigadora", texto: "Barreira 1", x: 0, y: 0, eficacia: 0.7 });
    nos.forEach(function (n) { delete n.__causa; });
    nos.push({ id: novoId("d"), tipo: "degradacao", texto: "Falha de manutenção", x: 0, y: 0, barreiraId: b1.id });
    aplicarLayoutPadrao(nos);
    return {
      id: null,
      nome: "Diagrama sem título",
      status: "em_progresso",
      pan: { x: 60, y: 60 },
      zoom: 1,
      nos: nos
    };
  }

  // ---------- Estado em memória (sem localStorage) ----------

  var estado = estadoPadrao();
  var sujo = false;
  var mundoEl, outerEl, canvasEl;

  function estadoParaPacote() {
    return {
      id: estado.id,
      nome: estado.nome,
      status: estado.status,
      dados: { pan: estado.pan, zoom: estado.zoom, nos: estado.nos }
    };
  }

  // ---------- Histórico (desfazer/refazer) — só cobre a lista de nós ----------

  var pilhaDesfazer = [];
  var pilhaRefazer = [];

  function clonarNos() {
    return JSON.stringify(estado.nos);
  }

  function restaurarNos(json) {
    estado.nos = JSON.parse(json);
  }

  function comHistorico(fn) {
    var antes = clonarNos();
    fn();
    var depois = clonarNos();
    if (antes !== depois) {
      pilhaDesfazer.push(antes);
      if (pilhaDesfazer.length > LIMITE_HISTORICO) pilhaDesfazer.shift();
      pilhaRefazer = [];
      sujo = true;
    }
    atualizarBotoesHistorico();
  }

  function desfazer() {
    if (!pilhaDesfazer.length) return;
    var atual = clonarNos();
    pilhaRefazer.push(atual);
    restaurarNos(pilhaDesfazer.pop());
    sujo = true;
    render();
    atualizarBotoesHistorico();
  }

  function refazer() {
    if (!pilhaRefazer.length) return;
    var atual = clonarNos();
    pilhaDesfazer.push(atual);
    restaurarNos(pilhaRefazer.pop());
    sujo = true;
    render();
    atualizarBotoesHistorico();
  }

  function atualizarBotoesHistorico() {
    var btnDesfazerFlutuante = document.getElementById("btnDesfazerFlutuante");
    var btnRefazerFlutuante = document.getElementById("btnRefazerFlutuante");
    if (btnDesfazerFlutuante) btnDesfazerFlutuante.disabled = pilhaDesfazer.length === 0;
    if (btnRefazerFlutuante) btnRefazerFlutuante.disabled = pilhaRefazer.length === 0;
  }

  // ---------- Notificações (substituem alert()/confirm() no fluxo de edição) ----------

  function mostrarNotificacao(mensagem, tipo) {
    var pilha = document.getElementById("toastPilha");
    var el = document.createElement("div");
    el.className = "toast toast-" + (tipo || "info");
    el.textContent = mensagem;
    pilha.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("mostrar"); });
    setTimeout(function () {
      el.classList.remove("mostrar");
      setTimeout(function () { el.remove(); }, 250);
    }, 3800);
  }

  // ---------- Renderização ----------

  function construirNoHtml(n) {
    var remover = '<button type="button" class="no-remover" data-id="' + escaparHtml(n.id) + '" title="Remover">×</button>';
    if (n.tipo === "comentario") {
      var iconeComentario = '<svg class="comentario-icone" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
      return '<div class="no no-comentario" data-id="' + escaparHtml(n.id) + '" data-tipo="comentario" style="left:' + n.x + "px;top:" + n.y + 'px;">' +
        iconeComentario + remover + "</div>";
    }
    var icone = "";
    if (ehBarreira(n)) icone = '<span class="no-icone" aria-hidden="true">🛡</span>';
    else if (n.tipo === "degradacao") icone = '<span class="no-icone" aria-hidden="true">⚠</span>';
    var conteudo = icone + '<span class="texto-no">' + escaparHtml(n.texto) + "</span>";
    if (ehBarreira(n) && typeof n.eficacia === "number") {
      conteudo += '<span class="eficacia-etiqueta">Eficácia: ' + n.eficacia.toFixed(2) + "</span>";
    }
    return '<div class="no no-' + n.tipo + '" data-id="' + escaparHtml(n.id) + '" data-tipo="' + n.tipo + '" style="left:' + n.x + "px;top:" + n.y + 'px;">' +
      conteudo + remover + "</div>";
  }

  function render() {
    mundoEl.innerHTML = estado.nos.filter(function (n) { return n.tipo !== "desenho"; }).map(construirNoHtml).join("");
    aplicarTransformMundo();
    requestAnimationFrame(desenharLinhas);
  }

  var ultimaCoordenadaMundo = { x: 0, y: 0 };

  function aplicarTransformMundo() {
    mundoEl.style.transform = "translate(" + estado.pan.x + "px," + estado.pan.y + "px) scale(" + estado.zoom + ")";
    var tamanhoGrade = TAMANHO_GRADE_BASE * estado.zoom;
    outerEl.style.backgroundSize = tamanhoGrade + "px " + tamanhoGrade + "px";
    outerEl.style.backgroundPosition = estado.pan.x + "px " + estado.pan.y + "px";
    atualizarRodapeStatus();
  }

  function atualizarRodapeStatus(clientX, clientY) {
    var el = document.getElementById("rodapeStatus");
    if (!el) return;
    if (typeof clientX === "number") {
      var rect = outerEl.getBoundingClientRect();
      ultimaCoordenadaMundo = {
        x: Math.round((clientX - rect.left - estado.pan.x) / estado.zoom),
        y: Math.round((clientY - rect.top - estado.pan.y) / estado.zoom)
      };
    }
    var zoomPct = Math.round(estado.zoom * 100);
    el.textContent = "Coordenadas: " + ultimaCoordenadaMundo.x + ", " + ultimaCoordenadaMundo.y + " | Nível de zoom: " + zoomPct + "%";
  }

  // ---------- Canvas: linhas de conexão (espaço de tela) ----------

  function pontoNaBorda(rect, alvoX, alvoY) {
    var cx = (rect.left + rect.right) / 2;
    var cy = (rect.top + rect.bottom) / 2;
    var dx = alvoX - cx;
    var dy = alvoY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var halfW = (rect.right - rect.left) / 2;
    var halfH = (rect.bottom - rect.top) / 2;
    var escala = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
    return { x: cx + dx * escala, y: cy + dy * escala };
  }

  function desenharLinhas() {
    var outerRect = outerEl.getBoundingClientRect();
    canvasEl.width = outerEl.clientWidth;
    canvasEl.height = outerEl.clientHeight;
    var ctx = canvasEl.getContext("2d");
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--cor-linha") || "#8a8f9b";
    ctx.lineWidth = 2;

    function rel(el) {
      var r = el.getBoundingClientRect();
      return { left: r.left - outerRect.left, top: r.top - outerRect.top, right: r.right - outerRect.left, bottom: r.bottom - outerRect.top };
    }
    function linhaEntre(elA, elB) {
      if (!elA || !elB) return;
      var a = rel(elA), b = rel(elB);
      var ca = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
      var cb = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      var pa = pontoNaBorda(a, cb.x, cb.y);
      var pb = pontoNaBorda(b, ca.x, ca.y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    function achar(id) { return mundoEl.querySelector('.no[data-id="' + cssEscape(id) + '"]'); }

    // Ramificação ortogonal em L: uma barreira -> várias degradações. O lado de saída da
    // barreira e o lado de entrada em cada degradação se adaptam à posição relativa real
    // (nós são arrastáveis livremente), então a linha sempre para na borda do bloco em vez
    // de atravessá-lo.
    function linhaOrtogonalRamificada(elOrigem, elementosDestino) {
      if (!elOrigem || !elementosDestino.length) return;
      var origemRect = rel(elOrigem);
      var destinos = elementosDestino.map(rel);
      var cO = { x: (origemRect.left + origemRect.right) / 2, y: (origemRect.top + origemRect.bottom) / 2 };
      var cC = {
        x: destinos.reduce(function (s, r) { return s + (r.left + r.right) / 2; }, 0) / destinos.length,
        y: destinos.reduce(function (s, r) { return s + (r.top + r.bottom) / 2; }, 0) / destinos.length
      };
      var dx = cC.x - cO.x, dy = cC.y - cO.y;
      var GAP = 22;
      var vertical = Math.abs(dy) >= Math.abs(dx);
      var origem, busCoord;

      if (vertical) {
        var paraBaixo = dy >= 0;
        origem = { x: cO.x, y: paraBaixo ? origemRect.bottom : origemRect.top };
        busCoord = origem.y + (paraBaixo ? GAP : -GAP);
      } else {
        var paraDireita = dx >= 0;
        origem = { x: paraDireita ? origemRect.right : origemRect.left, y: cO.y };
        busCoord = origem.x + (paraDireita ? GAP : -GAP);
      }

      var pontos = destinos.map(function (r) {
        if (vertical) {
          var cy = (r.top + r.bottom) / 2;
          return { x: (r.left + r.right) / 2, y: cy >= busCoord ? r.top : r.bottom };
        }
        var cx = (r.left + r.right) / 2;
        return { x: cx >= busCoord ? r.left : r.right, y: (r.top + r.bottom) / 2 };
      });

      ctx.beginPath();
      ctx.moveTo(origem.x, origem.y);
      ctx.lineTo(vertical ? origem.x : busCoord, vertical ? busCoord : origem.y);
      ctx.stroke();

      if (vertical) {
        var minX = Math.min(origem.x, Math.min.apply(null, pontos.map(function (p) { return p.x; })));
        var maxX = Math.max(origem.x, Math.max.apply(null, pontos.map(function (p) { return p.x; })));
        ctx.beginPath();
        ctx.moveTo(minX, busCoord);
        ctx.lineTo(maxX, busCoord);
        ctx.stroke();
      } else {
        var minY = Math.min(origem.y, Math.min.apply(null, pontos.map(function (p) { return p.y; })));
        var maxY = Math.max(origem.y, Math.max.apply(null, pontos.map(function (p) { return p.y; })));
        ctx.beginPath();
        ctx.moveTo(busCoord, minY);
        ctx.lineTo(busCoord, maxY);
        ctx.stroke();
      }

      pontos.forEach(function (p) {
        ctx.beginPath();
        if (vertical) { ctx.moveTo(p.x, busCoord); ctx.lineTo(p.x, p.y); }
        else { ctx.moveTo(busCoord, p.y); ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      });
    }

    var eventoNo = estado.nos.find(function (n) { return n.tipo === "evento"; });
    var eventoEl = eventoNo ? achar(eventoNo.id) : null;

    var causas = estado.nos.filter(function (n) { return n.tipo === "causa"; });
    var preventivas = estado.nos.filter(function (n) { return n.tipo === "barreiraPreventiva"; });
    causas.forEach(function (c) {
      var causaEl = achar(c.id);
      if (!causaEl) return;
      var minhas = preventivas.filter(function (b) { return maisProximo(b, causas) === c; });
      var ordenadas = minhas.slice().sort(function (a, b) { return dist(a, c) - dist(b, c); });
      var anterior = causaEl;
      ordenadas.forEach(function (b) {
        var bEl = achar(b.id);
        if (bEl) { linhaEntre(anterior, bEl); anterior = bEl; }
      });
      if (eventoEl) linhaEntre(anterior, eventoEl);
    });

    var consequencias = estado.nos.filter(function (n) { return n.tipo === "consequencia"; });
    var mitigadoras = estado.nos.filter(function (n) { return n.tipo === "barreiraMitigadora"; });
    consequencias.forEach(function (k) {
      var consEl = achar(k.id);
      if (!consEl) return;
      var minhas = mitigadoras.filter(function (b) { return maisProximo(b, consequencias) === k; });
      var ancora = eventoNo || { x: 0, y: 0 };
      var ordenadas = minhas.slice().sort(function (a, b) { return dist(a, ancora) - dist(b, ancora); });
      var anterior = eventoEl;
      ordenadas.forEach(function (b) {
        var bEl = achar(b.id);
        if (bEl) { linhaEntre(anterior, bEl); anterior = bEl; }
      });
      if (anterior) linhaEntre(anterior, consEl);
    });

    var todasBarreiras = estado.nos.filter(ehBarreira);
    var degradacoes = estado.nos.filter(function (n) { return n.tipo === "degradacao"; });
    if (todasBarreiras.length && degradacoes.length) {
      ctx.save();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--cor-degradacao-borda") || "#9c7a1f";
      ctx.setLineDash([4, 3]);
      todasBarreiras.forEach(function (b) {
        var bEl = achar(b.id);
        if (!bEl) return;
        var filhas = degradacoes
          .filter(function (d) { return d.barreiraId === b.id; })
          .map(function (d) { return achar(d.id); })
          .filter(Boolean);
        linhaOrtogonalRamificada(bEl, filhas);
      });
      ctx.restore();
    }

    // Traços da caneta (livre) — pontos armazenados em espaço-mundo, projetados na tela atual.
    function projetar(p) {
      return { x: p.x * estado.zoom + estado.pan.x, y: p.y * estado.zoom + estado.pan.y };
    }
    function desenharTraco(pontos) {
      if (!pontos || pontos.length < 2) return;
      ctx.beginPath();
      pontos.forEach(function (p, i) {
        var s = projetar(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    var desenhos = estado.nos.filter(function (n) { return n.tipo === "desenho"; });
    if (desenhos.length || desenhoAtual) {
      ctx.save();
      ctx.strokeStyle = "#1f2126";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      desenhos.forEach(function (d) { desenharTraco(d.pontos); });
      if (desenhoAtual) desenharTraco(desenhoAtual.pontos);
      ctx.restore();
    }
  }

  // ---------- Motor de validação (regras ISO 31010, adaptado à lista plana) ----------

  function validarDiagramaAtual() {
    var eventos = estado.nos.filter(function (n) { return n.tipo === "evento"; });
    var causas = estado.nos.filter(function (n) { return n.tipo === "causa"; });
    var consequencias = estado.nos.filter(function (n) { return n.tipo === "consequencia"; });
    var preventivas = estado.nos.filter(function (n) { return n.tipo === "barreiraPreventiva"; });
    var mitigadoras = estado.nos.filter(function (n) { return n.tipo === "barreiraMitigadora"; });

    var eventoDefinido = eventos.length === 1 && eventos[0].texto.trim().length > 0;

    var causasSemBarreira = causas.filter(function (c) {
      return !preventivas.some(function (b) { return maisProximo(b, causas) === c; });
    }).map(function (c) { return { id: c.id, texto: c.texto }; });

    var consequenciasSemBarreira = consequencias.filter(function (k) {
      return !mitigadoras.some(function (b) { return maisProximo(b, consequencias) === k; });
    }).map(function (k) { return { id: k.id, texto: k.texto }; });

    var mensagens = [];
    if (eventos.length === 0) mensagens.push("Nenhum evento central foi definido.");
    else if (eventos.length > 1) mensagens.push("Existe mais de um evento central — deveria haver apenas um.");
    else if (!eventoDefinido) mensagens.push("O evento central não possui um nome definido.");
    if (causas.length === 0) mensagens.push("Nenhuma causa foi cadastrada.");
    if (consequencias.length === 0) mensagens.push("Nenhuma consequência foi cadastrada.");
    causasSemBarreira.forEach(function (c) { mensagens.push('A causa "' + c.texto + '" não possui barreira preventiva associada.'); });
    consequenciasSemBarreira.forEach(function (k) { mensagens.push('A consequência "' + k.texto + '" não possui barreira mitigadora associada.'); });

    var valido = eventos.length === 1 && eventoDefinido && causas.length > 0 && consequencias.length > 0 &&
      causasSemBarreira.length === 0 && consequenciasSemBarreira.length === 0;

    return {
      valido: valido,
      eventoDefinido: eventoDefinido,
      totalEventos: eventos.length,
      totalCausas: causas.length,
      totalConsequencias: consequencias.length,
      causasSemBarreira: causasSemBarreira,
      consequenciasSemBarreira: consequenciasSemBarreira,
      mensagens: mensagens
    };
  }

  // ---------- Modal customizado de edição ----------

  var edicaoAtual = null;

  function abrirModalEdicao(no) {
    edicaoAtual = no.id;
    document.getElementById("modalTitulo").textContent = "Editar " + (RESPONSABILIDADE[no.tipo] || no.tipo);
    var campoTexto = document.getElementById("modalInputTexto");
    campoTexto.value = no.texto;
    var ehBarreira = no.tipo === "barreiraPreventiva" || no.tipo === "barreiraMitigadora";
    var campoEficacia = document.getElementById("modalCampoEficacia");
    campoEficacia.hidden = !ehBarreira;
    if (ehBarreira) {
      document.getElementById("modalInputEficacia").value = typeof no.eficacia === "number" ? no.eficacia : 0.5;
    }
    document.getElementById("modalOverlay").hidden = false;
    campoTexto.focus();
    campoTexto.select();
  }

  function fecharModalEdicao() {
    document.getElementById("modalOverlay").hidden = true;
    edicaoAtual = null;
  }

  function confirmarModalEdicao() {
    if (!edicaoAtual) return;
    var no = estado.nos.find(function (n) { return n.id === edicaoAtual; });
    if (!no) { fecharModalEdicao(); return; }
    comHistorico(function () {
      no.texto = document.getElementById("modalInputTexto").value.trim() || "(sem nome)";
      if (no.tipo === "barreiraPreventiva" || no.tipo === "barreiraMitigadora") {
        var v = parseFloat(document.getElementById("modalInputEficacia").value);
        if (isNaN(v)) v = 0;
        no.eficacia = Math.min(1, Math.max(0, v));
      }
    });
    fecharModalEdicao();
    render();
  }

  function configurarModal() {
    document.getElementById("modalBtnCancelar").addEventListener("click", fecharModalEdicao);
    document.getElementById("modalBtnSalvar").addEventListener("click", confirmarModalEdicao);
    document.getElementById("modalOverlay").addEventListener("mousedown", function (e) {
      if (e.target.id === "modalOverlay") fecharModalEdicao();
    });
    document.getElementById("modalOverlay").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); confirmarModalEdicao(); }
      else if (e.key === "Escape") { e.preventDefault(); fecharModalEdicao(); }
    });
  }

  // ---------- Modal de comentário (criar / visualizar mensagem de um pino) ----------

  var comentarioAtualId = null;
  var comentarioEhNovo = false;

  function abrirModalComentario(id, ehNovo) {
    var no = estado.nos.find(function (n) { return n.id === id; });
    if (!no) return;
    comentarioAtualId = id;
    comentarioEhNovo = !!ehNovo;
    document.getElementById("modalComentarioTitulo").textContent = ehNovo ? "Novo comentário" : "Comentário";
    var campo = document.getElementById("modalComentarioTexto");
    campo.value = no.texto || "";
    document.getElementById("modalComentarioOverlay").hidden = false;
    campo.focus();
  }

  function fecharModalComentario(cancelado) {
    document.getElementById("modalComentarioOverlay").hidden = true;
    if (cancelado && comentarioEhNovo && comentarioAtualId) {
      comHistorico(function () {
        estado.nos = estado.nos.filter(function (n) { return n.id !== comentarioAtualId; });
      });
      render();
    }
    comentarioAtualId = null;
    comentarioEhNovo = false;
  }

  function confirmarModalComentario() {
    if (!comentarioAtualId) { fecharModalComentario(false); return; }
    var texto = document.getElementById("modalComentarioTexto").value.trim();
    if (!texto && comentarioEhNovo) { fecharModalComentario(true); return; }
    var idParaSalvar = comentarioAtualId;
    comHistorico(function () {
      var no = estado.nos.find(function (n) { return n.id === idParaSalvar; });
      if (no) no.texto = texto;
    });
    document.getElementById("modalComentarioOverlay").hidden = true;
    comentarioAtualId = null;
    comentarioEhNovo = false;
    render();
  }

  function configurarModalComentario() {
    document.getElementById("modalComentarioBtnCancelar").addEventListener("click", function () { fecharModalComentario(true); });
    document.getElementById("modalComentarioBtnSalvar").addEventListener("click", confirmarModalComentario);
    document.getElementById("modalComentarioOverlay").addEventListener("mousedown", function (e) {
      if (e.target.id === "modalComentarioOverlay") fecharModalComentario(true);
    });
    document.getElementById("modalComentarioOverlay").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); fecharModalComentario(true); }
    });
  }

  // ---------- Ferramentas de anotação: comentário e texto livre ----------

  function iniciarNovoComentario(worldX, worldY) {
    var no = { id: novoId("cm"), tipo: "comentario", texto: "", x: worldX - 17, y: worldY - 17 };
    comHistorico(function () { estado.nos.push(no); });
    render();
    definirFerramenta("selecao");
    abrirModalComentario(no.id, true);
  }

  function criarTextoLivre(worldX, worldY) {
    var no = { id: novoId("t"), tipo: "texto-livre", texto: "Texto", x: worldX, y: worldY };
    comHistorico(function () { estado.nos.push(no); });
    render();
    definirFerramenta("selecao");
    abrirModalEdicao(no);
  }

  // ---------- Remoção instantânea (sem confirm) ----------

  function removerNo(id) {
    comHistorico(function () {
      var removendo = estado.nos.find(function (n) { return n.id === id; });
      estado.nos = estado.nos.filter(function (n) { return n.id !== id; });
      if (ehBarreira(removendo)) {
        estado.nos = estado.nos.filter(function (n) { return !(n.tipo === "degradacao" && n.barreiraId === id); });
      }
    });
    render();
  }

  // ---------- Sidebar: arrastar elementos para o canvas ----------

  function criarNoNaPosicao(tipoNo, x, y) {
    if (tipoNo === "evento") {
      var existente = estado.nos.find(function (n) { return n.tipo === "evento"; });
      if (existente) {
        comHistorico(function () { existente.x = x; existente.y = y; });
      } else {
        comHistorico(function () {
          estado.nos.push({ id: novoId("evt"), tipo: "evento", texto: "Evento indesejado", x: x, y: y });
        });
      }
      render();
      return;
    }
    if (tipoNo === "causa") {
      comHistorico(function () { estado.nos.push({ id: novoId("c"), tipo: "causa", texto: "Nova causa", x: x, y: y }); });
      render();
      return;
    }
    if (tipoNo === "consequencia") {
      comHistorico(function () { estado.nos.push({ id: novoId("k"), tipo: "consequencia", texto: "Nova consequência", x: x, y: y }); });
      render();
      return;
    }
    if (tipoNo === "barreiraPreventiva" || tipoNo === "barreiraMitigadora") {
      var tipoDono = tipoNo === "barreiraPreventiva" ? "causa" : "consequencia";
      var existemDonos = estado.nos.some(function (n) { return n.tipo === tipoDono; });
      comHistorico(function () {
        estado.nos.push({ id: novoId("b"), tipo: tipoNo, texto: "Nova barreira", x: x, y: y, eficacia: 0.5 });
      });
      render();
      if (!existemDonos) {
        mostrarNotificacao(
          "Nenhuma " + (tipoDono === "causa" ? "causa" : "consequência") + " cadastrada ainda — crie uma para que esta barreira se conecte ao diagrama.",
          "info"
        );
      }
      return;
    }
    if (tipoNo === "degradacao") {
      var barreirasDisponiveis = estado.nos.filter(ehBarreira);
      var barreiraAlvo = maisProximo({ x: x, y: y }, barreirasDisponiveis);
      comHistorico(function () {
        estado.nos.push({
          id: novoId("d"),
          tipo: "degradacao",
          texto: "Nova degradação",
          x: x,
          y: y,
          barreiraId: barreiraAlvo ? barreiraAlvo.id : null
        });
      });
      render();
      if (!barreiraAlvo) {
        mostrarNotificacao(
          "Nenhuma barreira cadastrada ainda — crie uma barreira para que este fator de degradação se conecte a ela.",
          "info"
        );
      }
      return;
    }
  }

  function tiposNoDataTransfer(dataTransfer) {
    return !!dataTransfer && Array.prototype.indexOf.call(dataTransfer.types || [], "text/tipo-no") !== -1;
  }

  function configurarSidebar() {
    document.querySelectorAll(".chip[data-tipo-no]").forEach(function (chip) {
      chip.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/tipo-no", chip.getAttribute("data-tipo-no"));
        e.dataTransfer.effectAllowed = "copy";
      });
    });

    outerEl.addEventListener("dragover", function (e) {
      if (!tiposNoDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      outerEl.classList.add("arraste-sobre");
    });
    outerEl.addEventListener("dragleave", function (e) {
      if (e.target === outerEl) outerEl.classList.remove("arraste-sobre");
    });
    outerEl.addEventListener("drop", function (e) {
      outerEl.classList.remove("arraste-sobre");
      var tipoNo = e.dataTransfer.getData("text/tipo-no");
      if (!tipoNo) return;
      e.preventDefault();
      var rect = outerEl.getBoundingClientRect();
      var worldX = (e.clientX - rect.left - estado.pan.x) / estado.zoom;
      var worldY = (e.clientY - rect.top - estado.pan.y) / estado.zoom;
      criarNoNaPosicao(tipoNo, worldX, worldY);
    });
  }

  // ---------- Arraste livre de blocos e pan/zoom da tela infinita ----------

  var espacoPressionado = false;
  var foiArrasteRecente = false;
  var zTopo = 10;
  var arrasteNo = null;
  var arrastePan = null;
  var modoFerramenta = "selecao";
  var desenhoAtual = null;

  function estaEditandoTexto() {
    var a = document.activeElement;
    if (!a) return false;
    return a.tagName === "INPUT" || a.tagName === "TEXTAREA";
  }

  function configurarArrasteEPan() {
    outerEl.addEventListener("mousedown", function (e) {
      if (e.target.closest(".no-remover")) return;
      if (e.target.closest(".ferramentas-flutuantes") || e.target.closest(".barra-superior-direita")) return;
      if (e.button === 1) {
        arrastePan = { startX: e.clientX, startY: e.clientY, panX: estado.pan.x, panY: estado.pan.y };
        outerEl.classList.add("arrastando-mundo");
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      var noEl = e.target.closest(".no");
      if (modoFerramenta !== "selecao" && !espacoPressionado && !noEl) {
        var rectFerramenta = outerEl.getBoundingClientRect();
        var wx = (e.clientX - rectFerramenta.left - estado.pan.x) / estado.zoom;
        var wy = (e.clientY - rectFerramenta.top - estado.pan.y) / estado.zoom;
        if (modoFerramenta === "comentarios") { e.preventDefault(); iniciarNovoComentario(wx, wy); return; }
        if (modoFerramenta === "texto") { e.preventDefault(); criarTextoLivre(wx, wy); return; }
        if (modoFerramenta === "caneta") { e.preventDefault(); desenhoAtual = { pontos: [{ x: wx, y: wy }] }; return; }
      }
      if (espacoPressionado || !noEl) {
        arrastePan = { startX: e.clientX, startY: e.clientY, panX: estado.pan.x, panY: estado.pan.y };
        outerEl.classList.add("arrastando-mundo");
        e.preventDefault();
        return;
      }
      var id = noEl.getAttribute("data-id");
      var objeto = estado.nos.find(function (n) { return n.id === id; });
      if (!objeto) return;
      arrasteNo = { el: noEl, obj: objeto, startX: e.clientX, startY: e.clientY, origX: objeto.x, origY: objeto.y, moveu: false, antes: null };
      e.preventDefault();
    });

    outerEl.addEventListener("auxclick", function (e) {
      if (e.button === 1) e.preventDefault();
    });

    window.addEventListener("mousemove", function (e) {
      if (desenhoAtual) {
        var rectDesenho = outerEl.getBoundingClientRect();
        var wx2 = (e.clientX - rectDesenho.left - estado.pan.x) / estado.zoom;
        var wy2 = (e.clientY - rectDesenho.top - estado.pan.y) / estado.zoom;
        desenhoAtual.pontos.push({ x: wx2, y: wy2 });
        desenharLinhas();
        return;
      }
      if (arrastePan) {
        estado.pan.x = arrastePan.panX + (e.clientX - arrastePan.startX);
        estado.pan.y = arrastePan.panY + (e.clientY - arrastePan.startY);
        aplicarTransformMundo();
        desenharLinhas();
        return;
      }
      if (arrasteNo) {
        var dx = e.clientX - arrasteNo.startX;
        var dy = e.clientY - arrasteNo.startY;
        if (!arrasteNo.moveu && Math.hypot(dx, dy) > 4) {
          arrasteNo.moveu = true;
          arrasteNo.antes = clonarNos();
          arrasteNo.el.classList.add("arrastando");
          zTopo = Math.min(zTopo + 1, 800);
          arrasteNo.el.style.zIndex = zTopo;
        }
        if (arrasteNo.moveu) {
          var novoX = arrasteNo.origX + dx / estado.zoom;
          var novoY = arrasteNo.origY + dy / estado.zoom;
          arrasteNo.obj.x = novoX;
          arrasteNo.obj.y = novoY;
          arrasteNo.el.style.left = novoX + "px";
          arrasteNo.el.style.top = novoY + "px";
          desenharLinhas();
        }
      }
    });

    window.addEventListener("mouseup", function () {
      if (desenhoAtual) {
        if (desenhoAtual.pontos.length > 1) {
          comHistorico(function () {
            estado.nos.push({ id: novoId("dz"), tipo: "desenho", pontos: desenhoAtual.pontos });
          });
        }
        desenhoAtual = null;
        render();
      }
      if (arrastePan) {
        arrastePan = null;
        outerEl.classList.remove("arrastando-mundo");
      }
      if (arrasteNo) {
        if (arrasteNo.moveu) {
          arrasteNo.el.classList.remove("arrastando");
          var depois = clonarNos();
          if (arrasteNo.antes !== depois) {
            pilhaDesfazer.push(arrasteNo.antes);
            if (pilhaDesfazer.length > LIMITE_HISTORICO) pilhaDesfazer.shift();
            pilhaRefazer = [];
            sujo = true;
            atualizarBotoesHistorico();
          }
          foiArrasteRecente = true;
        }
        arrasteNo = null;
      }
    });

    outerEl.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var rect = outerEl.getBoundingClientRect();
        aplicarZoom(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        estado.pan.x -= e.deltaX;
        estado.pan.y -= e.deltaY;
        aplicarTransformMundo();
        desenharLinhas();
      }
    }, { passive: false });

    outerEl.addEventListener("mousemove", function (e) {
      atualizarRodapeStatus(e.clientX, e.clientY);
    });
  }

  function aplicarZoom(fator, cursorX, cursorY) {
    var novoZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, estado.zoom * fator));
    var worldX = (cursorX - estado.pan.x) / estado.zoom;
    var worldY = (cursorY - estado.pan.y) / estado.zoom;
    estado.pan.x = cursorX - worldX * novoZoom;
    estado.pan.y = cursorY - worldY * novoZoom;
    estado.zoom = novoZoom;
    aplicarTransformMundo();
    desenharLinhas();
  }

  function coletarPontosDeTodosOsNos() {
    var pontos = [];
    mundoEl.querySelectorAll(".no").forEach(function (el) {
      var x = parseFloat(el.style.left) || 0;
      var y = parseFloat(el.style.top) || 0;
      var w = el.offsetWidth || 120;
      var h = el.offsetHeight || 50;
      pontos.push({ x: x, y: y });
      pontos.push({ x: x + w, y: y + h });
    });
    estado.nos.forEach(function (n) {
      if (n.tipo === "desenho" && n.pontos) pontos = pontos.concat(n.pontos);
    });
    return pontos;
  }

  function ajustarVisualizacao() {
    var pontos = coletarPontosDeTodosOsNos();
    if (!pontos.length) return;
    var minX = Math.min.apply(null, pontos.map(function (p) { return p.x; }));
    var maxX = Math.max.apply(null, pontos.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, pontos.map(function (p) { return p.y; }));
    var maxY = Math.max.apply(null, pontos.map(function (p) { return p.y; }));
    var margem = 80;
    minX -= margem; minY -= margem; maxX += margem; maxY += margem;
    var largura = Math.max(1, maxX - minX);
    var altura = Math.max(1, maxY - minY);
    var rectOuter = outerEl.getBoundingClientRect();
    var novoZoom = Math.min(rectOuter.width / largura, rectOuter.height / altura, 1.5);
    novoZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, novoZoom));
    estado.zoom = novoZoom;
    estado.pan.x = (rectOuter.width - largura * novoZoom) / 2 - minX * novoZoom;
    estado.pan.y = (rectOuter.height - altura * novoZoom) / 2 - minY * novoZoom;
    aplicarTransformMundo();
    desenharLinhas();
  }

  // ---------- Cliques (seleção visual + abrir modal) e teclado ----------

  function configurarCliquesETeclado() {
    mundoEl.addEventListener("click", function (e) {
      var btnRemover = e.target.closest(".no-remover");
      if (btnRemover) {
        removerNo(btnRemover.getAttribute("data-id"));
        return;
      }
      if (foiArrasteRecente) { foiArrasteRecente = false; return; }
      if (e.detail > 1) return;
      var noClicado = e.target.closest(".no");
      if (noClicado && noClicado.classList.contains("no-comentario")) {
        abrirModalComentario(noClicado.getAttribute("data-id"), false);
        return;
      }
      document.querySelectorAll(".selecionado").forEach(function (el) { el.classList.remove("selecionado"); });
      if (noClicado) noClicado.classList.add("selecionado");
    });

    mundoEl.addEventListener("dblclick", function (e) {
      if (e.target.closest(".no-remover")) return;
      var noEl = e.target.closest(".no");
      if (!noEl || noEl.classList.contains("no-comentario")) return;
      var no = estado.nos.find(function (n) { return n.id === noEl.getAttribute("data-id"); });
      if (no) abrirModalEdicao(no);
    });

    document.addEventListener("keydown", function (e) {
      var editando = estaEditandoTexto();
      var modalAberto = !document.getElementById("modalOverlay").hidden || !document.getElementById("modalJsonOverlay").hidden;

      if (e.code === "Space" && !espacoPressionado && !editando && !modalAberto) {
        espacoPressionado = true;
        outerEl.classList.add("modo-mao");
        e.preventDefault();
      }

      if ((e.ctrlKey || e.metaKey) && !editando && !modalAberto) {
        var tecla = e.key.toLowerCase();
        if (tecla === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
        if (tecla === "y" || (tecla === "z" && e.shiftKey)) { e.preventDefault(); refazer(); return; }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !editando && !modalAberto) {
        var selecionado = mundoEl.querySelector(".no.selecionado");
        if (selecionado) { e.preventDefault(); removerNo(selecionado.getAttribute("data-id")); }
      }
    });

    document.addEventListener("keyup", function (e) {
      if (e.code === "Space") {
        espacoPressionado = false;
        outerEl.classList.remove("modo-mao");
      }
    });
  }

  // ---------- Exportar / Importar JSON e SVG ----------

  function exportarJSON() {
    var blob = new Blob([JSON.stringify(estadoParaPacote(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (estado.nome || "diagrama-bowtie").replace(/[^\w\-]+/g, "_") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarNotificacao("Arquivo JSON exportado.", "sucesso");
  }

  function aplicarPacoteImportado(pacote) {
    if (!pacote.dados || !Array.isArray(pacote.dados.nos)) {
      throw new Error("estrutura inválida: 'dados.nos' deve ser uma lista.");
    }
    estado.id = pacote.id || null;
    estado.nome = pacote.nome || "Diagrama sem título";
    estado.pan = pacote.dados.pan || { x: 60, y: 60 };
    estado.zoom = typeof pacote.dados.zoom === "number" ? pacote.dados.zoom : 1;
    estado.nos = pacote.dados.nos;
    pilhaDesfazer = [];
    pilhaRefazer = [];
    sujo = false;
    document.getElementById("inputNomeDiagrama").value = estado.nome;
    render();
    atualizarBotoesHistorico();
    requestAnimationFrame(ajustarVisualizacao);
  }

  function importarJSONTexto(texto) {
    try {
      aplicarPacoteImportado(JSON.parse(texto));
      fecharModalJson();
      mostrarNotificacao("Diagrama importado.", "sucesso");
    } catch (erro) {
      mostrarNotificacao("JSON inválido: " + erro.message, "erro");
    }
  }

  function lerArquivoParaTextarea(arquivo) {
    var leitor = new FileReader();
    leitor.onload = function () {
      document.getElementById("modalJsonTexto").value = String(leitor.result);
    };
    leitor.onerror = function () {
      mostrarNotificacao("Não foi possível ler o arquivo.", "erro");
    };
    leitor.readAsText(arquivo, "utf-8");
  }

  // ---------- Modal de exportar/importar JSON ----------

  function abrirModalJson(modo) {
    var titulo = document.getElementById("modalJsonTitulo");
    var dica = document.getElementById("modalJsonDica");
    var textarea = document.getElementById("modalJsonTexto");
    var btnCopiar = document.getElementById("modalJsonBtnCopiar");
    var btnBaixar = document.getElementById("modalJsonBtnBaixar");
    var btnEscolherArquivo = document.getElementById("modalJsonBtnEscolherArquivo");
    var btnImportar = document.getElementById("modalJsonBtnImportar");

    if (modo === "exportar") {
      titulo.textContent = "Exportar JSON";
      dica.textContent = "JSON completo do diagrama atual — copie o texto abaixo ou baixe como arquivo.";
      textarea.value = JSON.stringify(estadoParaPacote(), null, 2);
      textarea.readOnly = true;
      btnCopiar.hidden = false;
      btnBaixar.hidden = false;
      btnEscolherArquivo.hidden = true;
      btnImportar.hidden = true;
    } else {
      titulo.textContent = "Importar JSON";
      dica.textContent = "Cole aqui o JSON de um diagrama exportado anteriormente, ou escolha um arquivo do computador.";
      textarea.value = "";
      textarea.readOnly = false;
      btnCopiar.hidden = true;
      btnBaixar.hidden = true;
      btnEscolherArquivo.hidden = false;
      btnImportar.hidden = false;
    }

    document.getElementById("modalJsonOverlay").hidden = false;
    textarea.focus();
    if (textarea.readOnly) textarea.select();
  }

  function fecharModalJson() {
    document.getElementById("modalJsonOverlay").hidden = true;
  }

  function configurarModalJson() {
    document.getElementById("btnExportarJson").addEventListener("click", function () { abrirModalJson("exportar"); });
    document.getElementById("btnImportarJson").addEventListener("click", function () { abrirModalJson("importar"); });

    document.getElementById("modalJsonBtnFechar").addEventListener("click", fecharModalJson);

    document.getElementById("modalJsonBtnBaixar").addEventListener("click", function () {
      exportarJSON();
    });

    document.getElementById("modalJsonBtnCopiar").addEventListener("click", function () {
      var textarea = document.getElementById("modalJsonTexto");
      textarea.focus();
      textarea.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textarea.value)
          .then(function () { mostrarNotificacao("JSON copiado para a área de transferência.", "sucesso"); })
          .catch(function () { mostrarNotificacao("Não foi possível copiar automaticamente — selecione e copie manualmente.", "erro"); });
      } else {
        try {
          document.execCommand("copy");
          mostrarNotificacao("JSON copiado para a área de transferência.", "sucesso");
        } catch (erro) {
          mostrarNotificacao("Não foi possível copiar automaticamente — selecione e copie manualmente.", "erro");
        }
      }
    });

    document.getElementById("modalJsonBtnEscolherArquivo").addEventListener("click", function () {
      document.getElementById("inputArquivoJson").click();
    });

    document.getElementById("modalJsonBtnImportar").addEventListener("click", function () {
      var texto = document.getElementById("modalJsonTexto").value.trim();
      if (!texto) { mostrarNotificacao("Cole o JSON ou escolha um arquivo antes de importar.", "info"); return; }
      importarJSONTexto(texto);
    });

    document.getElementById("inputArquivoJson").addEventListener("change", function (e) {
      var arquivo = e.target.files[0];
      if (arquivo) lerArquivoParaTextarea(arquivo);
      e.target.value = "";
    });

    document.getElementById("modalJsonOverlay").addEventListener("mousedown", function (e) {
      if (e.target.id === "modalJsonOverlay") fecharModalJson();
    });
    document.getElementById("modalJsonOverlay").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); fecharModalJson(); }
    });
  }

  var TAMANHOS_SVG = {
    evento: { w: 110, h: 110 },
    causa: { w: 150, h: 60 },
    consequencia: { w: 150, h: 60 },
    barreiraPreventiva: { w: 130, h: 50 },
    barreiraMitigadora: { w: 130, h: 50 },
    degradacao: { w: 130, h: 44 },
    comentario: { w: 34, h: 34 },
    "texto-livre": { w: 160, h: 30 }
  };
  var CORES_SVG = {
    evento: "#1c1e24",
    causa: "#c9760a",
    consequencia: "#c62828",
    barreiraPreventiva: "#4a8f6b",
    barreiraMitigadora: "#2f7dae",
    degradacao: "#9c7a1f",
    comentario: "#f5a623",
    "texto-livre": "#1f2126"
  };

  function retanguloMundo(n) {
    var tam = TAMANHOS_SVG[n.tipo] || { w: 140, h: 60 };
    return { left: n.x, top: n.y, right: n.x + tam.w, bottom: n.y + tam.h, w: tam.w, h: tam.h };
  }

  function construirSvgDoDiagrama() {
    var nos = estado.nos.filter(function (n) { return n.tipo !== "desenho"; });
    if (!nos.length) return null;

    var retangulos = {};
    nos.forEach(function (n) { retangulos[n.id] = retanguloMundo(n); });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nos.forEach(function (n) {
      var r = retangulos[n.id];
      minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
    });
    var margem = 40;
    minX -= margem; minY -= margem; maxX += margem; maxY += margem;
    var largura = maxX - minX, altura = maxY - minY;

    var linhasSvg = [];
    function linhaEntreSvg(noA, noB) {
      if (!noA || !noB) return;
      var a = retangulos[noA.id], b = retangulos[noB.id];
      var ca = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
      var cb = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      var pa = pontoNaBorda(a, cb.x, cb.y);
      var pb = pontoNaBorda(b, ca.x, ca.y);
      linhasSvg.push('<line x1="' + pa.x + '" y1="' + pa.y + '" x2="' + pb.x + '" y2="' + pb.y + '" stroke="#8a8f9b" stroke-width="2" />');
    }

    function linhaOrtogonalRamificadaSvg(noOrigem, nosDestino) {
      if (!noOrigem || !nosDestino.length) return;
      var origemRect = retangulos[noOrigem.id];
      var destinos = nosDestino.map(function (n) { return retangulos[n.id]; });
      var cO = { x: (origemRect.left + origemRect.right) / 2, y: (origemRect.top + origemRect.bottom) / 2 };
      var cC = {
        x: destinos.reduce(function (s, r) { return s + (r.left + r.right) / 2; }, 0) / destinos.length,
        y: destinos.reduce(function (s, r) { return s + (r.top + r.bottom) / 2; }, 0) / destinos.length
      };
      var dx = cC.x - cO.x, dy = cC.y - cO.y;
      var GAP = 22;
      var vertical = Math.abs(dy) >= Math.abs(dx);
      var origem, busCoord;

      if (vertical) {
        var paraBaixo = dy >= 0;
        origem = { x: cO.x, y: paraBaixo ? origemRect.bottom : origemRect.top };
        busCoord = origem.y + (paraBaixo ? GAP : -GAP);
      } else {
        var paraDireita = dx >= 0;
        origem = { x: paraDireita ? origemRect.right : origemRect.left, y: cO.y };
        busCoord = origem.x + (paraDireita ? GAP : -GAP);
      }

      var pontos = destinos.map(function (r) {
        if (vertical) {
          var cy = (r.top + r.bottom) / 2;
          return { x: (r.left + r.right) / 2, y: cy >= busCoord ? r.top : r.bottom };
        }
        var cx = (r.left + r.right) / 2;
        return { x: cx >= busCoord ? r.left : r.right, y: (r.top + r.bottom) / 2 };
      });

      var cor = CORES_SVG.degradacao;
      var estilo = 'stroke="' + cor + '" stroke-width="2" stroke-dasharray="4,3"';
      var trunkX2 = vertical ? origem.x : busCoord;
      var trunkY2 = vertical ? busCoord : origem.y;
      linhasSvg.push('<line x1="' + origem.x + '" y1="' + origem.y + '" x2="' + trunkX2 + '" y2="' + trunkY2 + '" ' + estilo + ' />');

      if (vertical) {
        var minX = Math.min(origem.x, Math.min.apply(null, pontos.map(function (p) { return p.x; })));
        var maxX = Math.max(origem.x, Math.max.apply(null, pontos.map(function (p) { return p.x; })));
        linhasSvg.push('<line x1="' + minX + '" y1="' + busCoord + '" x2="' + maxX + '" y2="' + busCoord + '" ' + estilo + ' />');
      } else {
        var minY = Math.min(origem.y, Math.min.apply(null, pontos.map(function (p) { return p.y; })));
        var maxY = Math.max(origem.y, Math.max.apply(null, pontos.map(function (p) { return p.y; })));
        linhasSvg.push('<line x1="' + busCoord + '" y1="' + minY + '" x2="' + busCoord + '" y2="' + maxY + '" ' + estilo + ' />');
      }

      pontos.forEach(function (p) {
        if (vertical) {
          linhasSvg.push('<line x1="' + p.x + '" y1="' + busCoord + '" x2="' + p.x + '" y2="' + p.y + '" ' + estilo + ' />');
        } else {
          linhasSvg.push('<line x1="' + busCoord + '" y1="' + p.y + '" x2="' + p.x + '" y2="' + p.y + '" ' + estilo + ' />');
        }
      });
    }

    var eventoNo = nos.find(function (n) { return n.tipo === "evento"; });
    var causas = nos.filter(function (n) { return n.tipo === "causa"; });
    var preventivas = nos.filter(function (n) { return n.tipo === "barreiraPreventiva"; });
    causas.forEach(function (c) {
      var minhas = preventivas.filter(function (b) { return maisProximo(b, causas) === c; })
        .sort(function (a, b) { return dist(a, c) - dist(b, c); });
      var anterior = c;
      minhas.forEach(function (b) { linhaEntreSvg(anterior, b); anterior = b; });
      if (eventoNo) linhaEntreSvg(anterior, eventoNo);
    });
    var consequencias = nos.filter(function (n) { return n.tipo === "consequencia"; });
    var mitigadoras = nos.filter(function (n) { return n.tipo === "barreiraMitigadora"; });
    consequencias.forEach(function (k) {
      var ancora = eventoNo || { x: 0, y: 0 };
      var minhas = mitigadoras.filter(function (b) { return maisProximo(b, consequencias) === k; })
        .sort(function (a, b) { return dist(a, ancora) - dist(b, ancora); });
      var anterior = eventoNo;
      minhas.forEach(function (b) { linhaEntreSvg(anterior, b); anterior = b; });
      if (anterior) linhaEntreSvg(anterior, k);
    });
    var todasBarreirasSvg = nos.filter(ehBarreira);
    var degradacoesSvg = nos.filter(function (n) { return n.tipo === "degradacao"; });
    todasBarreirasSvg.forEach(function (b) {
      var filhas = degradacoesSvg.filter(function (d) { return d.barreiraId === b.id; });
      linhaOrtogonalRamificadaSvg(b, filhas);
    });

    var nosSvg = nos.map(function (n) {
      var r = retangulos[n.id];
      var cor = CORES_SVG[n.tipo] || "#555";
      if (n.tipo === "comentario") {
        var raioC = r.w / 2;
        return '<circle cx="' + (r.left + raioC) + '" cy="' + (r.top + raioC) + '" r="' + raioC + '" fill="' + cor + '" />';
      }
      var forma;
      if (n.tipo === "evento") {
        var raio = r.w / 2;
        forma = '<circle cx="' + (r.left + raio) + '" cy="' + (r.top + raio) + '" r="' + raio + '" fill="' + cor + '" />';
      } else if (n.tipo === "texto-livre") {
        forma = "";
      } else {
        var espessura = (n.tipo === "causa" || n.tipo === "consequencia") ? 3 : (ehBarreira(n) ? 2 : 1.5);
        var tracejado = n.tipo === "degradacao" ? ' stroke-dasharray="5,3"' : "";
        forma = '<rect x="' + r.left + '" y="' + r.top + '" width="' + r.w + '" height="' + r.h +
          '" rx="8" fill="#ffffff" stroke="' + cor + '" stroke-width="' + espessura + '"' + tracejado + ' />';
      }
      var corTexto = n.tipo === "evento" ? "#ffffff" : "#1f2126";
      var cx = r.left + r.w / 2, cy = r.top + r.h / 2;
      var ancoragem = n.tipo === "texto-livre" ? "start" : "middle";
      var cxTexto = n.tipo === "texto-livre" ? r.left : cx;
      var linhasTexto = quebrarTexto(n.texto, 20);
      var textoSvg = linhasTexto.map(function (linha, i) {
        var dy = (i - (linhasTexto.length - 1) / 2) * 14;
        return '<tspan x="' + cxTexto + '" y="' + (cy + dy) + '">' + escaparXml(linha) + "</tspan>";
      }).join("");
      var eficaciaSvg = "";
      if (typeof n.eficacia === "number") {
        eficaciaSvg = '<text x="' + cx + '" y="' + (cy + r.h / 2 + 12) + '" text-anchor="middle" font-size="10" fill="#666">Eficácia: ' + n.eficacia.toFixed(2) + "</text>";
      }
      return forma + '<text text-anchor="' + ancoragem + '" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="12" fill="' + corTexto + '">' +
        textoSvg + "</text>" + eficaciaSvg;
    }).join("\n");

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + largura + " " + altura +
      '" width="' + largura + '" height="' + altura + '" font-family="Arial, sans-serif">' +
      '<rect x="0" y="0" width="' + largura + '" height="' + altura + '" fill="#fafafa" />' +
      '<g transform="translate(' + (-minX) + "," + (-minY) + ')">' +
      linhasSvg.join("\n") + nosSvg + "</g></svg>";
  }

  function exportarSVG() {
    var svg = construirSvgDoDiagrama();
    if (!svg) { mostrarNotificacao("Não há nada para exportar.", "info"); return; }

    var blob = new Blob([svg], { type: "image/svg+xml" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (estado.nome || "diagrama-bowtie").replace(/[^\w\-]+/g, "_") + ".svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarNotificacao("Imagem SVG exportada.", "sucesso");
  }

  // ---------- Compartilhar imagem do diagrama (Web Share API com anexo real) ----------

  function baixarBlob(blob, nomeArquivo) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function construirBlobPngDoDiagrama() {
    return new Promise(function (resolve, reject) {
      var svgTexto = construirSvgDoDiagrama();
      if (!svgTexto) { reject(new Error("Não há nada para exportar.")); return; }
      var svgBlob = new Blob([svgTexto], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function () {
        var escala = 2;
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth * escala;
        canvas.height = img.naturalHeight * escala;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error("Falha ao gerar a imagem PNG."));
        }, "image/png");
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Falha ao carregar o SVG do diagrama."));
      };
      img.src = url;
    });
  }

  function compartilharImagemDiagrama() {
    construirBlobPngDoDiagrama()
      .then(function (blob) {
        var nomeArquivo = (estado.nome || "diagrama-bowtie").replace(/[^\w\-]+/g, "_") + ".png";
        var arquivo = new File([blob], nomeArquivo, { type: "image/png" });
        var titulo = estado.nome || "Diagrama Bow Tie";
        var texto = "Diagrama de análise de riscos (Bow Tie) — " + titulo;

        if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
          navigator.share({ files: [arquivo], title: titulo, text: texto }).catch(function (erro) {
            if (erro && erro.name !== "AbortError") {
              mostrarNotificacao("Não foi possível compartilhar: " + erro.message, "erro");
            }
          });
        } else {
          baixarBlob(blob, nomeArquivo);
          mostrarNotificacao(
            "Este navegador não suporta anexar arquivos ao compartilhar — a imagem foi baixada para anexar manualmente.",
            "info"
          );
        }
      })
      .catch(function (erro) {
        mostrarNotificacao("Falha ao preparar imagem para compartilhamento: " + erro.message, "erro");
      });
  }

  function escaparXml(texto) {
    return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function quebrarTexto(texto, maxCaracteres) {
    var palavras = String(texto).split(/\s+/);
    var linhas = [];
    var atual = "";
    palavras.forEach(function (palavra) {
      var candidato = atual ? atual + " " + palavra : palavra;
      if (candidato.length > maxCaracteres && atual) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = candidato;
      }
    });
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  }

  // ---------- Backend: salvar, carregar, sincronizar no fechamento ----------

  function salvarNoServidor(mostrarToast) {
    return fetch("/api/diagrama/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estadoParaPacote())
    })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error("HTTP " + resposta.status);
        return resposta.json();
      })
      .then(function (corpo) {
        estado.id = corpo.id;
        sujo = false;
        if (mostrarToast) mostrarNotificacao("Diagrama salvo no servidor (ID " + corpo.id + ").", "sucesso");
        return corpo;
      })
      .catch(function (erro) {
        if (mostrarToast) mostrarNotificacao("Falha ao salvar no servidor: " + erro.message, "erro");
        throw erro;
      });
  }

  function carregarDoServidor(id) {
    return fetch("/api/diagrama/" + encodeURIComponent(id))
      .then(function (resposta) {
        if (!resposta.ok) throw new Error("HTTP " + resposta.status);
        return resposta.json();
      })
      .then(function (corpo) {
        estado.id = corpo.id;
        estado.nome = corpo.nome;
        estado.status = corpo.status || "em_progresso";
        estado.pan = corpo.dados.pan || { x: 60, y: 60 };
        estado.zoom = typeof corpo.dados.zoom === "number" ? corpo.dados.zoom : 1;
        estado.nos = corpo.dados.nos || [];
        pilhaDesfazer = [];
        pilhaRefazer = [];
        sujo = false;
        document.getElementById("inputNomeDiagrama").value = estado.nome;
        document.getElementById("selectStatusDiagrama").value = estado.status;
        render();
        atualizarBotoesHistorico();
        requestAnimationFrame(ajustarVisualizacao);
        mostrarNotificacao('Diagrama "' + estado.nome + '" carregado (ID ' + estado.id + ").", "sucesso");
        return corpo;
      })
      .catch(function (erro) {
        mostrarNotificacao("Falha ao carregar diagrama: " + erro.message, "erro");
        throw erro;
      });
  }

  function atualizarStatusNoServidor(status) {
    // Se o diagrama ainda não foi salvo (sem id), o status só existe em
    // memória por enquanto — será enviado no próximo salvamento completo.
    if (!estado.id) return;
    fetch("/api/diagrama/" + encodeURIComponent(estado.id) + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status })
    })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error("HTTP " + resposta.status);
        mostrarNotificacao("Status atualizado para: " + (status === "concluido" ? "Concluído" : "Em progresso"), "sucesso");
      })
      .catch(function (erro) {
        mostrarNotificacao("Falha ao atualizar status: " + erro.message, "erro");
      });
  }

  function sincronizarFechamento() {
    if (!sujo) return;
    var payload = JSON.stringify(estadoParaPacote());
    var enviado = false;
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: "application/json" });
      enviado = navigator.sendBeacon("/api/diagrama/salvar", blob);
    }
    if (!enviado) {
      fetch("/api/diagrama/salvar", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
    }
    sujo = false;
  }

  function configurarSincronizacaoDeFechamento() {
    window.addEventListener("beforeunload", sincronizarFechamento);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") sincronizarFechamento();
    });
  }

  // ---------- Botões da barra de ferramentas ----------

  function configurarBotoes() {
    document.getElementById("btnZoomIn").addEventListener("click", function () {
      var r = outerEl.getBoundingClientRect();
      aplicarZoom(1.15, r.width / 2, r.height / 2);
    });
    document.getElementById("btnZoomOut").addEventListener("click", function () {
      var r = outerEl.getBoundingClientRect();
      aplicarZoom(1 / 1.15, r.width / 2, r.height / 2);
    });
    document.getElementById("btnAjustar").addEventListener("click", ajustarVisualizacao);
    document.getElementById("btnReorganizar").addEventListener("click", function () {
      comHistorico(function () { aplicarLayoutPadrao(estado.nos); });
      render();
      requestAnimationFrame(ajustarVisualizacao);
    });

    document.getElementById("inputNomeDiagrama").addEventListener("input", function (e) {
      estado.nome = e.target.value;
      sujo = true;
    });

    document.getElementById("selectStatusDiagrama").addEventListener("change", function (e) {
      estado.status = e.target.value;
      sujo = true;
      atualizarStatusNoServidor(estado.status);
    });

    document.getElementById("btnSalvar").addEventListener("click", function () { salvarNoServidor(true); });
    document.getElementById("btnCarregar").addEventListener("click", function () {
      var id = document.getElementById("inputIdCarregar").value.trim();
      if (!id) { mostrarNotificacao("Informe o ID do diagrama para carregar.", "info"); return; }
      carregarDoServidor(id);
    });

    document.getElementById("btnNovoDiagrama").addEventListener("click", function () {
      if (!confirm("Isso vai descartar o diagrama atual da tela (não afeta o que já estiver salvo no servidor). Continuar?")) return;
      estado = estadoPadrao();
      sujo = false;
      pilhaDesfazer = [];
      pilhaRefazer = [];
      document.getElementById("inputNomeDiagrama").value = estado.nome;
      render();
      atualizarBotoesHistorico();
      requestAnimationFrame(ajustarVisualizacao);
    });

    document.getElementById("btnExportarSvg").addEventListener("click", exportarSVG);
  }

  function configurarRedimensionamento() {
    var ro = new ResizeObserver(function () { desenharLinhas(); });
    ro.observe(outerEl);
    window.addEventListener("resize", desenharLinhas);
  }

  // ---------- Barra de ferramentas flutuante (estilo Miro) — visual; ferramentas de desenho ainda não implementadas ----------

  var EXTENSOES_DISPONIVEIS = [
    { id: "biblioteca-icones", label: "Biblioteca de ícones de risco" },
    { id: "planilha-riscos", label: "Exportar para planilha de riscos" },
    { id: "conector-incidentes", label: "Conector com base de incidentes" },
    { id: "integracao-erm", label: "Integração com sistema ERM" }
  ];

  function definirFerramenta(nome) {
    modoFerramenta = nome;
    document.querySelectorAll(".ferramenta-btn[data-ferramenta]").forEach(function (b) {
      b.classList.toggle("ativo", b.getAttribute("data-ferramenta") === nome);
    });
    if (outerEl) outerEl.classList.toggle("modo-anotacao", nome !== "selecao");
    if (nome !== "caneta") desenhoAtual = null;
  }

  function configurarFerramentasFlutuantes() {
    var grupoPrincipal = document.querySelector(".ferramentas-grupo-principal");
    if (!grupoPrincipal) return;

    var botoesFerramenta = grupoPrincipal.querySelectorAll(".ferramenta-btn[data-ferramenta]");
    botoesFerramenta.forEach(function (btn) {
      btn.addEventListener("click", function () {
        definirFerramenta(btn.getAttribute("data-ferramenta"));
      });
    });

    var btnMais = document.getElementById("btnMaisFerramentas");
    var popover = document.getElementById("popoverMaisFerramentas");
    var lista = document.getElementById("listaMaisFerramentas");
    if (btnMais && popover && lista) {
      lista.innerHTML = EXTENSOES_DISPONIVEIS.map(function (ext) {
        return '<li><button type="button" class="ferramentas-popover-item" data-extensao="' + escaparHtml(ext.id) + '">' +
          escaparHtml(ext.label) + "</button></li>";
      }).join("");

      var fecharPopover = function () {
        popover.hidden = true;
        btnMais.setAttribute("aria-expanded", "false");
      };
      var abrirPopover = function () {
        popover.hidden = false;
        btnMais.setAttribute("aria-expanded", "true");
      };

      btnMais.addEventListener("click", function (e) {
        e.stopPropagation();
        if (popover.hidden) abrirPopover(); else fecharPopover();
      });
      lista.addEventListener("click", function (e) {
        var item = e.target.closest(".ferramentas-popover-item");
        if (!item) return;
        mostrarNotificacao('Extensão "' + item.textContent + '" — em breve.', "info");
        fecharPopover();
      });
      document.addEventListener("mousedown", function (e) {
        if (!popover.hidden && !popover.contains(e.target) && e.target !== btnMais && !btnMais.contains(e.target)) {
          fecharPopover();
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !popover.hidden) fecharPopover();
      });
    }

    var btnDesfazerFlutuante = document.getElementById("btnDesfazerFlutuante");
    var btnRefazerFlutuante = document.getElementById("btnRefazerFlutuante");
    if (btnDesfazerFlutuante) btnDesfazerFlutuante.addEventListener("click", desfazer);
    if (btnRefazerFlutuante) btnRefazerFlutuante.addEventListener("click", refazer);

    var btnCompartilharImagem = document.getElementById("btnCompartilharImagem");
    if (btnCompartilharImagem) btnCompartilharImagem.addEventListener("click", compartilharImagemDiagrama);

    configurarTelaCheia();
  }

  // ---------- Tela cheia do diagrama (F11, Ctrl+F ou botão dedicado) ----------

  function alternarTelaCheia() {
    if (!document.fullscreenElement) {
      if (outerEl.requestFullscreen) {
        outerEl.requestFullscreen().catch(function (erro) {
          mostrarNotificacao("Não foi possível entrar em tela cheia: " + erro.message, "erro");
        });
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  function configurarTelaCheia() {
    var btnTelaCheia = document.getElementById("btnTelaCheia");
    if (!btnTelaCheia) return;

    btnTelaCheia.addEventListener("click", alternarTelaCheia);

    document.addEventListener("fullscreenchange", function () {
      var ativo = document.fullscreenElement === outerEl;
      btnTelaCheia.classList.toggle("ativo", ativo);
      btnTelaCheia.title = ativo ? "Sair da tela cheia (F11 ou Ctrl+F)" : "Tela cheia (F11 ou Ctrl+F)";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "F11" || ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        alternarTelaCheia();
      }
    });
  }

  // ---------- Painel lateral de atividades (lista de comentários) ----------

  function centralizarEm(worldX, worldY) {
    var rect = outerEl.getBoundingClientRect();
    estado.pan.x = rect.width / 2 - worldX * estado.zoom;
    estado.pan.y = rect.height / 2 - worldY * estado.zoom;
    aplicarTransformMundo();
    desenharLinhas();
  }

  function renderizarListaAtividades() {
    var lista = document.getElementById("listaAtividades");
    var comentarios = estado.nos.filter(function (n) { return n.tipo === "comentario" && n.texto; });
    if (!comentarios.length) {
      lista.innerHTML = '<div class="item-atividade-vazio">Nenhum comentário ainda. Selecione a ferramenta de Comentários e clique no diagrama para adicionar um.</div>';
      return;
    }
    lista.innerHTML = comentarios.map(function (n) {
      return '<button type="button" class="item-atividade" data-id="' + escaparHtml(n.id) + '">' +
        '<span class="item-atividade-avatar"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></span>' +
        '<span class="item-atividade-texto">' + escaparHtml(n.texto) + "</span></button>";
    }).join("");
  }

  function configurarPainelAtividades() {
    var btnAtividades = document.getElementById("btnAtividades");
    var painel = document.getElementById("painelAtividades");
    var lista = document.getElementById("listaAtividades");
    var btnFechar = document.getElementById("btnFecharAtividades");
    if (!btnAtividades || !painel || !lista || !btnFechar) return;

    function abrir() { renderizarListaAtividades(); painel.hidden = false; }
    function fechar() { painel.hidden = true; }

    btnAtividades.addEventListener("click", function () {
      if (painel.hidden) abrir(); else fechar();
    });
    btnFechar.addEventListener("click", fechar);
    lista.addEventListener("click", function (e) {
      var item = e.target.closest(".item-atividade");
      if (!item) return;
      var no = estado.nos.find(function (n) { return n.id === item.getAttribute("data-id"); });
      if (no) centralizarEm(no.x, no.y);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !painel.hidden) fechar();
    });
  }

  // ---------- Apresentar (oculta a interface e maximiza o canvas) ----------

  function alternarApresentacao() {
    var btn = document.getElementById("btnApresentar");
    var ativando = !document.body.classList.contains("modo-apresentacao");
    document.body.classList.toggle("modo-apresentacao", ativando);
    if (btn) btn.classList.toggle("ativo", ativando);
    if (ativando && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () {});
    } else if (!ativando && document.fullscreenElement === document.documentElement) {
      document.exitFullscreen();
    }
    requestAnimationFrame(function () {
      desenharLinhas();
      ajustarVisualizacao();
    });
  }

  function configurarApresentacao() {
    var btn = document.getElementById("btnApresentar");
    if (!btn) return;
    btn.addEventListener("click", alternarApresentacao);
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && document.body.classList.contains("modo-apresentacao")) {
        document.body.classList.remove("modo-apresentacao");
        btn.classList.remove("ativo");
        requestAnimationFrame(function () {
          desenharLinhas();
          ajustarVisualizacao();
        });
      }
    });
  }

  // ---------- Inicialização ----------

  document.addEventListener("DOMContentLoaded", function () {
    outerEl = document.getElementById("outer");
    mundoEl = document.getElementById("world");
    canvasEl = document.getElementById("linesCanvas");

    configurarCliquesETeclado();
    configurarArrasteEPan();
    configurarSidebar();
    configurarBotoes();
    configurarModal();
    configurarModalJson();
    configurarModalComentario();
    configurarRedimensionamento();
    configurarFerramentasFlutuantes();
    configurarPainelAtividades();
    configurarApresentacao();
    configurarSincronizacaoDeFechamento();
    atualizarBotoesHistorico();

    var idInicial = new URLSearchParams(location.search).get("id");
    if (idInicial) {
      carregarDoServidor(idInicial);
    } else {
      document.getElementById("inputNomeDiagrama").value = estado.nome;
      render();
      requestAnimationFrame(ajustarVisualizacao);
    }

    window.BowTieDiagrama = {
      validarDiagramaAtual: validarDiagramaAtual,
      obterDados: function () { return JSON.parse(JSON.stringify(estadoParaPacote())); },
      salvarNoServidor: salvarNoServidor,
      carregarDoServidor: carregarDoServidor,
      exportarJSON: exportarJSON,
      exportarSVG: exportarSVG,
      desfazer: desfazer,
      refazer: refazer
    };
    window.validarDiagramaAtual = validarDiagramaAtual;
  });
})();