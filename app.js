// =====================================================================
// Dashboard de Mercado Farmacêutico
// Tudo roda dentro do navegador: o CSV é lido do computador do usuário
// e processado pelo DuckDB-WASM localmente. Nada é enviado a servidores.
// =====================================================================
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

// ---------------------------------------------------------------------
// Configuração: quais colunas do CSV viram filtros
// ---------------------------------------------------------------------
const DIMENSOES = [
  { key: 'ct1', rotulo: 'Classe Terapêutica 01', coluna: 'Classe Terapeutica Nível 1 Concatenada', secao: 'MERCADO' },
  { key: 'ct2', rotulo: 'Classe Terapêutica 02', coluna: 'Classe Terapeutica Nível 2 Concatenada', secao: 'MERCADO' },
  { key: 'ct3', rotulo: 'Classe Terapêutica 03', coluna: 'Classe Terapeutica Nível 3 Concatenada', secao: 'MERCADO' },
  { key: 'ct4', rotulo: 'Classe Terapêutica 04', coluna: 'Classe Terapeutica Nível 4 Concatenada', secao: 'MERCADO' },
  { key: 'mercado', rotulo: 'Tipo de Mercado', coluna: 'Mercado', secao: 'MERCADO' },
  { key: 'molecula', rotulo: 'Molécula', coluna: 'Molecula', secao: 'PRODUTO' },
  { key: 'corp', rotulo: 'Corporação', coluna: 'Corporacao', secao: 'PRODUTO' },
  { key: 'bu', rotulo: 'BU', coluna: 'DIVISAO', secao: 'PRODUTO' },
  { key: 'lab', rotulo: 'Laboratório', coluna: 'Laboratorio', secao: 'PRODUTO' },
  { key: 'produto', rotulo: 'Produto', coluna: 'Produto', secao: 'PRODUTO' },
  { key: 'apres', rotulo: 'DC Apresentação', coluna: 'Apresentacao Desc Longa', secao: 'PRODUTO' },
  { key: 'tipoforma', rotulo: 'Tipo de Formato', coluna: 'Tipo_forma_aplicacao', secao: 'PRODUTO' },
  { key: 'forma', rotulo: 'Formato Aplicação', coluna: 'Forma_aplicacao', secao: 'PRODUTO' },
  { key: 'padrao', rotulo: 'Padrão SKU', coluna: 'PADRÃO SKU', secao: 'PRODUTO' },
  { key: 'conc', rotulo: 'Concentração', coluna: 'Concentracao', secao: 'PRODUTO' },
  { key: 'cat1', rotulo: 'Categoria 01', coluna: 'CLASSIF. GERAL N1', secao: 'PRODUTO' },
  { key: 'cat2', rotulo: 'Categoria 02', coluna: 'CLASSIF. GERAL N2', secao: 'PRODUTO' },
  { key: 'cat3', rotulo: 'Categoria 03', coluna: 'CLASSIF. GERAL N3', secao: 'PRODUTO' },
  { key: 'cat4', rotulo: 'Categoria 04', coluna: 'CLASSIF. GERAL N4', secao: 'PRODUTO' },
  { key: 'cat5', rotulo: 'Categoria 05', coluna: 'CLASSIF. GERAL N5', secao: 'PRODUTO' },
  { key: 'qtd', rotulo: 'Quantidade', coluna: 'Quantidade', secao: 'PRODUTO' },
];
const COL_MEDIDA = 'Medida';
const COL_SIGLA = 'Sigla Laboratorio';
const COL_SKU = 'cd_apresentacao';
const COL_QTD_NUM = 'Quantidade Num';

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const NOME_MES = Object.keys(MESES);

const CORES = ['#6B76A6', '#A58BDB', '#F2C94C', '#4FA3A5', '#E07B53', '#8BB174',
  '#C25B8C', '#5B8FD9', '#B8A07E', '#3D4466', '#D98FB0', '#2E8B57', '#9C6644',
  '#7FB3D5', '#D4AC0D', '#6C3483', '#48C9B0', '#CB4335', '#85929E', '#F0B27A'];
const COR_OUTROS = '#BDBDBD';
const MAX_SERIES = 50;          // limite de segurança de cores no gráfico (o resto vira "Outros")
const MAX_OPCOES_VISIVEIS = 300; // itens mostrados por card de filtro
const MAX_LINHAS_TABELA = 1000;

