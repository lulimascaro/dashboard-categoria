// =====================================================================
// Página "EL Compilado": OnePage com todas as ELs (A4 paisagem)
// Lê as ELs pelo el.js (window.estudosEL) — nada sai do navegador.
// =====================================================================
const $ = (id) => document.getElementById(id);
const CORES = ['#6B76A6', '#A58BDB', '#F2C94C', '#4FA3A5', '#E07B53', '#8BB174',
  '#C25B8C', '#5B8FD9', '#B8A07E', '#3D4466', '#D98FB0', '#2E8B57', '#9C6644',
  '#7FB3D5', '#D4AC0D', '#6C3483', '#48C9B0', '#CB4335', '#85929E', '#F0B27A'];
const VERMELHO = '#C0392B';
const MEDIDAS = [
  ['un', 'UN'], ['fatB', 'Fat. Bruto'], ['fatL', 'Fat. Líquido'], ['rcd', 'RCD'], ['rc', 'RC'], ['pf', 'PF'],
];
const MESES = Array.from({ length: 24 }, (_, i) => `Mês ${i + 1}`);

const ec = {
  visao: 'marca',        // 'marca' (soma as ELs do mesmo Produto) ou 'sku'
  selecionadas: new Set(), // linhas clicadas na tabela (filtram gráficos e cards)
  ocultas: new Set(),      // itens escondidos pela legenda
  graficos: {},
  mercado: null,
  seletor: null,
  temporizador: null,
};

