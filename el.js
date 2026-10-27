// =====================================================================
// Aba "EL" (Estudo de Lançamento)
// As ELs ficam só neste navegador (localStorage). Nada é enviado ao site.
// =====================================================================
const CHAVE_ELS = 'dashboard-farma:els';
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Estrutura da EL
// ---------------------------------------------------------------------
const APROVADORES = ['Estratégia', 'Pricing', 'Diretoria'];
const APROV_COLS = [['aprovado', 'Aprovado'], ['reprovado', 'Reprovado'], ['data', 'Data'], ['assinatura', 'Assinatura']];
const INFO = [
  ['bu', 'Nome da BU'], ['tipo', 'Tipo de Lançamento'], ['produto', 'Nome do Produto'], ['molecula', 'Molécula'],
  ['padraoSku', 'Padrão SKU'], ['forma', 'Forma Farmacêutica'], ['classe', 'Classe Terapêutica'],
  ['colidencia', 'Colidência com bu', 'txt', 'colidencia'], ['franquia', 'Franquia'], ['segmento', 'Segmento'],
  ['tipoLista', 'Tipo de Lista'], ['sazonalidade', 'Sazonalidade'],
  ['previsao', 'Previsão de Lançamento (BU)', 'txt', 'previsaodelancamento'],
  ['premissa', 'Premissa de Lançamento', 'area', 'premissa'], ['farmaciaPopular', 'Farmácia Popular', 'bool'],
];
// [chave, rótulo, calculado?]
const PREC = [
  ['pf', 'Preço Fábrica (R$)'], ['desc', 'Desc. Comercial (%)'], ['bruto', 'Preço Bruto (R$)', true],
  ['impostos', 'Impostos (R$)'], ['liquido', 'Preço Líquido (R$)'], ['cpv', 'CPV (R$)'],
  ['mbRs', 'Margem Bruta (R$)', true], ['mbPct', 'Margem Bruta (%)', true],
];
const CONCORRENTES = [['ref', 'Referência'], ['c1', 'Concorrente 1'], ['c2', 'Concorrente 2']];
const COMP_TOPO = [['empresa', 'Empresa'], ['produto', 'Produto'], ['padraoSku', 'Padrão SKU']];
const COMP_LINHAS = [
  ['pf', 'Preço Fábrica (R$)'], ['desc', 'Desc. Comercial (%)'], ['venda', 'Preço de venda (R$)'],
  ['markup', 'Mark Up Distrib.(%)'], ['descDireto', 'Desconto Direto (%)'], ['ppp', 'Preço PPP (R$)'],
  ['cpp', 'Preço CPP (R$)'], ['margemFarma', 'Margem Farma (%)'],
];
const LANC_CALC = ['pf', 'desc', 'venda', 'margemFarma']; // nas colunas do lançamento, vêm da Precificação ou são calculados
const INDICES = [['idxPf', 'Index PF Ano 1', 'pf'], ['idxPpp', 'Index PPP Ano 1', 'ppp'], ['idxCpp', 'Index CPP Ano 1', 'cpp']];
const DEM_COLS = [['un', 'UN'], ['pf', 'PF'], ['ppp', 'PPP'], ['cpp', 'CPP']];
const EST_COLS = [['un', 'UN'], ['dia', 'Dia', 0]];
const SELL_COLS = [['un', 'UN'], ['fatB', 'Fat. B.'], ['fatL', 'Fat. L.']];
const CANAIS = [['abrafarma', 'Abrafarma'], ['outras', 'Outras redes'], ['franquias', 'Franquias & Assoc.'], ['indep', 'Indep.']];
const REDE_TOT = [['totCpp', 'Total CPP'], ['totPpp', 'Total PPP'], ['totPf', 'Total PF']];
const ANOS = [['a1', 'Ano 1'], ['a2', 'Ano 2']];

const mesesObj = (n) => Array.from({ length: n }, () => ({}));
function novaEL() {
  return {
    id: 'el-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    codigo: '', assin: {}, info: {},
    prec: { ano1: {}, ano2: {} },
    comp: { l1: {}, l2: {}, ref: {}, c1: {}, c2: {} },
    dem: { share1: {}, share2: {}, m: mesesObj(24) },
    est: { m: mesesObj(24) },
    sell: { pc: [null, null, null], m: mesesObj(24) },
    redes: { a1: { m: mesesObj(12), tot: {} }, a2: { m: mesesObj(12), tot: {} } },
    exec: { cnpj: mesesObj(12), giro: mesesObj(12) },
    inv: { com: mesesObj(12), mkt: mesesObj(12) },
  };
}

// copia os valores de "origem" sobre uma EL vazia (tolera arquivos antigos ou incompletos)
function completarEL(origem) {
  const base = novaEL();
  const juntar = (alvo, fonte) => {
    if (!fonte || typeof fonte !== 'object') return;
    for (const k of Object.keys(fonte)) {
      if (alvo[k] && typeof alvo[k] === 'object' && typeof fonte[k] === 'object' && fonte[k] !== null) juntar(alvo[k], fonte[k]);
      else alvo[k] = fonte[k];
    }
  };
  juntar(base, origem);
  return base;
}