// ---------------------------------------------------------------------
// Estado da aplicação
// ---------------------------------------------------------------------
const estado = {
  db: null,
  conn: null,
  dims: [],            // dimensões presentes no arquivo
  // key -> { modo, valores }. 'inc' com lista vazia = nada marcado = sem filtro (como no Power BI);
  // 'todos' = "Selecionar tudo" marcado (também sem filtro); 'exc' = tudo menos os valores.
  filtros: {},
  opcoes: {},          // key -> lista de valores disponíveis (cascata)
  busca: {},           // key -> texto de busca
  pagina: 'filtros',
  analisePendente: true,
  ordem: { col: 'r0', desc: true },
  dimsGrafico: [],     // dimensões do gráfico, na ordem escolhida
  dimsTabela: [],      // dimensões da tabela (níveis da matriz), na ordem escolhida
  expandidos: new Set(), // linhas abertas na matriz (caminho dos valores)
  exib: { topN: null, outros: false, auto80: false },
  meses: [],           // rótulos dos meses da base (ago-21, set-21, …)
  selecao: new Map(),  // linhas clicadas na tabela: caminho -> condição SQL
  ocultas: new Set(),  // séries escondidas pela legenda (valem para os dois gráficos)
  graficos: {},
  arquivoAtual: null,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Formatação brasileira
// ---------------------------------------------------------------------
const fmt0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function valido(v) { return v !== null && v !== undefined && Number.isFinite(v); }
function abreviar(v) {
  if (!valido(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return fmt1.format(v / 1e9) + 'B';
  if (a >= 1e6) return fmt1.format(v / 1e6) + 'M';
  if (a >= 1e3) return fmt1.format(v / 1e3) + 'K';
  return fmt1.format(v);
}
function inteiro(v) { return valido(v) ? fmt0.format(v) : '-'; }
function percentual(v) { return valido(v) ? fmt1.format(v * 100) + '%' : '-'; }
function divisao(a, b) { return valido(a) && valido(b) && b !== 0 ? a / b : null; }
function evolucao(atual, anterior) { const r = divisao(atual, anterior); return r === null ? null : r - 1; }
function cagr(atual, base) {
  const r = divisao(atual, base);
  return r === null || r < 0 ? null : Math.pow(r, 1 / 4) - 1;
}
function classeSinal(v) { return !valido(v) ? '' : v < 0 ? 'neg' : 'pos'; }

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const sqlTexto = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sqlColuna = (s) => '"' + String(s).replace(/"/g, '""') + '"';
// Compara nomes de coluna ignorando acentos, maiúsculas, espaços e pontuação
const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------
// Tela de carregamento
// ---------------------------------------------------------------------
function mostrarProgresso(texto, fracao) {
  $('carregando').hidden = false;
  $('carregando-texto').textContent = texto;
  if (fracao !== undefined) $('barra-progresso-preenchida').style.width = Math.round(fracao * 100) + '%';
}
function mostrarErro(msg) {
  $('carregando').hidden = true;
  $('erro').hidden = false;
  $('erro').textContent = msg;
}
function bloquearBotoes(sim) {
  $('btn-exemplo').disabled = sim;
  $('input-arquivo').disabled = sim;
}

async function iniciarDuckDB() {
  if (estado.db) return;
  mostrarProgresso('Preparando o motor de dados (só na primeira vez)…', 0.02);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  estado.db = db;
  estado.conn = await db.connect();
}

async function consultar(sql) {
  const resultado = await estado.conn.query(sql);
  return resultado.toArray().map((linha) => {
    const obj = linha.toJSON();
    for (const k in obj) if (typeof obj[k] === 'bigint') obj[k] = Number(obj[k]);
    return obj;
  });
}

// Lê o arquivo em pedaços (para mostrar o progresso), detecta se é UTF-8
// ou Latin-1 e devolve sempre os bytes em UTF-8.
async function lerArquivo(arquivo) {
  const PEDACO = 16 * 1024 * 1024;
  const total = arquivo.size || 1;
  const decodUtf8 = new TextDecoder('utf-8', { fatal: true });
  let ehUtf8 = true;
  const partes = [];
  for (let ini = 0; ini < arquivo.size; ini += PEDACO) {
    const bytes = new Uint8Array(await arquivo.slice(ini, ini + PEDACO).arrayBuffer());
    partes.push(bytes);
    if (ehUtf8) {
      try { decodUtf8.decode(bytes, { stream: ini + PEDACO < arquivo.size }); } catch { ehUtf8 = false; }
    }
    mostrarProgresso(`Lendo o arquivo… ${Math.round(Math.min(1, (ini + PEDACO) / total) * 100)}%`,
      0.05 + 0.45 * Math.min(1, (ini + PEDACO) / total));
  }
  let saida = partes;
  if (!ehUtf8) {
    mostrarProgresso('Convertendo acentuação (Latin-1 → UTF-8)…', 0.5);
    const decodLatin = new TextDecoder('windows-1252');
    const enc = new TextEncoder();
    saida = partes.map((p) => enc.encode(decodLatin.decode(p)));
  } else if (partes.length && partes[0][0] === 0xEF && partes[0][1] === 0xBB && partes[0][2] === 0xBF) {
    partes[0] = partes[0].subarray(3); // remove a marca BOM do Excel
  }
  const tamanho = saida.reduce((s, p) => s + p.length, 0);
  const tudo = new Uint8Array(tamanho);
  let pos = 0;
  for (const p of saida) { tudo.set(p, pos); pos += p.length; }
  return { bytes: tudo, codificacao: ehUtf8 ? 'UTF-8' : 'Latin-1' };
}

// Identifica colunas de mês como "ago-21" e devolve {coluna, ano, mes, indice}
function detectarMeses(colunas) {
  const meses = [];
  for (const c of colunas) {
    const m = String(c).trim().toLowerCase().match(/^([a-zç]{3})[-/ ._]?(\d{2}|\d{4})$/);
    if (!m || !(m[1] in MESES)) continue;
    const ano = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    meses.push({ coluna: c, ano, mes: MESES[m[1]], indice: ano * 12 + MESES[m[1]] - 1 });
  }
  return meses.sort((a, b) => a.indice - b.indice);
}

// Para cada período (MAT0..MAT4, YTD0..YTD4) devolve a expressão SQL do valor.
// Usa as colunas prontas (MAT-0 etc.); se faltarem, soma os meses.
function montarPeriodos(colunas, meses) {
  const porNome = {};
  for (const c of colunas) porNome[normalizar(c)] = c;
  const ultimo = meses.length ? meses[meses.length - 1] : null;
  const porIndice = {};
  for (const m of meses) porIndice[m.indice] = m;
  const somaMeses = (lista) => lista.length
    ? '(' + lista.map((m) => `COALESCE(num(${sqlColuna(m.coluna)}),0)`).join(' + ') + ')'
    : 'NULL';

  const periodos = {};
  const avisos = [];
  for (const tempo of ['MAT', 'YTD']) {
    for (let k = 0; k <= 4; k++) {
      const col = porNome[`${tempo.toLowerCase()}${k}`] || (k === 0 ? porNome[tempo.toLowerCase()] : undefined);
      if (col) { periodos[`${tempo}${k}`] = `num(${sqlColuna(col)})`; continue; }
      let lista = [];
      if (ultimo && tempo === 'MAT') {
        const fim = ultimo.indice - 12 * k;
        for (let i = fim - 11; i <= fim; i++) if (porIndice[i]) lista.push(porIndice[i]);
      } else if (ultimo) {
        lista = meses.filter((m) => m.ano === ultimo.ano - k && m.mes <= ultimo.mes);
      }
      if (!lista.length) avisos.push(`${tempo}-${k}`);
      periodos[`${tempo}${k}`] = somaMeses(lista);
    }
  }
  return { periodos, avisos };
}

async function carregarArquivo(arquivo) {
  $('erro').hidden = true;
  bloquearBotoes(true);
  try {
    await iniciarDuckDB();
    const { bytes, codificacao } = await lerArquivo(arquivo);

    mostrarProgresso('Organizando os dados…', 0.55);
    if (estado.arquivoAtual) { try { await estado.db.dropFile(estado.arquivoAtual); } catch { /* ignora */ } }
    const nomeInterno = `dados_${Date.now()}.csv`;
    await estado.db.registerFileBuffer(nomeInterno, bytes);
    estado.arquivoAtual = nomeInterno;

    const leitura = `read_csv(${sqlTexto(nomeInterno)}, delim=';', header=true, all_varchar=true, quote='"', escape='"', null_padding=true)`;
    await estado.conn.query(`CREATE OR REPLACE MACRO num(x) AS TRY_CAST(
      CASE WHEN strpos(trim(x), ',') > 0 THEN replace(replace(trim(x), '.', ''), ',', '.') ELSE trim(x) END AS DOUBLE)`);

    const colunas = (await consultar(`DESCRIBE SELECT * FROM ${leitura}`)).map((r) => r.column_name);
    const porNome = {};
    for (const c of colunas) porNome[normalizar(c)] = c;
    const achar = (nome) => porNome[normalizar(nome)];

    if (!achar(COL_MEDIDA)) {
      throw new Error(`Não encontrei a coluna "${COL_MEDIDA}" no arquivo.\nConfira se o separador é ";" e se a primeira linha tem os nomes das colunas.\n\nColunas encontradas: ${colunas.slice(0, 15).join(', ')}…`);
    }

    const meses = detectarMeses(colunas);
    const { periodos, avisos } = montarPeriodos(colunas, meses);

    // Dimensões: colunas de texto. Vazios viram "(vazio)".
    estado.dims = [];
    const selects = [];
    for (const d of DIMENSOES) {
      const col = achar(d.coluna);
      if (col) estado.dims.push(d);
      selects.push(col ? `COALESCE(NULLIF(TRIM(${sqlColuna(col)}), ''), '(vazio)') AS d_${d.key}`
        : `'(não informado)' AS d_${d.key}`);
    }
    const colSigla = achar(COL_SIGLA);
    const colSku = achar(COL_SKU);
    const colQtd = achar(COL_QTD_NUM);
    selects.push(colSigla ? `COALESCE(NULLIF(TRIM(${sqlColuna(colSigla)}), ''), '-') AS sigla` : `'-' AS sigla`);
    const colApres = achar('Apresentacao Desc Longa');
    const colChave = colSku || colApres;
    selects.push(colChave ? `TRIM(${sqlColuna(colChave)}) AS sku` : `'-' AS sku`);

    // Medidas: RCD, Unidades e Doses (Unidades x Quantidade Num) por período
    const med = `upper(trim(${sqlColuna(achar(COL_MEDIDA))}))`;
    const qtd = colQtd ? `num(${sqlColuna(colQtd)})` : 'NULL';
    const ehUnd = `${med} IN ('UNIDADES', 'UNIDADE', 'UND', 'UN')`;
    for (const p in periodos) {
      selects.push(`SUM(CASE WHEN ${med} = 'RCD' THEN ${periodos[p]} END) AS rcd_${p}`);
      selects.push(`SUM(CASE WHEN ${ehUnd} THEN ${periodos[p]} END) AS und_${p}`);
      selects.push(`SUM(CASE WHEN ${ehUnd} THEN ${periodos[p]} * ${qtd} END) AS dos_${p}`);
    }
    // RC (RCON) e PF (RPF) para a aba Preço
    for (const p in periodos) {
      selects.push(`SUM(CASE WHEN ${med} = 'RCON' THEN ${periodos[p]} END) AS rc_${p}`);
      selects.push(`SUM(CASE WHEN ${med} = 'RPF' THEN ${periodos[p]} END) AS pf_${p}`);
    }
    // Valores de cada mês (para o Tempo = Mês e para a aba Preço)
    meses.forEach((m, i) => {
      const v = `num(${sqlColuna(m.coluna)})`;
      selects.push(`SUM(CASE WHEN ${med} = 'RCD' THEN ${v} END) AS rcd_m${i}`);
      selects.push(`SUM(CASE WHEN ${ehUnd} THEN ${v} END) AS und_m${i}`);
      selects.push(`SUM(CASE WHEN ${med} = 'RCON' THEN ${v} END) AS rc_m${i}`);
      selects.push(`SUM(CASE WHEN ${med} = 'RPF' THEN ${v} END) AS pf_m${i}`);
    });
    selects.push(`${qtd} AS qtdnum`);
    estado.meses = meses.map(rotuloMes);

    mostrarProgresso('Processando os números (pode levar alguns segundos em arquivos grandes)…', 0.65);
    await estado.conn.query(`CREATE OR REPLACE TABLE fato AS
      SELECT ${selects.join(',\n')}
      FROM ${leitura}
      WHERE ${med} IN ('RCD', 'RCON', 'RPF') OR ${ehUnd}
      GROUP BY ALL`);
    // libera a memória do arquivo bruto: a tabela já foi criada
    await estado.db.dropFile(nomeInterno);
    estado.arquivoAtual = null;

    const [{ n }] = await consultar('SELECT count(*) AS n FROM fato');
    if (!n) throw new Error('Nenhuma linha com Medida "RCD" ou "Unidades" foi encontrada no arquivo.');

    mostrarProgresso('Montando os filtros…', 0.9);
    let info = `${arquivo.name} · ${inteiro(n)} apresentações · ${codificacao}`;
    if (meses.length) info += ` · Período: ${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}`;
    if (avisos.length) info += ` · ⚠ sem dados para ${avisos.join(', ')}`;
    $('info-arquivo').textContent = info;

    prepararInterface();
    await atualizarTudo();
    mostrarProgresso('Pronto!', 1);
    $('tela-inicial').hidden = true;
    $('app').hidden = false;
    trocarPagina('filtros');
  } catch (e) {
    console.error(e);
    mostrarErro('Não foi possível carregar o arquivo.\n\n' + (e && e.message ? e.message : e));
  } finally {
    bloquearBotoes(false);
    $('input-arquivo').value = '';
  }
}

function rotuloMes(m) { return `${NOME_MES[m.mes - 1]}-${String(m.ano).slice(2)}`; }

// ---------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------
function filtroAtivo(f) { return f && (f.modo === 'exc' || (f.modo === 'inc' && f.valores.size > 0)); }

function clausulaWhere(excetoKey) {
  const partes = [];
  for (const d of estado.dims) {
    if (d.key === excetoKey) continue;
    const f = estado.filtros[d.key];
    if (!filtroAtivo(f)) continue;
    const lista = [...f.valores].map(sqlTexto).join(', ');
    partes.push(`d_${d.key} ${f.modo === 'inc' ? 'IN' : 'NOT IN'} (${lista})`);
  }
  return partes.length ? 'WHERE ' + partes.join(' AND ') : '';
}

function estaMarcado(f, v) {
  if (f.modo === 'todos') return true;
  if (f.modo === 'exc') return !f.valores.has(v);
  return f.valores.has(v);
}

function marcar(key, valores, marcado) {
  const f = estado.filtros[key];
  for (const v of valores) {
    if (marcado) {
      if (f.modo === 'exc') f.valores.delete(v);
      else if (f.modo === 'inc') f.valores.add(v);
    } else {
      if (f.modo === 'todos') { f.modo = 'exc'; f.valores = new Set([v]); }
      else if (f.modo === 'exc') f.valores.add(v);
      else f.valores.delete(v);
    }
  }
  if (f.modo === 'exc' && f.valores.size === 0) f.modo = 'todos';
}

function prepararInterface() {
  estado.filtros = {};
  estado.busca = {};
  estado.opcoes = {};
  for (const secao of ['MERCADO', 'PRODUTO']) $('filtros-' + secao).innerHTML = '';
  for (const d of estado.dims) {
    estado.filtros[d.key] = { modo: 'inc', valores: new Set() };
    estado.busca[d.key] = '';
    $('filtros-' + d.secao).appendChild(criarCardFiltro(d));
  }
  // seletores da página 2
  const tem = (k) => estado.dims.some((d) => d.key === k);
  estado.dimsGrafico = tem('forma') ? ['forma'] : estado.dims.slice(0, 1).map((d) => d.key);
  estado.dimsTabela = tem('produto') ? ['__prodcorp'] : estado.dims.slice(0, 1).map((d) => d.key);
  estado.expandidos = new Set();
  estado.ordem = { col: 'r0', desc: true };
  renderizarSeletores();
  prepararPreco();
  prepararPreco2();
}

function criarCardFiltro(d) {
  const card = document.createElement('div');
  card.className = 'card-filtro';
  card.id = 'card-' + d.key;
  card.innerHTML = `
    <div class="cf-titulo">${escaparHtml(d.rotulo)}</div>
    <input class="cf-busca" type="search" placeholder="Buscar…">
    <label class="cf-tudo"><input type="checkbox"> Selecionar tudo</label>
    <div class="cf-lista"></div>`;
  const busca = card.querySelector('.cf-busca');
  const tudo = card.querySelector('.cf-tudo input');
  const lista = card.querySelector('.cf-lista');

  busca.addEventListener('input', () => { estado.busca[d.key] = busca.value; renderizarLista(d.key); });

  tudo.addEventListener('change', () => {
    const texto = estado.busca[d.key].trim();
    if (!texto) {
      estado.filtros[d.key] = tudo.checked ? { modo: 'todos', valores: new Set() } : { modo: 'inc', valores: new Set() };
    } else {
      marcar(d.key, opcoesFiltradas(d.key), tudo.checked);
    }
    aoMudarFiltro();
  });

  lista.addEventListener('change', (ev) => {
    const caixa = ev.target;
    if (!caixa.dataset || caixa.dataset.i === undefined) return;
    const valor = card._visiveis[Number(caixa.dataset.i)];
    marcar(d.key, [valor], caixa.checked);
    aoMudarFiltro();
  });
  return card;
}

function opcoesFiltradas(key) {
  const texto = normalizar(estado.busca[key] || '');
  const todas = estado.opcoes[key] || [];
  return texto ? todas.filter((v) => normalizar(v).includes(texto)) : todas;
}

function renderizarLista(key) {
  const card = $('card-' + key);
  if (!card) return;
  const f = estado.filtros[key];
  const filtradas = opcoesFiltradas(key);
  const visiveis = filtradas.slice(0, MAX_OPCOES_VISIVEIS);
  card._visiveis = visiveis;
  let html = visiveis.map((v, i) =>
    `<label><input type="checkbox" data-i="${i}" ${estaMarcado(f, v) ? 'checked' : ''}> ${escaparHtml(v)}</label>`).join('');
  if (filtradas.length > visiveis.length) {
    html += `<div class="cf-aviso">Mostrando ${inteiro(visiveis.length)} de ${inteiro(filtradas.length)}. Use a busca para encontrar outros.</div>`;
  }
  if (!filtradas.length) html = '<div class="cf-aviso">Nenhuma opção.</div>';
  card.querySelector('.cf-lista').innerHTML = html;

  const tudo = card.querySelector('.cf-tudo input');
  const marcados = filtradas.filter((v) => estaMarcado(f, v)).length;
  tudo.checked = filtradas.length > 0 && marcados === filtradas.length;
  tudo.indeterminate = marcados > 0 && marcados < filtradas.length;
  card.classList.toggle('com-filtro', filtroAtivo(f));
}

let temporizador = null;
function aoMudarFiltro() {
  // atualiza a própria lista na hora e o resto logo em seguida
  for (const d of estado.dims) renderizarLista(d.key);
  clearTimeout(temporizador);
  temporizador = setTimeout(atualizarTudo, 200);
}

let versaoAtualizacao = 0;
async function atualizarTudo() {
  const versao = ++versaoAtualizacao;
  // Cascata: as opções de cada filtro consideram os filtros dos OUTROS
  const novas = {};
  for (const d of estado.dims) {
    const linhas = await consultar(`SELECT DISTINCT d_${d.key} AS v FROM fato ${clausulaWhere(d.key)} ORDER BY 1`);
    novas[d.key] = linhas.map((r) => r.v);
  }
  if (versao !== versaoAtualizacao) return; // um clique mais novo já está sendo processado
  estado.opcoes = novas;
  for (const d of estado.dims) renderizarLista(d.key);

  const ativos = estado.dims.filter((d) => filtroAtivo(estado.filtros[d.key]));
  $('contador-filtros').textContent = ativos.length ? ativos.length : '';
  $('resumo-filtros').textContent = ativos.length
    ? 'Filtros: ' + ativos.map((d) => d.rotulo).join(', ')
    : 'Sem filtros aplicados';

  estado.analisePendente = true;
  estado.precoPendente = true;
  if (estado.pagina === 'analise') await atualizarAnalise();
  if (estado.pagina === 'preco') await atualizarPreco();
  estado.preco2Pendente = true;
  if (estado.pagina === 'preco2') await atualizarPreco2();
}

function zerarFiltros() {
  for (const d of estado.dims) {
    estado.filtros[d.key] = { modo: 'inc', valores: new Set() };
    estado.busca[d.key] = '';
    const card = $('card-' + d.key);
    if (card) card.querySelector('.cf-busca').value = '';
  }
  aoMudarFiltro();
}


// ---------------------------------------------------------------------
// Página 2: seletores "Gráfico" e "Tabela" (caixa suspensa estilo Power BI)
// A ordem em que os itens são marcados define a hierarquia.
// ---------------------------------------------------------------------
const PRODUTO_CORP = '__prodcorp';

function rotuloDim(key) {
  if (key === PRODUTO_CORP) return 'Produto Corp';
  const d = estado.dims.find((x) => x.key === key);
  return d ? d.rotulo : key;
}
function exprDim(key) {
  return key === PRODUTO_CORP ? `(d_produto || ' (' || sigla || ')')` : `d_${key}`;
}

function renderizarSeletores() {
  const base = estado.dims.map((d) => d.key);
  montarSuspenso('dd-grafico', estado.dimsGrafico, base, atualizarGraficos);
  montarSuspenso('dd-tabela', estado.dimsTabela, [...base, PRODUTO_CORP], () => {
    estado.expandidos = new Set();
    const tinhaSelecao = estado.selecao.size > 0;
    estado.selecao.clear();
    atualizarTabela();
    if (tinhaSelecao) { atualizarKpis(tempoTabela(), whereAnalise()); atualizarGraficos(); }
  });
  // "Mês" só aparece se a base tiver colunas mensais
  $('sel-tempo').querySelector('option[value="MES"]').hidden = !estado.meses.length;
  if (!estado.meses.length && $('sel-tempo').value === 'MES') $('sel-tempo').value = 'MAT';
}

function montarSuspenso(id, lista, opcoes, aoMudar) {
  const el = $(id);
  el.innerHTML = `
    <button type="button" class="dd-botao"><span class="dd-texto"></span><span class="dd-seta">▾</span></button>
    <div class="dd-painel" hidden>
      <input type="search" class="dd-busca" placeholder="Pesquisar">
      <div class="dd-lista"></div>
    </div>`;
  const botao = el.querySelector('.dd-botao');
  const painel = el.querySelector('.dd-painel');
  const busca = el.querySelector('.dd-busca');
  const listaEl = el.querySelector('.dd-lista');
  let temporizadorDd = null;

  const desenhar = () => {
    el.querySelector('.dd-texto').textContent = lista.length === 0 ? '(nenhum)'
      : lista.length === 1 ? rotuloDim(lista[0]) : 'Seleções múltiplas';
    const texto = normalizar(busca.value);
    listaEl.innerHTML = opcoes
      .filter((k) => !texto || normalizar(rotuloDim(k)).includes(texto))
      .map((k) => {
        const pos = lista.indexOf(k);
        return `<div class="dd-item${pos >= 0 ? ' marcado' : ''}" data-k="${k}">
          <span class="dd-caixa"></span><span class="dd-nome">${escaparHtml(rotuloDim(k))}</span>
          <span class="dd-ordem">${pos >= 0 ? pos + 1 : ''}</span></div>`;
      }).join('') || '<div class="dd-vazio">Nada encontrado</div>';
  };

  botao.onclick = () => {
    const abrir = painel.hidden;
    document.querySelectorAll('.dd-painel').forEach((p) => { p.hidden = true; });
    painel.hidden = !abrir;
    if (abrir) { busca.value = ''; desenhar(); busca.focus(); }
  };
  busca.oninput = desenhar;
  listaEl.onclick = (e) => {
    const item = e.target.closest('.dd-item');
    if (!item) return;
    const k = item.dataset.k;
    const pos = lista.indexOf(k);
    if (pos >= 0) lista.splice(pos, 1); else lista.push(k);
    desenhar();
    clearTimeout(temporizadorDd);
    temporizadorDd = setTimeout(aoMudar, 250);
  };
  desenhar();
}

// fecha as caixas suspensas ao clicar fora delas
document.addEventListener('mousedown', (e) => {
  document.querySelectorAll('.dropdown').forEach((dd) => {
    const painel = dd.querySelector('.dd-painel');
    if (painel && !dd.contains(e.target)) painel.hidden = true;
  });
});

// ---------------------------------------------------------------------
// Regra de exibição: Top N / Outros / 80% do RCD
// Recebe itens com .r0 (RCD do período atual) e devolve quais ficam,
// quais vão para "Outros" e quantos ficam escondidos.
// ---------------------------------------------------------------------
function aplicarExibicao(itens) {
  const { topN, outros, auto80 } = estado.exib;
  const ordenados = [...itens].sort((a, b) => (b.r0 || 0) - (a.r0 || 0));
  let n = ordenados.length;
  let agrupar = false;
  if (auto80) {
    const total = ordenados.reduce((s, i) => s + Math.max(0, i.r0 || 0), 0);
    if (total > 0) {
      let acumulado = 0;
      n = 0;
      while (n < ordenados.length && acumulado < 0.8 * total) { acumulado += Math.max(0, ordenados[n].r0 || 0); n++; }
    }
    agrupar = true;
  } else if (topN > 0) {
    n = Math.min(topN, ordenados.length);
    agrupar = outros;
  }
  const resto = ordenados.slice(n);
  return { manter: ordenados.slice(0, n), outros: agrupar ? resto : [], escondidos: agrupar ? 0 : resto.length };
}

function somarCampos(destino, origem, campos) {
  for (const c of campos) destino[c] = (destino[c] || 0) + (origem[c] || 0);
  return destino;
}

function lerExibicao() {
  const n = parseInt($('exib-topn').value, 10);
  estado.exib = {
    topN: Number.isFinite(n) && n > 0 ? n : null,
    outros: $('exib-outros').checked,
    auto80: $('exib-80').checked,
  };
  $('exib-topn').disabled = estado.exib.auto80;
  $('exib-outros').disabled = estado.exib.auto80;
  // a linha "Outros" muda de conteúdo: a seleção feita na tabela deixa de valer
  if (estado.selecao.size) limparSelecao();
  desenharGraficos();
  desenharTabela();
}

// ---------------------------------------------------------------------
// Página 2: KPIs, gráficos e tabela
// ---------------------------------------------------------------------
// Tabela e KPIs usam MAT quando o Tempo é "Mês"
const tempoTabela = () => ($('sel-tempo').value === 'YTD' ? 'YTD' : 'MAT');

// Filtros da página Filtros + linhas clicadas na tabela (só nesta página)
function whereAnalise() {
  const base = clausulaWhere(null);
  if (!estado.selecao.size) return base;
  const sel = '(' + [...estado.selecao.values()].join(' OR ') + ')';
  return base ? `${base} AND ${sel}` : `WHERE ${sel}`;
}

function trocarPagina(pagina) {
  estado.pagina = pagina;
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.pagina === pagina));
  $('pagina-filtros').hidden = pagina !== 'filtros';
  $('pagina-analise').hidden = pagina !== 'analise';
  $('pagina-preco').hidden = pagina !== 'preco';
  $('pagina-preco2').hidden = pagina !== 'preco2';
  if (pagina === 'analise') {
    if (estado.analisePendente) atualizarAnalise();
    else Object.values(estado.graficos).forEach((g) => g.resize());
  }
  if (pagina === 'preco') {
    if (estado.precoPendente) atualizarPreco();
    else if (estado.graficoPreco) { estado.graficoPreco.resize(); desenharPreco(); }
  }
  if (pagina === 'preco2') {
    // o produto é compartilhado com outras abas: se mudou lá, recalcula aqui
    if (estado.preco2Pendente || estado.p2.produtoUsado !== estado.produtoCompartilhado) atualizarPreco2();
    else desenharPreco2();
  }
}

async function atualizarAnalise() {
  estado.analisePendente = false;
  estado.selecao.clear();
  await Promise.all([
    atualizarKpis(tempoTabela(), whereAnalise()),
    atualizarGraficos(),
    atualizarTabela(),
  ]);
}

async function atualizarKpis(T, where, alvo = 'kpis') {
  const comVenda = `(COALESCE(rcd_${T}0, 0) <> 0 OR COALESCE(und_${T}0, 0) <> 0)`;
  const [k] = await consultar(`SELECT
      SUM(rcd_${T}0) r0, SUM(rcd_${T}1) r1, SUM(rcd_${T}4) r4,
      SUM(und_${T}0) u0, SUM(und_${T}1) u1, SUM(und_${T}4) u4,
      COUNT(DISTINCT d_corp) FILTER (WHERE ${comVenda}) corps,
      COUNT(DISTINCT d_produto) FILTER (WHERE ${comVenda}) marcas,
      COUNT(DISTINCT sku) FILTER (WHERE ${comVenda}) skus
    FROM fato ${where}`);
  const cards = [
    ['kpi-rcd', `RCD ${T}`, abreviar(k.r0)],
    ['kpi-rcd', `Evol. RCD ${T}`, percentual(evolucao(k.r0, k.r1))],
    ['kpi-rcd', 'CAGR 5Y RCD', percentual(cagr(k.r0, k.r4))],
    ['kpi-und', `UND ${T}`, abreviar(k.u0)],
    ['kpi-und', `Evol. UND ${T}`, percentual(evolucao(k.u0, k.u1))],
    ['kpi-und', 'CAGR 5Y UND', percentual(cagr(k.u0, k.u4))],
    ['kpi-cont', '#Corporações', inteiro(k.corps)],
    ['kpi-cont', '#Marcas', inteiro(k.marcas)],
    ['kpi-cont', '#SKUs', inteiro(k.skus)],
  ];
  $(alvo).innerHTML = cards.map(([cls, rotulo, valor]) =>
    `<div class="kpi ${cls}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div></div>`).join('');
}

// ----- Gráficos -----
let ultimoGrafico = null;

// Colunas e rótulos do eixo X conforme o Tempo
function periodosGrafico() {
  const tempo = $('sel-tempo').value;
  if (tempo === 'MES') {
    return { mes: true, rotulos: estado.meses, colunas: estado.meses.map((_, i) => `m${i}`) };
  }
  return {
    mes: false,
    rotulos: [`${tempo}-4`, `${tempo}-3`, `${tempo}-2`, `${tempo}-1`, tempo],
    colunas: [4, 3, 2, 1, 0].map((k) => `${tempo}${k}`),
  };
}

async function atualizarGraficos() {
  const dims = estado.dimsGrafico;
  const per = periodosGrafico();
  const grupo = dims.length ? `concat_ws(' | ', ${dims.map(exprDim).join(', ')})` : `'Total'`;
  const somas = per.colunas.map((c, i) => `SUM(rcd_${c}) r_${i}, SUM(und_${c}) u_${i}`).join(', ');
  const linhas = await consultar(`SELECT ${grupo} AS g, ${somas} FROM fato ${whereAnalise()} GROUP BY 1`);
  const ultimo = per.colunas.length - 1;
  for (const l of linhas) l.r0 = l['r_' + ultimo]; // ranking pelo RCD do período mais recente
  ultimoGrafico = { linhas, per };
  desenharGraficos();
}

function desenharGraficos() {
  if (!ultimoGrafico) return;
  const { linhas, per } = ultimoGrafico;
  if ($('sel-tipo').value === 'waterfall') {
    const n = estado.exib.topN || 5;
    desenharWaterfall('grafico-rcd', linhas, 'r_', per, n);
    desenharWaterfall('grafico-und', linhas, 'u_', per, n);
    desenharLegenda([
      { nome: 'Total', cor: WF.total }, { nome: 'Aumento', cor: WF.aumento },
      { nome: 'Queda', cor: WF.queda }, { nome: 'Outros', cor: WF.outros },
    ], true);
    $('nota-grafico').textContent = `Waterfall: em cada transição aparecem os ${n} itens de maior variação; o restante está em "Outros".`;
    return;
  }
  const campos = per.colunas.flatMap((_, i) => ['r_' + i, 'u_' + i]);
  const regra = aplicarExibicao(linhas);
  let manter = regra.manter;
  let outros = regra.outros;
  let nota = regra.escondidos ? `${inteiro(regra.escondidos)} itens fora do Top N não aparecem.` : '';
  if (manter.length > MAX_SERIES) { // segurança: centenas de cores travariam o gráfico
    outros = [...manter.slice(MAX_SERIES), ...outros];
    manter = manter.slice(0, MAX_SERIES);
    nota = `Mostrando os ${MAX_SERIES} maiores; os demais estão em "Outros".`;
  }
  const grupos = manter.map((l, i) => ({ nome: l.g, linha: l, cor: CORES[i % CORES.length] }));
  if (outros.length) {
    const soma = { g: 'Outros' };
    for (const l of outros) somarCampos(soma, l, campos);
    grupos.push({ nome: 'Outros', linha: soma, cor: COR_OUTROS });
  }
  // o total escrito acima da barra é sempre 100% dos dados filtrados
  const totalGeral = {};
  for (const l of linhas) somarCampos(totalGeral, l, campos);

  const tipo = $('sel-tipo').value;
  desenharGrafico('grafico-rcd', grupos, 'r_', per, totalGeral, tipo);
  desenharGrafico('grafico-und', grupos, 'u_', per, totalGeral, tipo);
  desenharLegenda(grupos);
  $('nota-grafico').textContent = nota;
}

// Legenda única, compartilhada pelos dois gráficos (já vem ordenada pelo RCD, "Outros" no fim)
function desenharLegenda(grupos, estatica = false) {
  $('legenda')._estatica = estatica;
  $('legenda').innerHTML = grupos.map((g, i) =>
    `<div class="leg-item${estatica ? ' estatica' : ''}${!estatica && estado.ocultas.has(g.nome) ? ' oculta' : ''}" data-i="${i}" title="${escaparHtml(g.nome)}">
      <span class="leg-cor" style="background:${g.cor}"></span><span class="leg-nome">${escaparHtml(g.nome)}</span>
    </div>`).join('');
  $('legenda')._grupos = grupos;
}

function alternarSerie(nome) {
  if (estado.ocultas.has(nome)) estado.ocultas.delete(nome); else estado.ocultas.add(nome);
  for (const g of Object.values(estado.graficos)) g.dispatchAction({ type: 'legendToggleSelect', name: nome });
  document.querySelectorAll('#legenda .leg-item').forEach((el) => {
    el.classList.toggle('oculta', estado.ocultas.has($('legenda')._grupos[Number(el.dataset.i)].nome));
  });
}

// ----- Waterfall ("Movimentações do Mercado") -----
const WF = { total: '#6B76A6', aumento: '#3BAA4A', queda: '#D9534F', outros: '#F2C94C' };

// Totais de cada período e, entre eles, a variação dos N itens que mais mudaram.
// Truque clássico: uma barra invisível de "base" empilhada sob a barra visível.
function desenharWaterfall(id, linhas, prefixo, per, n) {
  const el = $(id);
  if (!estado.graficos[id]) estado.graficos[id] = echarts.init(el);
  const grafico = estado.graficos[id];
  const ultimo = per.colunas.length - 1;
  // no modo Mês usa só o primeiro e o último mês
  const indices = per.mes ? [0, ultimo] : per.colunas.map((_, i) => i);
  const total = (i) => linhas.reduce((s, l) => s + (l[prefixo + i] || 0), 0);

  const barras = []; // { nome, base, altura, valor, cor, info }
  indices.forEach((i, k) => {
    const t = total(i);
    barras.push({ nome: per.rotulos[i], base: 0, altura: t, valor: t, cor: WF.total, info: 'Total' });
    if (k === indices.length - 1) return;
    const j = indices[k + 1];
    const transicao = `${per.rotulos[i]} → ${per.rotulos[j]}`;
    const variacoes = linhas
      .map((l) => ({ nome: l.g, d: (l[prefixo + j] || 0) - (l[prefixo + i] || 0) }))
      .filter((v) => v.d !== 0)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const itens = variacoes.slice(0, n).map((v) => ({ ...v, cor: v.d >= 0 ? WF.aumento : WF.queda }));
    const resto = variacoes.slice(n);
    if (resto.length) itens.push({ nome: 'Outros', d: resto.reduce((s, v) => s + v.d, 0), cor: WF.outros });
    let nivel = t;
    for (const it of itens) {
      barras.push({ nome: it.nome, base: Math.min(nivel, nivel + it.d), altura: Math.abs(it.d), valor: it.d, cor: it.cor, info: transicao });
      nivel += it.d;
    }
  });

  const curto = (s) => (s.length > 16 ? s.slice(0, 15) + '…' : s);
  // o eixo começa um pouco abaixo do menor nível, para as variações ficarem visíveis
  const menorNivel = Math.min(...barras.map((b) => (b.info === 'Total' ? b.valor : b.base)));
  let minimo = 0;
  if (menorNivel > 0) {
    const passo = Math.pow(10, Math.floor(Math.log10(menorNivel * 0.85)) - 1);
    minimo = Math.floor((menorNivel * 0.85) / passo) * passo;
  }
  const vertical = barras.length > 14;
  grafico.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const b = barras[p.dataIndex];
        return `${escaparHtml(b.nome)}<br>${escaparHtml(b.info)}: <b>${inteiro(b.valor)}</b>`;
      },
    },
    grid: { left: 50, right: 15, top: 30, bottom: 95 },
    xAxis: {
      type: 'category', data: barras.map((b) => b.nome), triggerEvent: true,
      axisLabel: { rotate: 45, fontSize: 10, interval: 0, formatter: curto },
    },
    yAxis: { type: 'value', min: minimo, max: (v) => v.max + (v.max - minimo) * 0.12, axisLabel: { formatter: abreviar } },
    series: [
      { type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'rgba(0,0,0,0)' }, tooltip: { show: false },
        data: barras.map((b) => b.base) },
      { type: 'bar', stack: 'wf', barMaxWidth: 40, barCategoryGap: '25%',
        data: barras.map((b) => ({ value: b.altura, itemStyle: { color: b.cor } })),
        label: {
          show: true, position: 'top', fontSize: vertical ? 9 : 10, color: '#2B2B2B',
          rotate: vertical ? 90 : 0, align: vertical ? 'left' : 'center', verticalAlign: 'middle', distance: 4,
          formatter: (p) => abreviar(barras[p.dataIndex].valor),
        } },
    ],
  }, true);
  // nome completo ao passar o mouse no rótulo do eixo
  grafico.off('mouseover'); grafico.off('mouseout');
  grafico.on('mouseover', (e) => { if (e.componentType === 'xAxis') el.title = e.value; });
  grafico.on('mouseout', (e) => { if (e.componentType === 'xAxis') el.title = ''; });
  grafico.resize();
}