// ----- formatação brasileira -----
const fmt = {};
const formato = (d) => (fmt[d] = fmt[d] || new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const valido = (v) => typeof v === 'number' && Number.isFinite(v);
function abreviar(v) {
  if (!valido(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return formato(1).format(v / 1e9) + 'B';
  if (a >= 1e6) return formato(1).format(v / 1e6) + 'M';
  if (a >= 1e3) return formato(1).format(v / 1e3) + 'K';
  return formato(a < 10 ? 2 : 0).format(v);
}
const pct = (v) => (valido(v) ? formato(1).format(v * 100) + '%' : '-');
const reais = (v) => (valido(v) ? 'R$ ' + formato(2).format(v) : '-');
const inteiro = (v) => (valido(v) ? formato(0).format(v) : '-');
const dividir = (a, b) => (valido(a) && valido(b) && b !== 0 ? a / b : null);
const soma = (lista) => lista.reduce((s, v) => s + (valido(v) ? v : 0), 0);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const corTexto = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? '#2B2B2B' : '#FFFFFF'; };

// ---------------------------------------------------------------------
// Dados: ELs escolhidas -> grupos (marca ou SKU)
// ---------------------------------------------------------------------
function rotulosELs() {
  // nome único de cada EL para a caixa de seleção
  const lista = window.estudosEL ? window.estudosEL.lista() : [];
  const vistos = {};
  return lista.map((el) => {
    const m = window.estudosEL.metricas(el);
    vistos[m.nome] = (vistos[m.nome] || 0) + 1;
    return { el, rotulo: vistos[m.nome] > 1 ? `${m.nome} (${vistos[m.nome]})` : m.nome };
  });
}

function montarGrupos() {
  const todas = rotulosELs();
  const escolhidas = ec.seletor && ec.seletor.valores.size ? todas.filter((x) => ec.seletor.valores.has(x.rotulo)) : todas;
  const grupos = new Map();
  for (const { el, rotulo } of escolhidas) {
    const m = window.estudosEL.metricas(el);
    const chave = ec.visao === 'marca' ? m.produto : rotulo;
    if (!grupos.has(chave)) grupos.set(chave, { nome: chave, els: [] });
    grupos.get(chave).els.push(m);
  }
  const lista = [...grupos.values()];
  lista.forEach(calcularGrupo);
  // cores fixas por nome (ordem alfabética)
  lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  lista.forEach((g, i) => { g.cor = CORES[i % CORES.length]; });
  return lista;
}

// somas mensais e indicadores de um grupo de ELs
function calcularGrupo(g) {
  const campos = ['un', 'pf', 'rcd', 'rc', 'sellUn', 'fatB', 'fatL', 'estUn'];
  g.meses = Array.from({ length: 24 }, (_, i) => {
    const o = {};
    for (const c of campos) {
      const vals = g.els.map((m) => m.meses[i][c]).filter(valido);
      o[c] = vals.length ? soma(vals) : null;
    }
    const dias = g.els.map((m) => m.meses[i].estDia).filter(valido);
    o.estDia = dias.length ? soma(dias) / dias.length : null; // média dos SKUs
    return o;
  });
  g.anos = [0, 1].map((a) => {
    const ms = g.meses.slice(a * 12, a * 12 + 12);
    const t = (c) => soma(ms.map((m) => m[c]));
    // Margem Bruta (k R$) = Fat. Líquido − Sell-In UN × CPV
    const mb = soma(g.els.map((m) => {
      const mm = m.meses.slice(a * 12, a * 12 + 12);
      return soma(mm.map((x) => x.fatL)) - soma(mm.map((x) => x.sellUn)) * (m.cpv[a] || 0);
    }));
    const invest = soma(g.els.map((m) => m.invest[a])); // R$
    const r = { un: t('un'), pf: t('pf'), rcd: t('rcd'), rc: t('rc'), sellUn: t('sellUn'), fatB: t('fatB'), fatL: t('fatL'), mb, invest };
    r.mc = mb - invest / 1000; // Margem de Contribuição (k R$) = Margem Bruta − Investimento
    return r;
  });
  const a1 = g.anos[0];
  // preços médios do Ano 1 (ponderados pelas unidades)
  g.pf1 = dividir(a1.pf, a1.un);
  g.rcd1 = dividir(a1.rcd, a1.un);
  g.rc1 = dividir(a1.rc, a1.un);
  const unEl = (m) => soma(m.meses.slice(0, 12).map((x) => x.un));
  const pond = (f) => {
    const itens = g.els.filter((m) => valido(f(m)) && unEl(m) > 0);
    const peso = soma(itens.map(unEl));
    return peso ? soma(itens.map((m) => f(m) * unEl(m))) / peso : (g.els.length === 1 ? f(g.els[0]) : null);
  };
  g.desc1 = pond((m) => m.desc1);
  g.mbPct1 = dividir(a1.mb, a1.fatL);
  g.mf1 = g.rcd1 !== null && g.rc1 ? 1 - g.rcd1 / g.rc1 : null;
  const ref = pond((m) => m.refRc);
  g.idxRc = g.rc1 !== null && ref ? (g.rc1 / ref) * 100 : null;
  g.padrao = [...new Set(g.els.map((m) => m.padrao).filter(Boolean))].join(', ');
  g.tipoLista = [...new Set(g.els.map((m) => m.tipoLista).filter(Boolean))].join(', ');
  g.produto = [...new Set(g.els.map((m) => m.produto))].join(', ');
}

// ---------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------
function grafico(id) {
  if (!ec.graficos[id]) ec.graficos[id] = echarts.init($(id));
  return ec.graficos[id];
}

async function desenhar() {
  if ($('pagina-elcomp').hidden) return;
  atualizarSeletor();
  const todos = montarGrupos();
  const vazio = !todos.length;
  $('ec-vazio').hidden = !vazio;
  $('ec-folha').hidden = vazio;
  if (vazio) return;
  // linhas clicadas na tabela filtram cards e gráficos
  for (const s of [...ec.selecionadas]) if (!todos.some((g) => g.nome === s)) ec.selecionadas.delete(s);
  const grupos = ec.selecionadas.size ? todos.filter((g) => ec.selecionadas.has(g.nome)) : todos;
  const medida = $('ec-medida').value;
  const nomeMedida = MEDIDAS.find(([k]) => k === medida)[1];
  const nEls = todos.reduce((s, g) => s + g.els.length, 0);
  $('ec-titulo').textContent = `EL Compilado — ${nEls} EL${nEls > 1 ? 's' : ''} · ${ec.visao === 'marca' ? 'Marca total' : 'Por SKU'} · ${nomeMedida}`;
  $('ec-subtitulo').textContent = ec.selecionadas.size ? `Filtrado pela tabela: ${[...ec.selecionadas].join(', ')}` : '';

  if (!ec.mercado && window.painelEL && window.painelEL.baseCarregada()) {
    try { ec.mercado = await window.painelEL.mercadoUN(); } catch { ec.mercado = null; }
  }
  desenharCards(grupos);
  desenharLinhas(grupos, medida, nomeMedida);
  desenharBarras(grupos, medida, nomeMedida);
  desenharEstoque(grupos);
  desenharLegenda(todos, medida === 'un');
  $('ec-un-linhas').hidden = medida !== 'un';
  desenharTabela(todos);
}

function desenharCards(grupos) {
  const anos = [0, 1].map((a) => {
    const t = (c) => soma(grupos.map((g) => g.anos[a][c]));
    const r = { un: t('un'), sellUn: t('sellUn'), fatB: t('fatB'), fatL: t('fatL'), mb: t('mb'), mc: t('mc'), invest: t('invest') };
    r.skus = grupos.reduce((s, g) => s + g.els.filter((m) => soma(m.meses.slice(a * 12, a * 12 + 12).map((x) => x.un)) > 0).length, 0);
    const merc = ec.mercado ? ec.mercado[a === 0 ? 'a1' : 'a2'] : null;
    r.share = valido(merc) ? dividir(r.un * 1000, merc + r.un * 1000) : null; // share do mercado com as ELs
    return r;
  });
  const card = (titulo, f, classe = '') => `
    <div class="ec-card ${classe}"><div class="ec-card-titulo">${titulo}</div>
      <div class="ec-card-anos">${anos.map((r, i) => `<div><span>Ano ${i + 1}</span><b>${f(r)}</b></div>`).join('')}</div></div>`;
  $('ec-cards').innerHTML = [
    card('Nº de SKUs', (r) => inteiro(r.skus), 'ec-cinza'),
    card('Demanda UN', (r) => abreviar(r.un * 1000)),
    card('Sell-In UN', (r) => abreviar(r.sellUn * 1000)),
    card('Fat. Bruto', (r) => 'R$ ' + abreviar(r.fatB * 1000), 'ec-azul'),
    card('Fat. Líquido', (r) => 'R$ ' + abreviar(r.fatL * 1000), 'ec-azul'),
    card('Margem Bruta', (r) => `R$ ${abreviar(r.mb * 1000)} <small>${pct(dividir(r.mb, r.fatL))}</small>`, 'ec-azul'),
    card('Margem de Contribuição', (r) => `R$ ${abreviar(r.mc * 1000)} <small>${pct(dividir(r.mc, r.fatL))}</small>`, 'ec-azul'),
    card('Investimento total', (r) => 'R$ ' + abreviar(r.invest), 'ec-lilas'),
    card('Share UN no mercado', (r) => pct(r.share), 'ec-lilas'),
  ].join('');
}

const selecionadas = (grupos) => Object.fromEntries(grupos.map((g) => [g.nome, !ec.ocultas.has(g.nome)]));
const legendaOculta = (grupos) => ({ show: false, data: grupos.map((g) => g.nome), selected: selecionadas(grupos) });

// Medida UN: Sell-out (Demanda UN, linha contínua) e Sell-in (Sell-In UN, tracejada) na mesma cor
function desenharLinhasUN(grupos) {
  const g = grafico('ec-g-linhas');
  const comOut = $('ec-sellout').checked;
  const comIn = $('ec-sellin').checked;
  const series = [];
  grupos.forEach((gr) => {
    const base = { name: gr.nome, type: 'line', symbolSize: 4, itemStyle: { color: gr.cor } };
    if (comOut) series.push({ ...base, lineStyle: { width: 2 }, data: gr.meses.map((m) => m.un) });
    if (comIn) series.push({ ...base, symbol: 'emptyCircle', lineStyle: { width: 2, type: [6, 4] }, data: gr.meses.map((m) => m.sellUn) });
  });
  // linha vertical separando o Ano 1 do Ano 2
  if (series.length) {
    series[0].markLine = {
      silent: true, symbol: 'none', lineStyle: { color: '#045b7b', type: 'dashed', width: 1.5 },
      label: { formatter: 'Ano 1 | Ano 2', position: 'end', color: '#045b7b', fontSize: 10 },
      data: [{ xAxis: 11.5 }],
    };
  }
  const k = (v) => (valido(v) ? abreviar(v * 1000) : '-');
  g.setOption({
    animation: false,
    title: { text: 'UN por mês (k): Sell-out e Sell-in', left: 6, top: 2, textStyle: { fontSize: 13, color: '#045b7b' } },
    legend: legendaOculta(grupos),
    // ao passar o mouse: Sell-out, Sell-in e a diferença de cada item visível
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const linhas = grupos.filter((gr) => !ec.ocultas.has(gr.nome)).map((gr) => {
          const m = gr.meses[i];
          const dif = valido(m.sellUn) || valido(m.un) ? (m.sellUn || 0) - (m.un || 0) : null;
          return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:${gr.cor}"></span>${esc(gr.nome)}</td>
            <td style="text-align:right;padding-left:10px">${k(m.un)}</td><td style="text-align:right;padding-left:10px">${k(m.sellUn)}</td>
            <td style="text-align:right;padding-left:10px;color:${valido(dif) && dif < 0 ? VERMELHO : 'inherit'}">${k(dif)}</td></tr>`;
        }).join('');
        return `<b>${MESES[i]}</b><table style="font-size:12px"><tr style="color:#777"><td></td><td style="text-align:right;padding-left:10px">Sell-out</td>
          <td style="text-align:right;padding-left:10px">Sell-in</td><td style="text-align:right;padding-left:10px">Sell-in − Sell-out</td></tr>${linhas}</table>`;
      },
    },
    grid: { left: 52, right: 14, top: 34, bottom: 34 },
    xAxis: { type: 'category', data: MESES, axisLabel: { fontSize: 9, interval: 1 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v) => abreviar(v * 1000) } },
    series,
  }, true);
}

// Medida UN: em cada ano, uma barra de Sell-out e outra de Sell-in, empilhadas por item
function desenharBarrasUN(grupos) {
  const g = grafico('ec-g-barras');
  // categoria vazia no meio: espaço entre o Ano 1 e o Ano 2
  const categorias = ['Sell-out\nAno 1', 'Sell-in\nAno 1', '', 'Sell-out\nAno 2', 'Sell-in\nAno 2'];
  const anual = (gr, campo, a) => soma(gr.meses.slice(a * 12, a * 12 + 12).map((m) => m[campo]));
  const valores = grupos.map((gr) => [anual(gr, 'un', 0), anual(gr, 'sellUn', 0), null, anual(gr, 'un', 1), anual(gr, 'sellUn', 1)]);
  const totais = [0, 1, 2, 3, 4].map((i) => (i === 2 ? null : soma(valores.map((v) => v[i]))));
  g.setOption({
    animation: false,
    title: { text: 'UN por ano: Sell-out × Sell-in', left: 6, top: 2, textStyle: { fontSize: 13, color: '#045b7b' } },
    legend: legendaOculta(grupos),
    tooltip: { trigger: 'item', formatter: (p) => `${esc(p.seriesName)}<br>${p.name.replace('\n', ' · ')}: <b>${abreviar(p.value * 1000)}</b> (${pct(dividir(p.value, totais[p.dataIndex]))})` },
    grid: { left: 52, right: 14, top: 40, bottom: 34 },
    xAxis: { type: 'category', data: categorias, axisLabel: { fontSize: 10, interval: 0 } },
    yAxis: { type: 'value', max: (v) => v.max * 1.15, axisLabel: { fontSize: 10, formatter: (v) => abreviar(v * 1000) } },
    series: [
      ...grupos.map((gr, gi) => ({
        name: gr.nome, type: 'bar', stack: 'ano', barMaxWidth: 50, barCategoryGap: '20%', itemStyle: { color: gr.cor },
        data: valores[gi].map((v, i) => ({ value: v, label: { show: totais[i] > 0 && v / totais[i] >= 0.1 } })),
        label: { position: 'inside', fontSize: 9, color: corTexto(gr.cor), formatter: (p) => pct(dividir(p.value, totais[p.dataIndex])) },
      })),
      { // total acima de cada barra (marcador invisível para o rótulo aparecer)
        name: '__total', type: 'line', silent: true, symbol: 'circle', symbolSize: 1, itemStyle: { color: 'rgba(0,0,0,0)' },
        lineStyle: { opacity: 0 }, tooltip: { show: false }, data: totais,
        label: { show: true, position: 'top', fontWeight: 'bold', fontSize: 10, color: '#2B2B2B', formatter: (p) => abreviar(p.value * 1000) },
      },
    ],
  }, true);
}

function desenharLinhas(grupos, medida, nomeMedida) {
  if (medida === 'un') { desenharLinhasUN(grupos); return; }
  const g = grafico('ec-g-linhas');
  g.setOption({
    animation: false,
    title: { text: `${nomeMedida} por mês (k)`, left: 6, top: 2, textStyle: { fontSize: 13, color: '#045b7b' } },
    legend: legendaOculta(grupos),
    tooltip: { trigger: 'axis', valueFormatter: (v) => abreviar(v * 1000) },
    grid: { left: 52, right: 14, top: 34, bottom: 34 },
    xAxis: { type: 'category', data: MESES, axisLabel: { fontSize: 9, interval: 1 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v) => abreviar(v * 1000) } },
    series: grupos.map((gr, gi) => ({
      name: gr.nome, type: 'line', symbolSize: 4, itemStyle: { color: gr.cor }, lineStyle: { width: 2 },
      data: gr.meses.map((m) => m[medida]),
      // linha vertical separando o Ano 1 do Ano 2
      markLine: gi === 0 ? {
        silent: true, symbol: 'none', lineStyle: { color: '#045b7b', type: 'dashed', width: 1.5 },
        label: { formatter: 'Ano 1 | Ano 2', position: 'end', color: '#045b7b', fontSize: 10 },
        data: [{ xAxis: 11.5 }],
      } : undefined,
    })),
  }, true);
}

function desenharBarras(grupos, medida, nomeMedida) {
  if (medida === 'un') { desenharBarrasUN(grupos); return; }
  const g = grafico('ec-g-barras');
  const valores = grupos.map((gr) => [0, 1].map((a) => soma(gr.meses.slice(a * 12, a * 12 + 12).map((m) => m[medida]))));
  const totais = [0, 1].map((a) => soma(valores.map((v) => v[a])));
  g.setOption({
    animation: false,
    title: { text: `${nomeMedida} por ano`, left: 6, top: 2, textStyle: { fontSize: 13, color: '#045b7b' } },
    legend: legendaOculta(grupos),
    tooltip: { trigger: 'item', formatter: (p) => `${esc(p.seriesName)}<br>${p.name}: <b>${abreviar(p.value * 1000)}</b> (${pct(dividir(p.value, totais[p.dataIndex]))})` },
    grid: { left: 52, right: 14, top: 40, bottom: 26 },
    xAxis: { type: 'category', data: ['Ano 1', 'Ano 2'] },
    yAxis: { type: 'value', max: (v) => v.max * 1.15, axisLabel: { fontSize: 10, formatter: (v) => abreviar(v * 1000) } },
    series: [
      ...grupos.map((gr, gi) => ({
        name: gr.nome, type: 'bar', stack: 'ano', barMaxWidth: 70, itemStyle: { color: gr.cor },
        data: valores[gi].map((v, i) => ({ value: v, label: { show: totais[i] > 0 && v / totais[i] >= 0.08 } })),
        label: { position: 'inside', fontSize: 10, color: corTexto(gr.cor), formatter: (p) => pct(dividir(p.value, totais[p.dataIndex])) },
      })),
      { // total acima da barra (marcador invisível para o rótulo aparecer)
        name: '__total', type: 'line', silent: true, symbol: 'circle', symbolSize: 1, itemStyle: { color: 'rgba(0,0,0,0)' },
        lineStyle: { opacity: 0 }, tooltip: { show: false }, data: totais,
        label: { show: true, position: 'top', fontWeight: 'bold', color: '#2B2B2B', formatter: (p) => abreviar(p.value * 1000) },
      },
    ],
  }, true);
}

function desenharEstoque(grupos) {
  // Dias de estoque começa no Mês 4: nos primeiros meses os dias distorcem a escala
  for (const [id, campo, titulo, fmtV, inicio] of [
    ['ec-g-estoque', 'estUn', 'Estoque UN (k)', (v) => abreviar(v * 1000), 0],
    ['ec-g-dias', 'estDia', 'Dias de estoque (a partir do Mês 4)', (v) => inteiro(v), 3],
  ]) {
    const g = grafico(id);
    g.setOption({
      animation: false,
      title: { text: titulo, left: 6, top: 2, textStyle: { fontSize: 13, color: '#045b7b' } },
      legend: legendaOculta(grupos),
      tooltip: { trigger: 'axis', valueFormatter: fmtV },
      grid: { left: 52, right: 14, top: 34, bottom: 34 },
      xAxis: { type: 'category', data: MESES.slice(inicio), axisLabel: { fontSize: 9, hideOverlap: true } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: fmtV } },
      series: grupos.map((gr, gi) => ({
        name: gr.nome, type: 'line', symbolSize: 5, itemStyle: { color: gr.cor }, lineStyle: { width: 2 },
        // meses negativos: ponto vermelho; o valor aparece só no pior mês
        data: (() => {
          const vals = gr.meses.slice(inicio).map((m) => m[campo]);
          const minimo = Math.min(...vals.filter(valido));
          const iMin = vals.indexOf(minimo); // rótulo só na primeira vez que o pior valor aparece
          return vals.map((v, i) => (valido(v) && v < 0
            ? { value: v, symbolSize: 7, itemStyle: { color: VERMELHO },
              label: { show: i === iMin, color: VERMELHO, fontSize: 9, fontWeight: 'bold', position: 'bottom', formatter: (p) => fmtV(p.value) } }
            : { value: v }));
        })(),
        markLine: gi === 0 ? {
          silent: true, symbol: 'none', data: [{ yAxis: 0, lineStyle: { color: VERMELHO, width: 1 } }, { xAxis: 11.5 - inicio, lineStyle: { color: '#045b7b', type: 'dashed' } }],
          label: { show: false },
        } : undefined,
        // faixa vermelho-clara abaixo de zero
        markArea: gi === 0 ? { silent: true, itemStyle: { color: 'rgba(192,57,43,0.07)' }, data: [[{ yAxis: 'min' }, { yAxis: 0 }]] } : undefined,
      })),
    }, true);
  }
}

function desenharLegenda(grupos, comEstilos) {
  $('ec-legenda').innerHTML = grupos.map((g, i) => `
    <div class="leg-item${ec.ocultas.has(g.nome) ? ' oculta' : ''}" data-i="${i}" title="${esc(g.nome)}">
      <span class="leg-cor" style="background:${g.cor}"></span><span class="leg-nome">${esc(g.nome)}</span></div>`).join('')
    // Medida UN: explica o estilo das linhas
    + (comEstilos ? `<div class="ec-leg-estilos">
      <div class="leg-item estatica"><span class="ec-traco"></span><span class="leg-nome">Sell-out</span></div>
      <div class="leg-item estatica"><span class="ec-traco ec-tracejado"></span><span class="leg-nome">Sell-in</span></div></div>` : '');
  $('ec-legenda')._grupos = grupos;
}

function desenharTabela(grupos) {
  const total = { nome: 'Total', els: grupos.flatMap((g) => g.els) };
  calcularGrupo(total);
  const linha = (g, ehTotal) => {
    const a = g.anos;
    const classe = ehTotal ? '' : ec.selecionadas.size ? (ec.selecionadas.has(g.nome) ? 'selecionada' : 'apagada') : '';
    const sinal = (v) => (valido(v) && v < 0 ? ' class="ec-neg"' : '');
    return `<tr class="${classe}" ${ehTotal ? '' : `data-nome="${esc(g.nome)}"`}>
      <td class="ec-esq">${ehTotal ? '<b>Total</b>' : `<span class="leg-cor" style="background:${g.cor}"></span>${esc(ec.visao === 'marca' ? g.produto : g.nome)}`}</td>
      <td class="ec-esq">${ehTotal ? '' : esc(g.padrao)}</td><td class="ec-esq">${ehTotal ? '' : esc(g.tipoLista)}</td>
      <td>${reais(g.pf1)}</td><td>${reais(g.rcd1)}</td><td>${reais(g.rc1)}</td>
      <td>${pct(valido(g.desc1) ? g.desc1 / 100 : null)}</td><td>${pct(g.mbPct1)}</td><td>${pct(g.mf1)}</td><td>${inteiro(g.idxRc)}</td>
      <td>${abreviar(a[0].un * 1000)}</td><td>${abreviar(a[1].un * 1000)}</td>
      <td>${abreviar(a[0].fatL * 1000)}</td><td>${abreviar(a[1].fatL * 1000)}</td>
      <td${sinal(a[0].mc)}>${abreviar(a[0].mc * 1000)}</td><td${sinal(a[1].mc)}>${abreviar(a[1].mc * 1000)}</td></tr>`;
  };
  $('ec-tabela').innerHTML = `
    <thead><tr><th class="ec-esq">Produto</th><th class="ec-esq">Padrão SKU</th><th class="ec-esq">Tipo de Lista</th>
      <th>PF Ano 1</th><th>RCD Ano 1</th><th>RC Ano 1</th><th>Desc. Comercial</th><th>Margem Bruta %</th><th>Margem Farma %</th>
      <th>Index RC vs Ref.</th><th>UN Ano 1</th><th>UN Ano 2</th><th>Fat. L. Ano 1</th><th>Fat. L. Ano 2</th><th>MC Ano 1</th><th>MC Ano 2</th></tr></thead>
    <tbody>${grupos.map((g) => linha(g, false)).join('')}</tbody>
    <tfoot>${linha(total, true)}</tfoot>`;
}

// ---------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------
function atualizarSeletor() {
  if (!ec.seletor) return;
  const rotulos = rotulosELs().map((x) => x.rotulo);
  ec.seletor.opcoes = rotulos;
  for (const v of [...ec.seletor.valores]) if (!rotulos.includes(v)) ec.seletor.valores.delete(v);
  ec.seletor.desenhar();
}

function iniciar() {
  if (!window.componentes) { setTimeout(iniciar, 50); return; } // espera o app.js
  $('ec-medida').innerHTML = MEDIDAS.map(([k, r]) => `<option value="${k}">${r}</option>`).join('');
  ec.seletor = window.componentes.criarSeletor('ec-els', { unico: false, vazio: 'Todas', aoMudar: () => { ec.selecionadas.clear(); desenhar(); } });
  $('ec-medida').addEventListener('change', desenhar);
  $('ec-sellout').addEventListener('change', desenhar);
  $('ec-sellin').addEventListener('change', desenhar);
  document.querySelectorAll('#ec-visao button').forEach((b) => b.addEventListener('click', () => {
    ec.visao = b.dataset.visao;
    document.querySelectorAll('#ec-visao button').forEach((x) => x.classList.toggle('ativo', x === b));
    ec.selecionadas.clear();
    ec.ocultas.clear();
    desenhar();
  }));
  $('ec-imprimir').addEventListener('click', imprimir);
  // clique na linha da tabela filtra gráficos e cards (Ctrl+clique acumula; clicar de novo limpa)
  $('ec-tabela').addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr[data-nome]');
    if (!tr) return;
    const nome = tr.dataset.nome;
    if (e.ctrlKey || e.metaKey) { if (ec.selecionadas.has(nome)) ec.selecionadas.delete(nome); else ec.selecionadas.add(nome); }
    else if (ec.selecionadas.has(nome) && ec.selecionadas.size === 1) ec.selecionadas.clear();
    else ec.selecionadas = new Set([nome]);
    desenhar();
  });
  // legenda única: oculta/mostra o item em todos os gráficos
  $('ec-legenda').addEventListener('click', (e) => {
    const item = e.target.closest('.leg-item[data-i]');
    if (!item) return;
    const nome = $('ec-legenda')._grupos[Number(item.dataset.i)].nome;
    if (ec.ocultas.has(nome)) ec.ocultas.delete(nome); else ec.ocultas.add(nome);
    item.classList.toggle('oculta', ec.ocultas.has(nome));
    for (const g of Object.values(ec.graficos)) g.dispatchAction({ type: 'legendToggleSelect', name: nome });
  });
  // ELs alteradas, filtros ou projeção: redesenha (o mercado é recalculado)
  const depois = (limparMercado) => () => {
    if (limparMercado) ec.mercado = null;
    clearTimeout(ec.temporizador);
    ec.temporizador = setTimeout(desenhar, 150);
  };
  window.addEventListener('els-alteradas', depois(false));
  window.addEventListener('sugestao-proj', depois(true));
  window.addEventListener('projecao-alterada', depois(true));
  window.addEventListener('base-carregada', depois(true));
  window.addEventListener('resize', () => { if (!$('pagina-elcomp').hidden) Object.values(ec.graficos).forEach((g) => g.resize()); });
  // impressão: cabe numa página A4 paisagem
  window.addEventListener('beforeprint', ajustarImpressao);
  window.addEventListener('afterprint', () => {
    document.documentElement.style.removeProperty('--ec-escala');
    if ($('ec-papel')) $('ec-papel').remove();
  });
}

// reduz a folha para caber em uma página A4 paisagem (≈ 1060 × 740 px úteis)
function ajustarImpressao() {
  if ($('pagina-elcomp').hidden) return;
  const folha = $('ec-folha');
  document.documentElement.style.removeProperty('--ec-escala'); // mede sem a redução anterior
  const escala = 0.97 * Math.min(1, 1060 / folha.scrollWidth, 740 / folha.scrollHeight);
  document.documentElement.style.setProperty('--ec-escala', String(escala));
  // papel A4 paisagem só para esta impressão
  if (!$('ec-papel')) {
    const st = document.createElement('style');
    st.id = 'ec-papel';
    st.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(st);
  }
}
function imprimir() {
  ajustarImpressao();
  window.print();
}

window.compilado = {
  mostrar: () => {
    ec.mercado = null;
    desenhar().then(() => Object.values(ec.graficos).forEach((g) => g.resize()));
  },
};

iniciar();