// lista de todos os campos editáveis: [caminho, tipo, casas decimais]
function camposEditaveis() {
  const c = [['codigo', 'txt']];
  for (const a of APROVADORES) for (const [k] of APROV_COLS) c.push([`assin.${a}.${k}`, 'txt']);
  for (const [k, , tipo] of INFO) c.push([`info.${k}`, tipo || 'txt']);
  for (const a of ['ano1', 'ano2']) for (const [k, , calc] of PREC) if (!calc) c.push([`prec.${a}.${k}`, 'num', 2]);
  for (const l of ['l1', 'l2']) for (const [k] of COMP_LINHAS) if (!LANC_CALC.includes(k)) c.push([`comp.${l}.${k}`, 'num', 2]);
  for (const [cc] of CONCORRENTES) {
    for (const [k] of COMP_TOPO) c.push([`comp.${cc}.${k}`, 'txt']);
    for (const [k] of COMP_LINHAS) if (k !== 'margemFarma') c.push([`comp.${cc}.${k}`, 'num', 2]);
  }
  for (const s of ['share1', 'share2']) for (const [k] of DEM_COLS) c.push([`dem.${s}.${k}`, 'num', 2]);
  for (let i = 0; i < 24; i++) {
    for (const [k] of DEM_COLS) c.push([`dem.m.${i}.${k}`, 'num', 2]);
    for (const [k, , d = 2] of EST_COLS) c.push([`est.m.${i}.${k}`, 'num', d]);
    for (const [k] of SELL_COLS) c.push([`sell.m.${i}.${k}`, 'num', 2]);
  }
  for (let i = 0; i < 3; i++) c.push([`sell.pc.${i}`, 'num', 2]);
  for (const [a] of ANOS) {
    for (let i = 0; i < 12; i++) for (const [k] of CANAIS) c.push([`redes.${a}.m.${i}.${k}`, 'num', 2]);
    for (const [t] of REDE_TOT) for (const [k] of CANAIS) c.push([`redes.${a}.tot.${t}.${k}`, 'num', 2]);
  }
  for (let i = 0; i < 12; i++) {
    for (const [a] of ANOS) {
      c.push([`exec.cnpj.${i}.${a}`, 'num', 0], [`exec.giro.${i}.${a}`, 'num', 2]);
      c.push([`inv.com.${i}.${a}`, 'num', 2], [`inv.mkt.${i}.${a}`, 'num', 2]);
    }
  }
  return c;
}

// nome legível de um campo (para o resumo da importação)
function nomeCampo(caminho) {
  const p = caminho.split('.');
  const mes = (i) => `Mês ${Number(i) + 1}`;
  const rot = (lista, k) => (lista.find((x) => x[0] === k) || [k, k])[1];
  switch (p[0]) {
    case 'codigo': return 'Código da EL';
    case 'assin': return `Assinatura · ${p[1]} · ${rot(APROV_COLS, p[2])}`;
    case 'info': return `Informações Gerais · ${rot(INFO, p[1])}`;
    case 'prec': return `Precificação · ${rot(PREC, p[2])} · ${p[1] === 'ano1' ? 'Ano 1' : 'Ano 2'}`;
    case 'comp': {
      const col = p[1] === 'l1' ? 'Lançamento Ano 1' : p[1] === 'l2' ? 'Lançamento Ano 2' : rot(CONCORRENTES, p[1]);
      return `Comparativo · ${rot([...COMP_TOPO, ...COMP_LINHAS, ...INDICES], p[2])} · ${col}`;
    }
    case 'dem': return `Demanda · ${p[1] === 'm' ? mes(p[2]) : p[1] === 'share1' ? 'Share Ano 1' : 'Share Ano 2'} · ${rot(DEM_COLS, p[p.length - 1])}`;
    case 'est': return `Estoque · ${mes(p[2])} · ${rot(EST_COLS, p[3])}`;
    case 'sell': return p[1] === 'pc' ? `Sell-In · PC ${Number(p[2]) + 1}` : `Sell-In · ${mes(p[2])} · ${rot(SELL_COLS, p[3])}`;
    case 'redes': return `Redes ${rot(ANOS, p[1])} · ${p[2] === 'm' ? mes(p[3]) : rot(REDE_TOT, p[3])} · ${rot(CANAIS, p[p.length - 1])}`;
    case 'exec': return `${p[1] === 'cnpj' ? 'Qtd. CNPJs Positivados' : 'Giro Mensal'} · ${mes(p[2])} · ${rot(ANOS, p[3])}`;
    case 'inv': return `Investimento ${p[1] === 'com' ? 'Comercial' : 'MKT'} · ${mes(p[2])} · ${rot(ANOS, p[3])}`;
    default: return caminho;
  }
}

function ler(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function gravar(obj, caminho, valor) {
  const p = caminho.split('.');
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) {
    if (o[p[i]] == null) o[p[i]] = /^\d+$/.test(p[i + 1]) ? [] : {};
    o = o[p[i]];
  }
  o[p[p.length - 1]] = valor;
}