// texto escuro sobre cores claras e branco sobre cores escuras
function corTexto(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#2B2B2B' : '#FFFFFF';
}

// índices que recebem rótulo numa linha do modo Mês: início, fim, máximo e mínimo
function pontosChave(valores) {
  if (!valores.length) return new Set();
  let iMax = 0, iMin = 0;
  valores.forEach((v, i) => { if (v > valores[iMax]) iMax = i; if (v < valores[iMin]) iMin = i; });
  return new Set([0, valores.length - 1, iMax, iMin]);
}

function desenharGrafico(id, grupos, prefixo, per, totalGeral, tipo) {
  const el = $(id);
  if (!estado.graficos[id]) estado.graficos[id] = echarts.init(el);
  const grafico = estado.graficos[id];
  const n = per.colunas.length;
  const mes = per.mes;

  const valores = grupos.map((g) => per.colunas.map((_, i) => g.linha[prefixo + i] || 0));
  const totais = per.colunas.map((_, i) => totalGeral[prefixo + i] || 0);
  const empilhado = tipo === 'empilhado' || tipo === 'cem' || tipo === 'areas';
  const cem = tipo === 'cem';
  const ehBarra = tipo === 'empilhado' || tipo === 'cem' || tipo === 'agrupado';
  const fracao = (v, i) => (totais[i] > 0 ? v / totais[i] : null);
  // no modo Mês só os segmentos bem grandes recebem rótulo interno
  const limiteRotulo = mes ? 0.15 : 0.08;
  // e só nos meses-chave (início, fim, máximo e mínimo do total)
  const mesesChave = pontosChave(totais);
  const rotuloInterno = (v, i) => {
    const f = fracao(v, i);
    return f !== null && f >= limiteRotulo && (!mes || mesesChave.has(i));
  };

  const series = grupos.map((g, gi) => {
    const dados = valores[gi];
    const chave = pontosChave(dados);
    const serie = {
      name: g.nome,
      type: ehBarra ? 'bar' : 'line',
      itemStyle: { color: g.cor },
      emphasis: { focus: 'series' },
      barMaxWidth: 70,
    };
    if (empilhado) serie.stack = 'total';
    if (tipo === 'areas') Object.assign(serie, { areaStyle: { opacity: 0.85 }, lineStyle: { width: 1 }, symbol: 'none' });
    if (tipo === 'linhas') Object.assign(serie, { symbolSize: mes ? 3 : 6, lineStyle: { width: 2 } });

    const corRotulo = corTexto(g.cor);
    if (tipo === 'empilhado' || tipo === 'cem') {
      serie.data = dados.map((v, i) => ({
        value: cem ? (fracao(v, i) ?? 0) * 100 : v,
        bruto: v,
        label: { show: rotuloInterno(v, i) },
      }));
      serie.label = {
        position: 'inside', color: corRotulo, fontSize: mes ? 9 : 10, rotate: mes ? 90 : 0,
        formatter: (p) => (mes ? `${abreviar(p.data.bruto)} · ${percentual(fracao(p.data.bruto, p.dataIndex))}`
          : `${abreviar(p.data.bruto)}\n${percentual(fracao(p.data.bruto, p.dataIndex))}`),
      };
    } else if (tipo === 'agrupado') {
      const mostrar = !mes && grupos.length <= 4;
      serie.data = dados.map((v) => ({ value: v, bruto: v }));
      serie.label = { show: mostrar, position: 'top', color: '#2B2B2B', fontSize: 9, formatter: (p) => abreviar(p.value) };
    } else if (tipo === 'linhas') {
      serie.data = dados.map((v, i) => ({ value: v, bruto: v, label: { show: !mes || chave.has(i) } }));
      serie.label = { position: 'top', color: '#2B2B2B', fontSize: 9, formatter: (p) => abreviar(p.value) };
    } else { // áreas: os rótulos ficam só no total
      serie.data = dados.map((v) => ({ value: v, bruto: v }));
    }
    return serie;
  });

  // total escrito acima das barras/áreas empilhadas (série invisível)
  if (empilhado) {
    const chaveTotal = pontosChave(totais);
    series.push({
      // o rótulo de linha só aparece se houver marcador: marcador invisível
      name: '__total', type: 'line', silent: true, symbol: 'circle', symbolSize: 1, itemStyle: { color: 'rgba(0,0,0,0)' },
      lineStyle: { opacity: 0 }, tooltip: { show: false },
      data: totais.map((t, i) => ({
        value: cem ? 100 : t,
        bruto: t,
        label: { show: !mes || tipo === 'empilhado' || tipo === 'cem' || chaveTotal.has(i) },
      })),
      label: {
        position: 'top', fontWeight: 'bold', color: '#2B2B2B',
        fontSize: mes ? 9 : 11, rotate: mes && tipo !== 'areas' ? 90 : 0,
        align: mes && tipo !== 'areas' ? 'left' : 'center',
        verticalAlign: 'middle',
        distance: mes && tipo !== 'areas' ? 4 : 6,
        formatter: (p) => abreviar(p.data.bruto),
      },
    });
  }

  const maxTotal = Math.max(0, ...totais);
  grafico.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const bruto = p.data && p.data.bruto !== undefined ? p.data.bruto : p.value;
        return `${escaparHtml(p.seriesName)}<br>${p.name}: <b>${inteiro(bruto)}</b> (${percentual(fracao(bruto, p.dataIndex))})`;
      },
    },
    // a legenda visível fica fora do gráfico (coluna à direita); esta só guarda o que está oculto
    legend: {
      show: false,
      data: grupos.map((g) => g.nome),
      selected: Object.fromEntries(grupos.map((g) => [g.nome, !estado.ocultas.has(g.nome)])),
    },
    grid: { left: 50, right: mes ? 20 : 15, top: mes ? 50 : 30, bottom: mes ? 50 : 30 },
    labelLayout: mes ? { hideOverlap: true } : undefined,
    xAxis: {
      type: 'category', data: per.rotulos, boundaryGap: ehBarra || n === 1,
      axisLabel: { rotate: mes ? 90 : 0, fontSize: mes ? 9 : 12 },
    },
    yAxis: cem
      ? { type: 'value', max: 100, axisLabel: { formatter: (v) => v + '%' } }
      : { type: 'value', max: (v) => Math.max(v.max, empilhado ? maxTotal : 0) * (mes ? 1.18 : 1.12), axisLabel: { formatter: abreviar } },
    series,
  }, true);
  grafico.resize();
}

