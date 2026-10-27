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
  '#C25B8C', '#5B8FD9', '#B8A07E', '#3D4466', '#D98FB0'];
const COR_OUTROS = '#BDBDBD';
const MAX_SERIES = 10;          // grupos no gráfico antes de virar "Outros"
const MAX_OPCOES_VISIVEIS = 300; // itens mostrados por card de filtro
const MAX_LINHAS_TABELA = 1000;

// ---------------------------------------------------------------------
// Estado da aplicação
// ---------------------------------------------------------------------
const estado = {
  db: null,
  conn: null,
  dims: [],            // dimensões presentes no arquivo
  filtros: {},         // key -> { modo: 'todos' | 'inc' | 'exc', valores: Set }
  opcoes: {},          // key -> lista de valores disponíveis (cascata)
  busca: {},           // key -> texto de busca
  pagina: 'filtros',
  analisePendente: true,
  ordem: { col: 'r0', desc: true },
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

    mostrarProgresso('Processando os números (pode levar alguns segundos em arquivos grandes)…', 0.65);
    await estado.conn.query(`CREATE OR REPLACE TABLE fato AS
      SELECT ${selects.join(',\n')}
      FROM ${leitura}
      WHERE ${med} = 'RCD' OR ${ehUnd}
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
    estado.filtros[d.key] = { modo: 'todos', valores: new Set() };
    estado.busca[d.key] = '';
    $('filtros-' + d.secao).appendChild(criarCardFiltro(d));
  }
  // seletores da página 2
  const opcoesDim = estado.dims.map((d) => `<option value="${d.key}">${escaparHtml(d.rotulo)}</option>`).join('');
  $('sel-grafico').innerHTML = opcoesDim;
  $('sel-tabela').innerHTML = opcoesDim + '<option value="__prodcorp">Produto Corp</option>';
  if (estado.dims.some((d) => d.key === 'forma')) $('sel-grafico').value = 'forma';
  if (estado.dims.some((d) => d.key === 'produto')) $('sel-tabela').value = '__prodcorp';
  estado.ordem = { col: 'r0', desc: true };
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
  if (estado.pagina === 'analise') await atualizarAnalise();
}

function zerarFiltros() {
  for (const d of estado.dims) {
    estado.filtros[d.key] = { modo: 'todos', valores: new Set() };
    estado.busca[d.key] = '';
    const card = $('card-' + d.key);
    if (card) card.querySelector('.cf-busca').value = '';
  }
  aoMudarFiltro();
}

// ---------------------------------------------------------------------
// Página 2: KPIs, gráficos e tabela
// ---------------------------------------------------------------------
function trocarPagina(pagina) {
  estado.pagina = pagina;
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.pagina === pagina));
  $('pagina-filtros').hidden = pagina !== 'filtros';
  $('pagina-analise').hidden = pagina !== 'analise';
  if (pagina === 'analise') {
    if (estado.analisePendente) atualizarAnalise();
    else Object.values(estado.graficos).forEach((g) => g.resize());
  }
}

async function atualizarAnalise() {
  estado.analisePendente = false;
  const tempo = $('sel-tempo').value;
  const where = clausulaWhere(null);
  await Promise.all([
    atualizarKpis(tempo, where),
    atualizarGraficos(tempo, where),
    atualizarTabela(tempo, where),
  ]);
}

async function atualizarKpis(T, where) {
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
  $('kpis').innerHTML = cards.map(([cls, rotulo, valor]) =>
    `<div class="kpi ${cls}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div></div>`).join('');
}

async function atualizarGraficos(T, where) {
  const key = $('sel-grafico').value;
  const somas = [0, 1, 2, 3, 4].map((k) => `SUM(rcd_${T}${k}) r${k}, SUM(und_${T}${k}) u${k}`).join(', ');
  const linhas = await consultar(`SELECT d_${key} AS g, ${somas} FROM fato ${where} GROUP BY 1`);

  // Os 10 maiores (pelo RCD do período atual) ganham cor própria; o resto vira "Outros"
  linhas.sort((a, b) => (b.r0 || 0) - (a.r0 || 0) || (b.u0 || 0) - (a.u0 || 0));
  const principais = linhas.slice(0, MAX_SERIES);
  const resto = linhas.slice(MAX_SERIES);
  const grupos = principais.map((l, i) => ({ nome: l.g, linha: l, cor: CORES[i % CORES.length] }));
  if (resto.length) {
    const soma = { g: 'Outros' };
    for (const p of ['r', 'u']) for (let k = 0; k <= 4; k++) soma[p + k] = resto.reduce((s, l) => s + (l[p + k] || 0), 0);
    grupos.push({ nome: 'Outros', linha: soma, cor: COR_OUTROS });
  }

  const eixoX = [`${T}-4`, `${T}-3`, `${T}-2`, `${T}-1`, T];
  desenharGrafico('grafico-rcd', grupos, 'r', eixoX);
  desenharGrafico('grafico-und', grupos, 'u', eixoX);
}

function desenharGrafico(id, grupos, prefixo, eixoX) {
  const el = $(id);
  if (!estado.graficos[id]) estado.graficos[id] = echarts.init(el);
  const grafico = estado.graficos[id];

  const valores = grupos.map((g) => [4, 3, 2, 1, 0].map((k) => g.linha[prefixo + k] || 0));
  const totais = [0, 1, 2, 3, 4].map((i) => valores.reduce((s, v) => s + v[i], 0));

  const series = grupos.map((g, gi) => ({
    name: g.nome,
    type: 'bar',
    stack: 'total',
    itemStyle: { color: g.cor },
    barMaxWidth: 70,
    emphasis: { focus: 'series' },
    data: valores[gi].map((v, i) => ({
      value: v,
      label: { show: totais[i] > 0 && v / totais[i] >= 0.08 },
    })),
    label: {
      position: 'inside',
      color: '#fff',
      fontSize: 10,
      textBorderColor: 'rgba(0,0,0,.45)',
      textBorderWidth: 2,
      formatter: (p) => `${abreviar(p.value)}\n${percentual(p.value / totais[p.dataIndex])}`,
    },
  }));
  // série invisível só para escrever o total acima de cada barra
  series.push({
    name: '__total', type: 'line', data: totais, symbol: 'none', silent: true,
    lineStyle: { opacity: 0 }, tooltip: { show: false },
    label: { show: true, position: 'top', fontWeight: 'bold', color: '#333', formatter: (p) => abreviar(p.value) },
  });

  grafico.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${escaparHtml(p.seriesName)}<br>${p.name}: <b>${inteiro(p.value)}</b> (${percentual(p.value / totais[p.dataIndex])})`,
    },
    legend: {
      type: 'scroll', orient: 'vertical', right: 6, top: 'middle',
      data: grupos.map((g) => g.nome),
      formatter: (n) => (n.length > 24 ? n.slice(0, 23) + '…' : n),
      textStyle: { fontSize: 11 },
    },
    grid: { left: 50, right: 170, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: eixoX },
    yAxis: { type: 'value', max: (v) => v.max * 1.12, axisLabel: { formatter: abreviar } },
    series,
  }, true);
  grafico.resize();
}

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

let ultimaTabela = null;
async function atualizarTabela(T, where) {
  const key = $('sel-tabela').value;
  const expr = key === '__prodcorp' ? `d_produto || ' (' || sigla || ')'` : `d_${key}`;
  const rotulo = key === '__prodcorp' ? 'Produto Corp' : estado.dims.find((d) => d.key === key).rotulo;
  const linhas = await consultar(`SELECT ${expr} AS nome,
      SUM(rcd_${T}0) r0, SUM(rcd_${T}1) r1, SUM(rcd_${T}4) r4,
      SUM(und_${T}0) u0, SUM(und_${T}1) u1, SUM(und_${T}4) u4,
      SUM(dos_${T}0) d0
    FROM fato ${where} GROUP BY 1`);

  const soma = (c) => linhas.reduce((s, l) => s + (l[c] || 0), 0);
  const total = { nome: 'Total' };
  for (const c of ['r0', 'r1', 'r4', 'u0', 'u1', 'u4', 'd0']) total[c] = soma(c);
  const completar = (l) => {
    l.msR = divisao(l.r0, total.r0);
    l.msU = divisao(l.u0, total.u0);
    l.msD = divisao(l.d0, total.d0);
    l.evR = evolucao(l.r0, l.r1);
    l.cgR = cagr(l.r0, l.r4);
    l.evU = evolucao(l.u0, l.u1);
    l.cgU = cagr(l.u0, l.u4);
    return l;
  };
  linhas.forEach(completar);
  completar(total);
  ultimaTabela = { linhas, total, rotulo, T };
  desenharTabela();
}

function desenharTabela() {
  if (!ultimaTabela) return;
  const { linhas, total, rotulo, T } = ultimaTabela;
  const colunas = COLUNAS_TABELA(T);
  const { col, desc } = estado.ordem;

  const ordenadas = [...linhas].sort((a, b) => {
    if (col === 'nome') return desc ? String(b.nome).localeCompare(a.nome, 'pt-BR') : String(a.nome).localeCompare(b.nome, 'pt-BR');
    const va = valido(a[col]) ? a[col] : -Infinity;
    const vb = valido(b[col]) ? b[col] : -Infinity;
    return desc ? vb - va : va - vb;
  });
  const visiveis = ordenadas.slice(0, MAX_LINHAS_TABELA);

  const maximos = {};
  for (const c of colunas) if (c.cor) maximos[c.id] = Math.max(0, ...linhas.map((l) => (valido(l[c.id]) ? l[c.id] : 0)));

  const celula = (l, c, comBarra) => {
    const v = l[c.id];
    const texto = c.tipo === 'num' ? inteiro(v) : percentual(v);
    const classe = c.tipo === 'var' ? classeSinal(v) : '';
    if (comBarra && c.cor && maximos[c.id] > 0 && valido(v) && v > 0) {
      const largura = Math.min(100, (v / maximos[c.id]) * 100);
      return `<td class="cel-barra ${classe}"><div class="barra" style="width:${largura}%;background:${c.cor}"></div><span>${texto}</span></td>`;
    }
    return `<td class="${classe}">${texto}</td>`;
  };

  const seta = (id) => (col === id ? (desc ? ' ▼' : ' ▲') : '');
  const cabecalho = `<thead><tr>
      <th data-col="nome" class="${col === 'nome' ? 'ordenada' : ''}">${escaparHtml(rotulo)}${seta('nome')}</th>
      ${colunas.map((c) => `<th data-col="${c.id}" class="${col === c.id ? 'ordenada' : ''}">${c.titulo}${seta(c.id)}</th>`).join('')}
    </tr></thead>`;
  const corpo = '<tbody>' + visiveis.map((l) =>
    `<tr><td>${escaparHtml(l.nome)}</td>${colunas.map((c) => celula(l, c, true)).join('')}</tr>`).join('') + '</tbody>';
  const rodape = `<tfoot><tr><td>Total</td>${colunas.map((c) => celula(total, c, false)).join('')}</tr></tfoot>`;

  $('tabela').innerHTML = cabecalho + corpo + rodape;
  $('nota-tabela').textContent = linhas.length > visiveis.length
    ? `Mostrando as primeiras ${inteiro(visiveis.length)} de ${inteiro(linhas.length)} linhas (o Total considera todas).`
    : '';
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
$('sel-grafico').addEventListener('change', () => atualizarGraficos($('sel-tempo').value, clausulaWhere(null)));
$('sel-tabela').addEventListener('change', () => {
  estado.ordem = { col: 'r0', desc: true };
  atualizarTabela($('sel-tempo').value, clausulaWhere(null));
});
$('tabela').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  const col = th.dataset.col;
  estado.ordem = estado.ordem.col === col ? { col, desc: !estado.ordem.desc } : { col, desc: col !== 'nome' };
  desenharTabela();
});
window.addEventListener('resize', () => Object.values(estado.graficos).forEach((g) => g.resize()));