// ---------------------------------------------------------------------
// Números no formato brasileiro
// ---------------------------------------------------------------------
const fmtCache = {};
function fmtNum(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (!fmtCache[d]) fmtCache[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return fmtCache[d].format(v);
}
// "1.234,56" -> 1234.56 ; "-" ou vazio -> null
function lerNumero(texto) {
  let t = String(texto == null ? '' : texto).replace(/R\$|%|\s/g, '').trim();
  if (!t || t === '-' || t === '–') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "10.165" = dez mil
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const somar = (lista) => { let s = 0, tem = false; for (const v of lista) if (num(v) !== null) { s += v; tem = true; } return tem ? s : null; };
const dividir = (a, b) => (num(a) !== null && num(b) ? a / b : null);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
// Campos calculados: caminho -> { d: casas decimais, f: (el) => valor }
// ---------------------------------------------------------------------
const CALCS = {};
(function montarCalculos() {
  for (const a of ['ano1', 'ano2']) {
    CALCS[`prec.${a}.bruto`] = { d: 2, f: (el) => (num(el.prec[a].pf) !== null && num(el.prec[a].desc) !== null ? el.prec[a].pf * (1 - el.prec[a].desc / 100) : null) };
    CALCS[`prec.${a}.mbRs`] = { d: 2, f: (el) => (num(el.prec[a].liquido) !== null && num(el.prec[a].cpv) !== null ? el.prec[a].liquido - el.prec[a].cpv : null) };
    CALCS[`prec.${a}.mbPct`] = { d: 2, f: (el) => { const r = dividir(CALCS[`prec.${a}.mbRs`].f(el), el.prec[a].liquido); return r === null ? null : r * 100; } };
  }
  // colunas do lançamento no comparativo: PF, desconto e preço de venda vêm da Precificação
  for (const [l, a] of [['l1', 'ano1'], ['l2', 'ano2']]) {
    CALCS[`comp.${l}.pf`] = { d: 2, f: (el) => num(el.prec[a].pf) };
    CALCS[`comp.${l}.desc`] = { d: 2, f: (el) => num(el.prec[a].desc) };
    CALCS[`comp.${l}.venda`] = { d: 2, f: (el) => CALCS[`prec.${a}.bruto`].f(el) };
  }
  for (const c of ['l1', 'l2', 'ref', 'c1', 'c2']) {
    CALCS[`comp.${c}.margemFarma`] = { d: 2, f: (el) => { const r = dividir(el.comp[c].ppp, el.comp[c].cpp); return r === null ? null : (1 - r) * 100; } };
  }
  // Index = preço do lançamento (Ano 1) ÷ preço do concorrente × 100
  const precoLanc = { pf: (el) => num(el.prec.ano1.pf), ppp: (el) => num(el.comp.l1.ppp), cpp: (el) => num(el.comp.l1.cpp) };
  for (const [c] of CONCORRENTES) {
    for (const [k, , campo] of INDICES) {
      CALCS[`comp.${c}.${k}`] = { d: 0, f: (el) => { const r = dividir(precoLanc[campo](el), el.comp[c][campo]); return r === null ? null : r * 100; } };
    }
  }
  // totais de ano (Demanda e Sell-In somam os meses; Estoque é a posição do último mês do ano)
  for (const [t, ini] of [['t1', 0], ['t2', 12]]) {
    for (const [k] of DEM_COLS) CALCS[`dem.${t}.${k}`] = { d: 2, f: (el) => somar(el.dem.m.slice(ini, ini + 12).map((m) => m[k])) };
    for (const [k] of SELL_COLS) CALCS[`sell.${t}.${k}`] = { d: 2, f: (el) => somar(el.sell.m.slice(ini, ini + 12).map((m) => m[k])) };
    for (const [k, , d = 2] of EST_COLS) CALCS[`est.${t}.${k}`] = { d, f: (el) => num(el.est.m[ini + 11][k]) };
    // preço unitário médio do ano = valor ÷ UN
    for (const k of ['pf', 'ppp', 'cpp']) CALCS[`dem.pu${t}.${k}`] = { d: 2, f: (el) => dividir(CALCS[`dem.${t}.${k}`].f(el), CALCS[`dem.${t}.un`].f(el)) };
    for (const k of ['fatB', 'fatL']) CALCS[`sell.pu${t}.${k}`] = { d: 2, f: (el) => dividir(CALCS[`sell.${t}.${k}`].f(el), CALCS[`sell.${t}.un`].f(el)) };
  }
  for (const g of ['com', 'mkt']) for (const [a] of ANOS) CALCS[`inv.${g}.tot.${a}`] = { d: 2, f: (el) => somar(el.inv[g].map((m) => m[a])) };
}());

// ---------------------------------------------------------------------
// Estado e armazenamento no navegador
// ---------------------------------------------------------------------
const els = { lista: [], ativa: null, temporizador: null };

function carregarSalvas() {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_ELS) || 'null');
    if (dados && Array.isArray(dados.lista)) {
      els.lista = dados.lista.map(completarEL);
      els.ativa = dados.ativa;
    }
  } catch { /* armazenamento indisponível: começa vazio */ }
  if (!els.lista.some((e) => e.id === els.ativa)) els.ativa = els.lista[0] ? els.lista[0].id : null;
}
function salvar() {
  try {
    localStorage.setItem(CHAVE_ELS, JSON.stringify({ lista: els.lista, ativa: els.ativa }));
    $('el-aviso-salvar').textContent = '';
  } catch {
    $('el-aviso-salvar').textContent = '⚠ Não foi possível salvar no navegador (armazenamento cheio ou bloqueado). Exporte as ELs para não perder.';
  }
}
function salvarDepois() { clearTimeout(els.temporizador); els.temporizador = setTimeout(salvar, 300); }
const elAtiva = () => els.lista.find((e) => e.id === els.ativa) || null;
const nomeEL = (el) => [el.info.produto, el.info.padraoSku].filter((x) => x && String(x).trim()).join(' ').trim() || 'EL sem nome';

// ---------------------------------------------------------------------
// Desenho da EL (todos os valores são campos editáveis)
// ---------------------------------------------------------------------
function campo(el, caminho, d = 2, extra = '') {
  return `<input class="el-in el-num ${extra}" data-c="${caminho}" data-d="${d}" inputmode="decimal" value="${esc(fmtNum(ler(el, caminho), d))}">`;
}
function campoTexto(el, caminho, extra = '') {
  return `<input class="el-in el-txt ${extra}" data-c="${caminho}" value="${esc(ler(el, caminho))}">`;
}
function calc(caminho) {
  return `<output class="el-calc" data-k="${caminho}" title="Calculado automaticamente"></output>`;
}