// ----- Tabela (matriz com níveis) -----
const CAMPOS_TABELA = ['r0', 'r1', 'r4', 'u0', 'u1', 'u4', 'd0'];
const SEP = '\u0001'; // separador interno do "caminho" de cada linha

const COLUNAS_TABELA = (T) => [
  { id: 'r0', titulo: `RCD ${T}`, tipo: 'num', cor: '#6B76A6' },
  { id: 'msR', titulo: 'MS% RCD', tipo: 'pct', cor: '#F2C94C' },
  { id: 'evR', titulo: `Evol. ${T} RCD`, tipo: 'var' },
  { id: 'cgR', titulo: 'CAGR 5Y RCD', tipo: 'var' },
  { id: 'u0', titulo: `UND ${T}`, tipo: 'num', cor: '#A58BDB' },
  { id: 'msU', titulo: 'MS% UND', tipo: 'pct', cor: '#F2C94C' },
  { id: 'msD', titulo: 'MS% DOSES', tipo: 'pct', cor: '#F2C94C' },
  { id: 'evU', titulo: `Evol. ${T} UND`, tipo: 'var' },
  { id: 'cgU', titulo: 'CAGR 5Y UND', tipo: 'var' },
];

function novoNo(nome, nivel, caminho, valores) {
  const no = { nome, nivel, caminho, valores, filhos: new Map() };
  for (const c of CAMPOS_TABELA) no[c] = 0;
  return no;
}

// MS% sempre sobre o total geral filtrado
function completarNo(no, total) {
  no.msR = divisao(no.r0, total.r0);
  no.msU = divisao(no.u0, total.u0);
  no.msD = divisao(no.d0, total.d0);
  no.evR = evolucao(no.r0, no.r1);
  no.cgR = cagr(no.r0, no.r4);
  no.evU = evolucao(no.u0, no.u1);
  no.cgU = cagr(no.u0, no.u4);
}

// A tabela usa só os filtros da página Filtros (não a própria seleção)
let ultimaTabela = null;
async function atualizarTabela() {
  const T = tempoTabela();
  const dims = estado.dimsTabela;
  const grupos = dims.map((k, i) => `${exprDim(k)} AS g${i}`);
  const linhas = await consultar(`SELECT ${grupos.length ? grupos.join(', ') + ',' : ''}
      SUM(rcd_${T}0) r0, SUM(rcd_${T}1) r1, SUM(rcd_${T}4) r4,
      SUM(und_${T}0) u0, SUM(und_${T}1) u1, SUM(und_${T}4) u4,
      SUM(dos_${T}0) d0
    FROM fato ${clausulaWhere(null)} ${grupos.length ? 'GROUP BY ALL' : ''}`);

  // monta a árvore: cada nível soma os valores dos níveis abaixo
  const raiz = novoNo('Total', -1, '', []);
  for (const l of linhas) {
    let no = raiz;
    somarCampos(raiz, l, CAMPOS_TABELA);
    dims.forEach((_, i) => {
      const valor = l['g' + i];
      let filho = no.filhos.get(valor);
      if (!filho) {
        filho = novoNo(valor, i, no.caminho + SEP + valor, [...no.valores, valor]);
        no.filhos.set(valor, filho);
      }
      somarCampos(filho, l, CAMPOS_TABELA);
      no = filho;
    });
  }
  const completarTudo = (no) => { completarNo(no, raiz); no.filhos.forEach(completarTudo); };
  completarTudo(raiz);
  ultimaTabela = { raiz, T, dims: [...dims] };
  desenharTabela();
}

function ordenarIrmaos(lista) {
  const { col, desc } = estado.ordem;
  return lista.sort((a, b) => {
    if (col === 'nome') return (desc ? -1 : 1) * String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    const va = valido(a[col]) ? a[col] : -Infinity;
    const vb = valido(b[col]) ? b[col] : -Infinity;
    return desc ? vb - va : va - vb;
  });
}

// Lista os filhos visíveis de um nó: regra de exibição, ordenação e "Outros" no fim
function filhosVisiveis(no, raiz) {
  const regra = aplicarExibicao([...no.filhos.values()]);
  const lista = ordenarIrmaos(regra.manter);
  if (regra.outros.length) {
    const outros = novoNo('Outros', no.nivel + 1, no.caminho + SEP + '__outros__', no.valores);
    outros.ehOutros = true;
    outros.membros = regra.outros.map((f) => f.nome);
    for (const f of regra.outros) somarCampos(outros, f, CAMPOS_TABELA);
    completarNo(outros, raiz);
    lista.push(outros);
  }
  return { lista, escondidos: regra.escondidos };
}

// Condição SQL equivalente a uma linha: a combinação de valores até o nível dela
function condicaoLinha(no, dims) {
  const partes = no.valores.map((v, i) => `${exprDim(dims[i])} = ${sqlTexto(v)}`);
  if (no.ehOutros) partes.push(`${exprDim(dims[no.nivel])} IN (${no.membros.map(sqlTexto).join(', ')})`);
  return partes.length ? '(' + partes.join(' AND ') + ')' : 'TRUE';
}

function linhaSelecionada(caminho) {
  for (const c of estado.selecao.keys()) {
    if (caminho === c || caminho.startsWith(c + SEP)) return true;
  }
  return false;
}

function desenharTabela() {
  if (!ultimaTabela) return;
  const { raiz, T, dims } = ultimaTabela;
  const colunas = COLUNAS_TABELA(T);
  const { col, desc } = estado.ordem;
  const ultimoNivel = dims.length - 1;

  // percorre a árvore, entrando só nas linhas abertas
  const visiveis = [];
  let escondidos = 0;
  let cortou = false;
  const percorrer = (no) => {
    const { lista, escondidos: e } = filhosVisiveis(no, raiz);
    escondidos += e;
    for (const f of lista) {
      if (visiveis.length >= MAX_LINHAS_TABELA) { cortou = true; return; }
      visiveis.push(f);
      if (!f.ehOutros && f.nivel < ultimoNivel && estado.expandidos.has(f.caminho)) percorrer(f);
    }
  };
  if (dims.length) percorrer(raiz);

  // barras de dados proporcionais ao maior valor de cada nível
  const maximos = {};
  for (const l of visiveis) {
    for (const c of colunas) {
      if (!c.cor || l.ehOutros) continue;
      const chave = c.id + '|' + l.nivel;
      maximos[chave] = Math.max(maximos[chave] || 0, valido(l[c.id]) ? l[c.id] : 0);
    }
  }

  const celula = (l, c, comBarra) => {
    const v = l[c.id];
    const texto = c.tipo === 'num' ? inteiro(v) : percentual(v);
    const classe = c.tipo === 'var' ? classeSinal(v) : '';
    const max = maximos[c.id + '|' + l.nivel];
    if (comBarra && c.cor && max > 0 && valido(v) && v > 0) {
      const largura = Math.min(100, (v / max) * 100);
      return `<td class="cel-barra ${classe}"><div class="barra" style="width:${largura}%;background:${c.cor}"></div><span>${texto}</span></td>`;
    }
    return `<td class="${classe}">${texto}</td>`;
  };

  const seta = (id) => (col === id ? (desc ? ' ▼' : ' ▲') : '');
  const titulo = dims.length ? dims.map(rotuloDim).join(' › ') : '(sem dimensão)';
  const cabecalho = `<thead><tr>
      <th data-col="nome" class="${col === 'nome' ? 'ordenada' : ''}">${escaparHtml(titulo)}${seta('nome')}</th>
      ${colunas.map((c) => `<th data-col="${c.id}" class="${col === c.id ? 'ordenada' : ''}">${c.titulo}${seta(c.id)}</th>`).join('')}
    </tr></thead>`;

  const haSelecao = estado.selecao.size > 0;
  estado.linhasTabela = visiveis;
  const corpo = '<tbody>' + visiveis.map((l, i) => {
    const podeAbrir = !l.ehOutros && l.nivel < ultimoNivel;
    const aberto = estado.expandidos.has(l.caminho);
    const botao = podeAbrir
      ? `<button class="btn-exp" data-i="${i}" title="${aberto ? 'Recolher' : 'Expandir'}">${aberto ? '−' : '+'}</button>`
      : '<span class="btn-exp-vazio"></span>';
    const classes = [`nivel-${Math.min(l.nivel, 3)}`];
    if (l.ehOutros) classes.push('linha-outros');
    if (haSelecao) classes.push(estado.selecao.has(l.caminho) ? 'selecionada' : linhaSelecionada(l.caminho) ? '' : 'apagada');
    return `<tr class="${classes.join(' ')}" data-i="${i}">
      <td style="padding-left:${8 + l.nivel * 20}px">${botao}${escaparHtml(l.nome)}</td>
      ${colunas.map((c) => celula(l, c, true)).join('')}</tr>`;
  }).join('') + '</tbody>';
  const rodape = `<tfoot><tr><td>Total</td>${colunas.map((c) => celula(raiz, c, false)).join('')}</tr></tfoot>`;

  $('tabela').innerHTML = cabecalho + corpo + rodape;
  $('btn-expandir').hidden = $('btn-recolher').hidden = dims.length < 2;
  $('btn-limpar-selecao').hidden = !haSelecao;
  $('dica-selecao').textContent = haSelecao
    ? `${estado.selecao.size} ${estado.selecao.size > 1 ? 'linhas selecionadas filtram' : 'linha selecionada filtra'} os gráficos e os cards.`
    : 'Clique em uma linha para filtrar os gráficos (Ctrl+clique para várias).';
  const notas = [];
  if (cortou) notas.push(`Mostrando as primeiras ${inteiro(MAX_LINHAS_TABELA)} linhas.`);
  if (escondidos) notas.push(`${inteiro(escondidos)} linhas fora do Top N não aparecem.`);
  if (notas.length) notas.push('O Total considera 100% dos dados filtrados.');
  $('nota-tabela').textContent = notas.join(' ');
}

function expandirTudo() {
  if (!ultimaTabela) return;
  const { raiz, dims } = ultimaTabela;
  const abrir = (no) => no.filhos.forEach((f) => {
    if (f.nivel < dims.length - 1) { estado.expandidos.add(f.caminho); abrir(f); }
  });
  abrir(raiz);
  desenharTabela();
}

// Clique na linha: filtra gráficos e cards. Ctrl+clique acumula.
function clicarLinha(linha, acumular) {
  const { caminho } = linha;
  const cond = condicaoLinha(linha, ultimaTabela.dims);
  if (acumular) {
    if (estado.selecao.has(caminho)) estado.selecao.delete(caminho);
    else estado.selecao.set(caminho, cond);
  } else if (estado.selecao.has(caminho) && estado.selecao.size === 1) {
    estado.selecao.clear();
  } else {
    estado.selecao = new Map([[caminho, cond]]);
  }
  aplicarSelecao();
}

function limparSelecao() {
  estado.selecao.clear();
  aplicarSelecao();
}

function aplicarSelecao() {
  desenharTabela();
  atualizarKpis(tempoTabela(), whereAnalise());
  atualizarGraficos();
}

// ---------------------------------------------------------------------
// Ligações dos botões
// ---------------------------------------------------------------------
$('input-arquivo').addEventListener('change', (e) => {
  const arquivo = e.target.files && e.target.files[0];
  if (arquivo) carregarArquivo(arquivo);
});

$('btn-exemplo').addEventListener('click', async () => {
  try {
    mostrarProgresso('Baixando dados de exemplo…', 0.01);
    const resp = await fetch('exemplo.csv');
    if (!resp.ok) throw new Error('arquivo exemplo.csv não encontrado');
    const blob = await resp.blob();
    carregarArquivo(new File([blob], 'exemplo.csv'));
  } catch (e) {
    mostrarErro('Não foi possível abrir os dados de exemplo: ' + e.message +
      '\n(Se você abriu o index.html direto do computador, use o site publicado no GitHub Pages.)');
  }
});

$('btn-trocar').addEventListener('click', () => {
  $('app').hidden = true;
  $('tela-inicial').hidden = false;
  $('carregando').hidden = true;
  $('erro').hidden = true;
});