function htmlEL(el) {
  const mesesLinhas = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  // ----- cabeçalho com assinaturas -----
  const cab = `
    <header class="el-cab">
      <div class="el-logo">Estudo de Lançamento</div>
      <div class="el-aprov">
        <p class="el-aprov-titulo">Assinatura</p>
        <table class="el-aprov-tab">
          <thead><tr><th></th>${APROV_COLS.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead>
          <tbody>${APROVADORES.map((a) => `<tr><td>${a}</td>${APROV_COLS.map(([k]) => `<td>${campoTexto(el, `assin.${a}.${k}`, 'el-branco')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <button type="button" class="el-imprimir">Imprimir</button>
    </header>`;
  // ----- informações gerais -----
  const info = `
    <section class="el-info">
      <div class="el-intro"><h1>Informações Gerais</h1>${campoTexto(el, 'codigo', 'el-codigo')}</div>
      <table><tbody>${INFO.map(([k, r, tipo]) => {
        let entrada;
        if (tipo === 'area') entrada = `<textarea class="el-in el-txt el-area" data-c="info.${k}" rows="3">${esc(el.info[k])}</textarea>`;
        else if (tipo === 'bool') {
          const v = el.info[k];
          entrada = `<select class="el-in el-bool" data-c="info.${k}"><option value=""${v == null ? ' selected' : ''}>-</option><option value="true"${v === true ? ' selected' : ''}>Sim</option><option value="false"${v === false ? ' selected' : ''}>Não</option></select>`;
        } else entrada = campoTexto(el, `info.${k}`, 'el-esq');
        return `<tr><td class="el-rot">${r}</td><td>${entrada}</td></tr>`;
      }).join('')}</tbody></table>
    </section>
    <div class="el-quebra"></div>`;
  // ----- precificação -----
  const celComp = (c, k) => {
    const caminho = `comp.${c}.${k}`;
    if (CALCS[caminho]) return `<td>${calc(caminho)}</td>`;
    return `<td>${campo(el, caminho, 2)}</td>`;
  };
  const prec = `
    <section class="el-prec">
      <h1 class="el-titulo">Precificação</h1>
      <table class="el-tab-prec">
        <thead><tr><th></th><th class="el-th">Ano 1</th><th class="el-th">Ano 2</th></tr></thead>
        <tbody>${PREC.map(([k, r, ehCalc]) => `<tr><td class="el-rot">${r}</td>${['ano1', 'ano2'].map((a) =>
          `<td>${ehCalc ? calc(`prec.${a}.${k}`) : campo(el, `prec.${a}.${k}`)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <table class="el-tab-comp">
        <thead><tr><th></th><th class="el-th">Lançamento Ano 1</th><th class="el-th">Lançamento Ano 2</th>${CONCORRENTES.map(([, r]) => `<th class="el-th">${r}</th>`).join('')}</tr></thead>
        <tbody>
          ${COMP_TOPO.map(([k, r]) => `<tr><td class="el-rot">${r}</td><td></td><td></td>${CONCORRENTES.map(([c]) => `<td>${campoTexto(el, `comp.${c}.${k}`)}</td>`).join('')}</tr>`).join('')}
          ${COMP_LINHAS.map(([k, r]) => `<tr><td class="el-rot">${r}</td>${['l1', 'l2'].map((l) => celComp(l, k)).join('')}${CONCORRENTES.map(([c]) => celComp(c, k)).join('')}</tr>`).join('')}
          <tr class="el-espaco"><td colspan="6"></td></tr>
          ${INDICES.map(([k, r]) => `<tr><td class="el-rot">${r}</td><td></td><td></td>${CONCORRENTES.map(([c]) => `<td>${calc(`comp.${c}.${k}`)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </section>
    <div class="el-quebra"></div>`;
  // ----- volume: Demanda | Estoque | Sell-In (linhas alinhadas) -----
  const linhaVol = (rot, cel) => `<tr><td class="el-rot">${rot}</td>${cel}</tr>`;
  const bloco = (titulo, cols, grupo, topo, extraTot) => `
    <div class="el-vol-bloco el-vol-${grupo}">
      <h2 class="el-subtitulo">${titulo}</h2>
      <table>
        <thead><tr><th></th>${cols.map(([, r]) => `<th class="el-th">${r}</th>`).join('')}</tr></thead>
        <tbody>
          ${topo}
          ${linhaVol('Total ano 1', cols.map(([k]) => `<td>${calc(`${grupo}.t1.${k}`)}</td>`).join(''))}
          ${linhaVol('Total ano 2', cols.map(([k]) => `<td>${calc(`${grupo}.t2.${k}`)}</td>`).join(''))}
          ${extraTot}
          <tr class="el-espaco"><td colspan="${cols.length + 1}"></td></tr>
          ${mesesLinhas(24, (i) => linhaVol(`Mês ${i + 1}`, cols.map(([k, , d = 2]) => `<td>${campo(el, `${grupo}.m.${i}.${k}`, d)}</td>`).join('')))}
        </tbody>
      </table>
    </div>`;
  const puLinhas = (grupo, cols) => ['t1', 't2'].map((t, j) => `<tr class="el-pu"><td class="el-rot">Preço unit. ano ${j + 1} (R$)</td>${cols.map(([k]) =>
    `<td>${CALCS[`${grupo}.pu${t}.${k}`] ? calc(`${grupo}.pu${t}.${k}`) : ''}</td>`).join('')}</tr>`).join('');
  const topoDem = ['share1', 'share2'].map((s, j) => linhaVol(`Share Ano ${j + 1}`, DEM_COLS.map(([k]) => `<td>${campo(el, `dem.${s}.${k}`)}</td>`).join(''))).join('');
  const topoVazio = (n) => `<tr class="el-alinha"><td colspan="${n + 1}"></td></tr><tr class="el-alinha"><td colspan="${n + 1}"></td></tr>`;
  const topoSell = `<tr class="el-alinha"><td class="el-rot" colspan="${SELL_COLS.length + 1}">${[0, 1, 2].map((i) =>
    `<span class="el-pc"><b>PC ${i + 1}</b> ${campo(el, `sell.pc.${i}`, 2, 'el-pc-in')}</span>`).join('')}</td></tr><tr class="el-alinha"><td colspan="${SELL_COLS.length + 1}"></td></tr>`;
  const volume = `
    <section class="el-volume">
      <h1 class="el-titulo">Volume</h1>
      <div class="el-vol">
        ${bloco('Demanda (k)', DEM_COLS, 'dem', topoDem, puLinhas('dem', DEM_COLS))}
        ${bloco('Estoque (k)', EST_COLS, 'est', topoVazio(EST_COLS.length), '<tr class="el-pu"><td colspan="3"></td></tr><tr class="el-pu"><td colspan="3"></td></tr>')}
        ${bloco('Sell-In (k)', SELL_COLS, 'sell', topoSell, puLinhas('sell', SELL_COLS))}
      </div>
      <div class="el-quebra"></div>
      <h1 class="el-titulo el-titulo-sec">Redes</h1>
      <div class="el-rede">
        <h3>% Peso Canal (k UN)</h3>
        <div class="el-rede-anos">${ANOS.map(([a, r]) => `
          <table class="el-rede-tab">
            <caption>${r}</caption>
            <thead><tr><th></th>${CANAIS.map(([, c]) => `<th class="el-th">${c}</th>`).join('')}</tr></thead>
            <tbody>
              ${mesesLinhas(12, (i) => `<tr><td class="el-rot">Mês ${i + 1}</td>${CANAIS.map(([k]) => `<td>${campo(el, `redes.${a}.m.${i}.${k}`)}</td>`).join('')}</tr>`)}
              ${REDE_TOT.map(([t, rt]) => `<tr class="el-azul"><td class="el-rot">${rt}</td>${CANAIS.map(([k]) => `<td>${campo(el, `redes.${a}.tot.${t}.${k}`, 2, 'el-branco')}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>`).join('')}
        </div>
      </div>
    </section>
    <div class="el-quebra"></div>`;
  // ----- execução comercial e investimento -----
  const tabelaAnos = (titulo, grupo, d, comTotal) => `
    <div class="el-caixa">
      <table class="${comTotal ? 'el-com-total' : ''}">
        <caption>${titulo}</caption>
        <thead><tr><th></th>${ANOS.map(([, r]) => `<th class="el-th">${r}</th>`).join('')}</tr></thead>
        <tbody>
          ${mesesLinhas(12, (i) => `<tr><td class="el-rot">Mês ${i + 1}</td>${ANOS.map(([a]) => `<td>${campo(el, `${grupo}.${i}.${a}`, d)}</td>`).join('')}</tr>`)}
          ${comTotal ? `<tr class="el-azul"><td class="el-rot">Total Ano</td>${ANOS.map(([a]) => `<td>${calc(`${grupo}.tot.${a}`)}</td>`).join('')}</tr>` : ''}
        </tbody>
      </table>
    </div>`;
  const exec = `
    <section class="el-exec">
      <h1 class="el-titulo">Execução Comercial</h1>
      <div class="el-caixas">${tabelaAnos('Qtd. CNPJs Positivados', 'exec.cnpj', 0)}${tabelaAnos('Giro Mensal', 'exec.giro', 2)}</div>
    </section>
    <div class="el-quebra"></div>
    <section class="el-inv">
      <h1 class="el-titulo">Investimento</h1>
      <div class="el-caixas">${tabelaAnos('Investimento Comercial (R$)', 'inv.com', 2, true)}${tabelaAnos('Investimento MKT (R$)', 'inv.mkt', 2, true)}</div>
    </section>`;
  return cab + info + prec + volume + exec;
}

function recalcular() {
  const el = elAtiva();
  if (!el) return;
  document.querySelectorAll('#el-folha .el-calc').forEach((o) => {
    const c = CALCS[o.dataset.k];
    const v = c ? c.f(el) : null;
    o.textContent = v === null ? '-' : fmtNum(v, c.d);
  });
}

function desenharSubabas() {
  $('el-subabas').innerHTML = els.lista.map((el) => `
    <div class="el-subaba${el.id === els.ativa ? ' ativa' : ''}" data-id="${el.id}">
      <button type="button" class="el-subaba-nome" data-acao="abrir">${esc(nomeEL(el))}</button>
      ${el.id === els.ativa ? '<button type="button" class="el-mini" data-acao="duplicar" title="Duplicar esta EL">Duplicar</button><button type="button" class="el-mini el-mini-perigo" data-acao="excluir" title="Excluir esta EL">Excluir</button>' : ''}
    </div>`).join('');
}

function desenharEL() {
  desenharSubabas();
  const el = elAtiva();
  $('el-vazio').hidden = !!el;
  $('el-folha').innerHTML = el ? htmlEL(el) : '';
  // textarea da premissa cresce com o texto
  document.querySelectorAll('#el-folha .el-area').forEach(ajustarAltura);
  recalcular();
}
function ajustarAltura(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }

// ---------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------
function aoEditar(e) {
  const alvo = e.target;
  if (!alvo.dataset || !alvo.dataset.c) return;
  const el = elAtiva();
  if (!el) return;
  let valor;
  if (alvo.classList.contains('el-num')) valor = lerNumero(alvo.value);
  else if (alvo.classList.contains('el-bool')) valor = alvo.value === '' ? null : alvo.value === 'true';
  else valor = alvo.value;
  gravar(el, alvo.dataset.c, valor);
  if (alvo.classList.contains('el-area')) ajustarAltura(alvo);
  recalcular();
  if (alvo.dataset.c === 'info.produto' || alvo.dataset.c === 'info.padraoSku') {
    const nome = document.querySelector(`.el-subaba[data-id="${el.id}"] .el-subaba-nome`);
    if (nome) nome.textContent = nomeEL(el);
  }
  salvarDepois();
}
// ao sair do campo, o número aparece formatado (ex.: 1234,5 -> 1.234,50)
function aoSair(e) {
  const alvo = e.target;
  if (!alvo.classList || !alvo.classList.contains('el-num')) return;
  const el = elAtiva();
  if (el) alvo.value = fmtNum(ler(el, alvo.dataset.c), Number(alvo.dataset.d));
}

function novaELVazia() {
  const el = novaEL();
  els.lista.push(el);
  els.ativa = el.id;
  salvar();
  desenharEL();
  $('el-folha').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function acaoSubaba(e) {
  const botao = e.target.closest('button[data-acao]');
  if (!botao) return;
  const id = botao.closest('.el-subaba').dataset.id;
  const el = els.lista.find((x) => x.id === id);
  if (!el) return;
  if (botao.dataset.acao === 'abrir') els.ativa = id;
  if (botao.dataset.acao === 'duplicar') {
    const copia = completarEL(JSON.parse(JSON.stringify(el)));
    copia.id = novaEL().id;
    copia.info.produto = (copia.info.produto || '') + ' (cópia)';
    els.lista.splice(els.lista.indexOf(el) + 1, 0, copia);
    els.ativa = copia.id;
  }
  if (botao.dataset.acao === 'excluir') {
    if (!confirm(`Excluir a EL "${nomeEL(el)}"?\n\nEla será apagada deste navegador. Se quiser guardar uma cópia, use "Exportar ELs" antes.`)) return;
    const i = els.lista.indexOf(el);
    els.lista.splice(i, 1);
    els.ativa = els.lista[Math.max(0, i - 1)] ? els.lista[Math.max(0, i - 1)].id : null;
  }
  salvar();
  desenharEL();
}

// ---------------------------------------------------------------------
// Exportar / importar ELs (.json) — backup no computador
// ---------------------------------------------------------------------
function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportarELs() {
  const hoje = new Date().toISOString().slice(0, 10);
  baixar(`ELs_${hoje}.json`, JSON.stringify({ tipo: 'estudos-de-lancamento', versao: 1, exportado: new Date().toISOString(), els: els.lista }, null, 2), 'application/json');
}
async function importarELsJson(arquivo) {
  try {
    const dados = JSON.parse(await arquivo.text());
    const lista = Array.isArray(dados) ? dados : dados && Array.isArray(dados.els) ? dados.els : null;
    if (!lista) throw new Error('o arquivo não tem uma lista de ELs');
    let novas = 0, substituidas = 0;
    for (const item of lista) {
      const el = completarEL(item);
      const i = els.lista.findIndex((x) => x.id === el.id);
      if (i >= 0) { els.lista[i] = el; substituidas++; } else { els.lista.push(el); novas++; }
      els.ativa = el.id;
    }
    salvar();
    desenharEL();
    mostrarResumo(`<b>Backup importado:</b> ${novas} EL(s) nova(s)${substituidas ? `, ${substituidas} atualizada(s)` : ''}.`);
  } catch (e) {
    mostrarResumo(`<b class="el-erro">Não foi possível importar o arquivo .json:</b> ${esc(e.message)}`);
  }
}

// ---------------------------------------------------------------------
// Importar EL a partir do arquivo .html (lido pelos rótulos, não pela posição)
// ---------------------------------------------------------------------
const chaveTexto = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const textoCelula = (td) => {
  const entrada = td.querySelector('input, textarea, select');
  if (entrada) return (entrada.getAttribute('value') || entrada.textContent || '').trim();
  return td.textContent.replace(/\s+/g, ' ').trim();
};
const cabecalhos = (tabela) => [...tabela.querySelectorAll('thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
const linhasTabela = (tabela) => [...tabela.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(textoCelula)).filter((l) => l.length);
const ehRotulo = (t) => /[a-zà-ú]/i.test(t) && !/^[-+\d.,\s%]+$/.test(t);

// acha o bloco (div/section) que contém um título com o texto dado
function acharBloco(doc, texto, tags = 'h1,h2,h3,caption,p') {
  const alvo = chaveTexto(texto);
  const t = [...doc.querySelectorAll(tags)].find((x) => chaveTexto(x.textContent).startsWith(alvo));
  if (!t) return null;
  return t.tagName === 'CAPTION' ? t.closest('table') : t.closest('div, section') || t.parentElement;
}
// índice de cada coluna pelo texto do cabeçalho
function indicesColunas(cab, cols) {
  const idx = {};
  for (const [k, r] of cols) {
    const alvo = chaveTexto(r);
    const i = cab.findIndex((c) => chaveTexto(c) === alvo || (chaveTexto(c) && chaveTexto(c).startsWith(alvo)) || (chaveTexto(c) && alvo.startsWith(chaveTexto(c))));
    if (i >= 0) idx[k] = i;
  }
  return idx;
}
// rótulo da linha -> parte do caminho ("Mês 3" -> m.2 ; "Total ano 1" -> t1 ...)
function chaveLinha(rotulo) {
  const k = chaveTexto(rotulo);
  let m = k.match(/^mes(\d+)$/);
  if (m) return { mes: Number(m[1]) - 1 };
  m = k.match(/^totalano(\d)$/);
  if (m) return { total: 't' + m[1] };
  if (k === 'totalano') return { total: 't' };
  m = k.match(/^share(?:ano)?(\d)$/);
  if (m) return { share: 'share' + m[1] };
  for (const [t, r] of REDE_TOT) if (k === chaveTexto(r)) return { redeTot: t };
  return null;
}
// lê uma tabela: se a 1ª coluna não tiver rótulos, usa a sequência de rótulos da tabela vizinha
function lerLinhas(tabela, sequencia) {
  const linhas = linhasTabela(tabela);
  const rotuladas = linhas.filter((l) => ehRotulo(l[0])).length > linhas.length / 2;
  return {
    rotuladas,
    linhas: linhas.map((cel, i) => ({ rotulo: rotuladas ? cel[0] : (sequencia || [])[i], cel })),
  };
}

function importarHtmlEL(texto) {
  const doc = new DOMParser().parseFromString(texto, 'text/html');
  const el = novaEL();
  const achados = new Set();
  const doArquivo = {}; // valores de campos calculados como vieram no arquivo (para comparar)
  const pos = (caminho, valor, tipo = 'num') => {
    gravar(el, caminho, tipo === 'num' ? lerNumero(valor) : String(valor).trim());
    achados.add(caminho);
  };
  const guardarCalc = (caminho, valor) => { const v = lerNumero(valor); if (v !== null) doArquivo[caminho] = v; };

  // código da EL: texto ao lado do título "Informações Gerais"
  const tituloInfo = [...doc.querySelectorAll('h1,h2')].find((h) => chaveTexto(h.textContent).startsWith('informacoesgerais'));
  if (tituloInfo) {
    const resto = tituloInfo.parentElement.textContent.replace(tituloInfo.textContent, '').trim();
    if (resto) pos('codigo', resto, 'txt');
  }
  // assinaturas
  const tabAprov = [...doc.querySelectorAll('table')].find((t) => cabecalhos(t).some((c) => chaveTexto(c) === 'aprovado'));
  if (tabAprov) {
    const idx = indicesColunas(cabecalhos(tabAprov), APROV_COLS);
    for (const cel of linhasTabela(tabAprov)) {
      const a = APROVADORES.find((x) => chaveTexto(x) === chaveTexto(cel[0]));
      if (a) for (const [k] of APROV_COLS) if (idx[k] !== undefined) pos(`assin.${a}.${k}`, cel[idx[k]] || '', 'txt');
    }
  }
  // informações gerais
  const secInfo = tituloInfo ? tituloInfo.closest('section') || doc : doc;
  for (const tab of secInfo.querySelectorAll('table')) {
    for (const cel of linhasTabela(tab)) {
      if (cel.length !== 2) continue;
      const k = chaveTexto(cel[0]);
      const def = INFO.find(([, r, , alvo]) => k === chaveTexto(r) || (alvo && k.startsWith(alvo)));
      if (!def) continue;
      if (def[2] === 'bool') {
        const v = chaveTexto(cel[1]);
        gravar(el, `info.${def[0]}`, ['true', 'sim', 's', '1'].includes(v) ? true : ['false', 'nao', 'n', '0'].includes(v) ? false : null);
        achados.add(`info.${def[0]}`);
      } else pos(`info.${def[0]}`, cel[1], 'txt');
    }
  }
  // precificação (tabela Ano 1 / Ano 2)
  const tabelas = [...doc.querySelectorAll('table')];
  const tabPrec = tabelas.find((t) => {
    const cab = cabecalhos(t).map(chaveTexto);
    return cab.includes('ano1') && cab.includes('ano2') && !cab.includes('referencia') && linhasTabela(t).some((l) => chaveTexto(l[0]).startsWith('precofabrica'));
  });
  if (tabPrec) {
    const idx = indicesColunas(cabecalhos(tabPrec), [['ano1', 'Ano 1'], ['ano2', 'Ano 2']]);
    for (const cel of linhasTabela(tabPrec)) {
      const def = PREC.find(([, r]) => chaveTexto(r) === chaveTexto(cel[0]));
      if (!def) continue;
      for (const a of ['ano1', 'ano2']) {
        if (idx[a] === undefined) continue;
        if (def[2]) guardarCalc(`prec.${a}.${def[0]}`, cel[idx[a]]); else pos(`prec.${a}.${def[0]}`, cel[idx[a]]);
      }
    }
  }
  // comparativo (colunas pelos títulos Referência / Concorrente 1 / Concorrente 2)
  const tabComp = tabelas.find((t) => cabecalhos(t).some((c) => chaveTexto(c) === 'referencia'));
  if (tabComp) {
    const idx = indicesColunas(cabecalhos(tabComp), CONCORRENTES);
    const iRef = idx.ref;
    for (const cel of linhasTabela(tabComp)) {
      const iRot = cel.findIndex((x) => x !== '');
      if (iRot < 0) continue;
      const k = chaveTexto(cel[iRot]);
      const topo = COMP_TOPO.find(([, r]) => chaveTexto(r) === k);
      const indice = INDICES.find(([, r]) => chaveTexto(r) === k);
      const linha = COMP_LINHAS.find(([, r]) => chaveTexto(r) === k);
      for (const [c] of CONCORRENTES) {
        if (idx[c] === undefined) continue;
        const v = cel[idx[c]] ?? '';
        if (topo) pos(`comp.${c}.${topo[0]}`, v, 'txt');
        else if (indice) guardarCalc(`comp.${c}.${indice[0]}`, v);
        else if (linha) { if (CALCS[`comp.${c}.${linha[0]}`]) guardarCalc(`comp.${c}.${linha[0]}`, v); else pos(`comp.${c}.${linha[0]}`, v); }
      }
      // colunas do lançamento: as duas antes de "Referência"
      if (linha && iRef !== undefined) {
        for (const [l, desloc] of [['l1', 2], ['l2', 1]]) {
          const v = cel[iRef - desloc] ?? '';
          if (CALCS[`comp.${l}.${linha[0]}`]) guardarCalc(`comp.${l}.${linha[0]}`, v); else pos(`comp.${l}.${linha[0]}`, v);
        }
      }
    }
  }
  // volume: Demanda define a sequência de rótulos (Total ano 1, Total ano 2, Mês 1…24)
  let seqVol = null;
  const lerVolume = (titulo, grupo, cols, aoTopo) => {
    const bloco = acharBloco(doc, titulo, 'h2,h3');
    if (!bloco) return;
    const tabs = [...bloco.querySelectorAll('table')];
    const tabCab = tabs.find((t) => Object.keys(indicesColunas(cabecalhos(t), cols)).length >= 2);
    if (!tabCab) return;
    const idx = indicesColunas(cabecalhos(tabCab), cols);
    if (aoTopo) aoTopo(tabCab, idx);
    for (const tab of tabs.filter((t) => t !== tabCab)) {
      const { rotuladas, linhas } = lerLinhas(tab, seqVol);
      if (rotuladas && !seqVol) seqVol = linhas.map((l) => l.rotulo);
      for (const { rotulo, cel } of linhas) {
        const ch = chaveLinha(rotulo || '');
        if (!ch) continue;
        for (const [k] of cols) {
          if (idx[k] === undefined) continue;
          const v = cel[idx[k]];
          if (v === undefined) continue;
          if (ch.mes !== undefined && ch.mes < 24) pos(`${grupo}.m.${ch.mes}.${k}`, v);
          else if (ch.total) guardarCalc(`${grupo}.${ch.total}.${k}`, v);
        }
      }
    }
  };
  lerVolume('Demanda', 'dem', DEM_COLS, (tab, idx) => {
    for (const cel of linhasTabela(tab)) {
      const ch = chaveLinha(cel[0]);
      if (ch && ch.share) for (const [k] of DEM_COLS) if (idx[k] !== undefined) pos(`dem.${ch.share}.${k}`, cel[idx[k]] ?? '');
    }
  });
  lerVolume('Estoque', 'est', EST_COLS);
  lerVolume('Sell-In', 'sell', SELL_COLS, (tab) => {
    for (const tr of tab.querySelectorAll('tbody tr')) {
      const m = tr.textContent.replace(/\s+/g, ' ').match(/PC\s*(\d)\s*([-\d.,]*)/i);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 3) pos(`sell.pc.${Number(m[1]) - 1}`, m[2]);
    }
  });
  // redes: Ano 1 tem os rótulos; o Ano 2 usa a mesma sequência
  const blocoRede = acharBloco(doc, '% Peso Canal', 'h1,h2,h3');
  if (blocoRede) {
    let seqRede = null;
    for (const tab of blocoRede.querySelectorAll('table')) {
      const cap = tab.querySelector('caption');
      const ano = ANOS.find(([, r]) => cap && chaveTexto(cap.textContent) === chaveTexto(r));
      if (!ano) continue;
      const idx = indicesColunas(cabecalhos(tab), CANAIS);
      const { rotuladas, linhas } = lerLinhas(tab, seqRede);
      if (rotuladas && !seqRede) seqRede = linhas.map((l) => l.rotulo);
      for (const { rotulo, cel } of linhas) {
        const ch = chaveLinha(rotulo || '');
        if (!ch) continue;
        for (const [k] of CANAIS) {
          if (idx[k] === undefined || cel[idx[k]] === undefined) continue;
          if (ch.mes !== undefined && ch.mes < 12) pos(`redes.${ano[0]}.m.${ch.mes}.${k}`, cel[idx[k]]);
          else if (ch.redeTot) pos(`redes.${ano[0]}.tot.${ch.redeTot}.${k}`, cel[idx[k]]);
        }
      }
    }
  }
  // execução comercial e investimento (pelo título de cada tabela)
  const lerAnos = (pares) => {
    let seq = null;
    for (const [titulo, grupo, temTotal] of pares) {
      const tab = acharBloco(doc, titulo, 'caption');
      if (!tab) continue;
      const idx = indicesColunas(cabecalhos(tab), ANOS);
      const { rotuladas, linhas } = lerLinhas(tab, seq);
      if (rotuladas) seq = linhas.map((l) => l.rotulo);
      for (const { rotulo, cel } of linhas) {
        const ch = chaveLinha(rotulo || '');
        if (!ch) continue;
        for (const [a] of ANOS) {
          if (idx[a] === undefined || cel[idx[a]] === undefined) continue;
          if (ch.mes !== undefined && ch.mes < 12) pos(`${grupo}.${ch.mes}.${a}`, cel[idx[a]]);
          else if (temTotal && ch.total === 't') guardarCalc(`${grupo}.tot.${a}`, cel[idx[a]]);
        }
      }
    }
  };
  lerAnos([['Qtd. CNPJs Positivados', 'exec.cnpj'], ['Giro Mensal', 'exec.giro']]);
  lerAnos([['Investimento Comercial', 'inv.com', true], ['Investimento MKT', 'inv.mkt', true]]);

  // resumo: campos que não foram encontrados e cálculos diferentes do arquivo
  const faltando = camposEditaveis().map(([c]) => c).filter((c) => !achados.has(c));
  const diferencas = [];
  for (const [caminho, v] of Object.entries(doArquivo)) {
    const c = CALCS[caminho];
    if (!c) continue;
    const calculado = c.f(el);
    const tolerancia = Math.max(0.011, Math.abs(v) * 0.005);
    if (calculado === null || Math.abs(calculado - v) > tolerancia) diferencas.push({ caminho, arquivo: v, calculado, d: c.d });
  }
  return { el, faltando, diferencas, lidos: achados.size };
}

function nomeCalc(caminho) {
  const p = caminho.split('.');
  if (p[0] === 'prec') return nomeCampo(caminho);
  if (p[0] === 'comp') return nomeCampo(caminho);
  const t = { t1: 'Total ano 1', t2: 'Total ano 2' }[p[1]];
  if (p[0] === 'dem') return `Demanda · ${t} · ${p[2].toUpperCase()}`;
  if (p[0] === 'est') return `Estoque · ${t} · ${p[2] === 'un' ? 'UN' : 'Dia'}`;
  if (p[0] === 'sell') return `Sell-In · ${t} · ${(SELL_COLS.find((x) => x[0] === p[2]) || [, p[2]])[1]}`;
  if (p[0] === 'inv') return `Investimento ${p[1] === 'com' ? 'Comercial' : 'MKT'} · Total · ${p[3] === 'a1' ? 'Ano 1' : 'Ano 2'}`;
  return caminho;
}

async function importarArquivosHtml(arquivos) {
  const partes = [];
  for (const arquivo of arquivos) {
    try {
      const { el, faltando, diferencas, lidos } = importarHtmlEL(await arquivo.text());
      if (lidos < 10) throw new Error('não parece um arquivo de EL (quase nenhum campo foi reconhecido)');
      els.lista.push(el);
      els.ativa = el.id;
      const listaFalt = faltando.length
        ? `<details><summary>${faltando.length} campo(s) não encontrado(s) — ficaram em branco</summary><ul>${faltando.map((c) => `<li>${esc(nomeCampo(c))}</li>`).join('')}</ul></details>`
        : '<div>Todos os campos foram encontrados.</div>';
      const listaDif = diferencas.length
        ? `<details><summary>${diferencas.length} valor(es) calculado(s) diferente(s) do arquivo (o dashboard usa o cálculo)</summary><ul>${diferencas.map((x) =>
          `<li>${esc(nomeCalc(x.caminho))}: arquivo ${fmtNum(x.arquivo, x.d) || '-'} · calculado ${x.calculado === null ? '-' : fmtNum(x.calculado, x.d)}</li>`).join('')}</ul></details>`
        : '';
      partes.push(`<div class="el-resumo-item"><b>✓ ${esc(arquivo.name)}</b> → ${esc(nomeEL(el))} (${lidos} campos lidos)${listaFalt}${listaDif}</div>`);
    } catch (e) {
      partes.push(`<div class="el-resumo-item"><b class="el-erro">✗ ${esc(arquivo.name)}</b>: ${esc(e.message || e)}</div>`);
    }
  }
  salvar();
  desenharEL();
  mostrarResumo(partes.join(''));
}

function mostrarResumo(html) {
  $('el-resumo').innerHTML = `<button type="button" class="el-resumo-fechar" title="Fechar">✕</button>${html}`;
  $('el-resumo').hidden = false;
}

// ---------------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------------
function iniciar() {
  carregarSalvas();
  desenharEL();
  const folha = $('el-folha');
  folha.addEventListener('input', aoEditar);
  folha.addEventListener('change', aoEditar);
  folha.addEventListener('focusout', aoSair);
  folha.addEventListener('click', (e) => { if (e.target.closest('.el-imprimir')) window.print(); });
  $('el-subabas').addEventListener('click', acaoSubaba);
  $('el-nova').addEventListener('click', novaELVazia);
  $('el-nova-vazio').addEventListener('click', novaELVazia);
  $('el-exportar').addEventListener('click', exportarELs);
  $('el-resumo').addEventListener('click', (e) => { if (e.target.closest('.el-resumo-fechar')) $('el-resumo').hidden = true; });
  $('el-importar-html').addEventListener('change', async (e) => {
    const arquivos = [...(e.target.files || [])];
    e.target.value = '';
    if (arquivos.length) await importarArquivosHtml(arquivos);
  });
  $('el-importar-json').addEventListener('change', async (e) => {
    const a = e.target.files && e.target.files[0];
    e.target.value = '';
    if (a) await importarELsJson(a);
  });
  $('el-exemplo').addEventListener('click', async () => {
    try {
      const resp = await fetch('exemplo_el.html');
      if (!resp.ok) throw new Error('exemplo_el.html não encontrado');
      await importarArquivosHtml([new File([await resp.blob()], 'exemplo_el.html')]);
    } catch (e) { mostrarResumo(`<b class="el-erro">Não foi possível abrir o exemplo:</b> ${esc(e.message)}`); }
  });
}

iniciar();