document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => trocarPagina(b.dataset.pagina)));
$('btn-zerar').addEventListener('click', zerarFiltros);
$('sel-tempo').addEventListener('change', atualizarAnalise);
$('sel-tipo').addEventListener('change', desenharGraficos);
$('exib-topn').addEventListener('input', lerExibicao);
$('exib-outros').addEventListener('change', lerExibicao);
$('exib-80').addEventListener('change', lerExibicao);
$('btn-expandir').addEventListener('click', expandirTudo);
$('btn-recolher').addEventListener('click', () => { estado.expandidos = new Set(); desenharTabela(); });
$('btn-limpar-selecao').addEventListener('click', limparSelecao);
$('tabela').addEventListener('click', (e) => {
  const botao = e.target.closest('.btn-exp');
  if (botao) {
    const { caminho } = estado.linhasTabela[Number(botao.dataset.i)];
    if (estado.expandidos.has(caminho)) estado.expandidos.delete(caminho);
    else estado.expandidos.add(caminho);
    desenharTabela();
    return;
  }
  const th = e.target.closest('th');
  if (th) {
    const col = th.dataset.col;
    estado.ordem = estado.ordem.col === col ? { col, desc: !estado.ordem.desc } : { col, desc: col !== 'nome' };
    desenharTabela();
    return;
  }
  const tr = e.target.closest('tbody tr');
  if (tr) clicarLinha(estado.linhasTabela[Number(tr.dataset.i)], e.ctrlKey || e.metaKey);
});
$('legenda').addEventListener('click', (e) => {
  const item = e.target.closest('.leg-item');
  if (item && !$('legenda')._estatica) alternarSerie($('legenda')._grupos[Number(item.dataset.i)].nome);
});

// versão em uso (vem do "?v=" no index.html), mostrada no rodapé
$('versao').textContent = 'versão ' + (new URL(import.meta.url).searchParams.get('v') || 'local');

window.addEventListener('resize', () => Object.values(estado.graficos).forEach((g) => g.resize()));

// =====================================================================
// Aba Preço: preço médio ponderado por apresentação (valor ÷ unidades)
// =====================================================================
const LARGURA_ROTULO_PRECO = 190; // coluna de rótulos da tabela = margem esquerda do gráfico
const COR_RC = '#C0392B';
const COR_INDEX = '#FFF4CC';
const fmt2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

estado.preco = { index: null, conc: new Set(), qtd: new Set(), seletores: {} };

function reais(v) {
  if (!valido(v)) return '-';
  return 'R$ ' + (Math.abs(v) < 1 && v !== 0 ? fmt3 : fmt2).format(v);
}

// clareia uma cor (mistura com branco)
function clarear(hex, f = 0.55) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * f));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

// "10000FCC" -> { valor: 10000, unidade: 'FCC' };  "500 mg" -> { valor: 500, unidade: 'MG' }
function lerConcentracao(texto) {
  const m = String(texto || '').trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const numero = m[1].includes(',') ? m[1].replace(/\./g, '').replace(',', '.') : m[1];
  const valor = parseFloat(numero);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { valor, unidade: m[2].toUpperCase().replace(/\s+/g, '') };
}

// Caixa suspensa genérica (seleção única ou múltipla) no estilo do Power BI
function criarSeletorPreco(id, { unico, vazio, aoMudar, limpar = false }) {
  const el = $(id);
  el.innerHTML = `
    <button type="button" class="dd-botao dd-largo"><span class="dd-texto"></span><span class="dd-seta">▾</span></button>
    <div class="dd-painel dd-painel-largo" hidden>
      ${limpar ? '<button type="button" class="dd-limpar">✕ Limpar filtro</button>' : ''}
      <input type="search" class="dd-busca" placeholder="Pesquisar">
      <div class="dd-lista"></div>
    </div>`;
  const painel = el.querySelector('.dd-painel');
  const busca = el.querySelector('.dd-busca');
  const lista = el.querySelector('.dd-lista');
  const sel = { opcoes: [], valores: new Set() };
  let temporizadorSel = null;

  sel.desenhar = () => {
    const v = [...sel.valores];
    el.querySelector('.dd-texto').textContent = v.length === 0 ? vazio : v.length === 1 ? v[0] : 'Seleções múltiplas';
    el.querySelector('.dd-botao').title = v.join(', ');
    if (painel.hidden) return;
    const texto = normalizar(busca.value);
    const filtradas = sel.opcoes.filter((o) => !texto || normalizar(o).includes(texto));
    const visiveis = filtradas.slice(0, MAX_OPCOES_VISIVEIS);
    lista._visiveis = visiveis;
    lista.innerHTML = visiveis.map((o, i) =>
      `<div class="dd-item${sel.valores.has(o) ? ' marcado' : ''}" data-i="${i}" title="${escaparHtml(o)}">
        <span class="dd-caixa${unico ? ' redonda' : ''}"></span><span class="dd-nome">${escaparHtml(o)}</span></div>`).join('')
      + (filtradas.length > visiveis.length ? `<div class="dd-vazio">Mostrando ${visiveis.length} de ${filtradas.length}. Use a busca.</div>` : '')
      || '<div class="dd-vazio">Nada encontrado</div>';
  };
  el.querySelector('.dd-botao').onclick = () => {
    const abrir = painel.hidden;
    document.querySelectorAll('.dd-painel').forEach((p) => { p.hidden = true; });
    painel.hidden = !abrir;
    if (abrir) { busca.value = ''; sel.desenhar(); busca.focus(); }
  };
  busca.oninput = sel.desenhar;
  if (limpar) {
    el.querySelector('.dd-limpar').onclick = () => {
      if (!sel.valores.size) return;
      sel.valores = new Set();
      sel.desenhar();
      aoMudar();
    };
  }
  lista.onclick = (e) => {
    const item = e.target.closest('.dd-item');
    if (!item) return;
    const valor = lista._visiveis[Number(item.dataset.i)];
    if (unico) {
      sel.valores = new Set([valor]);
      painel.hidden = true;
      sel.desenhar();
      aoMudar();
      return;
    }
    if (sel.valores.has(valor)) sel.valores.delete(valor); else sel.valores.add(valor);
    sel.desenhar();
    clearTimeout(temporizadorSel);
    temporizadorSel = setTimeout(aoMudar, 300);
  };
  return sel;
}

function prepararPreco() {
  const s = estado.preco.seletores;
  s.index = criarSeletorPreco('dd-index', { unico: true, vazio: '(escolha)', aoMudar: atualizarPreco });
  s.conc = criarSeletorPreco('dd-conc', { unico: false, vazio: 'Todas', aoMudar: atualizarPreco });
  s.qtd = criarSeletorPreco('dd-qtd', { unico: false, vazio: 'Todas', aoMudar: atualizarPreco });
  // "Último mês / 3 / 6 meses" só existem se a base tiver colunas mensais
  const temMeses = estado.meses.length > 0;
  $('preco-periodo').querySelectorAll('option[data-mensal]').forEach((o) => { o.hidden = !temMeses; });
  $('preco-periodo').value = temMeses ? '6' : 'MAT';
  estado.precoPendente = true;
  // cor fixa por corporação (ordem alfabética, então é sempre a mesma)
  consultar('SELECT DISTINCT d_corp AS c FROM fato ORDER BY 1').then((linhas) => {
    estado.coresCorp = {};
    linhas.forEach((l, i) => { estado.coresCorp[l.c] = CORES[i % CORES.length]; });
  });
}

// Expressão SQL do período escolhido para uma medida (rcd, pf, rc, und)
function exprPeriodoPreco(medida) {
  const p = $('preco-periodo').value;
  if (p === 'MAT' || p === 'YTD') return `COALESCE(${medida}_${p}0, 0)`;
  const n = estado.meses.length;
  const k = Math.min(Number(p), n);
  const partes = [];
  for (let i = n - k; i < n; i++) partes.push(`COALESCE(${medida}_m${i}, 0)`);
  return partes.length ? '(' + partes.join(' + ') + ')' : '0';
}

function descricaoPeriodo() {
  const p = $('preco-periodo').value;
  const n = estado.meses.length;
  const ultimoMes = n ? estado.meses[n - 1] : '';
  if (p === 'MAT') return { longo: `MAT (12 meses até ${ultimoMes || 'o último mês'})`, curto: 'MAT' };
  if (p === 'YTD') return { longo: `YTD (ano até ${ultimoMes || 'o último mês'})`, curto: 'YTD' };
  if (p === '1') return { longo: `Último mês (${ultimoMes})`, curto: ultimoMes };
  const k = Math.min(Number(p), n);
  return { longo: `Últimos ${k} meses (${estado.meses[n - k]} a ${ultimoMes})`, curto: `últ. ${k} meses` };
}

let ultimoPreco = null;
async function atualizarPreco() {
  estado.precoPendente = false;
  const s = estado.preco.seletores;
  const where = clausulaWhere(null);
  const e = (cond) => (where ? `${where} AND ${cond}` : `WHERE ${cond}`);
  const lista = (set) => [...set].map(sqlTexto).join(', ');
  const condConc = s.conc.valores.size ? `d_conc IN (${lista(s.conc.valores)})` : 'TRUE';
  const condQtd = s.qtd.valores.size ? `d_qtd IN (${lista(s.qtd.valores)})` : 'TRUE';
  const rcd = exprPeriodoPreco('rcd');

  // opções dos seletores (respeitam a página Filtros e um ao outro)
  const [apres, concs, qtds] = await Promise.all([
    consultar(`SELECT d_apres AS v, SUM(${rcd}) AS r FROM fato ${where} GROUP BY 1`),
    consultar(`SELECT DISTINCT d_conc AS v FROM fato ${e(condQtd)}`),
    consultar(`SELECT DISTINCT d_qtd AS v FROM fato ${e(condConc)}`),
  ]);
  const alfabetica = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  s.index.opcoes = apres.map((l) => l.v).sort(alfabetica);
  s.conc.opcoes = concs.map((l) => l.v).sort(alfabetica);
  s.qtd.opcoes = qtds.map((l) => l.v).sort(alfabetica);
  // index padrão: a apresentação com maior RCD no período
  let index = [...s.index.valores][0];
  if (!index || !s.index.opcoes.includes(index)) {
    const maior = apres.reduce((m, l) => (!m || (l.r || 0) > (m.r || 0) ? l : m), null);
    index = maior ? maior.v : null;
    s.index.valores = new Set(index ? [index] : []);
  }
  Object.values(s).forEach((x) => x.desenhar());

  if (!index) {
    ultimoPreco = null;
    $('preco-titulo').textContent = 'Preço';
    $('tabela-preco').innerHTML = '';
    $('preco-rodape').textContent = 'Nenhuma apresentação com os filtros atuais.';
    if (estado.graficoPreco) estado.graficoPreco.clear();
    return;
  }

  // a apresentação index sempre entra, mesmo fora dos filtros de concentração/quantidade
  const linhas = await consultar(`SELECT d_apres AS apres,
      any_value(d_produto) AS produto, any_value(sigla) AS sigla, any_value(d_corp) AS corp,
      any_value(d_conc) AS conc, any_value(d_qtd) AS qtd, any_value(d_forma) AS forma, any_value(qtdnum) AS qtdnum,
      SUM(${rcd}) AS rcd, SUM(${exprPeriodoPreco('pf')}) AS pf,
      SUM(${exprPeriodoPreco('rc')}) AS rc, SUM(${exprPeriodoPreco('und')}) AS und
    FROM fato ${e(`((${condConc} AND ${condQtd}) OR d_apres = ${sqlTexto(index)})`)}
    GROUP BY 1`);

  // cálculos por apresentação
  const porUnidade = (v, und) => (valido(v) && v !== 0 && und > 0 ? v / und : null);
  for (const a of linhas) {
    a.rcdU = porUnidade(a.rcd, a.und);
    a.pfU = porUnidade(a.pf, a.und);
    a.rcU = porUnidade(a.rc, a.und);
    a.desc = a.rcdU !== null && a.pfU ? 1 - a.rcdU / a.pfU : null;
    a.margem = a.rcdU !== null && a.rcU ? 1 - a.rcdU / a.rcU : null;
    a.mkup = a.rcU !== null && a.rcdU ? a.rcU / a.rcdU - 1 : null;
    a.rcDose = a.rcU !== null && a.qtdnum > 0 ? a.rcU / a.qtdnum : null;
    a.ehIndex = a.apres === index;
  }
  const idx = linhas.find((a) => a.ehIndex);
  const concIdx = lerConcentracao(idx.conc);
  for (const a of linhas) {
    a.indexRc = a.rcU !== null && idx.rcU ? (a.rcU / idx.rcU) * 100 : null;
    const c = lerConcentracao(a.conc);
    a.rcConc = a.rcDose !== null && concIdx && c && c.unidade === concIdx.unidade
      ? a.rcDose * (concIdx.valor / c.valor) : null;
  }

  // ordenação + Top N (o index sempre aparece)
  const chave = $('preco-ordem').value === 'total' ? 'rcd' : 'rcdU';
  const ordenar = (lst) => lst.sort((a, b) => (valido(b[chave]) ? b[chave] : -Infinity) - (valido(a[chave]) ? a[chave] : -Infinity));
  ordenar(linhas);
  const n = Math.max(1, parseInt($('preco-topn').value, 10) || 10);
  let itens = linhas.slice(0, n);
  if (!itens.includes(idx)) itens = ordenar([...itens, idx]);

  ultimoPreco = { itens, idx, concIdx, periodo: descricaoPeriodo(), total: linhas.length };
  desenharPreco();
}

function nomeCurto(a) { return `${a.produto} (${a.sigla})`; }

function desenharPreco() {
  if (!ultimoPreco) return;
  const { itens, idx, periodo, total } = ultimoPreco;
  const s = estado.preco.seletores;
  const cor = (a) => (estado.coresCorp && estado.coresCorp[a.corp]) || CORES[0];

  // título automático
  const filtros = [[...s.conc.valores].join(', '), [...s.qtd.valores].join(', ')].filter(Boolean).join(' ');
  $('preco-titulo').textContent = `Preço${filtros ? ' — ' + filtros : ''} | Index: ${nomeCurto(idx)}`;

  // ----- gráfico -----
  const el = $('grafico-preco');
  if (!estado.graficoPreco) estado.graficoPreco = echarts.init(el);
  const g = estado.graficoPreco;
  const posIndex = itens.indexOf(idx);
  const largura = (el.clientWidth - LARGURA_ROTULO_PRECO) / itens.length;
  const tamanho = largura < 80 ? 9 : 10;
  const rotulo = (v) => (largura < 70 ? fmt2.format(v) : reais(v)); // colunas estreitas: sem "R$"
  // segmento de cima (PF - RCD) só existe quando é positivo
  const difPF = (a) => (valido(a.pfU) && valido(a.rcdU) && a.pfU - a.rcdU > 0 ? a.pfU - a.rcdU : null);
  const NOMES = ['RCD (cor da corporação)', 'PF - RCD (tom claro)', 'RC (preço ao consumidor)'];

  g.setOption({
    animation: false,
    legend: { left: 10, top: 6, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 }, data: NOMES },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const a = itens[ps[0].dataIndex];
        const d = valido(a.pfU) && valido(a.rcdU) ? a.pfU - a.rcdU : null;
        return `<b>${escaparHtml(a.apres)}</b><br>${escaparHtml(a.corp)}<br>
          RCD/UND: <b>${reais(a.rcdU)}</b><br>
          PF/UND: <b>${reais(a.pfU)}</b><br>
          PF - RCD: <b>${reais(d)}</b> (${percentual(divisao(d, a.pfU))} do PF)<br>
          <span style="color:${COR_RC}">RC/UND: <b>${reais(a.rcU)}</b></span>`;
      },
    },
    grid: { left: LARGURA_ROTULO_PRECO, right: 0, top: 60, bottom: 6 },
    xAxis: { type: 'category', data: itens.map((a) => a.apres), axisLabel: { show: false }, axisTick: { show: false } },
    yAxis: {
      type: 'value', axisLabel: { formatter: (v) => 'R$ ' + fmt0.format(v) },
      max: (v) => v.max * 1.25,
    },
    series: [
      { // fundo amarelo-claro na coluna do index
        type: 'custom', silent: true, z: 0, tooltip: { show: false }, data: posIndex >= 0 ? [[posIndex, 0]] : [],
        renderItem: (params, api) => {
          const cs = params.coordSys;
          const w = api.size([1, 0])[0];
          const x = api.coord([api.value(0), 0])[0];
          return { type: 'rect', shape: { x: x - w / 2, y: 0, width: w, height: cs.y + cs.height + 6 }, style: { fill: COR_INDEX } };
        },
      },
      { // segmento de baixo: RCD, com o valor em branco perto do topo
        name: NOMES[0], type: 'bar', stack: 'preco', z: 2, barCategoryGap: '30%', barMaxWidth: 90,
        itemStyle: { color: '#6B76A6' },
        data: itens.map((a) => ({ value: a.rcdU, itemStyle: { color: cor(a) } })),
        label: { show: true, position: 'insideTop', distance: 4, color: '#FFFFFF', fontSize: tamanho, formatter: (p) => rotulo(p.value) },
      },
      { // segmento de cima: PF - RCD (altura total = PF)
        name: NOMES[1], type: 'bar', stack: 'preco', z: 2,
        itemStyle: { color: clarear('#6B76A6') },
        data: itens.map((a) => ({ value: difPF(a), itemStyle: { color: clarear(cor(a)) } })),
      },
      { // traço do RC + rótulos do RC e do PF, posicionados juntos para nunca colidirem
        name: NOMES[2], type: 'custom', z: 3, itemStyle: { color: COR_RC },
        encode: { x: 0, y: 1 }, tooltip: { show: false },
        data: itens.map((a, i) => [i, valido(a.rcU) ? a.rcU : 0]),
        renderItem: (params, api) => {
          const a = itens[params.dataIndex];
          const x = api.coord([params.dataIndex, 0])[0];
          const yDe = (v) => api.coord([params.dataIndex, v])[1]; // pixels: menor = mais alto
          const temPF = difPF(a) !== null;
          const temRC = valido(a.rcU);
          const H = tamanho + 4; // altura de uma linha de texto
          const yRcd = yDe(a.rcdU || 0);
          const topo = temPF ? yDe(a.pfU) : yRcd;
          let basePF = temPF ? topo - 4 : null; // base (parte de baixo) do texto do PF
          let baseRC = null;
          const filhos = [];
          if (temRC) {
            const yRC = yDe(a.rcU);
            baseRC = yRC - 5;
            if (yRC <= topo) {
              // traço acima da barra: se o PF encostar no traço, vai logo abaixo dele;
              // sem espaço ali (rótulo do RCD), sobe para cima do rótulo do RC
              if (temPF && basePF - H < yRC + 3) {
                if (yRC + 3 + H <= yRcd + 2) basePF = yRC + 3 + H;
                else basePF = baseRC - H - 2;
              }
            } else {
              // traço atravessa a barra: o rótulo do RC sobe para cima da barra (e do PF)
              baseRC = temPF ? basePF - H - 2 : topo - 4;
            }
            const w = api.size([1, 0])[0] * 0.7;
            filhos.push({ type: 'line', shape: { x1: x - w / 2, y1: yRC, x2: x + w / 2, y2: yRC }, style: { stroke: COR_RC, lineWidth: 3 } });
            filhos.push({ type: 'text', x, y: baseRC,
              style: { text: reais(a.rcU), fill: COR_RC, font: `bold ${tamanho + 1}px sans-serif`, textAlign: 'center', textVerticalAlign: 'bottom' } });
          }
          if (temPF) {
            filhos.push({ type: 'text', x, y: basePF,
              style: { text: rotulo(a.pfU), fill: '#3A3A3A', font: `${tamanho}px sans-serif`, textAlign: 'center', textVerticalAlign: 'bottom' } });
          }
          return { type: 'group', children: filhos };
        },
      },
    ],
  }, true);
  g.resize();

  // ----- tabela (mesmas colunas do gráfico) -----
  const concIdxTexto = idx.conc;
  const pct = (v) => percentual(v);
  const linhasTabela = [
    ['RCD (R$/UND)', (a) => reais(a.rcdU)],
    ['PF (R$/UND)', (a) => reais(a.pfU)],
    ['RC (R$/UND)', (a) => reais(a.rcU), 'v-rc'],
    ['Desc. Com.', (a) => pct(a.desc), ''],
    ['Margem PDV', (a) => pct(a.margem)],
    ['MKUP DIST', (a) => pct(a.mkup)],
    [`Index RC vs ${nomeCurto(idx)}`, (a) => (valido(a.indexRc) ? fmt0.format(a.indexRc) : '-'), 'v-index'],
    ['RC por dose', (a) => reais(a.rcDose), 'v-rc'],
    [`RC por ${concIdxTexto}`, (a) => reais(a.rcConc), 'v-rc'],
    [`UND ${periodo.curto} (mil)`, (a) => (a.und > 0 ? fmt1.format(a.und / 1000) : '-')],
  ];
  const cabecalho = `<thead><tr><th class="preco-rotulo">Apresentação</th>${itens.map((a) => `
      <th class="${a.ehIndex ? 'col-index' : ''}" title="${escaparHtml(a.apres)}">
        <b>${escaparHtml(nomeCurto(a).toUpperCase())}</b>
        <small>${escaparHtml([a.conc, a.forma, a.qtd].join(' · '))}</small>
      </th>`).join('')}</tr></thead>`;
  const corpo = '<tbody>' + linhasTabela.map(([rotulo, f, cls = '']) =>
    `<tr><td class="preco-rotulo ${cls}">${escaparHtml(rotulo)}</td>${itens.map((a) =>
      `<td class="${cls}${a.ehIndex ? ' col-index' : ''}">${f(a)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  $('tabela-preco').innerHTML = `<colgroup><col style="width:${LARGURA_ROTULO_PRECO}px">${itens.map(() => '<col>').join('')}</colgroup>` + cabecalho + corpo;

  $('preco-rodape').innerHTML = `Período: <b>${escaparHtml(periodo.longo)}</b>.
    Preço médio ponderado = soma do valor no período ÷ soma das unidades (UND) no período.
    ${total > itens.length ? `Mostrando ${itens.length} de ${total} apresentações.` : ''}`;
}

['preco-periodo', 'preco-ordem'].forEach((id) => $(id).addEventListener('change', atualizarPreco));
$('preco-topn').addEventListener('input', () => { clearTimeout(estado.tempoTopnPreco); estado.tempoTopnPreco = setTimeout(atualizarPreco, 300); });
window.addEventListener('resize', () => { if (estado.graficoPreco && estado.pagina === 'preco') { estado.graficoPreco.resize(); desenharPreco(); } });

// =====================================================================
// Aba Preço 2: evolução mensal do preço de um produto e MATs por apresentação
// =====================================================================
const COR_RCD_ESCURO = '#6B76A6';
const COR_DIF_CLARO = '#B9C0DA';
const COR_DESC = '#F2C94C';
const LARGURA_MES = 46; // px por mês no gráfico principal (acima disso, rolagem horizontal)

// "Produto (Sigla)" escolhido: compartilhado entre as abas Preço 2 e Preço 3
estado.produtoCompartilhado = null;
estado.p2 = { seletores: {}, graficos: {}, ocultas: new Set(), produtoUsado: null, dados: null };

function prepararPreco2() {
  const s = estado.p2.seletores;
  s.produto = criarSeletorPreco('dd-p2-produto', {
    unico: true, vazio: '(escolha)',
    aoMudar: () => {
      estado.produtoCompartilhado = [...s.produto.valores][0] || null;
      s.apres.valores = new Set(); // apresentações de outro produto não valem mais
      atualizarPreco2();
    },
  });
  s.apres = criarSeletorPreco('dd-p2-apres', { unico: false, vazio: 'Todas', limpar: true, aoMudar: atualizarPreco2 });
  // controle deslizante: base inteira por padrão
  const n = estado.meses.length;
  for (const id of ['p2-ini', 'p2-fim']) { $(id).min = 0; $(id).max = Math.max(0, n - 1); }
  $('p2-ini').value = 0;
  $('p2-fim').value = Math.max(0, n - 1);
  $('p2-tempo').hidden = !n;
  atualizarRotulosTempo();
  estado.p2.ocultas = new Set();
  estado.preco2Pendente = true;
}

function atualizarRotulosTempo() {
  const ini = Number($('p2-ini').value);
  const fim = Number($('p2-fim').value);
  $('p2-ini-txt').value = estado.meses[ini] || '';
  $('p2-fim-txt').value = estado.meses[fim] || '';
  // pinta o trecho escolhido do trilho
  const n = Math.max(1, estado.meses.length - 1);
  $('p2-trilho').style.background =
    `linear-gradient(90deg, #ccc ${ini / n * 100}%, var(--amarelo) ${ini / n * 100}%, var(--amarelo) ${fim / n * 100}%, #ccc ${fim / n * 100}%)`;
}

const exprProdutoCorp = `(d_produto || ' (' || sigla || ')')`;

async function atualizarPreco2() {
  estado.preco2Pendente = false;
  const s = estado.p2.seletores;
  const where = clausulaWhere(null);
  const e = (cond) => (where ? `${where} AND ${cond}` : `WHERE ${cond}`);

  // produtos (padrão: o de maior RCD MAT)
  const produtos = await consultar(`SELECT ${exprProdutoCorp} AS v, SUM(rcd_MAT0) AS r FROM fato ${where} GROUP BY 1`);
  s.produto.opcoes = produtos.map((l) => l.v).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  let produto = estado.produtoCompartilhado;
  if (!produto || !s.produto.opcoes.includes(produto)) {
    const maior = produtos.reduce((m, l) => (!m || (l.r || 0) > (m.r || 0) ? l : m), null);
    produto = maior ? maior.v : null;
    estado.produtoCompartilhado = produto;
  }
  s.produto.valores = new Set(produto ? [produto] : []);
  estado.p2.produtoUsado = produto;
  if (!produto) {
    s.produto.desenhar(); s.apres.opcoes = []; s.apres.desenhar();
    estado.p2.dados = null;
    $('kpis-p2').innerHTML = '';
    $('p2-aviso').textContent = 'Nenhum produto com os filtros atuais.';
    Object.values(estado.p2.graficos).forEach((g) => g.clear());
    return;
  }
  $('p2-aviso').textContent = '';
  const condProduto = `${exprProdutoCorp} = ${sqlTexto(produto)}`;

  // apresentações do produto (todas definem as cores fixas)
  const apres = await consultar(`SELECT DISTINCT d_apres AS v FROM fato ${e(condProduto)}`);
  const todas = apres.map((l) => l.v).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
  s.apres.opcoes = todas;
  for (const v of [...s.apres.valores]) if (!todas.includes(v)) s.apres.valores.delete(v);
  s.produto.desenhar();
  s.apres.desenhar();
  const cores = {};
  todas.forEach((v, i) => { cores[v] = CORES[i % CORES.length]; });

  const condApres = s.apres.valores.size
    ? `d_apres IN (${[...s.apres.valores].map(sqlTexto).join(', ')})` : 'TRUE';
  const whereSel = e(`${condProduto} AND ${condApres}`);

  // KPIs do produto (mesmos cards da página Gráfico e Tabela)
  atualizarKpis('MAT', e(condProduto), 'kpis-p2');

  // valores mensais somados das apresentações selecionadas
  const n = estado.meses.length;
  let mensal = [];
  if (n) {
    const somas = estado.meses.map((_, i) =>
      `SUM(rcd_m${i}) r${i}, SUM(und_m${i}) u${i}, SUM(rc_m${i}) c${i}, SUM(pf_m${i}) p${i}`).join(', ');
    const [l] = await consultar(`SELECT ${somas} FROM fato ${whereSel}`);
    mensal = estado.meses.map((mes, i) => ({ mes, rcd: l['r' + i], und: l['u' + i], rc: l['c' + i], pf: l['p' + i] }));
  }

  // MAT-4 … MAT por apresentação
  const somasMat = [0, 1, 2, 3, 4].map((k) =>
    `SUM(rcd_MAT${k}) r${k}, SUM(und_MAT${k}) u${k}, SUM(rc_MAT${k}) c${k}, SUM(pf_MAT${k}) p${k}`).join(', ');
  const porApres = await consultar(`SELECT d_apres AS apres, ${somasMat} FROM fato ${whereSel} GROUP BY 1`);
  porApres.sort((a, b) => todas.indexOf(a.apres) - todas.indexOf(b.apres));

  estado.p2.dados = { mensal, porApres, cores };
  desenharPreco2();
}

// preço médio ponderado: valor ÷ unidades (vazio quando não há venda)
const precoMedio = (valor, und) => (valido(valor) && valor !== 0 && und > 0 ? valor / und : null);
const descontoCom = (rcd, pf) => (valido(rcd) && valido(pf) && pf !== 0 ? 1 - rcd / pf : null);

function graficoP2(id) {
  if (!estado.p2.graficos[id]) estado.p2.graficos[id] = echarts.init($(id));
  return estado.p2.graficos[id];
}

function desenharPreco2() {
  const d = estado.p2.dados;
  if (!d) return;
  desenharMensalP2(d.mensal);
  desenharMatsP2(d.porApres, d.cores);
}

function desenharMensalP2(mensal) {
  if (!mensal.length) {
    $('p2-mensal-card').hidden = true;
    return;
  }
  $('p2-mensal-card').hidden = false;
  const ini = Number($('p2-ini').value);
  const fim = Number($('p2-fim').value);
  const meses = mensal.slice(ini, fim + 1).map((m) => {
    const rcdU = precoMedio(m.rcd, m.und);
    const rcU = precoMedio(m.rc, m.und);
    const pfU = precoMedio(m.pf, m.und);
    const dif = rcdU !== null && rcU !== null && rcU - rcdU > 0 ? rcU - rcdU : null;
    return { mes: m.mes, rcdU, rcU, pfU, dif, desc: rcdU !== null && pfU !== null ? 1 - rcdU / pfU : null };
  });

  // largura do gráfico: muitos meses => rolagem horizontal
  const caixa = $('p2-mensal-rolagem');
  const largura = Math.max(caixa.clientWidth, meses.length * LARGURA_MES + 120);
  $('p2-mensal').style.width = largura + 'px';
  const g = graficoP2('p2-mensal');
  g.resize();
  // barras ocupam até ~75% da altura; os pontos do desconto ficam numa faixa entre 80% e 92%
  const descs = meses.map((m) => m.desc).filter(valido);
  const lo = descs.length ? Math.min(...descs) : 0;
  const hi = descs.length ? Math.max(...descs) : 1;
  const faixa = Math.max(hi - lo, Math.abs(hi) * 0.05, 0.005);
  const minDesc = lo - 0.80 * (faixa / 0.12);
  const maxDesc = minDesc + faixa / 0.12;
  g.setOption({
    animation: false,
    legend: { top: 4, left: 10, data: ['RCD/UND', 'Dif RC-RCD', 'Desc. Com.'], textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const m = meses[ps[0].dataIndex];
        return `<b>${m.mes}</b><br>RCD/UND: ${reais(m.rcdU)}<br>PF/UND: ${reais(m.pfU)}<br>RC/UND: ${reais(m.rcU)}<br>Dif RC-RCD: ${reais(m.rcU !== null && m.rcdU !== null ? m.rcU - m.rcdU : null)}<br>Desc. Com.: ${percentual(m.desc)}`;
      },
    },
    grid: { left: 60, right: 60, top: 44, bottom: 50 },
    labelLayout: { hideOverlap: true },
    xAxis: { type: 'category', data: meses.map((m) => m.mes), axisLabel: { rotate: 90, fontSize: 10, interval: 0 } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: (v) => 'R$ ' + fmt0.format(v) }, max: (v) => v.max * 1.35 },
      {
        type: 'value', min: minDesc, max: maxDesc, splitLine: { show: false },
        axisLabel: { formatter: (v) => (v < 0 ? '' : fmt1.format(v * 100) + '%') },
      },
    ],
    series: [
      {
        name: 'RCD/UND', type: 'bar', stack: 'p2', barMaxWidth: 34, itemStyle: { color: COR_RCD_ESCURO },
        // sem a parte de cima, o valor vai no topo do próprio RCD
        data: meses.map((m) => ({ value: m.rcdU, label: { show: m.dif === null && m.rcdU !== null } })),
        label: { position: 'top', fontSize: 9, color: '#2B2B2B', formatter: (p) => fmt1.format(p.value) },
      },
      {
        name: 'Dif RC-RCD', type: 'bar', stack: 'p2', itemStyle: { color: COR_DIF_CLARO },
        data: meses.map((m) => m.dif),
        label: { show: true, position: 'top', fontSize: 9, color: '#2B2B2B', formatter: (p) => fmt1.format(meses[p.dataIndex].rcU) },
      },
      {
        name: 'Desc. Com.', type: 'scatter', yAxisIndex: 1, symbolSize: 9,
        itemStyle: { color: COR_DESC, borderColor: '#9A7B10', borderWidth: 1 },
        data: meses.map((m) => m.desc),
        label: { show: true, position: 'top', fontSize: 9, color: '#7A5F00', formatter: (p) => percentual(p.value) },
      },
    ],
  }, true);
}

function desenharMatsP2(porApres, cores) {
  const rotulos = ['MAT-4', 'MAT-3', 'MAT-2', 'MAT-1', 'MAT'];
  const ks = [4, 3, 2, 1, 0];
  const calc = {
    'p2-pf': (a, k) => precoMedio(a['p' + k], a['u' + k]),
    'p2-rcd': (a, k) => precoMedio(a['r' + k], a['u' + k]),
    'p2-rc': (a, k) => precoMedio(a['c' + k], a['u' + k]),
    'p2-desc': (a, k) => descontoCom(precoMedio(a['r' + k], a['u' + k]), precoMedio(a['p' + k], a['u' + k])),
  };
  const selecionadas = Object.fromEntries(porApres.map((a) => [a.apres, !estado.p2.ocultas.has(a.apres)]));
  for (const id of Object.keys(calc)) {
    const ehPct = id === 'p2-desc';
    const fmt = (v) => (ehPct ? percentual(v) : fmt2.format(v));
    const g = graficoP2(id);
    g.setOption({
      animation: false,
      legend: { show: false, data: porApres.map((a) => a.apres), selected: selecionadas },
      tooltip: { trigger: 'item', formatter: (p) => `${escaparHtml(p.seriesName)}<br>${p.name}: <b>${ehPct ? percentual(p.value) : reais(p.value)}</b>` },
      grid: { left: 52, right: 14, top: 22, bottom: 26 },
      labelLayout: { hideOverlap: true },
      xAxis: { type: 'category', data: rotulos, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { fontSize: 10, formatter: (v) => (ehPct ? fmt0.format(v * 100) + '%' : fmt0.format(v)) },
      },
      series: porApres.map((a) => ({
        name: a.apres, type: 'line', step: 'middle', connectNulls: false,
        symbol: 'rect', symbolSize: 7,
        itemStyle: { color: cores[a.apres] },
        lineStyle: { type: 'dotted', width: 2, color: cores[a.apres] },
        data: ks.map((k) => calc[id](a, k)),
        label: { show: true, position: 'top', fontSize: 9, color: cores[a.apres], formatter: (p) => fmt(p.value) },
      })),
    }, true);
    g.resize();
  }
  // legenda compartilhada (clique oculta/mostra a apresentação nos quatro gráficos)
  $('p2-legenda').innerHTML = porApres.map((a, i) =>
    `<span class="p2-leg-item${estado.p2.ocultas.has(a.apres) ? ' oculta' : ''}" data-i="${i}" title="${escaparHtml(a.apres)}">
      <span class="leg-cor" style="background:${cores[a.apres]}"></span><span class="leg-nome">${escaparHtml(a.apres)}</span></span>`).join('');
  $('p2-legenda')._apres = porApres.map((a) => a.apres);
}

$('p2-legenda').addEventListener('click', (e) => {
  const item = e.target.closest('.p2-leg-item');
  if (!item) return;
  const nome = $('p2-legenda')._apres[Number(item.dataset.i)];
  if (estado.p2.ocultas.has(nome)) estado.p2.ocultas.delete(nome); else estado.p2.ocultas.add(nome);
  item.classList.toggle('oculta', estado.p2.ocultas.has(nome));
  for (const id of ['p2-pf', 'p2-rcd', 'p2-rc', 'p2-desc']) {
    estado.p2.graficos[id].dispatchAction({ type: 'legendToggleSelect', name: nome });
  }
});

// alças do período: a inicial nunca passa a final
['p2-ini', 'p2-fim'].forEach((id) => $(id).addEventListener('input', () => {
  const ini = $('p2-ini');
  const fim = $('p2-fim');
  if (Number(ini.value) > Number(fim.value)) {
    if (id === 'p2-ini') ini.value = fim.value; else fim.value = ini.value;
  }
  atualizarRotulosTempo();
  if (estado.p2.dados) desenharMensalP2(estado.p2.dados.mensal);
}));

window.addEventListener('resize', () => {
  if (estado.pagina === 'preco2') desenharPreco2();
});
