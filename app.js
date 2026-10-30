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
  { key: 'apres', rotulo: 'Apresentação', coluna: 'Apresentacao Desc Longa', secao: 'PRODUTO' },
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
const MAX_OPCOES_VISIVEIS = 300; // itens mostrados nas caixas suspensas das abas de preço
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
    // Com taxonomia (navegador ou repositório), Categoria 01–05 existem mesmo sem as colunas na base.
    await estado.promessaTax;
    estado.dims = [];
    const selects = [];
    for (const d of DIMENSOES) {
      const col = achar(d.coluna);
      if (col || (estado.tax.mapa && NIVEIS_TAX.includes(d.key))) estado.dims.push(d);
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
    // mês de lançamento (cadastro) da apresentação, como índice de mês (ano × 12 + mês − 1)
    const colLanc = achar('Lancamento Apresentacao');
    selects.push(colLanc ? `${exprMesLancamento(sqlColuna(colLanc))} AS lanc_cad` : 'CAST(NULL AS INTEGER) AS lanc_cad');

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
    estado.mesesObj = meses;

    mostrarProgresso('Processando os números (pode levar alguns segundos em arquivos grandes)…', 0.65);
    await estado.conn.query(`CREATE OR REPLACE TABLE fato AS
      SELECT ${selects.join(',\n')}
      FROM ${leitura}
      WHERE ${med} IN ('RCD', 'RCON', 'RPF') OR ${ehUnd}
      GROUP BY ALL`);
    // libera a memória do arquivo bruto: a tabela já foi criada
    await estado.db.dropFile(nomeInterno);
    estado.arquivoAtual = null;

    // número de cada linha + cópia do RC original (para ligar/desligar a correção Infoprice)
    // + colunas das ELs (SKUs virtuais) e do MAT+1 (meses 13–24 das ELs)
    const colsMatp = ['rcd', 'und', 'dos', 'rc', 'pf'].map((m) => `CAST(NULL AS DOUBLE) AS ${m}_MATP`);
    const colsMesP = Array.from({ length: 12 }, (_, j) => ['rcd', 'und', 'rc', 'pf'].map((m) => `CAST(NULL AS DOUBLE) AS ${m}_p${j}`)).flat();
    await estado.conn.query(`CREATE OR REPLACE TABLE fato AS SELECT row_number() OVER () AS rid, *,
      FALSE AS is_el, FALSE AS el_sempre, CAST(NULL AS VARCHAR) AS el_id, ${[...colsMatp, ...colsMesP].join(', ')} FROM fato`);
    estado.colunasRc = [...Object.keys(periodos).map((p) => `rc_${p}`), ...meses.map((_, i) => `rc_m${i}`)];
    await estado.conn.query(`CREATE OR REPLACE TABLE rc_orig AS SELECT rid, ${estado.colunasRc.join(', ')} FROM fato`);
    // CLASSIF. GERAL da base (a taxonomia substitui; daqui dá para voltar a elas)
    await estado.conn.query(`CREATE OR REPLACE TABLE cat_orig AS SELECT rid, ${NIVEIS_TAX.map((k, i) => `d_${k} AS c${i + 1}`).join(', ')} FROM fato`);
    await aplicarTaxonomia();
    estado.periodosRc = Object.keys(periodos);

    const [{ n }] = await consultar('SELECT count(*) AS n FROM fato');
    if (!n) throw new Error('Nenhuma linha com Medida "RCD" ou "Unidades" foi encontrada no arquivo.');

    mostrarProgresso('Montando os filtros…', 0.9);
    let info = `${arquivo.name} · ${inteiro(n)} apresentações · ${codificacao}`;
    if (meses.length) info += ` · Período: ${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}`;
    if (avisos.length) info += ` · ⚠ sem dados para ${avisos.join(', ')}`;
    $('info-arquivo').textContent = info;
    estado.nomeArquivo = arquivo.name;

    prepararInterface();
    // arquivos Infoprice já carregados valem também para a nova base
    if (estado.ip.arquivos.length) await reprocessarInfoprice();
    estado.cacheValoresEL = {};
    await reconstruirEL();
    await carregarLinhasCategorizacao();
    estado.tax.antes = new Map();
    estado.tax.selecionadas = new Set();
    await atualizarTudo();
    window.dispatchEvent(new Event('base-carregada'));
    mostrarProgresso('Pronto!', 1);
    $('tela-inicial').hidden = true;
    $('app').hidden = false;
    // abre na última página usada neste navegador
    let ultima = 'filtros';
    try { ultima = localStorage.getItem(CHAVE_PAGINA) || 'filtros'; } catch { /* sem armazenamento */ }
    trocarPagina(ultima);
  } catch (e) {
    console.error(e);
    mostrarErro('Não foi possível carregar o arquivo.\n\n' + (e && e.message ? e.message : e));
  } finally {
    bloquearBotoes(false);
    $('input-arquivo').value = '';
  }
}

// Data de lançamento: número de série do Excel (45778 = 01/05/2025), ano (2017) ou texto dd/mm/aaaa / aaaa-mm-dd
function exprMesLancamento(col) {
  const data = `COALESCE(
    CASE WHEN num(${col}) BETWEEN 10000 AND 80000 THEN DATE '1899-12-30' + CAST(floor(num(${col})) AS INTEGER) END,
    CASE WHEN num(${col}) BETWEEN 1900 AND 2100 THEN make_date(CAST(num(${col}) AS INTEGER), 1, 1) END,
    CAST(try_strptime(trim(${col}), '%d/%m/%Y') AS DATE),
    CAST(try_strptime(trim(${col}), '%Y-%m-%d') AS DATE))`;
  return `CAST(year(${data}) * 12 + month(${data}) - 1 AS INTEGER)`;
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
  if (!partes.length) return '';
  // ELs marcadas "Incluir sempre no mercado filtrado" passam por qualquer filtro
  if (elLigado()) return `WHERE ((${partes.join(' AND ')}) OR (is_el AND el_sempre))`;
  return 'WHERE ' + partes.join(' AND ');
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
  prepararLanc();
  prepararPareto();
  prepararPortfolio();
  prepararPreco();
  prepararPreco2();
  prepararPreco3();
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

  // busca com pequena espera, para não refazer a lista a cada letra digitada
  let espera = null;
  busca.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(() => { estado.busca[d.key] = busca.value; lista.scrollTop = 0; renderizarLista(d.key); }, 120);
  });
  // lista virtual: ao rolar, só as linhas visíveis são desenhadas
  lista.addEventListener('scroll', () => {
    if (card._quadro) return;
    card._quadro = requestAnimationFrame(() => { card._quadro = null; desenharJanelaLista(card, d.key); });
  });

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
    const valor = card._filtradas[Number(caixa.dataset.i)];
    marcar(d.key, [valor], caixa.checked);
    aoMudarFiltro();
  });
  return card;
}

// busca em qualquer parte do texto, ignorando acentos, maiúsculas, espaços e pontuação
// (ex.: "10000FCC X 30" ou "menta"); os textos já normalizados ficam guardados
function opcoesFiltradas(key) {
  const texto = normalizar(estado.busca[key] || '');
  const todas = estado.opcoes[key] || [];
  if (!texto) return todas;
  if (!estado.opcoesNorm || estado.opcoesNorm[key]?.origem !== todas) {
    estado.opcoesNorm = estado.opcoesNorm || {};
    estado.opcoesNorm[key] = { origem: todas, norm: todas.map(normalizar) };
  }
  const norm = estado.opcoesNorm[key].norm;
  return todas.filter((_, i) => norm[i].includes(texto));
}

const ALTURA_LINHA_FILTRO = 22; // px de cada linha da lista (fixa, para a lista virtual)

function renderizarLista(key) {
  const card = $('card-' + key);
  if (!card) return;
  const f = estado.filtros[key];
  const filtradas = opcoesFiltradas(key);
  card._filtradas = filtradas;
  const lista = card.querySelector('.cf-lista');
  if (!filtradas.length) {
    lista.innerHTML = '<div class="cf-aviso">Nenhuma opção.</div>';
  } else {
    if (!lista.querySelector('.cf-espaco')) lista.innerHTML = '<div class="cf-espaco"><div class="cf-janela"></div></div>';
    lista.querySelector('.cf-espaco').style.height = filtradas.length * ALTURA_LINHA_FILTRO + 'px';
    desenharJanelaLista(card, key);
  }

  const tudo = card.querySelector('.cf-tudo input');
  const marcados = filtradas.filter((v) => estaMarcado(f, v)).length;
  tudo.checked = filtradas.length > 0 && marcados === filtradas.length;
  tudo.indeterminate = marcados > 0 && marcados < filtradas.length;
  card.classList.toggle('com-filtro', filtroAtivo(f));
}

// desenha só as linhas que aparecem na área visível (mais uma margem)
function desenharJanelaLista(card, key) {
  const lista = card.querySelector('.cf-lista');
  const janela = lista.querySelector('.cf-janela');
  const filtradas = card._filtradas || [];
  if (!janela) return;
  const f = estado.filtros[key];
  const inicio = Math.max(0, Math.floor(lista.scrollTop / ALTURA_LINHA_FILTRO) - 10);
  const fim = Math.min(filtradas.length, inicio + Math.ceil(lista.clientHeight / ALTURA_LINHA_FILTRO) + 20);
  janela.style.transform = `translateY(${inicio * ALTURA_LINHA_FILTRO}px)`;
  let html = '';
  for (let i = inicio; i < fim; i++) {
    const v = filtradas[i];
    html += `<label title="${escaparHtml(v)}"><input type="checkbox" data-i="${i}" ${estaMarcado(f, v) ? 'checked' : ''}><span>${escaparHtml(v)}</span></label>`;
  }
  janela.innerHTML = html;
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
  document.querySelectorAll('.contador-filtros').forEach((s) => { s.textContent = ativos.length ? ativos.length : ''; });
  $('resumo-filtros').textContent = ativos.length
    ? 'Filtros: ' + ativos.map((d) => d.rotulo).join(', ')
    : 'Sem filtros aplicados';

  await calcularSugestaoProj();
  estado.analisePendente = true;
  estado.precoPendente = true;
  if (estado.pagina === 'analise') await atualizarAnalise();
  estado.lancPendente = true;
  estado.paretoPendente = true;
  if (estado.pagina === 'pareto') await atualizarPareto();
  estado.portPendente = true;
  if (estado.pagina === 'port') await atualizarPortfolio();
  if (estado.pagina === 'lanc') await atualizarLanc();
  if (estado.pagina === 'preco') await atualizarPreco();
  estado.preco2Pendente = true;
  if (estado.pagina === 'preco2') await atualizarPreco2();
  estado.preco3Pendente = true;
  if (estado.pagina === 'preco3') await atualizarPreco3();
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

function montarSuspenso(id, lista, opcoes, aoMudar, rotulo = rotuloDim) {
  const el = $(id);
  el.innerHTML = `
    <button type="button" class="dd-botao"><span class="dd-texto"></span><span class="dd-seta">▾</span></button>
    <div class="dd-painel" hidden>
      <input type="search" class="dd-busca" placeholder="Pesquisar">
      <div class="dd-lista"></div>
      <div class="dd-rodape"><button type="button" class="dd-limpar" disabled>✕ Limpar filtro</button></div>
    </div>`;
  const botao = el.querySelector('.dd-botao');
  const limpar = el.querySelector('.dd-limpar');
  const painel = el.querySelector('.dd-painel');
  const busca = el.querySelector('.dd-busca');
  const listaEl = el.querySelector('.dd-lista');
  let temporizadorDd = null;

  const desenhar = () => {
    el.querySelector('.dd-texto').textContent = lista.length === 0 ? '(nenhum)'
      : lista.length === 1 ? rotulo(lista[0]) : 'Seleções múltiplas';
    limpar.disabled = lista.length === 0;
    const texto = normalizar(busca.value);
    listaEl.innerHTML = opcoes
      .filter((k) => !texto || normalizar(rotulo(k)).includes(texto))
      .map((k) => {
        const pos = lista.indexOf(k);
        return `<div class="dd-item${pos >= 0 ? ' marcado' : ''}" data-k="${k}">
          <span class="dd-caixa"></span><span class="dd-nome">${escaparHtml(rotulo(k))}</span>
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
  // "Limpar filtro": desmarca só esta caixa; a lista continua aberta
  limpar.onclick = () => {
    if (!lista.length) return;
    lista.splice(0, lista.length);
    desenhar();
    clearTimeout(temporizadorDd);
    aoMudar();
  };
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
// campo = valor usado no ranking (padrão: RCD do período)
function aplicarExibicao(itens, exib = estado.exib, campo = 'r0') {
  const { topN, outros, auto80 } = exib;
  const ordenados = [...itens].sort((a, b) => (b[campo] || 0) - (a[campo] || 0));
  let n = ordenados.length;
  let agrupar = false;
  if (auto80) {
    const total = ordenados.reduce((s, i) => s + Math.max(0, i[campo] || 0), 0);
    if (total > 0) {
      let acumulado = 0;
      n = 0;
      while (n < ordenados.length && acumulado < 0.8 * total) { acumulado += Math.max(0, ordenados[n][campo] || 0); n++; }
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

async function trocarPagina(pagina) {
  if (!PAGINAS.some(([p]) => p === pagina)) pagina = 'filtros';
  // edição da EL ainda esperando: grava agora e espera a base ser atualizada
  if (window.estudosEL) window.estudosEL.descarregar();
  if (estado.promessaEL) await estado.promessaEL;
  estado.pagina = pagina;
  try { localStorage.setItem(CHAVE_PAGINA, pagina); } catch { /* sem armazenamento */ }
  marcarMenu(pagina);
  instalarCapturas(); // páginas/cards novos ganham o botão automaticamente
  $('pagina-filtros').hidden = pagina !== 'filtros';
  $('pagina-cat').hidden = pagina !== 'cat';
  if (pagina === 'cat') desenharCategorizacao();
  $('pagina-analise').hidden = pagina !== 'analise';
  $('pagina-lanc').hidden = pagina !== 'lanc';
  $('pagina-pareto').hidden = pagina !== 'pareto';
  $('pagina-port').hidden = pagina !== 'port';
  $('pagina-preco').hidden = pagina !== 'preco';
  $('pagina-preco2').hidden = pagina !== 'preco2';
  $('pagina-preco3').hidden = pagina !== 'preco3';
  $('pagina-el').hidden = pagina !== 'el';
  $('pagina-elcomp').hidden = pagina !== 'elcomp';
  if (pagina === 'elcomp' && window.compilado) window.compilado.mostrar();
  if (pagina === 'analise') {
    if (estado.analisePendente) atualizarAnalise();
    else Object.values(estado.graficos).forEach((g) => g.resize());
  }
  if (pagina === 'port' && estado.portPendente) atualizarPortfolio();
  if (pagina === 'pareto') {
    if (estado.paretoPendente) atualizarPareto();
    else desenharGraficoPareto();
  }
  if (pagina === 'lanc') {
    if (estado.lancPendente) atualizarLanc();
    else desenharLancTudo();
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
  if (pagina === 'preco3') {
    if (estado.preco3Pendente || estado.p3.produtoUsado !== estado.produtoCompartilhado) atualizarPreco3();
    else desenharPreco3();
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
  if (T === 'MAT' && elLigado()) {
    const [p] = await consultar(`SELECT SUM(${exprMATP('rcd')}) r, SUM(${exprMATP('und')}) u FROM fato ${where}`);
    cards.splice(3, 0, ['kpi-rcd kpi-proj', 'RCD MAT+1 (proj.)', `${abreviar(p.r)} <small>${percentual(evolucao(p.r, k.r0))}</small>`]);
    cards.splice(7, 0, ['kpi-und kpi-proj', 'UND MAT+1 (proj.)', `${abreviar(p.u)} <small>${percentual(evolucao(p.u, k.u0))}</small>`]);
  }
  $(alvo).innerHTML = cards.map(([cls, rotulo, valor]) =>
    `<div class="kpi ${cls}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div></div>`).join('');
}

// ----- Gráficos -----
let ultimoGrafico = null;

// Colunas e rótulos do eixo X conforme o Tempo
function periodosGrafico() {
  const tempo = $('sel-tempo').value;
  const projetado = new Set();
  if (tempo === 'MES') {
    const rotulos = [...estado.meses];
    const colunas = estado.meses.map((_, i) => `m${i}`);
    // MAT+1 mês a mês (marcados com *)
    if (elLigado()) rotulosProjetados().forEach((r, j) => { projetado.add(rotulos.length); rotulos.push(r + '*'); colunas.push(`p${j}`); });
    return { mes: true, rotulos, colunas, projetado, atual: estado.meses.length - 1 };
  }
  const rotulos = [`${tempo}-4`, `${tempo}-3`, `${tempo}-2`, `${tempo}-1`, tempo];
  const colunas = [4, 3, 2, 1, 0].map((k) => `${tempo}${k}`);
  if (elLigado() && tempo === 'MAT') { projetado.add(5); rotulos.push('MAT+1'); colunas.push('MATP'); }
  return { mes: false, rotulos, colunas, projetado, atual: 4 };
}

async function atualizarGraficos() {
  const dims = estado.dimsGrafico;
  const per = periodosGrafico();
  const grupo = dims.length ? `concat_ws(' | ', ${dims.map(exprDim).join(', ')})` : `'Total'`;
  const somas = per.colunas.map((c, i) => `SUM(${colExpr('rcd', c)}) r_${i}, SUM(${colExpr('und', c)}) u_${i}`).join(', ');
  const linhas = await consultar(`SELECT ${grupo} AS g, ${somas}, bool_or(is_el) AS el FROM fato ${whereAnalise()} GROUP BY 1`);
  for (const l of linhas) l.r0 = l['r_' + per.atual]; // ranking pelo RCD do período atual (não o projetado)
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
  if (per.projetado.size) nota += (nota ? ' ' : '') + (per.mes ? '* meses projetados (MAT+1).' : 'MAT+1 = projetado (hachurado).');
  $('nota-grafico').textContent = nota;
}

// Legenda única, compartilhada pelos dois gráficos (já vem ordenada pelo RCD, "Outros" no fim)
function desenharLegenda(grupos, estatica = false) {
  $('legenda')._estatica = estatica;
  $('legenda').innerHTML = grupos.map((g, i) =>
    `<div class="leg-item${estatica ? ' estatica' : ''}${!estatica && estado.ocultas.has(g.nome) ? ' oculta' : ''}" data-i="${i}" title="${escaparHtml(g.nome)}">
      <span class="leg-cor" style="background:${g.cor}"></span><span class="leg-nome">${escaparHtml(g.nome)}</span>${g.linha && g.linha.el ? '<span class="tag-el">EL</span>' : ''}
    </div>`).join('');
  $('legenda')._grupos = grupos;
}

function alternarSerie(nome) {
  if (estado.ocultas.has(nome)) estado.ocultas.delete(nome); else estado.ocultas.add(nome);
  for (const id of ['grafico-rcd', 'grafico-und']) if (estado.graficos[id]) estado.graficos[id].dispatchAction({ type: 'legendToggleSelect', name: nome });
  document.querySelectorAll('#legenda .leg-item').forEach((el) => {
    el.classList.toggle('oculta', estado.ocultas.has($('legenda')._grupos[Number(el.dataset.i)].nome));
  });
}

// ----- Waterfall ("Movimentações do Mercado") -----
const WF = { total: '#6B76A6', aumento: '#3BAA4A', queda: '#D9534F', outros: '#F2C94C', projetado: '#AEB4D2' };

// Totais de cada período e, entre eles, a variação dos N itens que mais mudaram.
// Truque clássico: uma barra invisível de "base" empilhada sob a barra visível.
function desenharWaterfall(id, linhas, prefixo, per, n) {
  const el = $(id);
  if (!estado.graficos[id]) estado.graficos[id] = echarts.init(el);
  const grafico = estado.graficos[id];
  const ultimo = per.colunas.length - 1;
  // no modo Mês usa só o primeiro e o último mês
  const indices = per.mes ? [0, per.atual] : per.colunas.map((_, i) => i);
  const total = (i) => linhas.reduce((s, l) => s + (l[prefixo + i] || 0), 0);

  const barras = []; // { nome, base, altura, valor, cor, info }
  indices.forEach((i, k) => {
    const t = total(i);
    const proj = per.projetado.has(i);
    barras.push({ nome: per.rotulos[i], base: 0, altura: t, valor: t, cor: proj ? WF.projetado : WF.total, info: proj ? 'Total projetado' : 'Total' });
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
  const menorNivel = Math.min(...barras.map((b) => (b.info.startsWith('Total') ? b.valor : b.base)));
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

// opcoes: ocultas (séries escondidas), nulos (linhas interrompidas onde não há dado),
// rotulos (false = sem rótulos nas linhas), extras (séries adicionais, ex.: média)
function desenharGrafico(id, grupos, prefixo, per, totalGeral, tipo, opcoes = {}) {
  const ocultas = opcoes.ocultas || estado.ocultas;
  const el = $(id);
  if (!estado.graficos[id]) estado.graficos[id] = echarts.init(el);
  const grafico = estado.graficos[id];
  const n = per.colunas.length;
  const mes = per.mes;

  const valores = grupos.map((g) => per.colunas.map((_, i) => {
    const v = g.linha[prefixo + i];
    return opcoes.nulos && tipo === 'linhas' && !valido(v) ? null : v || 0;
  }));
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
      serie.data = dados.map((v, i) => ({ value: v, bruto: v, label: { show: opcoes.rotulos !== false && (!mes || chave.has(i)) } }));
      serie.label = { position: 'top', color: '#2B2B2B', fontSize: 9, formatter: (p) => abreviar(p.value) };
    } else { // áreas: os rótulos ficam só no total
      serie.data = dados.map((v) => ({ value: v, bruto: v }));
    }
    return serie;
  });

  // períodos projetados (MAT+1): mais claros e hachurados
  if (per.projetado.size || grupos.some((g) => g.proj && g.proj.size)) {
    series.forEach((s, k) => {
      const proj = grupos[k].proj;
      s.data = s.data.map((d, i) => (per.projetado.has(i) || (proj && proj.has(i))
        ? { ...d, itemStyle: { opacity: 0.55, decal: HACHURA }, symbol: 'emptyCircle' } : d));
    });
  }
  if (opcoes.extras) series.push(...opcoes.extras);

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
      selected: Object.fromEntries(grupos.map((g) => [g.nome, !ocultas.has(g.nome)])),
    },
    grid: { left: 50, right: mes ? 20 : 15, top: mes ? 50 : 30, bottom: mes ? 50 : 30 },
    labelLayout: mes ? { hideOverlap: true } : undefined,
    xAxis: {
      type: 'category', data: per.rotulos, boundaryGap: ehBarra || n === 1,
      axisLabel: { rotate: mes ? 90 : 0, fontSize: mes ? 9 : 12, formatter: (v) => (v === 'MAT+1' ? 'MAT+1\n(projetado)' : v) },
    },
    yAxis: cem
      ? { type: 'value', max: 100, axisLabel: { formatter: (v) => v + '%' } }
      : { type: 'value', max: (v) => Math.max(v.max, empilhado ? maxTotal : 0) * (mes ? 1.18 : 1.12), axisLabel: { formatter: abreviar } },
    series,
  }, true);
  grafico.resize();
}

// ----- Tabela (matriz com níveis) -----
const CAMPOS_TABELA = ['r0', 'r1', 'r4', 'u0', 'u1', 'u4', 'd0', 'rP', 'uP'];
const SEP = '\u0001'; // separador interno do "caminho" de cada linha

const COLUNAS_TABELA = (T, comProjecao = false) => [
  { id: 'r0', titulo: `RCD ${T}`, tipo: 'num', cor: '#6B76A6' },
  { id: 'msR', titulo: 'MS% RCD', tipo: 'pct', cor: '#F2C94C' },
  { id: 'evR', titulo: `Evol. ${T} RCD`, tipo: 'var' },
  { id: 'cgR', titulo: 'CAGR 5Y RCD', tipo: 'var' },
  ...(comProjecao ? [
    { id: 'rP', titulo: 'RCD MAT+1', tipo: 'num', cor: '#AEB4D2', proj: true },
    { id: 'evRP', titulo: 'Evol. MAT+1 RCD', tipo: 'var', proj: true },
  ] : []),
  { id: 'u0', titulo: `UND ${T}`, tipo: 'num', cor: '#A58BDB' },
  { id: 'msU', titulo: 'MS% UND', tipo: 'pct', cor: '#F2C94C' },
  { id: 'msD', titulo: 'MS% DOSES', tipo: 'pct', cor: '#F2C94C' },
  { id: 'evU', titulo: `Evol. ${T} UND`, tipo: 'var' },
  { id: 'cgU', titulo: 'CAGR 5Y UND', tipo: 'var' },
  ...(comProjecao ? [
    { id: 'uP', titulo: 'UND MAT+1', tipo: 'num', cor: '#CDBDEB', proj: true },
    { id: 'evUP', titulo: 'Evol. MAT+1 UND', tipo: 'var', proj: true },
  ] : []),
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
  no.evRP = evolucao(no.rP, no.r0);
  no.evUP = evolucao(no.uP, no.u0);
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
      SUM(dos_${T}0) d0,
      ${T === 'MAT' && elLigado() ? `SUM(${exprMATP('rcd')}) rP, SUM(${exprMATP('und')}) uP,` : ''}
      bool_or(is_el) AS el
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
      if (l.el) filho.el = true; // a linha tem SKU de EL
      no = filho;
    });
  }
  const completarTudo = (no) => { completarNo(no, raiz); no.filhos.forEach(completarTudo); };
  completarTudo(raiz);
  ultimaTabela = { raiz, T, dims: [...dims], projecao: T === 'MAT' && elLigado() };
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
  const colunas = COLUNAS_TABELA(T, ultimaTabela.projecao);
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
      <td style="padding-left:${8 + l.nivel * 20}px">${botao}${escaparHtml(l.nome)}${l.el ? '<span class="tag-el">EL</span>' : ''}</td>
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
$('versao').innerHTML = `<span class="texto-taxonomia"></span> · versão ${escaparHtml(new URL(import.meta.url).searchParams.get('v') || 'local')}`;

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
function criarSeletorPreco(id, { unico, vazio, aoMudar }) {
  const el = $(id);
  el.innerHTML = `
    <button type="button" class="dd-botao dd-largo"><span class="dd-texto"></span><span class="dd-seta">▾</span></button>
    <div class="dd-painel dd-painel-largo" hidden>
      <input type="search" class="dd-busca" placeholder="Pesquisar">
      <div class="dd-lista"></div>
      ${unico ? '' : '<div class="dd-rodape"><button type="button" class="dd-limpar" disabled>✕ Limpar filtro</button></div>'}
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
    if (!unico) el.querySelector('.dd-limpar').disabled = v.length === 0;
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
  // "Limpar filtro" (só nas caixas de seleção múltipla): desmarca esta caixa; a lista continua aberta
  if (!unico) {
    el.querySelector('.dd-limpar').onclick = () => {
      if (!sel.valores.size) return;
      sel.valores = new Set();
      sel.desenhar();
      clearTimeout(temporizadorSel);
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
  // MAT+1: SKUs reais = MAT × evolução da projeção; ELs = meses 13–24 (Ano 2)
  if (p === 'MATP') return `COALESCE(${exprMATP(medida)}, 0)`;
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
  if (p === 'MATP') {
    const r = rotulosProjetados();
    return { longo: `MAT+1 projetado (${r[0]} a ${r[11]}; SKUs reais = MAT × evolução R$ ÷ evolução UND, ELs = Ano 2)`, curto: 'MAT+1' };
  }
  if (p === 'MAT') return { longo: `MAT (12 meses até ${ultimoMes || 'o último mês'})`, curto: 'MAT' };
  if (p === 'YTD') return { longo: `YTD (ano até ${ultimoMes || 'o último mês'})`, curto: 'YTD' };
  if (p === '1') return { longo: `Último mês (${ultimoMes})`, curto: ultimoMes };
  const k = Math.min(Number(p), n);
  return { longo: `Últimos ${k} meses (${estado.meses[n - k]} a ${ultimoMes})`, curto: `últ. ${k} meses` };
}

let ultimoPreco = null;
// "MAT+1 (projetado)" só existe com as ELs ligadas
function atualizarOpcaoMatp() {
  const op = $('preco-periodo').querySelector('option[value="MATP"]');
  op.hidden = !elLigado();
  if (!elLigado() && $('preco-periodo').value === 'MATP') $('preco-periodo').value = 'MAT';
}

async function atualizarPreco() {
  estado.precoPendente = false;
  atualizarOpcaoMatp();
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
      SUM(${exprPeriodoPreco('rc')}) AS rc, SUM(${exprPeriodoPreco('und')}) AS und,
      bool_or(is_el) AS el
    FROM fato ${e(`((${condConc} AND ${condQtd}) OR d_apres = ${sqlTexto(index)}${elLigado() ? ' OR is_el' : ''})`)}
    GROUP BY 1`);

  // cálculos por apresentação
  const mesesPeriodo = indicesPeriodoPreco();
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
    a.ip = temIP(a.apres, mesesPeriodo); // RC corrigido com Infoprice em algum mês do período
  }
  const idx = linhas.find((a) => a.ehIndex);
  const concIdx = lerConcentracao(idx.conc);
  for (const a of linhas) {
    a.indexRc = a.rcU !== null && idx.rcU ? (a.rcU / idx.rcU) * 100 : null;
    const c = lerConcentracao(a.conc);
    a.rcConc = a.rcDose !== null && concIdx && c && c.unidade === concIdx.unidade
      ? a.rcDose * (concIdx.valor / c.valor) : null;
  }

  // "Top N por" escolhe QUAIS apresentações entram (maiores pelo total do período);
  // "Ordenar por" define a ORDEM das colunas (preço médio, do maior para o menor)
  const desc = (campo) => (a, b) => (valido(b[campo]) ? b[campo] : -Infinity) - (valido(a[campo]) ? a[campo] : -Infinity);
  const n = Math.max(1, parseInt($('preco-topn').value, 10) || 10);
  let itens = [...linhas].sort(desc($('preco-topn-por').value)).slice(0, n);
  // o index e os SKUs das ELs sempre aparecem, mesmo fora do Top N
  itens.push(...linhas.filter((a) => (a === idx || a.el) && !itens.includes(a)));
  itens.sort(desc($('preco-ordem').value));

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

  // volume: linha no eixo secundário com o total do período (métrica do "Top N por")
  const comVolume = $('preco-volume').checked;
  const metrica = $('preco-topn-por').value; // 'rcd' ou 'und'
  const nomeVol = metrica === 'rcd' ? 'RCD total' : 'UND total';
  el.style.height = '';
  const somaR = itens.reduce((s2, a) => s2 + (a.rcd || 0), 0);
  const somaU = itens.reduce((s2, a) => s2 + (a.und || 0), 0);
  const volumes = itens.map((a) => Math.max(0, a[metrica] || 0));
  const textoVol = (v) => {
    if (metrica === 'rcd') return 'R$ ' + abreviar(v);
    if (v >= 1e6) return fmt1.format(v / 1e6) + ' mi';
    if (v >= 1e3) return fmt0.format(v / 1e3) + ' mil';
    return fmt0.format(v);
  };
  const COR_VOL = 'rgba(31,42,68,0.7)';
  // faixas verticais (px) já ocupadas em cada coluna pelos rótulos de RC, PF e RCD:
  // preenchidas pela série do RC e lidas pela série das etiquetas do volume (desenhada depois)
  const ocupado = [];
  const seriesVolume = comVolume ? [
    {
      name: nomeVol, type: 'line', yAxisIndex: 1, z: 4, symbol: 'circle', symbolSize: 5,
      lineStyle: { width: 1.5, color: COR_VOL }, itemStyle: { color: COR_VOL },
      data: itens.map((a, i) => ({
        value: volumes[i],
        ...(a.ehIndex ? { symbolSize: 8, itemStyle: { color: '#F2C94C', borderColor: '#F2C94C' } } : {}),
      })),
    },
    { // etiquetas do volume: acima do ponto; se colidirem com outro rótulo, abaixo; senão, acima de tudo
      type: 'custom', yAxisIndex: 1, z: 5, silent: true, tooltip: { show: false },
      data: itens.map((_, i) => [i, volumes[i]]),
      renderItem: (params, api) => {
        const i = params.dataIndex;
        const [x, y] = api.coord([i, volumes[i]]);
        const texto = textoVol(volumes[i]);
        const fs = 9;
        const h = fs + 6;
        const w = texto.length * fs * 0.62 + 10;
        const faixas = ocupado[i] || [];
        const colide = (t) => faixas.some(([a1, a2]) => t < a2 + 3 && t + h > a1 - 3); // 3 px de folga
        let topo = y - 6 - h;
        if (colide(topo)) {
          topo = y + 6;
          if (colide(topo)) topo = Math.min(y - 6 - h, ...faixas.map(([a1]) => a1)) - h - 3;
        }
        topo = Math.max(params.coordSys.y - 4, topo);
        return { type: 'group', children: [
          { type: 'rect', shape: { x: x - w / 2, y: topo, width: w, height: h, r: 3 },
            style: { fill: 'rgba(255,255,255,0.75)', stroke: itens[i].ehIndex ? '#F2C94C' : '#C9CED8', lineWidth: itens[i].ehIndex ? 1.5 : 1 } },
          { type: 'text', x, y: topo + h / 2,
            style: { text: texto, fill: '#1F2A44', font: `bold ${fs}px sans-serif`, textAlign: 'center', textVerticalAlign: 'middle' } },
        ] };
      },
    },
  ] : [];

  g.setOption({
    animation: false,
    legend: {
      left: 10, top: 6, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 },
      data: [...NOMES, ...(comVolume ? [nomeVol] : [])], // a linha aparece como —●—
    },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const a = itens[ps[0].dataIndex];
        const d = valido(a.pfU) && valido(a.rcdU) ? a.pfU - a.rcdU : null;
        // volume: totais e participação no total das colunas exibidas
        const volume = comVolume ? `<hr style="margin:4px 0;border:none;border-top:1px solid #ddd">
          RCD total: <b>${reais(a.rcd)}</b> (${percentual(divisao(a.rcd, somaR))} das colunas exibidas)<br>
          UND total: <b>${inteiro(a.und)}</b> (${percentual(divisao(a.und, somaU))} das colunas exibidas)` : '';
        return `<b>${escaparHtml(a.apres)}</b><br>${escaparHtml(a.corp)}<br>
          RCD/UND: <b>${reais(a.rcdU)}</b><br>
          PF/UND: <b>${reais(a.pfU)}</b><br>
          PF - RCD: <b>${reais(d)}</b> (${percentual(divisao(d, a.pfU))} do PF)<br>
          <span style="color:${COR_RC}">RC/UND: <b>${reais(a.rcU)}</b></span>${volume}`;
      },
    },
    // right: 0 mantém as colunas alinhadas com a tabela; o eixo do volume fica por dentro, à direita
    grid: { left: LARGURA_ROTULO_PRECO, right: 0, top: 60, bottom: 6 },
    xAxis: { type: 'category', data: itens.map((a) => a.apres), axisLabel: { show: false }, axisTick: { show: false } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: (v) => 'R$ ' + fmt0.format(v) }, max: (v) => v.max * 1.25 },
      {
        type: 'value', position: 'right', show: comVolume, min: 0, max: (v) => v.max * 1.1,
        splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { inside: true, showMaxLabel: false, fontSize: 9, color: '#B5BAC4', formatter: (v) => (metrica === 'rcd' ? abreviar(v) : textoVol(v)) },
        name: `${nomeVol} (${periodo.curto})`, nameLocation: 'end', nameGap: 10,
        nameTextStyle: { fontSize: 9, color: '#9AA0AA', align: 'right' },
      },
    ],
    series: [
      { // borda tracejada nas colunas das ELs
        type: 'custom', silent: true, z: 1, tooltip: { show: false },
        data: itens.map((a, i) => (a.el ? [i, 0] : null)).filter(Boolean),
        renderItem: (params, api) => {
          const cs = params.coordSys;
          const w = api.size([1, 0])[0];
          const x = api.coord([api.value(0), 0])[0];
          return { type: 'rect', shape: { x: x - w / 2 + 2, y: 2, width: w - 4, height: cs.y + cs.height + 4 },
            style: { fill: 'none', stroke: '#045b7b', lineWidth: 1.5, lineDash: [6, 4] } };
        },
      },
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
              style: { text: reais(a.rcU) + (a.ip && valido(a.rcU) ? ' IP' : ''), fill: COR_RC, font: `bold ${tamanho + 1}px sans-serif`, textAlign: 'center', textVerticalAlign: 'bottom' } });
          }
          if (temPF) {
            filhos.push({ type: 'text', x, y: basePF,
              style: { text: rotulo(a.pfU), fill: '#3A3A3A', font: `${tamanho}px sans-serif`, textAlign: 'center', textVerticalAlign: 'bottom' } });
          }
          // o que já ocupa esta coluna (para as etiquetas do volume desviarem)
          const faixasCol = [[yRcd + 2, yRcd + 6 + H]]; // valor do RCD dentro da barra
          if (temPF) faixasCol.push([basePF - H, basePF]);
          if (temRC) faixasCol.push([baseRC - H - 1, baseRC], [yDe(a.rcU) - 2, yDe(a.rcU) + 2]);
          ocupado[params.dataIndex] = faixasCol;
          return { type: 'group', children: filhos };
        },
      },
      ...seriesVolume,
    ],
  }, true);
  g.resize();

  // ----- tabela (mesmas colunas do gráfico) -----
  const concIdxTexto = idx.conc;
  const pct = (v) => percentual(v);
  const linhasTabela = [
    ['RCD (R$/UND)', (a) => reais(a.rcdU)],
    ['PF (R$/UND)', (a) => reais(a.pfU)],
    ['RC (R$/UND)', (a) => reais(a.rcU) + marcaIP(a.ip && valido(a.rcU)), 'v-rc'],
    ['Desc. Com.', (a) => pct(a.desc), ''],
    ['Margem PDV', (a) => pct(a.margem)],
    ['MKUP DIST', (a) => pct(a.mkup)],
    [`Index RC vs ${nomeCurto(idx)}`, (a) => (valido(a.indexRc) ? fmt0.format(a.indexRc) : '-'), 'v-index'],
    ['RC por dose', (a) => reais(a.rcDose) + marcaIP(a.ip && valido(a.rcDose)), 'v-rc'],
    [`RC por ${concIdxTexto}`, (a) => reais(a.rcConc) + marcaIP(a.ip && valido(a.rcConc)), 'v-rc'],
    [`RCD ${periodo.curto} (R$ mil)`, (a) => (a.rcd > 0 ? fmt1.format(a.rcd / 1000) : '-')],
    [`UND ${periodo.curto} (mil)`, (a) => (a.und > 0 ? fmt1.format(a.und / 1000) : '-')],
  ];
  const cabecalho = `<thead><tr><th class="preco-rotulo">Apresentação</th>${itens.map((a) => `
      <th class="${a.ehIndex ? 'col-index' : ''}${a.el ? ' col-el' : ''}" title="${escaparHtml(a.apres)}">${a.el ? '<span class="tag-el">EL</span>' : ''}
        <b>${escaparHtml(nomeCurto(a).toUpperCase())}</b>
        <small>${escaparHtml([a.conc, a.forma, a.qtd].join(' · '))}</small>
      </th>`).join('')}</tr></thead>`;
  const corpo = '<tbody>' + linhasTabela.map(([rotulo, f, cls = '']) =>
    `<tr><td class="preco-rotulo ${cls}">${escaparHtml(rotulo)}</td>${itens.map((a) =>
      `<td class="${cls}${a.ehIndex ? ' col-index' : ''}${a.el ? ' col-el' : ''}">${f(a)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  $('tabela-preco').innerHTML = `<colgroup><col style="width:${LARGURA_ROTULO_PRECO}px">${itens.map(() => '<col>').join('')}</colgroup>` + cabecalho + corpo;

  $('preco-rodape').innerHTML = `Período: <b>${escaparHtml(periodo.longo)}</b>.
    Preço médio ponderado = soma do valor no período ÷ soma das unidades (UND) no período.
    ${total > itens.length ? `Mostrando ${itens.length} de ${total} apresentações.` : ''}
    ${itens.some((a) => a.ip) ? `<br>${marcaIP(true)} ${NOTA_IP}.` : ''}`;
}

// meses (índices) do período escolhido na aba Preço
function indicesPeriodoPreco() {
  const p = $('preco-periodo').value;
  if (p === 'MATP') return [];
  if (p === 'MAT' || p === 'YTD') return indicesJanela(p, 0);
  const n = estado.meses.length;
  const k = Math.min(Number(p), n);
  return Array.from({ length: k }, (_, j) => n - k + j);
}

['preco-periodo', 'preco-ordem', 'preco-topn-por'].forEach((id) => $(id).addEventListener('change', atualizarPreco));
$('preco-volume').addEventListener('change', desenharPreco);
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
  s.apres = criarSeletorPreco('dd-p2-apres', { unico: false, vazio: 'Todas', aoMudar: atualizarPreco2 });
  // controle deslizante (compartilhado com a aba Preço 3): base inteira por padrão
  const n = estado.meses.length;
  for (const pre of ABAS_TEMPO) {
    for (const id of [`${pre}-ini`, `${pre}-fim`]) { $(id).min = 0; $(id).max = Math.max(0, n - 1); }
    $(`${pre}-tempo`).hidden = !n;
  }
  estado.tempo = { ini: 0, fim: Math.max(0, n - 1) };
  atualizarRotulosTempo();
  estado.p2.ocultas = new Set();
  estado.preco2Pendente = true;
}

// abas com o controle de período compartilhado (prefixo dos ids no HTML)
const ABAS_TEMPO = ['p2', 'p3'];
estado.tempo = { ini: 0, fim: 0 };

// leva o período compartilhado para os controles das duas abas
function atualizarRotulosTempo() {
  const { ini, fim } = estado.tempo;
  const n = Math.max(1, estado.meses.length - 1);
  for (const pre of ABAS_TEMPO) {
    $(`${pre}-ini`).value = ini;
    $(`${pre}-fim`).value = fim;
    $(`${pre}-ini-txt`).value = estado.meses[ini] || '';
    $(`${pre}-fim-txt`).value = estado.meses[fim] || '';
    // pinta o trecho escolhido do trilho
    $(`${pre}-trilho`).style.background =
      `linear-gradient(90deg, #ccc ${ini / n * 100}%, var(--amarelo) ${ini / n * 100}%, var(--amarelo) ${fim / n * 100}%, #ccc ${fim / n * 100}%)`;
  }
}

// cores fixas por apresentação (ordem alfabética dentro do produto), iguais nas abas Preço 2 e 3
function coresPorApresentacao(todas) {
  const cores = {};
  todas.forEach((v, i) => { cores[v] = CORES[i % CORES.length]; });
  return cores;
}
const ordemApresentacao = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });

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
  const todas = apres.map((l) => l.v).sort(ordemApresentacao);
  s.apres.opcoes = todas;
  for (const v of [...s.apres.valores]) if (!todas.includes(v)) s.apres.valores.delete(v);
  s.produto.desenhar();
  s.apres.desenhar();
  const cores = coresPorApresentacao(todas);

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
  // MAT+1 mês a mês (ELs: meses 13–24; SKUs reais: sazonalidade do MAT × evolução)
  let mensalProj = [];
  if (n && elLigado()) {
    const somasP = Array.from({ length: 12 }, (_, j) =>
      `SUM(${exprMesP('rcd', j)}) r${j}, SUM(${exprMesP('und', j)}) u${j}, SUM(${exprMesP('rc', j)}) c${j}, SUM(${exprMesP('pf', j)}) p${j}`).join(', ');
    const [lp] = await consultar(`SELECT ${somasP} FROM fato ${whereSel}`);
    mensalProj = rotulosProjetados().map((mes, j) => ({ mes: mes + '*', rcd: lp['r' + j], und: lp['u' + j], rc: lp['c' + j], pf: lp['p' + j], proj: true }));
  }

  // MAT-4 … MAT por apresentação
  const somasMat = [0, 1, 2, 3, 4].map((k) =>
    `SUM(rcd_MAT${k}) r${k}, SUM(und_MAT${k}) u${k}, SUM(rc_MAT${k}) c${k}, SUM(pf_MAT${k}) p${k}`).join(', ');
  const somaProj = elLigado() ? `, SUM(${exprMATP('rcd')}) rP, SUM(${exprMATP('und')}) uP, SUM(${exprMATP('rc')}) cP, SUM(${exprMATP('pf')}) pP` : '';
  const porApres = await consultar(`SELECT d_apres AS apres, ${somasMat}${somaProj} FROM fato ${whereSel} GROUP BY 1`);
  porApres.sort((a, b) => todas.indexOf(a.apres) - todas.indexOf(b.apres));

  estado.p2.dados = { mensal, mensalProj, porApres, cores, apresUsadas: s.apres.valores.size ? [...s.apres.valores] : todas };
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
  // nota do Infoprice quando algum RC mostrado veio de lá
  const { ini, fim } = estado.tempo;
  const meses = Array.from({ length: Math.max(0, fim - ini + 1) }, (_, j) => ini + j);
  const mesesMats = [0, 1, 2, 3, 4].flatMap((k) => indicesJanela('MAT', k));
  const usou = d.apresUsadas.some((a) => temIP(a, meses)) || d.porApres.some((a) => temIP(a.apres, mesesMats));
  $('p2-nota-ip').innerHTML = usou ? `${marcaIP(true)} ${NOTA_IP}.` : '';
}

function desenharMensalP2(mensal) {
  if (!mensal.length) {
    $('p2-mensal-card').hidden = true;
    return;
  }
  $('p2-mensal-card').hidden = false;
  const { ini, fim } = estado.tempo;
  const apresUsadas = estado.p2.dados.apresUsadas;
  const meses = [...mensal.slice(ini, fim + 1), ...(estado.p2.dados.mensalProj || [])].map((m, j) => {
    const rcdU = precoMedio(m.rcd, m.und);
    const rcU = precoMedio(m.rc, m.und);
    const pfU = precoMedio(m.pf, m.und);
    const dif = rcdU !== null && rcU !== null && rcU - rcdU > 0 ? rcU - rcdU : null;
    const ip = !m.proj && apresUsadas.some((a) => temIP(a, [ini + j]));
    return { mes: m.mes, proj: !!m.proj, rcdU, rcU, pfU, dif, ip, desc: rcdU !== null && pfU !== null ? 1 - rcdU / pfU : null };
  });

  // largura do gráfico: muitos meses => rolagem horizontal
  const caixa = $('p2-mensal-rolagem');
  const largura = Math.max(caixa.clientWidth, meses.length * LARGURA_MES + 120);
  $('p2-mensal').style.width = largura + 'px';
  requestAnimationFrame(() => { caixa.scrollLeft = 1e9; }); // abre nos meses mais recentes
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
        return `<b>${m.mes}</b><br>RCD/UND: ${reais(m.rcdU)}<br>PF/UND: ${reais(m.pfU)}<br>RC/UND: ${reais(m.rcU)}${m.ip ? ' (Infoprice)' : ''}<br>Dif RC-RCD: ${reais(m.rcU !== null && m.rcdU !== null ? m.rcU - m.rcdU : null)}<br>Desc. Com.: ${percentual(m.desc)}`;
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
        data: meses.map((m) => ({ value: m.rcdU, label: { show: m.dif === null && m.rcdU !== null }, ...estiloProj(m.proj) })),
        label: { position: 'top', fontSize: 9, color: '#2B2B2B', formatter: (p) => fmt1.format(p.value) },
      },
      {
        name: 'Dif RC-RCD', type: 'bar', stack: 'p2', itemStyle: { color: COR_DIF_CLARO },
        data: meses.map((m) => ({ value: m.dif, ...estiloProj(m.proj) })),
        label: { show: true, position: 'top', fontSize: 9, color: '#2B2B2B', formatter: (p) => fmt1.format(meses[p.dataIndex].rcU) + (meses[p.dataIndex].ip ? ' IP' : '') },
      },
      {
        name: 'Desc. Com.', type: 'scatter', yAxisIndex: 1, symbolSize: 9,
        itemStyle: { color: COR_DESC, borderColor: '#9A7B10', borderWidth: 1 },
        data: meses.map((m) => ({ value: m.desc, symbol: m.proj ? 'emptyCircle' : 'circle' })),
        label: { show: true, position: 'top', fontSize: 9, color: '#7A5F00', formatter: (p) => percentual(p.value) },
      },
    ],
  }, true);
}

function desenharMatsP2(porApres, cores) {
  const rotulos = ['MAT-4', 'MAT-3', 'MAT-2', 'MAT-1', 'MAT'];
  const ks = [4, 3, 2, 1, 0];
  if (elLigado() && porApres.some((a) => 'rP' in a)) { rotulos.push('MAT+1*'); ks.push('P'); }
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
        data: ks.map((k) => ({ value: calc[id](a, k), ip: id === 'p2-rc' && temIP(a.apres, indicesJanela('MAT', k)) })),
        label: { show: true, position: 'top', fontSize: 9, color: cores[a.apres], formatter: (p) => fmt(p.value) + (p.data.ip ? ' IP' : '') },
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

// alças do período (iguais nas abas Preço 2 e 3): a inicial nunca passa a final
for (const pre of ABAS_TEMPO) {
  for (const lado of ['ini', 'fim']) {
    $(`${pre}-${lado}`).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (lado === 'ini') estado.tempo = { ini: Math.min(v, estado.tempo.fim), fim: estado.tempo.fim };
      else estado.tempo = { ini: estado.tempo.ini, fim: Math.max(v, estado.tempo.ini) };
      atualizarRotulosTempo();
      if (pre === 'p2' && estado.p2.dados) desenharMensalP2(estado.p2.dados.mensal);
      if (pre === 'p3') desenharPreco3();
    });
  }
}

window.addEventListener('resize', () => {
  if (estado.pagina === 'preco2') desenharPreco2();
});

// =====================================================================
// Aba Preço 3: preço médio mensal e market share por apresentação
// =====================================================================
const MEDIDAS_P3_PRECO = {
  rc: { rotulo: 'RC/UND', pct: false, calc: (m) => precoMedio(m.c, m.u) },
  rcd: { rotulo: 'RCD/UND', pct: false, calc: (m) => precoMedio(m.r, m.u) },
  pf: { rotulo: 'PF/UND', pct: false, calc: (m) => precoMedio(m.p, m.u) },
  desc: { rotulo: 'Desc. Com.', pct: true, calc: (m) => descontoCom(precoMedio(m.r, m.u), precoMedio(m.p, m.u)) },
  margem: {
    rotulo: 'Margem PDV', pct: true,
    calc: (m) => { const rcd = precoMedio(m.r, m.u); const rc = precoMedio(m.c, m.u); return rcd !== null && rc ? 1 - rcd / rc : null; },
  },
  mkup: {
    rotulo: 'MKUP DIST', pct: true,
    calc: (m) => { const rcd = precoMedio(m.r, m.u); const rc = precoMedio(m.c, m.u); return rc !== null && rcd ? rc / rcd - 1 : null; },
  },
};
const MEDIDAS_P3_SHARE = { u: 'Unidades', r: 'RCD', c: 'RCON', p: 'RPF' };

estado.p3 = { seletores: {}, graficos: {}, ocultas: new Set(), produtoUsado: null, dados: null };

function prepararPreco3() {
  estado.p3.seletores.produto = criarSeletorPreco('dd-p3-produto', {
    unico: true, vazio: '(escolha)',
    aoMudar: () => {
      estado.produtoCompartilhado = [...estado.p3.seletores.produto.valores][0] || null;
      atualizarPreco3();
    },
  });
  estado.p3.ocultas = new Set();
  estado.preco3Pendente = true;
}

// produtos que passam pelos filtros; o escolhido é o compartilhado (padrão: maior RCD MAT)
async function escolherProduto(seletor, where) {
  const produtos = await consultar(`SELECT ${exprProdutoCorp} AS v, SUM(rcd_MAT0) AS r FROM fato ${where} GROUP BY 1`);
  seletor.opcoes = produtos.map((l) => l.v).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  let produto = estado.produtoCompartilhado;
  if (!produto || !seletor.opcoes.includes(produto)) {
    const maior = produtos.reduce((m, l) => (!m || (l.r || 0) > (m.r || 0) ? l : m), null);
    produto = maior ? maior.v : null;
    estado.produtoCompartilhado = produto;
  }
  seletor.valores = new Set(produto ? [produto] : []);
  seletor.desenhar();
  return produto;
}

async function atualizarPreco3() {
  estado.preco3Pendente = false;
  const where = clausulaWhere(null);
  const e = (cond) => (where ? `${where} AND ${cond}` : `WHERE ${cond}`);
  const produto = await escolherProduto(estado.p3.seletores.produto, where);
  estado.p3.produtoUsado = produto;
  if (!produto) {
    estado.p3.dados = null;
    $('kpis-p3').innerHTML = '';
    $('p3-legenda').innerHTML = '';
    $('p3-aviso').textContent = 'Nenhum produto com os filtros atuais.';
    Object.values(estado.p3.graficos).forEach((g) => g.clear());
    return;
  }
  $('p3-aviso').textContent = estado.meses.length ? '' : 'A base não tem colunas mensais (ex.: "ago-21"), então os gráficos mensais ficam vazios.';
  const condProduto = `${exprProdutoCorp} = ${sqlTexto(produto)}`;
  atualizarKpis('MAT', e(condProduto), 'kpis-p3');

  const somas = estado.meses.map((_, i) =>
    `SUM(rcd_m${i}) r${i}, SUM(und_m${i}) u${i}, SUM(rc_m${i}) c${i}, SUM(pf_m${i}) p${i}`).join(', ');
  const linhas = await consultar(`SELECT d_apres AS apres${somas ? ', ' + somas : ''} FROM fato ${e(condProduto)} GROUP BY 1`);
  linhas.sort((a, b) => ordemApresentacao(a.apres, b.apres));
  const cores = coresPorApresentacao(linhas.map((l) => l.apres));
  // por apresentação: lista de meses com r (RCD), u (UND), c (RCON), p (RPF)
  // MAT+1 mês a mês, por apresentação
  let proj = {};
  if (estado.meses.length && elLigado()) {
    const somasP = Array.from({ length: 12 }, (_, j) =>
      `SUM(${exprMesP('rcd', j)}) r${j}, SUM(${exprMesP('und', j)}) u${j}, SUM(${exprMesP('rc', j)}) c${j}, SUM(${exprMesP('pf', j)}) p${j}`).join(', ');
    const lp = await consultar(`SELECT d_apres AS apres, ${somasP} FROM fato ${e(condProduto)} GROUP BY 1`);
    proj = Object.fromEntries(lp.map((l) => [l.apres, Array.from({ length: 12 }, (_, j) => ({ r: l['r' + j], u: l['u' + j], c: l['c' + j], p: l['p' + j] }))]));
  }
  const series = linhas.map((l) => ({
    apres: l.apres,
    meses: estado.meses.map((_, i) => ({ r: l['r' + i], u: l['u' + i], c: l['c' + i], p: l['p' + i] })),
    proj: proj[l.apres] || [],
  }));
  estado.p3.dados = { series, cores };
  desenharPreco3();
}

function graficoP3(id) {
  if (!estado.p3.graficos[id]) estado.p3.graficos[id] = echarts.init($(id));
  return estado.p3.graficos[id];
}

// rótulos de uma linha só no início, no fim, no pico e no vale (ignorando meses vazios)
function pontosChaveComVazios(valores) {
  const validos = valores.map((v, i) => [v, i]).filter(([v]) => valido(v));
  if (!validos.length) return new Set();
  let max = validos[0], min = validos[0];
  for (const p of validos) { if (p[0] > max[0]) max = p; if (p[0] < min[0]) min = p; }
  return new Set([validos[0][1], validos[validos.length - 1][1], max[1], min[1]]);
}

function desenharPreco3() {
  const d = estado.p3.dados;
  if (!d || !estado.meses.length || estado.pagina !== 'preco3') return;
  const { ini, fim } = estado.tempo;
  const nReal = fim - ini + 1;
  const comProj = d.series.some((s) => s.proj.length);
  const rotulosX = [...estado.meses.slice(ini, fim + 1), ...(comProj ? rotulosProjetados().map((r) => r + '*') : [])];
  const mesesDe = (s) => [...s.meses.slice(ini, fim + 1), ...(comProj ? s.proj : [])];
  const medida1 = MEDIDAS_P3_PRECO[$('p3-medida1').value];
  const campo2 = $('p3-medida2').value;
  $('p3-titulo1').textContent = `Preço Médio ${medida1.rotulo}`;
  $('p3-titulo2').textContent = `Market Share ${MEDIDAS_P3_SHARE[campo2]}`;

  // mesma largura nos dois gráficos (meses alinhados); muitos meses => rolagem horizontal
  const largura = Math.max($('p3-rolagem1').clientWidth, rotulosX.length * LARGURA_MES + 130);
  $('p3-g1').style.width = largura + 'px';
  $('p3-g2').style.width = largura + 'px';
  // com rolagem, os gráficos abrem nos meses mais recentes (onde estão as ELs e o MAT+1)
  requestAnimationFrame(() => { $('p3-rolagem1').scrollLeft = 1e9; $('p3-rolagem2').scrollLeft = 1e9; });
  const selecionadas = Object.fromEntries(d.series.map((s) => [s.apres, !estado.p3.ocultas.has(s.apres)]));
  const eixoX = { type: 'category', data: rotulosX, axisLabel: { rotate: 90, fontSize: 10, interval: 0 } };
  const fmtValor = (v) => (medida1.pct ? percentual(v) : fmt2.format(v));
  // medidas que dependem do RC recebem a marca "IP" nos meses corrigidos
  const usaRC = ['rc', 'margem', 'mkup'].includes($('p3-medida1').value);
  const meses3 = Array.from({ length: fim - ini + 1 }, (_, j) => ini + j);
  $('p3-nota-ip').innerHTML = usaRC && d.series.some((s) => temIP(s.apres, meses3)) ? `${marcaIP(true)} ${NOTA_IP}.` : '';

  // ----- Gráfico 01: preço médio mensal por apresentação -----
  const g1 = graficoP3('p3-g1');
  g1.resize();
  g1.setOption({
    animation: false,
    legend: { show: false, data: d.series.map((s) => s.apres), selected: selecionadas },
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${escaparHtml(p.seriesName)}<br>${p.name}: <b>${medida1.pct ? percentual(p.value) : reais(p.value)}</b>${p.data.ip ? ' (RC Infoprice)' : ''}`,
    },
    grid: { left: 64, right: 24, top: 24, bottom: 50 },
    labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
    xAxis: eixoX,
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { formatter: (v) => (medida1.pct ? fmt0.format(v * 100) + '%' : 'R$ ' + fmt0.format(v)) },
    },
    series: d.series.flatMap((s) => {
      const valores = mesesDe(s).map(medida1.calc);
      const valoresReais = valores.map((v, i) => (i < nReal ? v : null));
      const chave = pontosChaveComVazios(valoresReais);
      const rotulo = { position: 'top', fontSize: 10, color: d.cores[s.apres], fontWeight: 'bold', formatter: (p) => fmtValor(p.value) + (p.data.ip ? ' IP' : '') };
      const linhas = [{
        name: s.apres, type: 'line', connectNulls: false, symbolSize: 5,
        itemStyle: { color: d.cores[s.apres] }, lineStyle: { width: 2 },
        data: valoresReais.map((v, i) => ({ value: v, label: { show: chave.has(i) }, ip: usaRC && valido(v) && temIP(s.apres, [ini + i]) })),
        label: rotulo,
      }];
      // MAT+1: mesma cor, linha tracejada (mesmo nome = some junto na legenda)
      if (comProj) {
        const ultimo = valores.length - 1;
        linhas.push({
          name: s.apres, type: 'line', connectNulls: false, symbol: 'emptyCircle', symbolSize: 5,
          itemStyle: { color: d.cores[s.apres] }, lineStyle: { width: 2, type: 'dashed' },
          data: valores.map((v, i) => ({ value: i >= nReal - 1 ? v : null, label: { show: i === ultimo }, ip: false })),
          label: rotulo,
        });
      }
      return linhas;
    }),
  }, true);

  // ----- Gráfico 02: participação de cada apresentação no total do produto (100%) -----
  const valoresMes = d.series.map((s) => mesesDe(s).map((m) => (valido(m[campo2]) ? m[campo2] : 0)));
  const totais = rotulosX.map((_, i) => valoresMes.reduce((t, v) => t + v[i], 0));
  const g2 = graficoP3('p3-g2');
  g2.resize();
  g2.setOption({
    animation: false,
    legend: { show: false, data: d.series.map((s) => s.apres), selected: selecionadas },
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${escaparHtml(p.seriesName)}<br>${p.name}: <b>${percentual(p.value / 100)}</b> (${inteiro(valoresMes[p.seriesIndex][p.dataIndex])})`,
    },
    grid: { left: 64, right: 24, top: 24, bottom: 50 },
    xAxis: eixoX,
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: (v) => v + '%' } },
    series: d.series.map((s, si) => ({
      name: s.apres, type: 'bar', stack: 'share', barMaxWidth: 40,
      itemStyle: { color: d.cores[s.apres] },
      data: valoresMes[si].map((v, i) => {
        const share = totais[i] > 0 ? (v / totais[i]) * 100 : null;
        return { value: share, label: { show: share !== null && share > 8 }, ...estiloProj(i >= nReal) };
      }),
      label: { position: 'inside', fontSize: 9, color: corTexto(d.cores[s.apres]), formatter: (p) => fmt1.format(p.value) + '%' },
    })),
  }, true);

  // ----- legenda única (clique oculta/mostra a apresentação nos dois gráficos) -----
  $('p3-legenda').innerHTML = d.series.map((s, i) =>
    `<div class="leg-item${estado.p3.ocultas.has(s.apres) ? ' oculta' : ''}" data-i="${i}" title="${escaparHtml(s.apres)}">
      <span class="leg-cor" style="background:${d.cores[s.apres]}"></span><span class="leg-nome">${escaparHtml(s.apres)}</span></div>`).join('');
}

$('p3-legenda').addEventListener('click', (e) => {
  const item = e.target.closest('.leg-item');
  if (!item || !estado.p3.dados) return;
  const nome = estado.p3.dados.series[Number(item.dataset.i)].apres;
  if (estado.p3.ocultas.has(nome)) estado.p3.ocultas.delete(nome); else estado.p3.ocultas.add(nome);
  item.classList.toggle('oculta', estado.p3.ocultas.has(nome));
  for (const g of Object.values(estado.p3.graficos)) g.dispatchAction({ type: 'legendToggleSelect', name: nome });
});
['p3-medida1', 'p3-medida2'].forEach((id) => $(id).addEventListener('change', desenharPreco3));
window.addEventListener('resize', () => { if (estado.pagina === 'preco3') desenharPreco3(); });

// =====================================================================
// Correção de preço com Infoprice
// Os arquivos são lidos só neste navegador; nada é enviado ou salvo no site.
// =====================================================================
const NOTA_IP = 'RC corrigido com Infoprice (média semanal → mensal) nos meses disponíveis; demais meses: base RM';
const SEM_CORRESPONDENCIA = '— Sem correspondência —';
const CHAVE_DEPARA = 'dashboard-farma:depara-infoprice';
const CONFIANCA_BAIXA = 70; // abaixo disso a sugestão fica amarela
const CONFIANCA_MINIMA = 45; // abaixo disso a sugestão vira "Sem correspondência"
const PALAVRAS_IGNORADAS = new Set(['LTDA', 'SA', 'S', 'A', 'DO', 'DA', 'DE', 'DOS', 'DAS', 'E', 'IND', 'COM',
  'LAB', 'LABS', 'LABORATORIO', 'LABORATORIOS', 'FARMACEUTICA', 'FARMACEUTICO', 'FARMA', 'PHARMA', 'BRASIL', 'UN']);

estado.ip = {
  arquivos: [],        // { nome, modificado, semanas: [{ data, lojas, redes, precos: {coluna: valor} }] }
  colunas: [],         // nomes das colunas de SKU (Infoprice)
  mapa: {},            // coluna -> { apres: string|'' , confianca, status: 'auto'|'manual'|'salvo' }
  candidatos: [],      // apresentações da base RM, com campos prontos para comparar
  usar: true,
  corrigidos: new Map(), // apresentação -> Set(índices de mês corrigidos)
  aplicado: false,
};

// ----- utilidades -----
const textoLimpo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();
const semEspaco = (s) => textoLimpo(s).replace(/[^A-Z0-9]/g, '');

// semelhança entre dois textos (0 a 1), por pares de letras
function bigramas(s) {
  const t = semEspaco(s);
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return { m, n: Math.max(0, t.length - 1), t };
}
function semelhanca(a, b) {
  if (!a.n || !b.n) return a.t && a.t === b.t ? 1 : 0;
  if (a.t === b.t) return 1;
  let comuns = 0;
  for (const [k, v] of a.m) comuns += Math.min(v, b.m.get(k) || 0);
  return (2 * comuns) / (a.n + b.n);
}

// leitor de CSV simples (aspas, vírgulas dentro de aspas, quebras de linha \r\n)
function lerCsv(texto, sep) {
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== '')) linhas.push(linha);
  return linhas;
}

// "PRODUTO (MOLÉCULA) 1000MCG COMPRIMIDO FABRICANTE 30 UN" -> partes para comparar
function analisarNomeIP(nome) {
  const t = textoLimpo(nome);
  let marca = null, molecula, resto;
  const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  if (m) { marca = m[1].trim(); molecula = m[2].trim(); resto = m[3]; } else {
    // sem marca: a molécula vai até o primeiro número (a concentração)
    const k = t.search(/\d/);
    molecula = (k > 0 ? t.slice(0, k) : t).trim();
    resto = k > 0 ? t.slice(k) : '';
  }
  const conc = resto.match(/(\d+(?:[.,]\d+)?)\s*(MCG|MG|G|ML|UI|FCC|%|MEQ|UFC)?/);
  const qtd = t.match(/(\d+(?:[.,]\d+)?)\s*UN\s*$/);
  return {
    marca, molecula,
    conc: conc ? parseFloat(conc[1].replace(',', '.')) : null,
    qtd: qtd ? parseFloat(qtd[1].replace(',', '.')) : null,
    palavras: new Set(t.split(/[^A-Z0-9]+/).filter((w) => w.length >= 3 && !PALAVRAS_IGNORADAS.has(w))),
    bMarca: marca ? bigramas(marca) : null,
    bMol: bigramas(molecula),
  };
}

// ----- de-para salvo no navegador (só neste computador) -----
function lerDeparaSalvo() {
  try { return JSON.parse(localStorage.getItem(CHAVE_DEPARA) || '{}') || {}; } catch { return {}; }
}
function salvarDepara() {
  const salvo = lerDeparaSalvo();
  for (const [col, m] of Object.entries(estado.ip.mapa)) {
    if (m.status === 'manual' || m.status === 'salvo') salvo[col] = m.apres;
  }
  try { localStorage.setItem(CHAVE_DEPARA, JSON.stringify(salvo)); } catch { /* navegador sem armazenamento: segue sem salvar */ }
}

// ----- leitura dos arquivos -----
async function lerArquivoIP(arquivo) {
  let texto = await arquivo.text();
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  const linhas = lerCsv(texto, ',');
  if (linhas.length < 2) throw new Error(`"${arquivo.name}" está vazio.`);
  const cab = linhas[0].map((c) => c.trim());
  const iTempo = cab.findIndex((c) => normalizar(c) === 'tempo');
  if (iTempo < 0) throw new Error(`"${arquivo.name}" não tem a coluna "TEMPO".`);
  const iLojas = cab.findIndex((c) => normalizar(c) === 'lojas');
  const iRedes = cab.findIndex((c) => normalizar(c) === 'redes');
  const skus = cab.map((c, i) => [c, i]).filter(([c, i]) => c && i !== iTempo && i !== iLojas && i !== iRedes);
  const num = (v) => { const x = parseFloat(String(v).trim()); return Number.isFinite(x) ? x : null; };
  const semanas = [];
  for (const l of linhas.slice(1)) {
    const d = String(l[iTempo] || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!d) continue;
    const precos = {};
    for (const [c, i] of skus) { const v = num(l[i]); if (v !== null && v > 0) precos[c] = v; }
    semanas.push({ data: `${d[1]}-${d[2]}-${d[3]}`, ano: +d[1], mes: +d[2],
      lojas: iLojas >= 0 ? num(l[iLojas]) : null, redes: iRedes >= 0 ? num(l[iRedes]) : null, precos });
  }
  return { nome: arquivo.name, modificado: arquivo.lastModified || Date.now(), ordem: Date.now(), semanas, colunas: skus.map(([c]) => c) };
}

async function carregarArquivosIP(arquivos) {
  $('ip-erro').textContent = '';
  try {
    for (const a of arquivos) {
      const lido = await lerArquivoIP(a);
      // mesmo nome de arquivo: substitui o anterior
      estado.ip.arquivos = estado.ip.arquivos.filter((x) => x.nome !== lido.nome);
      estado.ip.arquivos.push(lido);
    }
    estado.ip.usar = true;
    $('ip-usar').checked = true;
    await reprocessarInfoprice();
  } catch (e) {
    console.error(e);
    $('ip-erro').textContent = 'Não foi possível ler o arquivo Infoprice: ' + (e.message || e);
  }
}

// junta os arquivos: mesmo SKU + mesma semana => vale o arquivo mais recente
function juntarSemanas() {
  const porColuna = new Map(); // coluna -> Map(data -> { v, rank })
  const rank = (a) => [a.modificado, a.ordem];
  const maisNovo = (x, y) => x[0] > y[0] || (x[0] === y[0] && x[1] >= y[1]);
  for (const a of estado.ip.arquivos) {
    const r = rank(a);
    for (const s of a.semanas) {
      for (const [col, v] of Object.entries(s.precos)) {
        if (!porColuna.has(col)) porColuna.set(col, new Map());
        const m = porColuna.get(col);
        const atual = m.get(s.data);
        if (!atual || maisNovo(r, atual.rank)) m.set(s.data, { v, rank: r, ano: s.ano, mes: s.mes });
      }
    }
  }
  return porColuna;
}

// semanal -> mensal: média simples das semanas de cada mês (índice do mês na base RM)
function precosMensais(porColuna) {
  const idxMes = new Map((estado.mesesObj || []).map((m, i) => [m.ano * 12 + m.mes - 1, i]));
  const mensal = new Map(); // coluna -> Map(índice do mês -> preço)
  for (const [col, semanas] of porColuna) {
    const soma = new Map();
    for (const s of semanas.values()) {
      const i = idxMes.get(s.ano * 12 + s.mes - 1);
      if (i === undefined) continue;
      const x = soma.get(i) || [0, 0];
      soma.set(i, [x[0] + s.v, x[1] + 1]);
    }
    mensal.set(col, new Map([...soma].map(([i, [t, n]]) => [i, t / n])));
  }
  return mensal;
}

// ----- sugestão automática -----
async function carregarCandidatos() {
  const linhas = await consultar(`SELECT d_apres AS apres, any_value(d_produto) AS produto, any_value(d_molecula) AS molecula,
      any_value(d_conc) AS conc, any_value(qtdnum) AS qtdnum, any_value(d_lab) AS lab, any_value(d_corp) AS corp
    FROM fato WHERE NOT is_el GROUP BY 1`);
  estado.ip.candidatos = linhas.map((c) => {
    const conc = lerConcentracao(c.conc);
    return {
      apres: c.apres, bProd: bigramas(c.produto), bMol: bigramas(c.molecula),
      conc: conc ? conc.valor : null, qtd: valido(c.qtdnum) ? c.qtdnum : null,
      fab: new Set(textoLimpo(`${c.lab} ${c.corp}`).split(/[^A-Z0-9]+/).filter((w) => w.length >= 3 && !PALAVRAS_IGNORADAS.has(w))),
    };
  });
  estado.ip.listaApres = [SEM_CORRESPONDENCIA, ...linhas.map((c) => c.apres).sort(ordemApresentacao)];
}

// nota de 0 a 100: nome (40) + molécula (15) + concentração (20) + quantidade (15) + fabricante (10)
function pontuar(ip, c) {
  let nome, mol;
  if (ip.bMarca) {
    nome = semelhanca(ip.bMarca, c.bProd);
    mol = semelhanca(ip.bMol, c.bMol);
  } else {
    // sem marca: compara a molécula com o produto e com a molécula da base
    nome = Math.max(semelhanca(ip.bMol, c.bProd), semelhanca(ip.bMol, c.bMol));
    mol = semelhanca(ip.bMol, c.bMol);
  }
  let pontos = 40 * nome + 15 * mol;
  if (ip.conc !== null && c.conc !== null && Math.abs(ip.conc - c.conc) < 1e-9) pontos += 20;
  if (ip.qtd !== null && c.qtd !== null && Math.abs(ip.qtd - c.qtd) < 1e-9) pontos += 15;
  for (const w of c.fab) if (ip.palavras.has(w)) { pontos += 10; break; }
  return pontos;
}

function sugerir(coluna) {
  const ip = analisarNomeIP(coluna);
  const notas = estado.ip.candidatos.map((c) => [pontuar(ip, c), c.apres]).sort((a, b) => b[0] - a[0]);
  const [melhor, segundo] = notas;
  if (!melhor) return { apres: '', confianca: 0, ranking: [] };
  let confianca = Math.round(melhor[0]);
  if (segundo && melhor[0] - segundo[0] < 3) confianca = Math.max(0, confianca - 15); // empate: ambíguo
  return {
    apres: confianca >= CONFIANCA_MINIMA ? melhor[1] : '',
    confianca,
    ranking: notas.slice(0, 8).map((n) => n[1]),
  };
}

// refaz o de-para (salvos primeiro, depois sugestões) e aplica a correção
async function reprocessarInfoprice() {
  const colunas = [...new Set(estado.ip.arquivos.flatMap((a) => a.colunas))];
  estado.ip.colunas = colunas;
  await carregarCandidatos();
  const salvo = lerDeparaSalvo();
  const existe = new Set(estado.ip.listaApres);
  const anterior = estado.ip.mapa;
  estado.ip.mapa = {};
  estado.ip.rankings = {};
  for (const col of colunas) {
    const sug = sugerir(col);
    estado.ip.rankings[col] = sug.ranking;
    const antes = anterior[col];
    if (antes && antes.status === 'manual' && (antes.apres === '' || existe.has(antes.apres))) estado.ip.mapa[col] = antes;
    else if (col in salvo && (salvo[col] === '' || existe.has(salvo[col]))) estado.ip.mapa[col] = { apres: salvo[col], confianca: sug.confianca, status: 'salvo' };
    else estado.ip.mapa[col] = { apres: sug.apres, confianca: sug.confianca, status: 'auto' };
  }
  desenharSecaoIP();
  await aplicarInfoprice();
}

// ----- aplicação da correção no banco de dados -----
// janelas de meses (índices) de cada período MAT-k / YTD-k
function indicesJanela(tipo, k) {
  const meses = estado.mesesObj || [];
  if (!meses.length) return [];
  const ultimo = meses[meses.length - 1];
  const r = [];
  meses.forEach((m, i) => {
    if (tipo === 'MAT') { const fim = ultimo.indice - 12 * k; if (m.indice > fim - 12 && m.indice <= fim) r.push(i); }
    else if (m.ano === ultimo.ano - k && m.mes <= ultimo.mes) r.push(i);
  });
  return r;
}

async function aplicarInfoprice() {
  const conn = estado.conn;
  const sets = estado.colunasRc.map((c) => `${c} = o.${c}`).join(', ');
  // 1) volta ao RC original da base RM
  if (estado.ip.aplicado) {
    await conn.query(`UPDATE fato SET ${sets} FROM rc_orig o WHERE fato.rid = o.rid`);
    estado.ip.aplicado = false;
  }
  estado.ip.corrigidos = new Map();
  const n = estado.meses.length;
  if (estado.ip.usar && n && estado.ip.arquivos.length) {
    // 2) preço mensal por apresentação (média das colunas Infoprice ligadas a ela)
    const mensal = precosMensais(juntarSemanas());
    const porApres = new Map();
    for (const [col, m] of Object.entries(estado.ip.mapa)) {
      if (!m.apres || !mensal.has(col)) continue;
      if (!porApres.has(m.apres)) porApres.set(m.apres, new Map());
      const alvo = porApres.get(m.apres);
      for (const [i, v] of mensal.get(col)) { const x = alvo.get(i) || [0, 0]; alvo.set(i, [x[0] + v, x[1] + 1]); }
    }
    if (porApres.size) {
      const linhas = [];
      for (const [apres, meses] of porApres) {
        const precos = Array.from({ length: n }, (_, i) => (meses.has(i) ? meses.get(i)[0] / meses.get(i)[1] : null));
        estado.ip.corrigidos.set(apres, new Set([...meses.keys()]));
        linhas.push(`(${sqlTexto(apres)}, ${precos.map((p) => (p === null ? 'NULL' : p)).join(', ')})`);
      }
      await conn.query(`CREATE OR REPLACE TABLE ip_wide (d_apres VARCHAR, ${Array.from({ length: n }, (_, i) => `p${i} DOUBLE`).join(', ')})`);
      await conn.query(`INSERT INTO ip_wide VALUES ${linhas.join(', ')}`);
      // 3) RCON do mês = preço Infoprice × unidades; MAT/YTD recebem a diferença dos meses corrigidos
      const novo = (i) => `CASE WHEN w.p${i} IS NOT NULL THEN w.p${i} * COALESCE(und_m${i}, 0) ELSE rc_m${i} END`;
      const delta = (i) => `CASE WHEN w.p${i} IS NOT NULL THEN w.p${i} * COALESCE(und_m${i}, 0) - COALESCE(rc_m${i}, 0) ELSE 0 END`;
      const partes = Array.from({ length: n }, (_, i) => `rc_m${i} = ${novo(i)}`);
      for (const p of estado.periodosRc) {
        const janela = indicesJanela(p.slice(0, 3), Number(p.slice(3)));
        if (janela.length) partes.push(`rc_${p} = COALESCE(rc_${p}, 0) + ${janela.map(delta).join(' + ')}`);
      }
      await conn.query(`UPDATE fato SET ${partes.join(', ')} FROM ip_wide w WHERE fato.d_apres = w.d_apres`);
      estado.ip.aplicado = true;
    }
  }
  // todas as páginas recalculam com o RC novo
  estado.analisePendente = estado.portPendente = estado.paretoPendente = estado.lancPendente = estado.precoPendente = estado.preco2Pendente = estado.preco3Pendente = true;
  desenharResumoIP();
}

// ----- marcação "IP" nas páginas de preço -----
function ipAtivo() { return estado.ip.aplicado && estado.ip.corrigidos.size > 0; }
function temIP(apres, indices) {
  if (!ipAtivo()) return false;
  const s = estado.ip.corrigidos.get(apres);
  return !!s && indices.some((i) => s.has(i));
}
const marcaIP = (sim) => (sim ? '<sup class="ip">IP</sup>' : '');

// ----- tela -----
function desenharSecaoIP() {
  const tem = estado.ip.arquivos.length > 0;
  $('ip-controles').hidden = !tem;
  if (!tem) { $('ip-depara').innerHTML = ''; desenharResumoIP(); return; }
  const linhas = estado.ip.colunas.map((col, i) => {
    const m = estado.ip.mapa[col];
    return `<tr data-i="${i}" class="${baixaConfianca(m) ? 'ip-baixa' : ''}">
      <td class="ip-col" title="${escaparHtml(col)}">${escaparHtml(col)}</td>
      <td><div class="dropdown" id="ip-dd-${i}"></div></td>
      <td class="ip-conf">${textoConfianca(m)}</td>
      <td class="ip-status">${textoStatus(m)}</td>
    </tr>`;
  }).join('');
  $('ip-depara').innerHTML = `<table class="tabela-ip">
    <thead><tr><th>Coluna Infoprice</th><th>SKU sugerido (Apresentacao Desc Longa)</th><th>Confiança</th><th>Status</th></tr></thead>
    <tbody>${linhas}</tbody></table>`;
  estado.ip.colunas.forEach((col, i) => {
    const sel = criarSeletorPreco(`ip-dd-${i}`, {
      unico: true, vazio: SEM_CORRESPONDENCIA,
      aoMudar: () => {
        const v = [...sel.valores][0];
        estado.ip.mapa[col] = { ...estado.ip.mapa[col], apres: v === SEM_CORRESPONDENCIA ? '' : v, status: 'manual' };
        salvarDepara();
        atualizarLinhaIP(i);
        clearTimeout(estado.ip.temporizador);
        estado.ip.temporizador = setTimeout(aplicarInfoprice, 400);
      },
    });
    // as melhores sugestões aparecem primeiro na lista
    const ranking = estado.ip.rankings[col] || [];
    sel.opcoes = [SEM_CORRESPONDENCIA, ...ranking, ...estado.ip.listaApres.slice(1).filter((a) => !ranking.includes(a))];
    sel.valores = new Set([estado.ip.mapa[col].apres || SEM_CORRESPONDENCIA]);
    sel.desenhar();
  });
}

function baixaConfianca(m) { return m.status === 'auto' && (m.confianca < CONFIANCA_BAIXA || !m.apres); }
function textoConfianca(m) {
  const nivel = m.confianca >= 85 ? 'alta' : m.confianca >= CONFIANCA_BAIXA ? 'média' : 'baixa';
  return `${m.confianca}% <small>(${nivel})</small>`;
}
function textoStatus(m) {
  if (m.status === 'manual') return m.apres ? 'Escolhido por você' : 'Sem correspondência (escolhido)';
  if (m.status === 'salvo') return m.apres ? 'De-para salvo' : 'Sem correspondência (salvo)';
  if (!m.apres) return '⚠ Sem correspondência — revisar';
  return m.confianca < CONFIANCA_BAIXA ? '⚠ Sugestão — revisar' : 'Sugestão automática';
}
function atualizarLinhaIP(i) {
  const tr = document.querySelector(`.tabela-ip tr[data-i="${i}"]`);
  const m = estado.ip.mapa[estado.ip.colunas[i]];
  tr.classList.toggle('ip-baixa', baixaConfianca(m));
  tr.querySelector('.ip-status').innerHTML = textoStatus(m);
  desenharResumoIP();
}

function desenharResumoIP() {
  const ip = estado.ip;
  if (!ip.arquivos.length) { $('ip-resumo').innerHTML = ''; return; }
  const datas = ip.arquivos.flatMap((a) => a.semanas.map((s) => s.data)).sort();
  const fmtData = (d) => d.split('-').reverse().join('/');
  const media = (lst) => { const v = lst.filter(valido); return v.length ? fmt0.format(v.reduce((a, b) => a + b, 0) / v.length) : '-'; };
  const arquivos = ip.arquivos.map((a) =>
    `<li><b>${escaparHtml(a.nome)}</b> — ${a.semanas.length} semanas, ${a.colunas.length} SKUs; amostra média: ${media(a.semanas.map((s) => s.lojas))} lojas, ${media(a.semanas.map((s) => s.redes))} redes</li>`).join('');
  const comCorresp = ip.colunas.filter((c) => ip.mapa[c] && ip.mapa[c].apres).length;
  const mesesFora = ip.aplicado ? '' : ' <span class="ip-off">(correção desligada)</span>';
  $('ip-resumo').innerHTML = `
    <ul class="ip-arquivos">${arquivos}</ul>
    <div class="ip-numeros">
      <span>Período coberto: <b>${fmtData(datas[0])}</b> a <b>${fmtData(datas[datas.length - 1])}</b></span>
      <span>SKUs com correspondência: <b>${comCorresp} / ${ip.colunas.length}</b></span>
      <span>Apresentações corrigidas: <b>${ip.corrigidos.size}</b>${mesesFora}</span>
    </div>`;
}

async function removerInfoprice() {
  estado.ip.arquivos = [];
  estado.ip.colunas = [];
  estado.ip.mapa = {};
  await aplicarInfoprice();
  desenharSecaoIP();
}

function exportarDepara() {
  const linhas = [['coluna_infoprice', 'sku_rm', 'status'],
    ...estado.ip.colunas.map((c) => [c, estado.ip.mapa[c].apres, estado.ip.mapa[c].status])];
  const csv = '﻿' + linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'de-para-infoprice.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importarDepara(arquivo) {
  let texto = await arquivo.text();
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  const sep = (texto.split(/\r?\n/)[0].match(/;/g) || []).length ? ';' : ',';
  const linhas = lerCsv(texto, sep).filter((l) => l.length >= 2 && normalizar(l[0]) !== 'colunainfoprice');
  const salvo = lerDeparaSalvo();
  for (const [col, apres] of linhas) salvo[col] = apres === SEM_CORRESPONDENCIA ? '' : apres;
  try { localStorage.setItem(CHAVE_DEPARA, JSON.stringify(salvo)); } catch { /* sem armazenamento */ }
  // vale também para o que já está na tela
  for (const [col, apres] of linhas) {
    if (estado.ip.mapa[col]) estado.ip.mapa[col] = { ...estado.ip.mapa[col], apres: apres === SEM_CORRESPONDENCIA ? '' : apres, status: 'salvo' };
  }
  desenharSecaoIP();
  await aplicarInfoprice();
}

$('ip-arquivos').addEventListener('change', async (e) => {
  const arquivos = [...(e.target.files || [])];
  e.target.value = '';
  if (arquivos.length) await carregarArquivosIP(arquivos);
});
$('ip-exemplo').addEventListener('click', async () => {
  try {
    const resp = await fetch('exemplo_infoprice.csv');
    if (!resp.ok) throw new Error('exemplo_infoprice.csv não encontrado');
    await carregarArquivosIP([new File([await resp.blob()], 'exemplo_infoprice.csv', { lastModified: Date.now() })]);
  } catch (e) { $('ip-erro').textContent = 'Não foi possível abrir o exemplo: ' + e.message; }
});
$('ip-usar').addEventListener('change', (e) => { estado.ip.usar = e.target.checked; aplicarInfoprice(); });
$('ip-remover').addEventListener('click', removerInfoprice);
$('ip-exportar').addEventListener('click', exportarDepara);
$('ip-importar').addEventListener('change', async (e) => {
  const a = e.target.files && e.target.files[0];
  e.target.value = '';
  if (a) await importarDepara(a);
});

// =====================================================================
// Integração com as ELs (Estudos de Lançamento) e projeção MAT+1
// As ELs vêm do el.js (window.estudosEL); aqui viram SKUs virtuais na base.
// =====================================================================
const CHAVE_CHAVE_EL = 'dashboard-farma:incluir-els';
const HACHURA = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [3, 4], rotation: -Math.PI / 4, color: 'rgba(255,255,255,0.6)' };
const elLigado = () => !!estado.elAtivo;
try { estado.elAtivo = localStorage.getItem(CHAVE_CHAVE_EL) === '1'; } catch { estado.elAtivo = false; }
estado.sugestaoProj = { und: null, rs: null };

// evolução usada no MAT+1 (fração): a digitada na aba EL ou, se vazia, a sugerida
function evolucaoProj() {
  const p = (window.estudosEL && window.estudosEL.projecao()) || {};
  const pega = (digitado, sugerido) => (valido(digitado) ? digitado / 100 : valido(sugerido) ? sugerido : 0);
  return { und: pega(p.und, estado.sugestaoProj.und), rs: pega(p.rs, estado.sugestaoProj.rs) };
}
// MAT+1: SKUs da EL têm valor próprio; SKUs reais = MAT-0 × (1 + evolução)
function exprMATP(med) {
  const e = evolucaoProj();
  const f = 1 + (med === 'und' || med === 'dos' ? e.und : e.rs);
  return `COALESCE(${med}_MATP, ${med}_MAT0 * ${f})`;
}
// mês j do MAT+1: segue a sazonalidade do mesmo mês do MAT-0
function exprMesP(med, j) {
  const e = evolucaoProj();
  const f = 1 + (med === 'und' ? e.und : e.rs);
  const janela = indicesJanela('MAT', 0);
  const base = janela[j];
  return base === undefined ? `${med}_p${j}` : `COALESCE(${med}_p${j}, ${med}_m${base} * ${f})`;
}
function colExpr(med, c) {
  if (c === 'MATP') return exprMATP(med);
  const m = /^p(\d+)$/.exec(c);
  if (m) return exprMesP(med, Number(m[1]));
  return `${med}_${c}`;
}
// rótulos dos 12 meses seguintes ao último mês da base (ex.: set-26 … ago-27)
function rotulosProjetados() {
  const meses = estado.mesesObj || [];
  if (!meses.length) return [];
  const u = meses[meses.length - 1];
  return Array.from({ length: 12 }, (_, j) => {
    const idx = u.ano * 12 + u.mes - 1 + j + 1;
    return `${NOME_MES[idx % 12]}-${String(Math.floor(idx / 12)).slice(2)}`;
  });
}

// --------- SKUs virtuais das ELs ---------
const sqlNum = (v) => (valido(v) ? String(v) : 'NULL');
const vazioSe = (v) => (v === undefined || v === null || String(v).trim() === '' ? '(vazio)' : String(v).trim());
function apresentacaoEL(el) {
  const c = el.classif || {};
  return `${(c.produto || el.info.produto || 'EL').trim()} ${(el.info.padraoSku || '').trim()} (EL)`.replace(/\s+/g, ' ');
}

async function reconstruirEL() {
  if (!estado.conn) return;
  await estado.conn.query('DELETE FROM fato WHERE is_el');
  const lista = (window.estudosEL && window.estudosEL.lista()) || [];
  if (!elLigado() || !lista.length || !(estado.mesesObj || []).length) return;
  const janela = indicesJanela('MAT', 0);   // Mês 1..12 da EL = meses do MAT atual
  const ytd = new Set(indicesJanela('YTD', 0));
  const medidas = [['und', 'un'], ['pf', 'pf'], ['rcd', 'ppp'], ['rc', 'cpp']]; // coluna da base <- coluna da Demanda (k)
  const colunas = ['rid', ...DIMENSOES.map((d) => `d_${d.key}`), 'sigla', 'sku', 'qtdnum', 'is_el', 'el_sempre', 'el_id'];
  const medCols = [];
  for (const [m] of medidas) {
    for (const i of janela) medCols.push(`${m}_m${i}`);
    medCols.push(`${m}_MAT0`, `${m}_YTD0`, `${m}_MATP`);
    for (let j = 0; j < 12; j++) medCols.push(`${m}_p${j}`);
  }
  medCols.push('dos_MAT0', 'dos_YTD0', 'dos_MATP');
  const linhas = lista.map((el, n) => {
    const c = el.classif || {};
    const dims = DIMENSOES.map((d) => sqlTexto(d.key === 'apres' ? apresentacaoEL(el) : vazioSe(c[d.key])));
    const qtdnum = valido(c.qtdnum) ? c.qtdnum : null;
    const valores = [];
    const tot = {};
    for (const [m, campoEL] of medidas) {
      const dem = window.estudosEL.demanda(el); // PF, PPP e CPP = UN × preço, como na aba EL
      const mes = (k) => { const v = dem[k] ? dem[k][campoEL] : null; return valido(v) ? v * 1000 : null; };
      let mat = 0, ano = 0, prox = 0;
      janela.forEach((i, k) => { const v = mes(k); valores.push(sqlNum(v)); mat += v || 0; if (ytd.has(i)) ano += v || 0; });
      for (let k = 12; k < 24; k++) prox += mes(k) || 0;
      valores.push(String(mat), String(ano), String(prox));
      for (let j = 0; j < 12; j++) valores.push(String(mes(12 + j) || 0));
      tot[m] = { mat, ano, prox };
    }
    const dos = (v) => (qtdnum !== null ? String(v * qtdnum) : 'NULL');
    valores.push(dos(tot.und.mat), dos(tot.und.ano), dos(tot.und.prox));
    const sempre = el.sempre !== false;
    return `(${[1e9 + n, ...dims, sqlTexto(vazioSe(c.sigla)), sqlTexto('EL:' + el.id), sqlNum(qtdnum), 'TRUE', sempre ? 'TRUE' : 'FALSE', sqlTexto(el.id), ...valores].join(', ')})`;
  });
  await estado.conn.query(`INSERT INTO fato (${[...colunas, ...medCols].join(', ')}) VALUES ${linhas.join(', ')}`);
}

// evolução MAT-0 vs MAT-1 do mercado filtrado (só SKUs reais), sugerida para o MAT+1
async function calcularSugestaoProj() {
  if (!estado.conn) return;
  const where = clausulaWhere(null);
  const [s] = await consultar(`SELECT SUM(und_MAT0) u0, SUM(und_MAT1) u1, SUM(rcd_MAT0) r0, SUM(rcd_MAT1) r1
    FROM fato ${where ? where + ' AND NOT is_el' : 'WHERE NOT is_el'}`);
  estado.sugestaoProj = { und: evolucao(s.u0, s.u1), rs: evolucao(s.r0, s.r1) };
  window.dispatchEvent(new Event('sugestao-proj'));
}

// tudo que mostra dados recalcula
async function aposMudancaEL(reconstruir) {
  if (!estado.conn) return;
  if (reconstruir) await reconstruirEL();
  estado.analisePendente = estado.portPendente = estado.paretoPendente = estado.lancPendente = estado.precoPendente = estado.preco2Pendente = estado.preco3Pendente = true;
  await atualizarTudo();
}

// API para a aba EL (el.js)
window.painelEL = {
  baseCarregada: () => !!estado.conn,
  // valores existentes na base para cada campo da classificação
  async valores(chave) {
    if (!estado.conn) return [];
    estado.cacheValoresEL = estado.cacheValoresEL || {};
    if (estado.cacheValoresEL[chave]) return estado.cacheValoresEL[chave];
    const expr = chave === 'sigla' ? 'sigla' : chave === 'qtdnum' ? 'qtdnum' : `d_${chave}`;
    const linhas = await consultar(`SELECT DISTINCT ${expr} AS v FROM fato WHERE NOT is_el AND ${expr} IS NOT NULL ORDER BY 1`);
    const lista = linhas.map((l) => (chave === 'qtdnum' ? fmt0.format(l.v) : l.v)).filter((v) => v !== '(vazio)' && v !== '(não informado)');
    estado.cacheValoresEL[chave] = lista;
    return lista;
  },
  // classificação mais comum de um produto que já existe na base
  async classificacaoDoProduto(produto) {
    if (!estado.conn || !produto) return null;
    const cols = DIMENSOES.map((d) => `mode(d_${d.key}) AS ${d.key}`).join(', ');
    const [l] = await consultar(`SELECT count(*) AS n, ${cols}, mode(sigla) AS sigla FROM fato
      WHERE NOT is_el AND lower(d_produto) = lower(${sqlTexto(produto)})`);
    return l && l.n ? l : null;
  },
  sugestao: () => estado.sugestaoProj,
  // unidades do mercado filtrado (só SKUs reais): MAT atual e MAT+1 projetado
  async mercadoUN() {
    if (!estado.conn) return null;
    const where = clausulaWhere(null);
    const [m] = await consultar(`SELECT SUM(und_MAT0) a1, SUM(und_MAT0 * ${1 + evolucaoProj().und}) a2
      FROM fato ${where ? where + ' AND NOT is_el' : 'WHERE NOT is_el'}`);
    return m;
  },
  periodo: () => {
    const j = indicesJanela('MAT', 0);
    const proj = rotulosProjetados();
    return j.length ? { ini: estado.meses[j[0]], fim: estado.meses[j[j.length - 1]], projIni: proj[0], projFim: proj[11] } : null;
  },
  ligado: elLigado,
};

// interruptor global "Incluir ELs e MAT+1"
$('chave-el').checked = elLigado();
$('chave-el').addEventListener('change', async (e) => {
  estado.elAtivo = e.target.checked;
  try { localStorage.setItem(CHAVE_CHAVE_EL, estado.elAtivo ? '1' : '0'); } catch { /* sem armazenamento */ }
  document.body.classList.toggle('com-el', estado.elAtivo);
  await aposMudancaEL(true);
  window.dispatchEvent(new Event('chave-el'));
});
document.body.classList.toggle('com-el', elLigado());

// edições na aba EL: reconstrói os SKUs virtuais (com uma pequena espera enquanto digita)
let esperaEL = null;
window.addEventListener('els-alteradas', () => {
  estado.promessaEL = aposMudancaEL(true).finally(() => { estado.promessaEL = null; });
});
window.addEventListener('projecao-alterada', () => {
  clearTimeout(esperaEL);
  esperaEL = setTimeout(() => aposMudancaEL(false), 300);
});

// barras/pontos de meses projetados (MAT+1): mais claros e hachurados
function estiloProj(projetado) {
  return projetado ? { itemStyle: { opacity: 0.55, decal: HACHURA } } : {};
}

// =====================================================================
// Pareto: itens ordenados do maior para o menor, % acumulado e classes
// A (até 80%), B (80–95%) e C (acima de 95%). Respeita os filtros e as ELs.
// =====================================================================
const MEDIDAS_PARETO = { rcd: 'RCD', und: 'UND', rc: 'RCON', pf: 'RPF' };
const COR_CLASSE = { A: '#6B76A6', B: '#A58BDB', C: '#D3D3D3' };
const COR_OUTROS_PARETO = '#5A5A5A';
const LARGURA_BARRA_PARETO = 42; // px por barra; acima da largura do card, rolagem horizontal
estado.par = {
  dimsGrafico: [], dimsTabela: [], expandidos: new Set(), selecao: new Map(),
  ordem: { col: 'r0', desc: true }, exib: { topN: null, outros: false, auto80: false },
  grafico: null, tabela: null, linhas: [],
};
estado.paretoPendente = true;

// classe pelo % acumulado ANTES do item: o item que cruza 80% ainda é A (o mesmo do "Aglutinar 80%")
const classePareto = (antes) => (antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C');

function prepararPareto() {
  const P = estado.par;
  const tem = (k) => estado.dims.some((d) => d.key === k);
  const padrao = tem('produto') ? [PRODUTO_CORP] : estado.dims.slice(0, 1).map((d) => d.key);
  P.dimsGrafico = [...padrao];
  P.dimsTabela = [...padrao];
  P.expandidos = new Set();
  P.selecao = new Map();
  const base = estado.dims.map((d) => d.key);
  montarSuspenso('dd-grafico-par', P.dimsGrafico, [...base, PRODUTO_CORP], () => { limparSelecaoPareto(false); atualizarGraficoPareto(); });
  montarSuspenso('dd-tabela-par', P.dimsTabela, [...base, PRODUTO_CORP], () => {
    P.expandidos = new Set();
    limparSelecaoPareto(false);
    atualizarTabelaPareto();
  });
  P.ordem = { col: colunaMedidaPareto(), desc: true };
}

// coluna da tabela que tem o valor da Medida escolhida
const colunaMedidaPareto = () => ({ rcd: 'r0', und: 'u0' }[$('par-medida').value] || 'v');

// colunas do período escolhido: atual, anterior (Evol.) e 4 anos antes (CAGR)
const periodoPareto = () => periodoDe($('par-periodo').value);
function periodoDe(p) {
  if (p === 'MATP') return { atual: 'MATP', ant: 'MAT0', base: 'MAT3', rot: 'MAT+1' };
  if (p === 'YTD0') return { atual: 'YTD0', ant: 'YTD1', base: 'YTD4', rot: 'YTD' };
  const k = Number(p.slice(3));
  return { atual: `MAT${k}`, ant: k < 4 ? `MAT${k + 1}` : null, base: k === 0 ? 'MAT4' : null, rot: k ? `MAT-${k}` : 'MAT' };
}
const somaPeriodo = (med, c) => (c ? `SUM(${colExpr(med, c)})` : 'NULL');

// Filtros + linhas/barras clicadas (só nesta página)
function whereParetoSel() {
  const base = clausulaWhere(null);
  if (!estado.par.selecao.size) return base;
  const sel = '(' + [...estado.par.selecao.values()].join(' OR ') + ')';
  return base ? `${base} AND ${sel}` : `WHERE ${sel}`;
}

async function atualizarPareto() {
  estado.paretoPendente = false;
  // MAT+1 só existe com o interruptor ligado
  const opcaoP = $('par-periodo').querySelector('option[value="MATP"]');
  opcaoP.hidden = !elLigado();
  if (!elLigado() && $('par-periodo').value === 'MATP') $('par-periodo').value = 'MAT0';
  estado.par.selecao.clear();
  await Promise.all([atualizarKpisPareto(), atualizarGraficoPareto(), atualizarTabelaPareto()]);
}

// ----- KPIs: os mesmos da página Gráfico e Tabela + os do Pareto -----
// cards de RCD, UND e contagens de um período (iguais aos da página Gráfico e Tabela)
async function cardsPeriodo(per, where) {
  const comVenda = `(COALESCE(${colExpr('rcd', per.atual)}, 0) <> 0 OR COALESCE(${colExpr('und', per.atual)}, 0) <> 0)`;
  const [k] = await consultar(`SELECT
      ${somaPeriodo('rcd', per.atual)} r0, ${somaPeriodo('rcd', per.ant)} r1, ${somaPeriodo('rcd', per.base)} r4,
      ${somaPeriodo('und', per.atual)} u0, ${somaPeriodo('und', per.ant)} u1, ${somaPeriodo('und', per.base)} u4,
      COUNT(DISTINCT d_corp) FILTER (WHERE ${comVenda}) corps,
      COUNT(DISTINCT d_produto) FILTER (WHERE ${comVenda}) marcas,
      COUNT(DISTINCT sku) FILTER (WHERE ${comVenda}) skus
    FROM fato ${where}`);
  const T = per.rot;
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
  if (per.atual === 'MATP') cards.forEach((c) => { if (/MAT\+1/.test(c[1])) c[0] += ' kpi-proj'; });
  return cards;
}
const htmlCards = (cards) => cards.map(([cls, rotulo, valor]) =>
  `<div class="kpi ${cls}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div></div>`).join('');

async function atualizarKpisPareto() {
  const per = periodoPareto();
  const med = $('par-medida').value;
  const where = whereParetoSel();
  const dims = estado.par.dimsGrafico;
  const grupo = dims.length ? `concat_ws(' | ', ${dims.map(exprDim).join(', ')})` : `'Total'`;
  const [cards, itens] = await Promise.all([
    cardsPeriodo(per, where),
    consultar(`SELECT ${grupo} AS g, ${somaPeriodo(med, per.atual)} AS v FROM fato ${where} GROUP BY 1`),
  ]);
  // Pareto dos itens do "Gráfico" (com a seleção da tabela, se houver)
  const valores = itens.map((i) => Math.max(0, i.v || 0)).sort((a, b) => b - a);
  const total = valores.reduce((s, v) => s + v, 0);
  let acum = 0, nA = 0;
  for (const v of valores) { if (total > 0 && acum / total < 0.8) nA++; acum += v; }
  const nItens = valores.filter((v) => v > 0).length;
  const top5 = valores.slice(0, 5).reduce((s, v) => s + v, 0);
  cards.push(
    ['kpi-pareto', 'Nº itens classe A', inteiro(total > 0 ? nA : null)],
    ['kpi-pareto', '% dos itens que fazem 80%', percentual(divisao(nA, nItens))],
    ['kpi-pareto', 'Concentração Top 5 (%)', percentual(divisao(top5, total))],
  );
  $('kpis-par').innerHTML = htmlCards(cards);
}

// ----- Gráfico -----
async function atualizarGraficoPareto() {
  const P = estado.par;
  const per = periodoPareto();
  const med = $('par-medida').value;
  const dims = P.dimsGrafico;
  const colunas = dims.map((k, i) => `${exprDim(k)} AS g${i}`);
  // com seleção: marca quais barras têm as linhas/barras clicadas (destaque)
  const sel = P.selecao.size ? `bool_or(${[...P.selecao.values()].join(' OR ')})` : 'TRUE';
  const linhas = await consultar(`SELECT ${colunas.length ? colunas.join(', ') + ',' : ''}
      ${somaPeriodo(med, per.atual)} AS v, ${sel} AS sel, bool_or(is_el) AS el
    FROM fato ${clausulaWhere(null)} ${colunas.length ? 'GROUP BY ALL' : ''}`);
  P.grafico = linhas.map((l) => {
    const valores = dims.map((_, i) => l['g' + i]);
    return { valores, g: dims.length ? valores.join(' | ') : 'Total', v: l.v || 0, sel: l.sel, el: l.el };
  });
  desenharGraficoPareto();
}

function desenharGraficoPareto() {
  const P = estado.par;
  if (!P.grafico) return;
  const per = periodoPareto();
  const nomeMed = MEDIDAS_PARETO[$('par-medida').value];
  $('titulo-pareto').textContent = `Pareto — ${nomeMed} ${per.rot}`;

  // % acumulado sempre sobre todos os itens (na ordem do Pareto)
  const todos = [...P.grafico].sort((a, b) => b.v - a.v);
  const total = todos.reduce((s, i) => s + Math.max(0, i.v), 0);
  let acum = 0;
  for (const it of todos) {
    it.classe = classePareto(total > 0 ? acum / total : 1);
    acum += Math.max(0, it.v);
    it.acum = total > 0 ? acum / total : null;
    it.part = divisao(it.v, total);
  }
  const regra = aplicarExibicao(todos, P.exib, 'v');
  const barras = regra.manter.map((it) => ({ ...it, nome: it.g }));
  if (regra.outros.length) {
    const v = regra.outros.reduce((s, i) => s + i.v, 0);
    barras.push({
      nome: 'Outros', outros: true, membros: regra.outros, v, part: divisao(v, total),
      acum: regra.outros[regra.outros.length - 1].acum, sel: regra.outros.some((i) => i.sel), classe: '',
    });
  }
  P.barras = barras;
  const haSel = P.selecao.size > 0;
  const cor = (b) => (b.outros ? COR_OUTROS_PARETO : COR_CLASSE[b.classe]);
  const muitas = barras.length > 15;

  // largura: barras com espaço mínimo; acima do card, rolagem horizontal
  const el = $('grafico-pareto');
  const disponivel = $('pareto-rolagem').clientWidth || 800;
  el.style.width = Math.max(disponivel, 90 + barras.length * LARGURA_BARRA_PARETO) + 'px';
  if (!estado.graficos['grafico-pareto']) {
    estado.graficos['grafico-pareto'] = echarts.init(el);
    const g = estado.graficos['grafico-pareto'];
    g.on('click', (p) => {
      if (p.componentType === 'series' && p.seriesType === 'bar') clicarBarraPareto(estado.par.barras[p.dataIndex], p.event && p.event.event && (p.event.event.ctrlKey || p.event.event.metaKey));
    });
    // nome completo ao passar o mouse no rótulo do eixo
    g.on('mouseover', (e) => { if (e.componentType === 'xAxis') el.title = e.value; });
    g.on('mouseout', (e) => { if (e.componentType === 'xAxis') el.title = ''; });
  }
  const grafico = estado.graficos['grafico-pareto'];
  const curto = (s) => (String(s).length > 18 ? String(s).slice(0, 17) + '…' : s);
  grafico.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const b = barras[p.dataIndex];
        return `<b>${escaparHtml(b.nome)}</b>${b.el ? ' <span class="tag-el">EL</span>' : ''}<br>
          ${nomeMed} ${per.rot}: <b>${inteiro(b.v)}</b><br>Participação: <b>${percentual(b.part)}</b><br>
          % acumulado: <b>${percentual(b.acum)}</b><br>${b.outros ? `Outros: ${inteiro(b.membros.length)} itens` : `Classe: <b>${b.classe}</b>`}`;
      },
    },
    grid: { left: 60, right: 50, top: 30, bottom: 110 },
    xAxis: {
      type: 'category', data: barras.map((b) => b.nome), triggerEvent: true,
      axisLabel: { rotate: 45, fontSize: 10, interval: 0, formatter: curto },
    },
    yAxis: [
      { type: 'value', max: (v) => v.max * 1.12, axisLabel: { formatter: abreviar } },
      { type: 'value', min: 0, max: 100, interval: 20, splitLine: { show: false }, axisLabel: { formatter: (v) => v + '%' } },
    ],
    series: [
      {
        type: 'bar', barMaxWidth: 48, barCategoryGap: '20%',
        data: barras.map((b) => ({
          value: b.v,
          itemStyle: { color: cor(b), opacity: haSel && !b.sel ? 0.3 : 1, borderColor: haSel && b.sel ? '#2B2B2B' : undefined, borderWidth: haSel && b.sel ? 1.5 : 0 },
        })),
        label: { show: true, position: 'top', fontSize: 10, color: '#2B2B2B', formatter: (p) => abreviar(p.value) },
      },
      {
        type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 6, z: 5,
        itemStyle: { color: '#2B2B2B' }, lineStyle: { color: '#2B2B2B', width: 2 },
        data: barras.map((b, i) => ({
          value: valido(b.acum) ? b.acum * 100 : null,
          // para não poluir: com mais de 15 barras, rótulo a cada 2 pontos (e sempre no último)
          label: { show: !muitas || i % 2 === 0 || i === barras.length - 1 },
        })),
        label: { position: 'top', fontSize: 9, color: '#2B2B2B', formatter: (p) => fmt1.format(p.value) + '%' },
        tooltip: { show: false },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { color: '#C0392B', type: 'dashed', width: 1.5 },
          // rótulo no início da linha: continua visível com rolagem horizontal
          label: { formatter: '80%', position: 'insideStartTop', color: '#C0392B', fontWeight: 'bold' },
          data: [{ yAxis: 80 }],
        },
      },
    ],
  }, true);
  grafico.resize();
  const notas = [];
  if (regra.escondidos) notas.push(`${inteiro(regra.escondidos)} itens fora do Top N não aparecem (o % acumulado considera todos).`);
  if (!todos.length) notas.push('Nenhum dado com os filtros atuais.');
  if (haSel) notas.push('Barras em destaque: linhas/barras clicadas (os cards consideram só elas).');
  $('nota-grafico-par').textContent = notas.join(' ');
}

// Clique numa barra = clique na linha correspondente da tabela
function clicarBarraPareto(barra, acumular) {
  if (!barra) return;
  const dims = estado.par.dimsGrafico;
  const condItem = (it) => (dims.length ? '(' + it.valores.map((v, i) => `${exprDim(dims[i])} = ${sqlTexto(v)}`).join(' AND ') + ')' : 'TRUE');
  const caminho = barra.outros ? 'graf' + SEP + '__outros__' : SEP + barra.valores.join(SEP);
  const cond = barra.outros ? '(' + barra.membros.map(condItem).join(' OR ') + ')' : condItem(barra);
  alternarSelecaoPareto(caminho, cond, acumular);
}

// ----- Tabela (matriz) -----
// Part. %, % Acumulado e Classe: entre os itens do mesmo nível (sobre o total do nível acima)
function marcarPareto(no) {
  const filhos = [...no.filhos.values()].sort((a, b) => (b.v || 0) - (a.v || 0));
  const total = filhos.reduce((s, f) => s + Math.max(0, f.v || 0), 0);
  let acum = 0;
  for (const f of filhos) {
    f.classe = classePareto(total > 0 ? acum / total : 1);
    acum += Math.max(0, f.v || 0);
    f.acum = total > 0 ? acum / total : null;
    f.part = divisao(f.v, total);
    marcarPareto(f);
  }
}

async function atualizarTabelaPareto() {
  const P = estado.par;
  const per = periodoPareto();
  const med = $('par-medida').value;
  const dims = P.dimsTabela;
  const grupos = dims.map((k, i) => `${exprDim(k)} AS g${i}`);
  const linhas = await consultar(`SELECT ${grupos.length ? grupos.join(', ') + ',' : ''}
      ${somaPeriodo(med, per.atual)} v,
      ${somaPeriodo('rcd', per.atual)} r0, ${somaPeriodo('rcd', per.ant)} r1, ${somaPeriodo('rcd', per.base)} r4,
      ${somaPeriodo('und', per.atual)} u0, ${somaPeriodo('und', per.ant)} u1, ${somaPeriodo('und', per.base)} u4,
      ${somaPeriodo('dos', per.atual)} d0, bool_or(is_el) AS el
    FROM fato ${clausulaWhere(null)} ${grupos.length ? 'GROUP BY ALL' : ''}`);
  const campos = [...CAMPOS_TABELA, 'v'];
  const raiz = novoNo('Total', -1, '', []);
  raiz.v = 0;
  for (const l of linhas) {
    let no = raiz;
    somarCampos(raiz, l, campos);
    dims.forEach((_, i) => {
      const valor = l['g' + i];
      let filho = no.filhos.get(valor);
      if (!filho) {
        filho = novoNo(valor, i, no.caminho + SEP + valor, [...no.valores, valor]);
        filho.v = 0;
        no.filhos.set(valor, filho);
      }
      somarCampos(filho, l, campos);
      if (l.el) filho.el = true;
      no = filho;
    });
  }
  const completarTudo = (no) => { completarNo(no, raiz); no.filhos.forEach(completarTudo); };
  completarTudo(raiz);
  marcarPareto(raiz);
  raiz.part = raiz.acum = 1;
  P.tabela = { raiz, dims: [...dims], per, med };
  desenharTabelaPareto();
}

// colunas da página Gráfico e Tabela + Part. % / % Acumulado / Classe depois da Medida
function colunasPareto(per, med) {
  const base = COLUNAS_TABELA(per.rot).filter((c) => !c.proj);
  const extras = [
    { id: 'part', titulo: 'Part. %', tipo: 'pct', cor: '#F2C94C' },
    { id: 'acum', titulo: '% Acumulado', tipo: 'pct' },
    { id: 'classe', titulo: 'Classe', tipo: 'classe' },
  ];
  const alvo = colunaMedidaPareto();
  if (alvo === 'v') return [{ id: 'v', titulo: `${MEDIDAS_PARETO[med]} ${per.rot}`, tipo: 'num', cor: '#4FA3A5' }, ...extras, ...base];
  const i = base.findIndex((c) => c.id === alvo);
  return [...base.slice(0, i + 1), ...extras, ...base.slice(i + 1)];
}

function desenharTabelaPareto() {
  const P = estado.par;
  if (!P.tabela) return;
  const { raiz, dims, per, med } = P.tabela;
  const colunas = colunasPareto(per, med);
  const { col, desc } = P.ordem;
  const ultimoNivel = dims.length - 1;

  const visiveis = [];
  let escondidos = 0;
  let cortou = false;
  const percorrer = (no) => {
    const regra = aplicarExibicao([...no.filhos.values()], P.exib, 'v');
    escondidos += regra.escondidos;
    const lista = regra.manter.sort((a, b) => {
      if (col === 'nome') return (desc ? -1 : 1) * String(a.nome).localeCompare(String(b.nome), 'pt-BR');
      if (col === 'classe') return (desc ? -1 : 1) * String(a.classe || 'Z').localeCompare(String(b.classe || 'Z'));
      const va = valido(a[col]) ? a[col] : -Infinity;
      const vb = valido(b[col]) ? b[col] : -Infinity;
      return desc ? vb - va : va - vb;
    });
    if (regra.outros.length) {
      const outros = novoNo('Outros', no.nivel + 1, no.caminho + SEP + '__outros__', no.valores);
      outros.v = 0;
      outros.ehOutros = true;
      outros.membros = regra.outros.map((f) => f.nome);
      for (const f of regra.outros) somarCampos(outros, f, [...CAMPOS_TABELA, 'v']);
      completarNo(outros, raiz);
      const total = [...no.filhos.values()].reduce((s, f) => s + Math.max(0, f.v || 0), 0);
      outros.part = divisao(outros.v, total);
      outros.acum = 1;
      outros.classe = '';
      lista.push(outros);
    }
    for (const f of lista) {
      if (visiveis.length >= MAX_LINHAS_TABELA) { cortou = true; return; }
      visiveis.push(f);
      if (!f.ehOutros && f.nivel < ultimoNivel && P.expandidos.has(f.caminho)) percorrer(f);
    }
  };
  if (dims.length) percorrer(raiz);

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
    if (c.tipo === 'classe') {
      return v ? `<td><span class="classe-pareto" style="background:${COR_CLASSE[v]};color:${corTexto(COR_CLASSE[v])}">${v}</span></td>` : '<td></td>';
    }
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

  const haSelecao = P.selecao.size > 0;
  const selecionada = (caminho) => [...P.selecao.keys()].some((c) => caminho === c || caminho.startsWith(c + SEP));
  P.linhas = visiveis;
  const corpo = '<tbody>' + visiveis.map((l, i) => {
    const podeAbrir = !l.ehOutros && l.nivel < ultimoNivel;
    const aberto = P.expandidos.has(l.caminho);
    const botao = podeAbrir
      ? `<button class="btn-exp" data-i="${i}" title="${aberto ? 'Recolher' : 'Expandir'}">${aberto ? '−' : '+'}</button>`
      : '<span class="btn-exp-vazio"></span>';
    const classes = [`nivel-${Math.min(l.nivel, 3)}`];
    if (l.ehOutros) classes.push('linha-outros');
    if (haSelecao) classes.push(P.selecao.has(l.caminho) ? 'selecionada' : selecionada(l.caminho) ? '' : 'apagada');
    return `<tr class="${classes.join(' ')}" data-i="${i}">
      <td style="padding-left:${8 + l.nivel * 20}px">${botao}${escaparHtml(l.nome)}${l.el ? '<span class="tag-el">EL</span>' : ''}</td>
      ${colunas.map((c) => celula(l, c, true)).join('')}</tr>`;
  }).join('') + '</tbody>';
  const rodape = `<tfoot><tr><td>Total</td>${colunas.map((c) => (c.tipo === 'classe' ? '<td></td>' : celula(raiz, c, false))).join('')}</tr></tfoot>`;

  $('tabela-par').innerHTML = cabecalho + corpo + rodape;
  $('btn-expandir-par').hidden = $('btn-recolher-par').hidden = dims.length < 2;
  $('btn-limpar-selecao-par').hidden = !haSelecao;
  $('dica-selecao-par').textContent = haSelecao
    ? `${P.selecao.size} ${P.selecao.size > 1 ? 'itens selecionados filtram' : 'item selecionado filtra'} os cards e ficam em destaque no gráfico.`
    : 'Clique em uma linha ou barra para destacar no gráfico e filtrar os cards (Ctrl+clique para várias).';
  const notas = [];
  if (cortou) notas.push(`Mostrando as primeiras ${inteiro(MAX_LINHAS_TABELA)} linhas.`);
  if (escondidos) notas.push(`${inteiro(escondidos)} linhas fora do Top N não aparecem.`);
  notas.push('Part. %, % Acumulado e Classe seguem a ordem do Pareto (maior para menor) entre os itens de cada nível. Classe A: até 80%; B: 80–95%; C: acima de 95%.');
  $('nota-tabela-par').textContent = notas.join(' ');
}

function alternarSelecaoPareto(caminho, cond, acumular) {
  const P = estado.par;
  if (acumular) {
    if (P.selecao.has(caminho)) P.selecao.delete(caminho);
    else P.selecao.set(caminho, cond);
  } else if (P.selecao.has(caminho) && P.selecao.size === 1) {
    P.selecao.clear();
  } else {
    P.selecao = new Map([[caminho, cond]]);
  }
  aplicarSelecaoPareto();
}
function aplicarSelecaoPareto() {
  desenharTabelaPareto();
  atualizarKpisPareto();
  atualizarGraficoPareto();
}
function limparSelecaoPareto(redesenhar = true) {
  const tinha = estado.par.selecao.size > 0;
  estado.par.selecao.clear();
  if (redesenhar || tinha) aplicarSelecaoPareto();
}

function lerExibicaoPareto() {
  const n = parseInt($('par-topn').value, 10);
  const auto80 = $('par-80').checked;
  estado.par.exib = { topN: Number.isFinite(n) && n > 0 ? n : null, outros: $('par-outros').checked, auto80 };
  $('par-topn').disabled = auto80;
  $('par-outros').disabled = auto80;
  // gráfico e tabela mudam juntos; a seleção deixa de valer (os "Outros" mudam)
  if (estado.par.selecao.size) { estado.par.selecao.clear(); atualizarKpisPareto(); atualizarGraficoPareto(); }
  else desenharGraficoPareto();
  desenharTabelaPareto();
}

// ligações dos controles
['par-medida', 'par-periodo'].forEach((id) => $(id).addEventListener('change', () => {
  if (id === 'par-medida') estado.par.ordem = { col: colunaMedidaPareto(), desc: true };
  atualizarPareto();
}));
$('par-topn').addEventListener('input', lerExibicaoPareto);
$('par-outros').addEventListener('change', lerExibicaoPareto);
$('par-80').addEventListener('change', lerExibicaoPareto);
$('btn-expandir-par').addEventListener('click', () => {
  const P = estado.par;
  if (!P.tabela) return;
  const abrir = (no) => no.filhos.forEach((f) => {
    if (f.nivel < P.tabela.dims.length - 1) { P.expandidos.add(f.caminho); abrir(f); }
  });
  abrir(P.tabela.raiz);
  desenharTabelaPareto();
});
$('btn-recolher-par').addEventListener('click', () => { estado.par.expandidos = new Set(); desenharTabelaPareto(); });
$('btn-limpar-selecao-par').addEventListener('click', () => limparSelecaoPareto());
$('tabela-par').addEventListener('click', (e) => {
  const P = estado.par;
  const botao = e.target.closest('.btn-exp');
  if (botao) {
    const { caminho } = P.linhas[Number(botao.dataset.i)];
    if (P.expandidos.has(caminho)) P.expandidos.delete(caminho); else P.expandidos.add(caminho);
    desenharTabelaPareto();
    return;
  }
  const th = e.target.closest('th');
  if (th) {
    const col = th.dataset.col;
    P.ordem = P.ordem.col === col ? { col, desc: !P.ordem.desc } : { col, desc: col !== 'nome' && col !== 'classe' };
    desenharTabelaPareto();
    return;
  }
  const tr = e.target.closest('tbody tr');
  if (tr) {
    const linha = P.linhas[Number(tr.dataset.i)];
    alternarSelecaoPareto(linha.caminho, condicaoLinha(linha, P.tabela.dims), e.ctrlKey || e.metaKey);
  }
});

// =====================================================================
// Portfólio: matriz Linhas × Colunas em mapa de calor, com caixa "Leitura"
// e cópia como imagem. Respeita os filtros e as ELs.
// =====================================================================
const CHAVE_LEITURA = 'dashboard-farma:leitura:';
const COR_CALOR_MIN = [0xEE, 0xF1, 0xF5]; // #EEF1F5
const COR_CALOR_MAX = [0x1F, 0x2A, 0x44]; // #1F2A44
const MAX_COLUNAS_PORT = 60; // segurança: acima disso o restante vira "Outros"
const COL_OUTROS = '__outros__';
const MEDIDAS_PORT = { rcd: 'RCD', und: 'UND', preco: 'Preço (RCD/UND)' };
estado.port = {
  dimsLinhas: [], expandidos: new Set(), selecao: null, ordem: { col: '__total', desc: true },
  exib: { topN: null, outros: false, auto80: false }, exibCol: { topN: null, outros: false },
  dados: null, linhas: [], colunas: [],
};
estado.portPendente = true;

const medidaPort = () => document.querySelector('#port-medida button.ativo').dataset.medida;
const periodoPort = () => periodoDe($('port-periodo').value);

function prepararPortfolio() {
  const P = estado.port;
  const tem = (k) => estado.dims.some((d) => d.key === k);
  P.dimsLinhas = tem('molecula') ? ['molecula'] : estado.dims.slice(0, 1).map((d) => d.key);
  P.expandidos = new Set();
  P.selecao = null;
  P.ordem = { col: '__total', desc: true };
  const base = estado.dims.map((d) => d.key);
  montarSuspenso('dd-linhas-port', P.dimsLinhas, [...base, PRODUTO_CORP], () => {
    P.expandidos = new Set();
    atualizarPortfolio();
  });
  const sel = $('port-colunas');
  sel.innerHTML = [...base, PRODUTO_CORP].map((k) => `<option value="${k}">${escaparHtml(rotuloDim(k))}</option>`).join('');
  sel.value = tem('forma') ? 'forma' : base[Math.min(1, base.length - 1)];
}

// Filtros + o que foi clicado na matriz (só para os KPIs)
function whereSelPort() {
  const base = clausulaWhere(null);
  const s = estado.port.selecao;
  if (!s) return base;
  return base ? `${base} AND ${s.cond}` : `WHERE ${s.cond}`;
}

async function atualizarPortfolio() {
  estado.portPendente = false;
  const P = estado.port;
  const opcaoP = $('port-periodo').querySelector('option[value="MATP"]');
  opcaoP.hidden = !elLigado();
  if (!elLigado() && $('port-periodo').value === 'MATP') $('port-periodo').value = 'MAT0';
  P.selecao = null;
  const per = periodoPort();
  const dims = P.dimsLinhas;
  const colDim = $('port-colunas').value;
  const grupos = dims.map((k, i) => `${exprDim(k)} AS g${i}`);
  const linhas = await consultar(`SELECT ${grupos.length ? grupos.join(', ') + ',' : ''}
      ${exprDim(colDim)} AS c, ${somaPeriodo('rcd', per.atual)} AS r, ${somaPeriodo('und', per.atual)} AS u
    FROM fato ${clausulaWhere(null)} GROUP BY ALL`);
  P.dados = { linhas, dims: [...dims], colDim, per };
  carregarLeitura();
  montarMatrizPort();
  atualizarKpisPort();
}

async function atualizarKpisPort() {
  $('kpis-port').innerHTML = htmlCards(await cardsPeriodo(periodoPort(), whereSelPort()));
}

// ----- árvore das linhas: cada nó guarda RCD e UND por coluna -----
function noPort(nome, nivel, caminho, valores) {
  return { nome, nivel, caminho, valores, filhos: new Map(), cols: new Map(), r: 0, u: 0 };
}
function somarNoPort(no, c, r, u) {
  no.r += r; no.u += u;
  const cel = no.cols.get(c) || { r: 0, u: 0 };
  cel.r += r; cel.u += u;
  no.cols.set(c, cel);
}
function juntarNoPort(destino, origem) {
  origem.cols.forEach((v, c) => somarNoPort(destino, c, v.r, v.u));
}
// valor da medida: RCD, UND ou preço (RCD ÷ UND)
function valorPort(o, med) {
  if (!o) return null;
  if (med === 'preco') return o.u > 0 ? o.r / o.u : null;
  return med === 'rcd' ? o.r : o.u;
}

function montarMatrizPort() {
  const P = estado.port;
  if (!P.dados) return;
  const { linhas, dims } = P.dados;
  const raiz = noPort('Total', -1, '', []);
  for (const l of linhas) {
    const r = l.r || 0, u = l.u || 0;
    somarNoPort(raiz, l.c, r, u);
    let no = raiz;
    dims.forEach((_, i) => {
      const v = l['g' + i];
      let filho = no.filhos.get(v);
      if (!filho) { filho = noPort(v, i, no.caminho + SEP + v, [...no.valores, v]); no.filhos.set(v, filho); }
      somarNoPort(filho, l.c, r, u);
      no = filho;
    });
  }
  P.raiz = raiz;
  desenharMatrizPort();
}

// Colunas: ordenadas pelo total (desc.); Top N colunas + "Outros" sempre por último
function colunasPort(raiz, med) {
  const rank = med === 'preco' ? 'rcd' : med; // no Preço, a ordem/Top N segue o RCD
  const todas = [...raiz.cols.entries()].map(([c, v]) => ({ c, v: valorPort(v, rank) || 0 }))
    .sort((a, b) => b.v - a.v);
  const { topN, outros } = estado.port.exibCol;
  let n = topN ? Math.min(topN, todas.length) : todas.length;
  let agrupar = !!topN && outros;
  let nota = '';
  if (n > MAX_COLUNAS_PORT) { n = MAX_COLUNAS_PORT; agrupar = true; nota = `Mostrando as ${MAX_COLUNAS_PORT} maiores colunas; as demais estão em "Outros".`; }
  const manter = todas.slice(0, n).map((x) => ({ chave: x.c, nome: x.c }));
  const resto = todas.slice(n).map((x) => x.c);
  if (agrupar && resto.length) manter.push({ chave: COL_OUTROS, nome: 'Outros', membros: resto });
  else if (resto.length) nota = `${inteiro(resto.length)} colunas fora do Top N não aparecem (o Total considera todas).`;
  return { colunas: manter, nota };
}
// RCD/UND de um nó numa coluna (a coluna "Outros" soma as escondidas)
function celulaPort(no, col) {
  if (col.chave !== COL_OUTROS) return no.cols.get(col.chave) || null;
  const s = { r: 0, u: 0 };
  for (const c of col.membros) { const v = no.cols.get(c); if (v) { s.r += v.r; s.u += v.u; } }
  return s;
}

function formatoPort(max, med, modo) {
  if (modo !== 'valores') return { div: 1, sufixo: '', fmt: (v) => fmt1.format(v * 100) + '%' };
  if (med === 'preco') return { div: 1, sufixo: 'R$/UND', fmt: (v) => fmt2.format(v) };
  let u = $('port-unidade').value;
  if (u === 'auto') u = max >= 1e6 ? 'mi' : max >= 1e3 ? 'mil' : '';
  const div = u === 'mi' ? 1e6 : u === 'mil' ? 1e3 : 1;
  const sufixo = u === 'mi' ? 'Mi' : u === 'mil' ? 'Mil' : (med === 'rcd' ? 'R$' : 'UND');
  return { div, sufixo, fmt: div > 1 ? (v) => fmt2.format(v / div) : (v) => fmt0.format(v) };
}

function corCalor(t) {
  const c = COR_CALOR_MIN.map((a, i) => Math.round(a + (COR_CALOR_MAX[i] - a) * t));
  return `rgb(${c.join(',')})`;
}

function desenharMatrizPort() {
  const P = estado.port;
  if (!P.raiz) return;
  const { dims, colDim, per } = P.dados;
  const raiz = P.raiz;
  const med = medidaPort();
  const modo = med === 'preco' ? 'valores' : $('port-mostrar').value;
  $('port-mostrar').disabled = med === 'preco';
  const escopo = $('port-intensidade').value;
  const { colunas, nota: notaCol } = colunasPort(raiz, med);
  P.colunas = colunas;
  const rank = med === 'preco' ? 'rcd' : med;
  const totalGeral = valorPort(raiz, med);
  const totColuna = new Map(colunas.map((c) => [c.chave, celulaPort(raiz, c)]));

  // valor exibido conforme "Mostrar como"
  const exibido = (no, cel, col) => {
    const v = valorPort(cel, med);
    if (!valido(v) || v === 0) return null;
    if (modo === 'linha') return divisao(v, valorPort(no, med));
    if (modo === 'coluna') return divisao(v, valorPort(totColuna.get(col.chave), med));
    if (modo === 'total') return divisao(v, totalGeral);
    return v;
  };
  const exibidoTotal = (no) => {
    const v = valorPort(no, med);
    if (!valido(v) || v === 0) return null;
    if (modo === 'linha') return 1;
    if (modo === 'coluna' || modo === 'total') return divisao(v, totalGeral);
    return v;
  };

  // linhas visíveis: Top N / Outros / 80%, ordenação e +/-
  const { col: ordCol, desc } = P.ordem;
  const chaveOrdem = (no) => {
    if (ordCol === '__total') return valorPort(no, med);
    const col = colunas.find((c) => 'c:' + c.chave === ordCol);
    return col ? valorPort(celulaPort(no, col), med) : null;
  };
  const visiveis = [];
  let escondidos = 0;
  let cortou = false;
  const percorrer = (no) => {
    const filhos = [...no.filhos.values()];
    filhos.forEach((f) => { f.rank = valorPort(f, rank) || 0; });
    // cor fixa de cada item: posição pelo total (como nos gráficos das outras páginas)
    [...filhos].sort((a, b) => b.rank - a.rank).forEach((f, i) => { f.cor = CORES[i % CORES.length]; });
    const regra = aplicarExibicao(filhos, P.exib, 'rank');
    escondidos += regra.escondidos;
    const lista = regra.manter.sort((a, b) => {
      if (ordCol === '__nome') return (desc ? -1 : 1) * String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true });
      const va = chaveOrdem(a), vb = chaveOrdem(b);
      const xa = valido(va) ? va : -Infinity, xb = valido(vb) ? vb : -Infinity;
      return desc ? xb - xa : xa - xb;
    });
    if (regra.outros.length) {
      const outros = noPort('Outros', no.nivel + 1, no.caminho + SEP + '__outros__', no.valores);
      outros.ehOutros = true;
      outros.membros = regra.outros.map((f) => f.nome);
      outros.cor = COR_OUTROS;
      for (const f of regra.outros) juntarNoPort(outros, f);
      lista.push(outros);
    }
    for (const f of lista) {
      if (visiveis.length >= MAX_LINHAS_TABELA) { cortou = true; return; }
      visiveis.push(f);
      if (!f.ehOutros && f.nivel < dims.length - 1 && P.expandidos.has(f.caminho)) percorrer(f);
    }
  };
  if (dims.length) percorrer(raiz);
  else visiveis.push(Object.assign(raiz, { nivel: 0, nome: 'Total', cor: CORES[0] }));
  P.linhas = visiveis;

  // valores exibidos e faixa do mapa de calor (tabela toda / por linha / por coluna, por nível)
  const grade = visiveis.map((no) => colunas.map((c) => exibido(no, celulaPort(no, c), c)));
  const faixas = new Map();
  const chaveFaixa = (i, j) => (escopo === 'linha' ? 'l' + i : escopo === 'coluna' ? `c${j}|${visiveis[i].nivel}` : 'n' + visiveis[i].nivel);
  grade.forEach((lin, i) => lin.forEach((v, j) => {
    if (!valido(v)) return;
    const k = chaveFaixa(i, j);
    const f = faixas.get(k) || { min: Infinity, max: -Infinity };
    f.min = Math.min(f.min, v); f.max = Math.max(f.max, v);
    faixas.set(k, f);
  }));
  const maxAbs = Math.max(0, ...grade.flat().filter(valido), ...visiveis.map((no) => exibidoTotal(no) || 0));
  const fmtP = formatoPort(maxAbs, med, modo);

  // título e rótulos
  const nomeLinhas = dims.length ? dims.map(rotuloDim).join(' › ') : '(sem linhas)';
  const unidade = modo === 'linha' ? '% da linha' : modo === 'coluna' ? '% da coluna' : modo === 'total' ? '% do total' : fmtP.sufixo;
  $('port-titulo').textContent = `${MEDIDAS_PORT[med]} ${per.rot} — ${nomeLinhas} × ${rotuloDim(colDim)} (${unidade})`;

  const s = P.selecao;
  const seta = (id) => (ordCol === id ? (desc ? ' ▼' : ' ▲') : '');
  const ordenar = (id) => `<span class="port-ordenar" data-ordem="${id}" title="Ordenar">⇅</span>`;
  const comMS = med !== 'preco';
  const cab = `<thead><tr>
      <th class="port-canto" data-ordem="__nome">${escaparHtml(nomeLinhas)}${seta('__nome')}</th>
      ${colunas.map((c, j) => `<th class="port-col${s && s.col === c.chave && s.tipo !== 'linha' ? ' port-sel' : ''}" data-j="${j}" title="${escaparHtml(c.nome)}">
        <span class="port-col-nome">${escaparHtml(c.nome)}</span>${seta('c:' + c.chave)}${ordenar('c:' + c.chave)}</th>`).join('')}
      <th class="port-tot-cab" data-ordem="__total">Total${seta('__total')}</th>
      ${comMS ? '<th class="port-tot-cab">MS%</th>' : ''}
    </tr></thead>`;

  const fmtCel = (v) => (valido(v) ? fmtP.fmt(v) : '');
  const dica = (no, cel, col) => {
    if (!cel || !(cel.r || cel.u)) return '';
    const base = med === 'preco' ? 'rcd' : med;
    const v = valorPort(cel, base);
    const linhasD = [
      `${no.nome} × ${col.nome}`,
      `${MEDIDAS_PORT[med]}: ${med === 'preco' ? reais(valorPort(cel, 'preco')) : inteiro(valorPort(cel, med))}`,
      `% da linha: ${percentual(divisao(v, valorPort(no, base)))}`,
      `% da coluna: ${percentual(divisao(v, valorPort(totColuna.get(col.chave), base)))}`,
      `% do total: ${percentual(divisao(v, valorPort(raiz, base)))}`,
      `RCD/UND: ${reais(valorPort(cel, 'preco'))}`,
    ];
    if (med === 'preco') linhasD.splice(2, 0, `RCD: ${inteiro(cel.r)} · UND: ${inteiro(cel.u)}`);
    return escaparHtml(linhasD.join('\n'));
  };
  const corpo = '<tbody>' + visiveis.map((no, i) => {
    const podeAbrir = !no.ehOutros && no.nivel < dims.length - 1;
    const aberto = P.expandidos.has(no.caminho);
    const botao = podeAbrir
      ? `<button class="btn-exp" data-i="${i}" title="${aberto ? 'Recolher' : 'Expandir'}">${aberto ? '−' : '+'}</button>`
      : '<span class="btn-exp-vazio"></span>';
    const linhaSel = s && s.tipo !== 'coluna' && s.caminho === no.caminho;
    const celulas = colunas.map((c, j) => {
      const v = grade[i][j];
      const cel = celulaPort(no, c);
      const selec = s && s.tipo === 'celula' && s.caminho === no.caminho && s.col === c.chave ? ' port-sel' : '';
      if (!valido(v)) return `<td class="port-cel port-vazia${selec}" data-i="${i}" data-j="${j}"></td>`;
      const f = faixas.get(chaveFaixa(i, j));
      const t = f.max > f.min ? (v - f.min) / (f.max - f.min) : 1;
      return `<td class="port-cel${selec}" data-i="${i}" data-j="${j}" title="${dica(no, cel, c)}"
        style="background:${corCalor(t)};color:${t > 0.45 ? '#FFFFFF' : '#1F2A44'}">${fmtCel(v)}</td>`;
    }).join('');
    const tot = exibidoTotal(no);
    return `<tr class="nivel-${Math.min(no.nivel, 3)}${no.ehOutros ? ' linha-outros' : ''}">
      <td class="port-nome${linhaSel ? ' port-sel' : ''}" data-i="${i}" style="padding-left:${8 + no.nivel * 18}px">${botao}<span class="port-quad" style="background:${no.cor}"></span>${escaparHtml(no.nome)}</td>
      ${celulas}
      <td class="port-tot">${fmtCel(tot)}</td>
      ${comMS ? `<td class="port-tot">${percentual(divisao(valorPort(no, med), totalGeral))}</td>` : ''}</tr>`;
  }).join('') + '</tbody>';
  const rodape = `<tfoot><tr><td>Total</td>
    ${colunas.map((c) => {
      const cel = totColuna.get(c.chave);
      const v = valorPort(cel, med);
      const x = !valido(v) || v === 0 ? null : modo === 'linha' ? divisao(v, totalGeral) : modo === 'coluna' ? 1 : modo === 'total' ? divisao(v, totalGeral) : v;
      return `<td>${fmtCel(x)}</td>`;
    }).join('')}
    <td>${fmtCel(modo === 'valores' ? totalGeral : 1)}</td>${comMS ? `<td>${percentual(totalGeral ? 1 : null)}</td>` : ''}</tr></tfoot>`;
  $('tabela-port').innerHTML = cab + corpo + rodape;

  $('btn-expandir-port').hidden = $('btn-recolher-port').hidden = dims.length < 2;
  $('btn-limpar-selecao-port').hidden = !s;
  $('dica-selecao-port').textContent = s
    ? `Cards filtrados por: ${s.rotulo}.`
    : 'Clique numa célula, no nome de uma linha ou no cabeçalho de uma coluna para filtrar os cards. ⇅ no cabeçalho reordena as linhas.';
  const notas = [];
  if (notaCol) notas.push(notaCol);
  if (cortou) notas.push(`Mostrando as primeiras ${inteiro(MAX_LINHAS_TABELA)} linhas.`);
  if (escondidos) notas.push(`${inteiro(escondidos)} linhas fora do Top N não aparecem (o Total considera todas).`);
  if (med === 'preco') notas.push('Preço = RCD ÷ UND de cada combinação; o Total é o preço médio ponderado.');
  $('nota-port').textContent = notas.join(' ');
  desenharRodapePort();
}

// rodapé: fonte e meses do período
function desenharRodapePort() {
  const per = periodoPort();
  let ini = '', fim = '';
  if (per.atual === 'MATP') { const p = rotulosProjetados(); ini = p[0]; fim = p[p.length - 1]; }
  else {
    const j = per.atual.startsWith('YTD') ? indicesJanela('YTD', 0) : indicesJanela('MAT', Number(per.atual.slice(3)));
    if (j.length) { ini = estado.meses[j[0]]; fim = estado.meses[j[j.length - 1]]; }
  }
  $('port-fonte').textContent = `Fonte: ${estado.nomeArquivo || '-'} · ${per.rot} = ${ini || '?'} a ${fim || '?'}`;
}

// ----- clique: célula, linha ou coluna filtra os KPIs -----
function condColunaPort(col) {
  const e = exprDim(estado.port.dados.colDim);
  return col.chave === COL_OUTROS ? `${e} IN (${col.membros.map(sqlTexto).join(', ')})` : `${e} = ${sqlTexto(col.chave)}`;
}
function selecionarPort(nova) {
  const P = estado.port;
  const igual = P.selecao && nova && P.selecao.tipo === nova.tipo && P.selecao.caminho === nova.caminho && P.selecao.col === nova.col;
  P.selecao = igual ? null : nova;
  desenharMatrizPort();
  atualizarKpisPort();
}
$('tabela-port').addEventListener('click', (e) => {
  const P = estado.port;
  const botao = e.target.closest('.btn-exp');
  if (botao) {
    const { caminho } = P.linhas[Number(botao.dataset.i)];
    if (P.expandidos.has(caminho)) P.expandidos.delete(caminho); else P.expandidos.add(caminho);
    desenharMatrizPort();
    return;
  }
  const ord = e.target.closest('[data-ordem]');
  if (ord) {
    const col = ord.dataset.ordem;
    P.ordem = P.ordem.col === col ? { col, desc: !P.ordem.desc } : { col, desc: col !== '__nome' };
    desenharMatrizPort();
    return;
  }
  const th = e.target.closest('th.port-col');
  if (th) {
    const col = P.colunas[Number(th.dataset.j)];
    selecionarPort({ tipo: 'coluna', caminho: null, col: col.chave, cond: condColunaPort(col), rotulo: col.nome });
    return;
  }
  const nome = e.target.closest('td.port-nome');
  if (nome) {
    const no = P.linhas[Number(nome.dataset.i)];
    selecionarPort({ tipo: 'linha', caminho: no.caminho, col: null, cond: condicaoLinha(no, P.dados.dims), rotulo: no.nome });
    return;
  }
  const td = e.target.closest('td.port-cel');
  if (td && !td.classList.contains('port-vazia')) {
    const no = P.linhas[Number(td.dataset.i)];
    const col = P.colunas[Number(td.dataset.j)];
    selecionarPort({
      tipo: 'celula', caminho: no.caminho, col: col.chave, rotulo: `${no.nome} × ${col.nome}`,
      cond: `(${condicaoLinha(no, P.dados.dims)} AND ${condColunaPort(col)})`,
    });
  }
});

// ----- Leitura: texto livre guardado no navegador por combinação -----
function chaveLeitura() {
  const P = estado.port;
  return CHAVE_LEITURA + [P.dimsLinhas.join('>'), $('port-colunas').value, medidaPort(), $('port-periodo').value].join('|');
}
function carregarLeitura() {
  let texto = '';
  try { texto = localStorage.getItem(chaveLeitura()) || ''; } catch { /* sem armazenamento */ }
  $('port-leitura').value = texto;
}
$('port-leitura').addEventListener('input', () => {
  try {
    const v = $('port-leitura').value;
    if (v) localStorage.setItem(chaveLeitura(), v); else localStorage.removeItem(chaveLeitura());
  } catch { /* sem armazenamento */ }
});

// ----- Exibição e controles -----
function lerExibicaoPort() {
  const P = estado.port;
  const n = parseInt($('port-topn').value, 10);
  const auto80 = $('port-80').checked;
  P.exib = { topN: Number.isFinite(n) && n > 0 ? n : null, outros: $('port-outros').checked, auto80 };
  $('port-topn').disabled = auto80;
  $('port-outros').disabled = auto80;
  const nc = parseInt($('port-topn-col').value, 10);
  P.exibCol = { topN: Number.isFinite(nc) && nc > 0 ? nc : null, outros: $('port-outros-col').checked };
  // linhas/colunas "Outros" mudam de conteúdo: a seleção deixa de valer
  if (P.selecao) { P.selecao = null; atualizarKpisPort(); }
  desenharMatrizPort();
}
['port-topn', 'port-topn-col'].forEach((id) => $(id).addEventListener('input', lerExibicaoPort));
['port-outros', 'port-80', 'port-outros-col'].forEach((id) => $(id).addEventListener('change', lerExibicaoPort));
['port-colunas', 'port-periodo'].forEach((id) => $(id).addEventListener('change', atualizarPortfolio));
['port-mostrar', 'port-unidade', 'port-intensidade'].forEach((id) => $(id).addEventListener('change', desenharMatrizPort));
document.querySelectorAll('#port-medida button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#port-medida button').forEach((x) => x.classList.toggle('ativo', x === b));
  carregarLeitura();
  desenharMatrizPort();
}));
$('btn-expandir-port').addEventListener('click', () => {
  const P = estado.port;
  const abrir = (no) => no.filhos.forEach((f) => {
    if (f.nivel < P.dados.dims.length - 1) { P.expandidos.add(f.caminho); abrir(f); }
  });
  if (P.raiz) abrir(P.raiz);
  desenharMatrizPort();
});
$('btn-recolher-port').addEventListener('click', () => { estado.port.expandidos = new Set(); desenharMatrizPort(); });
$('btn-limpar-selecao-port').addEventListener('click', () => selecionarPort(null));

// =====================================================================
// Lançamentos Mercado: só os produtos lançados no período escolhido,
// com eixo em calendário ou alinhado no mês de lançamento (Mês 1).
// Respeita os filtros da página Filtros. Com "Incluir ELs e MAT+1"
// ligado, as ELs também são lançamentos (Mês 1 da EL = mês de lançamento).
// =====================================================================
const LANC = '__lanc'; // dimensão "Lançamento" (apresentação ou marca, conforme o Nível)
const CAMPOS_LANC = ['rA', 'uA', 'pfA', 'rcA', 'r12', 'u12', 'mat0', 'rY0', 'rY1', 'rY2', 'uY0', 'uY1', 'uY2'];
const COR_MEDIA = '#000000';
estado.lanc = {
  dimsGrafico: [LANC], dimsTabela: [LANC], expandidos: new Set(), selecao: new Map(), ocultas: new Set(),
  ordem: { col: 'ar0', desc: true }, exib: { topN: null, outros: false, auto80: false },
  dados: null, calc: null, tabela: null, linhas: [],
};
estado.lancPendente = true;

const rotuloDimLanc = (k) => (k === LANC ? 'Lançamento' : rotuloDim(k));
const valorLanc = (it, k) => (k === LANC ? it.unidade : it.d[k]);
// rótulo de um mês da linha do tempo (meses projetados do MAT+1 com *)
function rotuloTempo(t) {
  const N = estado.meses.length;
  if (t < N) return t >= 0 ? estado.meses[t] : '-';
  const p = rotulosProjetados()[t - N];
  return p ? p + '*' : '-';
}

function prepararLanc() {
  const L = estado.lanc;
  L.dimsGrafico = [LANC];
  L.dimsTabela = [LANC];
  L.expandidos = new Set();
  L.selecao = new Map();
  L.ocultas = new Set();
  L.ordem = { col: 'ar0', desc: true };
  const opcoes = estado.meses.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  $('lanc-ini').innerHTML = opcoes;
  $('lanc-fim').innerHTML = opcoes;
  const N = estado.meses.length;
  $('lanc-ini').value = String(Math.max(0, N - 36)); // padrão: últimos 36 meses da base
  $('lanc-fim').value = String(Math.max(0, N - 1));
  renderizarSeletoresLanc();
}

function renderizarSeletoresLanc() {
  const L = estado.lanc;
  const base = estado.dims.map((d) => d.key);
  montarSuspenso('dd-grafico-lanc', L.dimsGrafico, [LANC, ...base], desenharGraficosLanc, rotuloDimLanc);
  montarSuspenso('dd-tabela-lanc', L.dimsTabela, [LANC, ...base, PRODUTO_CORP], () => {
    L.expandidos = new Set();
    const tinha = L.selecao.size > 0;
    L.selecao.clear();
    montarTabelaLanc();
    if (tinha) { atualizarKpisLanc(); desenharGraficosLanc(); }
  }, rotuloDimLanc);
}

// Busca na base os SKUs lançados no período (com os valores de todos os meses)
async function atualizarLanc() {
  estado.lancPendente = false;
  const L = estado.lanc;
  L.selecao.clear();
  const N = estado.meses.length;
  if (!N) {
    L.dados = null;
    $('nota-tabela-lanc').textContent = 'A base não tem colunas mensais: não dá para identificar lançamentos.';
    return;
  }
  const NT = N + (elLigado() ? 12 : 0); // com as ELs ligadas, a linha do tempo inclui os 12 meses do MAT+1
  const idx0 = estado.mesesObj[0].indice;
  const janela = indicesJanela('MAT', 0);
  const mesEL = janela.length ? janela[0] : Math.max(0, N - 12);
  let ini = Number($('lanc-ini').value) || 0;
  let fim = Number($('lanc-fim').value);
  if (!Number.isFinite(fim)) fim = N - 1;
  if (ini > fim) { fim = ini; $('lanc-fim').value = String(fim); }
  // mês de lançamento de cada SKU: cadastro ou primeiro mês com unidades > 0
  // (vendendo já no 1º mês da base = lançado antes da base: −1, fica fora do período)
  const lancSku = $('lanc-data').value === 'venda'
    ? `COALESCE(${estado.meses.map((_, i) => `CASE WHEN und_m${i} > 0 THEN ${i || -1} END`).join(', ')})`
    : `lanc_cad - ${idx0}`;
  const unidade = $('lanc-nivel').value === 'marca' ? `(d_produto || ' (' || sigla || ')')` : 'd_apres';
  const dims = estado.dims.map((d) => `d_${d.key} AS "k_${d.key}"`);
  dims.push(`(d_produto || ' (' || sigla || ')') AS "k_${PRODUTO_CORP}"`);
  const valores = [];
  const mercado = [];
  for (let t = 0; t < NT; t++) {
    const c = t < N ? `m${t}` : `p${t - N}`;
    for (const m of ['rcd', 'und', 'pf', 'rc']) valores.push(`${colExpr(m, c)} AS ${m}_${t}`);
    mercado.push(`SUM(${colExpr('und', c)}) AS u_${t}`, `SUM(${colExpr('rcd', c)}) AS r_${t}`);
  }
  const where = clausulaWhere(null);
  const [linhas, [merc]] = await Promise.all([
    consultar(`WITH b AS (
        SELECT *, CASE WHEN is_el THEN ${mesEL} ELSE ${lancSku} END AS l_sku, ${unidade} AS unidade FROM fato ${where}
      ), u AS (SELECT *, min(l_sku) OVER (PARTITION BY unidade) AS l_lanc FROM b)
      SELECT unidade, l_lanc, is_el, COALESCE(rcd_MAT0, 0) AS mat0, ${dims.join(', ')}, ${valores.join(', ')}
      FROM u WHERE l_lanc BETWEEN ${ini} AND ${fim}`),
    consultar(`SELECT SUM(rcd_MAT0) AS rmat, ${mercado.join(', ')} FROM fato ${where}`),
  ]);
  const chaves = [...estado.dims.map((d) => d.key), PRODUTO_CORP];
  const itens = linhas.map((l) => {
    const it = { unidade: l.unidade, L: l.l_lanc, el: !!l.is_el, mat0: l.mat0, d: {}, r: [], u: [], p: [], c: [] };
    for (const k of chaves) it.d[k] = l['k_' + k];
    for (let t = 0; t < NT; t++) {
      it.r.push(l['rcd_' + t] || 0); it.u.push(l['und_' + t] || 0);
      it.p.push(l['pf_' + t] || 0); it.c.push(l['rc_' + t] || 0);
    }
    return it;
  });
  L.dados = {
    itens, N, NT, rmat: merc.rmat,
    mercadoU: Array.from({ length: NT }, (_, t) => merc['u_' + t] || 0),
    mercadoR: Array.from({ length: NT }, (_, t) => merc['r_' + t] || 0),
  };
  calcularLanc();
  desenharLancTudo();
}

// Eixo e métricas no horizonte (sem consultar a base de novo)
function calcularLanc() {
  const L = estado.lanc;
  if (!L.dados) { L.calc = null; return; }
  const { itens, N, NT } = L.dados;
  const H = Number($('lanc-horizonte').value) || 12;
  const alinhado = $('lanc-eixo').value === 'alinhado';
  const inicio = itens.length ? Math.min(...itens.map((it) => it.L)) : 0; // Calendário: lançamento mais antigo
  const posicoes = alinhado ? H : Math.max(0, Math.min(H, NT - inicio));
  const rotulos = Array.from({ length: posicoes }, (_, k) => (alinhado ? `Mês ${k + 1}` : rotuloTempo(inicio + k)));
  const tempo = (it, k) => (alinhado ? it.L + k : inicio + k); // mês da base na posição k do eixo
  for (const it of itens) {
    // SKUs reais param no último mês da base; as ELs seguem pelos 12 meses do MAT+1
    const fimDados = it.el ? NT : N;
    it.pos = []; // posição do eixo -> mês da base (null = sem dado: antes do lançamento ou depois da base)
    for (const c of ['rA', 'uA', 'pfA', 'rcA']) it[c] = 0;
    for (let k = 0; k < posicoes; k++) {
      const t = tempo(it, k);
      const ok = t >= it.L && t < fimDados;
      it.pos.push(ok ? t : null);
      if (!ok) continue;
      it.rA += it.r[t]; it.uA += it.u[t]; it.pfA += it.p[t]; it.rcA += it.c[t];
    }
    const t12 = it.L + 11;
    it.t12 = t12 < fimDados ? t12 : null;
    it.r12 = it.t12 !== null ? it.r[t12] : 0;
    it.u12 = it.t12 !== null ? it.u[t12] : 0;
    it.info = { L: it.L, t12: it.t12 };
  }
  // Ano 1 = Meses 1–12 desde o lançamento, Ano 2 = 13–24, Ano 3 = 25–36 (quantos o Horizonte pedir).
  // O mercado de cada ano é somado nos MESMOS meses do calendário daquele ano do lançamento.
  const nAnos = Math.round(H / 12);
  const { mercadoR, mercadoU } = L.dados;
  const fimUnidade = new Map();
  for (const it of itens) fimUnidade.set(it.unidade, Math.max(fimUnidade.get(it.unidade) || 0, it.el ? NT : N));
  for (const it of itens) {
    const fim = fimUnidade.get(it.unidade);
    it.info.anos = [];
    for (let a = 0; a < 3; a++) {
      let r = 0, u = 0, meses = 0, mR = 0, mU = 0;
      for (let j = 0; j < 12 && a < nAnos; j++) {
        const t = it.L + 12 * a + j;
        if (t >= fim) break;
        meses++; r += it.r[t]; u += it.u[t]; mR += mercadoR[t]; mU += mercadoU[t];
      }
      it['rY' + a] = r; it['uY' + a] = u;
      it.info.anos.push({ meses, mR, mU });
    }
  }
  const projetado = new Set();
  if (!alinhado) for (let k = 0; k < posicoes; k++) if (inicio + k >= N) projetado.add(k);
  L.calc = { H, alinhado, inicio, posicoes, rotulos, projetado, nAnos };
}

function itensSelecionadosLanc() {
  const L = estado.lanc;
  if (!L.dados) return [];
  if (!L.selecao.size) return L.dados.itens;
  const conds = [...L.selecao.values()];
  return L.dados.itens.filter((it) => conds.some((f) => f(it)));
}

function desenharLancTudo() {
  if (!estado.lanc.dados) return;
  atualizarKpisLanc();
  desenharGraficosLanc();
  montarTabelaLanc();
}

// ----- KPIs -----
function atualizarKpisLanc() {
  const L = estado.lanc;
  if (!L.calc) return;
  const itens = itensSelecionadosLanc();
  const unidades = new Map();
  let rA = 0, uA = 0, mat = 0, u12 = 0;
  for (const it of itens) {
    unidades.set(it.unidade, it.info);
    rA += it.rA; uA += it.uA; mat += it.mat0; u12 += it.u12;
  }
  const com12 = [...unidades.values()].filter((i) => i.t12 !== null).length;
  const H = L.calc.H;
  const cards = [
    ['kpi-cont', 'Nº de lançamentos', inteiro(unidades.size)],
    ['kpi-rcd', `RCD acumulado (${H} meses)`, abreviar(rA)],
    ['kpi-und', `UND acumulado (${H} meses)`, abreviar(uA)],
    ['kpi-rcd', 'Lançamentos no RCD MAT do mercado', percentual(divisao(mat, L.dados.rmat))],
    ['kpi-und', 'Média de UND no Mês 12 por lançamento',
      `${com12 ? abreviar(u12 / com12) : '-'} <small>${com12} de ${unidades.size} com 12 meses</small>`],
  ];
  $('kpis-lanc').innerHTML = cards.map(([cls, rotulo, valor]) =>
    `<div class="kpi ${cls}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div></div>`).join('');
}

// ----- Gráficos -----
// soma os valores de vários itens em cada posição do eixo (null onde nenhum tem dado)
function somarPosicoes(itens, campo, n) {
  const v = new Array(n).fill(null);
  for (const it of itens) {
    it.pos.forEach((t, k) => { if (t !== null) v[k] = (v[k] || 0) + it[campo][t]; });
  }
  return v;
}
function acumular(v) {
  let s = 0;
  return v.map((x) => (x === null ? null : (s += x)));
}

function desenharGraficosLanc() {
  const L = estado.lanc;
  if (!L.calc) return;
  const { posicoes, rotulos, projetado, alinhado } = L.calc;
  const { N } = L.dados;
  const acum = $('lanc-acum').value === 'acum';
  const tipo = $('lanc-tipo').value;
  const itens = itensSelecionadosLanc();
  const dims = L.dimsGrafico;

  // um grupo por combinação das dimensões do "Gráfico" (padrão: um por lançamento)
  const porGrupo = new Map();
  for (const it of itens) {
    const g = dims.length ? dims.map((k) => valorLanc(it, k)).join(' | ') : 'Total';
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(it);
  }
  const montar = (nome, lista) => {
    const linha = { g: nome, el: lista.some((it) => it.el), r0: lista.reduce((s, it) => s + it.rA, 0) };
    let r = somarPosicoes(lista, 'r', posicoes);
    let u = somarPosicoes(lista, 'u', posicoes);
    if (acum) { r = acumular(r); u = acumular(u); }
    r.forEach((v, k) => { linha['r_' + k] = v; linha['u_' + k] = u[k]; });
    // no eixo alinhado, cada lançamento chega ao MAT+1 projetado num ponto diferente
    const proj = new Set();
    if (alinhado) for (const it of lista) it.pos.forEach((t, k) => { if (t !== null && t >= N) proj.add(k); });
    return { linha, proj, lista };
  };
  const todos = [...porGrupo].map(([nome, lista]) => montar(nome, lista));
  const regra = aplicarExibicao(todos.map((x) => Object.assign(x.linha, { _x: x })), L.exib);
  let manter = regra.manter.map((l) => l._x);
  let outros = regra.outros.map((l) => l._x);
  let nota = regra.escondidos ? `${inteiro(regra.escondidos)} itens fora do Top N não aparecem.` : '';
  if (manter.length > MAX_SERIES) {
    outros = [...manter.slice(MAX_SERIES), ...outros];
    manter = manter.slice(0, MAX_SERIES);
    nota = `Mostrando os ${MAX_SERIES} maiores; os demais estão em "Outros".`;
  }
  const grupos = manter.map((x, i) => ({ nome: x.linha.g, linha: x.linha, cor: CORES[i % CORES.length], proj: x.proj }));
  if (outros.length) {
    const o = montar('Outros', outros.flatMap((x) => x.lista));
    grupos.push({ nome: 'Outros', linha: o.linha, cor: COR_OUTROS, proj: o.proj });
  }
  const totalGeral = {};
  for (let k = 0; k < posicoes; k++) {
    totalGeral['r_' + k] = todos.reduce((s, x) => s + (x.linha['r_' + k] || 0), 0);
    totalGeral['u_' + k] = todos.reduce((s, x) => s + (x.linha['u_' + k] || 0), 0);
  }
  const per = { mes: true, rotulos, colunas: rotulos.map((_, k) => k), projetado, atual: posicoes - 1 };

  if (tipo === 'waterfall') {
    const n = L.exib.topN || 5;
    const linhas = todos.map((x) => x.linha);
    desenharWaterfall('grafico-lanc-rcd', linhas, 'r_', per, n);
    desenharWaterfall('grafico-lanc-und', linhas, 'u_', per, n);
    desenharLegendaLanc([
      { nome: 'Total', cor: WF.total }, { nome: 'Aumento', cor: WF.aumento },
      { nome: 'Queda', cor: WF.queda }, { nome: 'Outros', cor: WF.outros },
    ], false, true);
    $('nota-grafico-lanc').textContent = `Waterfall: do primeiro ao último ponto do eixo, os ${n} itens de maior variação; o restante está em "Outros".`;
    return;
  }

  // média por lançamento em cada ponto do eixo (só os lançamentos que já têm aquele mês)
  const comMedia = $('lanc-media').checked && tipo !== 'cem';
  const extras = (campo) => {
    if (!comMedia) return [];
    const porUnidade = new Map();
    for (const it of itens) {
      if (!porUnidade.has(it.unidade)) porUnidade.set(it.unidade, []);
      porUnidade.get(it.unidade).push(it);
    }
    const soma = new Array(posicoes).fill(0);
    const qtd = new Array(posicoes).fill(0);
    for (const lista of porUnidade.values()) {
      let v = somarPosicoes(lista, campo, posicoes);
      if (acum) v = acumular(v);
      v.forEach((x, k) => { if (x !== null) { soma[k] += x; qtd[k]++; } });
    }
    return [{
      name: 'Média dos lançamentos', type: 'line', z: 10, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: COR_MEDIA }, lineStyle: { color: COR_MEDIA, type: 'dashed', width: 2 },
      label: { show: false },
      data: soma.map((s, k) => (qtd[k] ? { value: s / qtd[k], bruto: s / qtd[k] } : null)),
    }];
  };
  const opcoes = (campo) => ({ ocultas: L.ocultas, nulos: true, rotulos: grupos.length <= 4, extras: extras(campo) });
  desenharGrafico('grafico-lanc-rcd', grupos, 'r_', per, totalGeral, tipo, opcoes('r'));
  desenharGrafico('grafico-lanc-und', grupos, 'u_', per, totalGeral, tipo, opcoes('u'));
  desenharLegendaLanc(grupos, comMedia);
  if (!itens.length) nota = 'Nenhum lançamento no período escolhido (confira "Lançados desde" e os filtros).';
  if (alinhado) nota += (nota ? ' ' : '') + 'Mês 1 = mês de lançamento. Linhas interrompidas: o lançamento ainda não tem esse mês.';
  if (projetado.size || grupos.some((g) => g.proj.size)) nota += ' Pontos hachurados/vazados = meses projetados (MAT+1).';
  if ($('lanc-media').checked && tipo === 'cem') nota += ' A média não aparece no gráfico 100%.';
  $('nota-grafico-lanc').textContent = nota;
}

function desenharLegendaLanc(grupos, comMedia, estatica = false) {
  const leg = $('legenda-lanc');
  leg._grupos = grupos;
  leg._estatica = estatica;
  leg.innerHTML = grupos.map((g, i) =>
    `<div class="leg-item${estatica ? ' estatica' : ''}${!estatica && estado.lanc.ocultas.has(g.nome) ? ' oculta' : ''}" data-i="${i}" title="${escaparHtml(g.nome)}">
      <span class="leg-cor" style="background:${g.cor}"></span><span class="leg-nome">${escaparHtml(g.nome)}</span>${g.linha && g.linha.el ? '<span class="tag-el">EL</span>' : ''}
    </div>`).join('')
    + (comMedia ? '<div class="leg-item estatica"><span class="leg-media"></span><span class="leg-nome">Média dos lançamentos</span></div>' : '');
}

$('legenda-lanc').addEventListener('click', (e) => {
  const leg = $('legenda-lanc');
  const item = e.target.closest('.leg-item[data-i]');
  if (!item || leg._estatica) return;
  const nome = leg._grupos[Number(item.dataset.i)].nome;
  const ocultas = estado.lanc.ocultas;
  if (ocultas.has(nome)) ocultas.delete(nome); else ocultas.add(nome);
  for (const id of ['grafico-lanc-rcd', 'grafico-lanc-und']) {
    if (estado.graficos[id]) estado.graficos[id].dispatchAction({ type: 'legendToggleSelect', name: nome });
  }
  item.classList.toggle('oculta', ocultas.has(nome));
});

// ----- Tabela (matriz) -----
function noLanc(nome, nivel, caminho, valores) {
  const no = { nome, nivel, caminho, valores, filhos: new Map(), unidades: new Map(), el: false };
  for (const c of CAMPOS_LANC) no[c] = 0;
  return no;
}
function somarNoLanc(no, it) {
  for (const c of CAMPOS_LANC) no[c] += it[c] || 0;
  no.unidades.set(it.unidade, it.info);
  if (it.el) no.el = true;
}
function juntarNosLanc(destino, origem) {
  for (const c of CAMPOS_LANC) destino[c] += origem[c] || 0;
  origem.unidades.forEach((v, k) => destino.unidades.set(k, v));
  if (origem.el) destino.el = true;
}
// Anos, Mês 12 e médias. MS% = valor do lançamento ÷ valor do mercado filtrado nos mesmos meses
function completarNoLanc(no) {
  const { N, mercadoU, mercadoR } = estado.lanc.dados;
  const { nAnos } = estado.lanc.calc;
  let minL = Infinity, maxL = -Infinity, n12 = 0, mercado12U = 0, mercado12R = 0;
  for (const inf of no.unidades.values()) {
    minL = Math.min(minL, inf.L);
    maxL = Math.max(maxL, inf.L);
    if (inf.t12 !== null) { n12++; mercado12U += mercadoU[inf.t12] || 0; mercado12R += mercadoR[inf.t12] || 0; }
  }
  no.nLanc = no.unidades.size;
  no.L = no.nLanc ? minL : null;
  no.Lfim = no.nLanc ? maxL : null;
  no.meses = no.nLanc ? N - minL : null;
  no.r12v = n12 ? no.r12 : null;
  no.u12v = n12 ? no.u12 : null;
  no.ms12 = n12 ? divisao(no.u12, mercado12U) : null;
  no.msr12 = n12 ? divisao(no.r12, mercado12R) : null;
  // cada ano soma só os lançamentos que já têm dado naquele ano
  no.anos = [];
  for (let a = 0; a < nAnos; a++) {
    let n = 0, parciais = 0, minMeses = 12, mR = 0, mU = 0;
    for (const inf of no.unidades.values()) {
      const y = inf.anos[a];
      if (!y.meses) continue;
      n++; mR += y.mR; mU += y.mU;
      if (y.meses < 12) { parciais++; minMeses = Math.min(minMeses, y.meses); }
    }
    no.anos.push({ n, parciais, minMeses });
    no['ar' + a] = n ? no['rY' + a] : null;
    no['au' + a] = n ? no['uY' + a] : null;
    no['amr' + a] = n ? divisao(no['rY' + a], mR) : null;
    no['amu' + a] = n ? divisao(no['uY' + a], mU) : null;
    if (a > 0) {
      // um lançamento só: Evol. em branco se algum dos dois anos estiver incompleto
      const incompleto = no.nLanc === 1 && (parciais || no.anos[a - 1].parciais);
      no['aer' + a] = incompleto ? null : evolucao(no['ar' + a], no['ar' + (a - 1)]);
      no['aeu' + a] = incompleto ? null : evolucao(no['au' + a], no['au' + (a - 1)]);
    }
  }
  no.pfU = divisao(no.pfA, no.uA);
  no.rcdU = divisao(no.rA, no.uA);
  no.rcU = divisao(no.rcA, no.uA);
  no.desc = no.pfA ? 1 - no.rA / no.pfA : null;
  no.margem = no.rcA ? 1 - no.rA / no.rcA : null;
  no.r0 = no.rA; // Top N / 80% pelo RCD acumulado no horizonte
}

const COLUNAS_LANC = (nAnos) => [
  { id: 'L', titulo: 'Data de lançamento', tipo: 'data' },
  { id: 'meses', titulo: 'Meses desde o lançamento', tipo: 'int' },
  ...Array.from({ length: nAnos }, (_, a) => {
    const n = a + 1;
    const grupo = `Ano ${n}`;
    return [
      { id: 'ar' + a, titulo: `RCD Ano ${n}`, tipo: 'num', cor: '#6B76A6', ano: a, grupo },
      { id: 'au' + a, titulo: `UND Ano ${n}`, tipo: 'num', cor: '#A58BDB', ano: a, grupo },
      ...(a > 0 ? [
        { id: 'aer' + a, titulo: `Evol. RCD Ano ${n}`, tipo: 'var', ano: a, grupo },
        { id: 'aeu' + a, titulo: `Evol. UND Ano ${n}`, tipo: 'var', ano: a, grupo },
      ] : []),
      { id: 'amr' + a, titulo: `MS% RCD Ano ${n}`, tipo: 'pct', cor: '#F2C94C', ano: a, grupo },
      { id: 'amu' + a, titulo: `MS% UND Ano ${n}`, tipo: 'pct', cor: '#F2C94C', ano: a, grupo },
    ];
  }).flat(),
  { id: 'r12v', titulo: 'RCD Mês 12', tipo: 'num', cor: '#6B76A6' },
  { id: 'u12v', titulo: 'UND Mês 12', tipo: 'num', cor: '#A58BDB' },
  { id: 'msr12', titulo: 'MS% RCD Mês 12', tipo: 'pct', cor: '#F2C94C' },
  { id: 'ms12', titulo: 'MS% UND Mês 12', tipo: 'pct', cor: '#F2C94C' },
  { id: 'pfU', titulo: 'PF/UND', tipo: 'rs' },
  { id: 'rcdU', titulo: 'RCD/UND', tipo: 'rs' },
  { id: 'rcU', titulo: 'RC/UND', tipo: 'rs' },
  { id: 'desc', titulo: 'Desc. Com.', tipo: 'pct' },
  { id: 'margem', titulo: 'Margem PDV', tipo: 'pct' },
];

// A tabela usa todos os lançamentos (não a própria seleção)
function montarTabelaLanc() {
  const L = estado.lanc;
  if (!L.calc) return;
  const dims = L.dimsTabela;
  const raiz = noLanc('Total', -1, '', []);
  for (const it of L.dados.itens) {
    somarNoLanc(raiz, it);
    let no = raiz;
    dims.forEach((k, i) => {
      const valor = valorLanc(it, k);
      let filho = no.filhos.get(valor);
      if (!filho) {
        filho = noLanc(valor, i, no.caminho + SEP + valor, [...no.valores, valor]);
        no.filhos.set(valor, filho);
      }
      somarNoLanc(filho, it);
      no = filho;
    });
  }
  const completarTudo = (no) => { completarNoLanc(no); no.filhos.forEach(completarTudo); };
  completarTudo(raiz);
  L.tabela = { raiz, dims: [...dims] };
  desenharTabelaLanc();
}

function ordenarLanc(lista) {
  const { col, desc } = estado.lanc.ordem;
  return lista.sort((a, b) => {
    if (col === 'nome') return (desc ? -1 : 1) * String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    const va = valido(a[col]) ? a[col] : -Infinity;
    const vb = valido(b[col]) ? b[col] : -Infinity;
    return desc ? vb - va : va - vb;
  });
}

function filhosVisiveisLanc(no) {
  const regra = aplicarExibicao([...no.filhos.values()], estado.lanc.exib);
  const lista = ordenarLanc(regra.manter);
  if (regra.outros.length) {
    const outros = noLanc('Outros', no.nivel + 1, no.caminho + SEP + '__outros__', no.valores);
    outros.ehOutros = true;
    outros.membros = new Set(regra.outros.map((f) => f.nome));
    for (const f of regra.outros) juntarNosLanc(outros, f);
    completarNoLanc(outros);
    lista.push(outros);
  }
  return { lista, escondidos: regra.escondidos };
}

// Filtro equivalente a uma linha da tabela (função aplicada a cada SKU lançado)
function condicaoLinhaLanc(no, dims) {
  const valores = [...no.valores];
  const membros = no.ehOutros ? no.membros : null;
  const nivel = no.nivel;
  return (it) => valores.every((v, i) => valorLanc(it, dims[i]) === v)
    && (!membros || membros.has(valorLanc(it, dims[nivel])));
}

function desenharTabelaLanc() {
  const L = estado.lanc;
  if (!L.tabela) return;
  const { raiz, dims } = L.tabela;
  const { H, alinhado, nAnos } = L.calc;
  const colunas = COLUNAS_LANC(nAnos);
  const { col, desc } = L.ordem;
  const ultimoNivel = dims.length - 1;

  const visiveis = [];
  let escondidos = 0;
  let cortou = false;
  const percorrer = (no) => {
    const { lista, escondidos: e } = filhosVisiveisLanc(no);
    escondidos += e;
    for (const f of lista) {
      if (visiveis.length >= MAX_LINHAS_TABELA) { cortou = true; return; }
      visiveis.push(f);
      if (!f.ehOutros && f.nivel < ultimoNivel && L.expandidos.has(f.caminho)) percorrer(f);
    }
  };
  if (dims.length) percorrer(raiz);

  const maximos = {};
  for (const l of visiveis) {
    for (const c of colunas) {
      if (!c.cor || l.ehOutros) continue;
      const chave = c.id + '|' + l.nivel;
      maximos[chave] = Math.max(maximos[chave] || 0, valido(l[c.id]) ? l[c.id] : 0);
    }
  }
  const texto = (l, c) => {
    const v = l[c.id];
    if (c.tipo === 'data') {
      if (!valido(v)) return '-';
      // várias datas (Total, grupos): intervalo do primeiro ao último lançamento
      const fim = valido(l.Lfim) && l.Lfim !== v ? ` a ${rotuloTempo(l.Lfim)}` : '';
      return `<span class="lanc-data">${rotuloTempo(v)}${fim}</span>`;
    }
    if (c.tipo === 'int') return inteiro(v);
    if (c.tipo === 'rs') return reais(v);
    if (c.tipo === 'pct' || c.tipo === 'var') return percentual(v);
    return inteiro(v);
  };
  const celula = (l, c, comBarra) => {
    const v = l[c.id];
    const classes = [];
    let dica = '';
    if (c.ano !== undefined) {
      const ano = l.anos[c.ano];
      if (!ano.n || !valido(v)) return '<td></td>'; // ainda não chegou a este ano
      if (ano.parciais && c.tipo !== 'var') {
        classes.push('parcial');
        dica = l.nLanc === 1 ? `ano incompleto: ${ano.minMeses} de 12 meses`
          : `inclui ${ano.parciais} ${ano.parciais > 1 ? 'lançamentos' : 'lançamento'} com ano incompleto`;
      }
    }
    if (c.tipo === 'var') classes.push(classeSinal(v));
    const max = maximos[c.id + '|' + l.nivel];
    const barra = comBarra && c.cor && max > 0 && valido(v) && v > 0;
    if (barra) classes.unshift('cel-barra');
    const atrib = `class="${classes.join(' ')}"${dica ? ` title="${dica}"` : ''}`;
    if (barra) {
      const largura = Math.min(100, (v / max) * 100);
      return `<td ${atrib}><div class="barra" style="width:${largura}%;background:${c.cor}"></div><span>${texto(l, c)}</span></td>`;
    }
    return `<td ${atrib}>${texto(l, c)}</td>`;
  };

  const seta = (id) => (col === id ? (desc ? ' ▼' : ' ▲') : '');
  const titulo = dims.length ? dims.map(rotuloDimLanc).join(' › ') : '(sem dimensão)';
  // duas linhas de cabeçalho: grupos "Ano 1", "Ano 2"… em cima; colunas sem grupo ocupam as duas
  const th = (c, extra = '') => `<th data-col="${c.id}" class="${col === c.id ? 'ordenada' : ''}"${extra}>${c.titulo}${seta(c.id)}</th>`;
  let linha1 = `<th data-col="nome" rowspan="2" class="${col === 'nome' ? 'ordenada' : ''}">${escaparHtml(titulo)}${seta('nome')}</th>`;
  for (let i = 0; i < colunas.length; i++) {
    const c = colunas[i];
    if (!c.grupo) { linha1 += th(c, ' rowspan="2"'); continue; }
    let n = 1;
    while (colunas[i + n] && colunas[i + n].grupo === c.grupo) n++;
    linha1 += `<th class="grupo-ano" colspan="${n}">${c.grupo}</th>`;
    i += n - 1;
  }
  const linha2 = colunas.filter((c) => c.grupo).map((c) => th(c)).join('');
  const cabecalho = `<thead><tr>${linha1}</tr>${linha2 ? `<tr class="sub">${linha2}</tr>` : ''}</thead>`;

  const haSelecao = L.selecao.size > 0;
  const selecionada = (caminho) => [...L.selecao.keys()].some((c) => caminho === c || caminho.startsWith(c + SEP));
  L.linhas = visiveis;
  const corpo = '<tbody>' + visiveis.map((l, i) => {
    const podeAbrir = !l.ehOutros && l.nivel < ultimoNivel;
    const aberto = L.expandidos.has(l.caminho);
    const botao = podeAbrir
      ? `<button class="btn-exp" data-i="${i}" title="${aberto ? 'Recolher' : 'Expandir'}">${aberto ? '−' : '+'}</button>`
      : '<span class="btn-exp-vazio"></span>';
    const classes = [`nivel-${Math.min(l.nivel, 3)}`];
    if (l.ehOutros) classes.push('linha-outros');
    if (haSelecao) classes.push(L.selecao.has(l.caminho) ? 'selecionada' : selecionada(l.caminho) ? '' : 'apagada');
    return `<tr class="${classes.join(' ')}" data-i="${i}">
      <td style="padding-left:${8 + l.nivel * 20}px">${botao}${escaparHtml(l.nome)}${l.el ? '<span class="tag-el">EL</span>' : ''}</td>
      ${colunas.map((c) => celula(l, c, true)).join('')}</tr>`;
  }).join('') + '</tbody>';
  const rodape = `<tfoot><tr><td>Total (${inteiro(raiz.nLanc)} lançamentos)</td>${colunas.map((c) => celula(raiz, c, false)).join('')}</tr></tfoot>`;

  $('tabela-lanc').innerHTML = cabecalho + corpo + rodape;
  // a 2ª linha do cabeçalho fica fixa logo abaixo da 1ª ao rolar
  const altura = $('tabela-lanc').querySelector('thead tr').getBoundingClientRect().height;
  $('tabela-lanc').querySelectorAll('thead tr.sub th').forEach((x) => { x.style.top = altura + 'px'; });
  $('btn-expandir-lanc').hidden = $('btn-recolher-lanc').hidden = dims.length < 2;
  $('btn-limpar-selecao-lanc').hidden = !haSelecao;
  $('dica-selecao-lanc').textContent = haSelecao
    ? `${L.selecao.size} ${L.selecao.size > 1 ? 'linhas selecionadas filtram' : 'linha selecionada filtra'} os gráficos e os cards.`
    : 'Clique em uma linha para filtrar os gráficos (Ctrl+clique para várias).';
  const notas = [];
  if (!raiz.nLanc) notas.push('Nenhum lançamento no período escolhido.');
  if (cortou) notas.push(`Mostrando as primeiras ${inteiro(MAX_LINHAS_TABELA)} linhas.`);
  if (escondidos) notas.push(`${inteiro(escondidos)} linhas fora do Top N não aparecem.`);
  notas.push('Ano 1 = Meses 1–12 desde o lançamento, Ano 2 = 13–24, Ano 3 = 25–36. Cinza e itálico = ano incompleto (passe o mouse).');
  notas.push('MS% = sobre o mercado filtrado nos mesmos meses do calendário.');
  notas.push(alinhado
    ? `Preços médios: do Mês 1 ao Mês ${H} de cada lançamento.`
    : `Preços médios: de ${rotuloTempo(L.calc.inicio)} até ${rotuloTempo(L.calc.inicio + L.calc.posicoes - 1)} (calendário).`);
  $('nota-tabela-lanc').textContent = notas.join(' ');
}

function clicarLinhaLanc(linha, acumularSel) {
  const L = estado.lanc;
  const { caminho } = linha;
  const cond = condicaoLinhaLanc(linha, L.tabela.dims);
  if (acumularSel) {
    if (L.selecao.has(caminho)) L.selecao.delete(caminho);
    else L.selecao.set(caminho, cond);
  } else if (L.selecao.has(caminho) && L.selecao.size === 1) {
    L.selecao.clear();
  } else {
    L.selecao = new Map([[caminho, cond]]);
  }
  aplicarSelecaoLanc();
}
function aplicarSelecaoLanc() {
  desenharTabelaLanc();
  atualizarKpisLanc();
  desenharGraficosLanc();
}

function lerExibicaoLanc() {
  const n = parseInt($('lanc-topn').value, 10);
  const auto80 = $('lanc-80').checked;
  estado.lanc.exib = { topN: Number.isFinite(n) && n > 0 ? n : null, outros: $('lanc-outros').checked, auto80 };
  $('lanc-topn').disabled = auto80;
  $('lanc-outros').disabled = auto80;
  if (estado.lanc.selecao.size) estado.lanc.selecao.clear();
  desenharLancTudo();
}

// ligações dos controles
['lanc-data', 'lanc-nivel', 'lanc-ini', 'lanc-fim'].forEach((id) => $(id).addEventListener('change', atualizarLanc));
['lanc-eixo', 'lanc-horizonte'].forEach((id) => $(id).addEventListener('change', () => { calcularLanc(); desenharLancTudo(); }));
['lanc-acum', 'lanc-tipo', 'lanc-media'].forEach((id) => $(id).addEventListener('change', desenharGraficosLanc));
$('lanc-topn').addEventListener('input', lerExibicaoLanc);
$('lanc-outros').addEventListener('change', lerExibicaoLanc);
$('lanc-80').addEventListener('change', lerExibicaoLanc);
$('btn-expandir-lanc').addEventListener('click', () => {
  const L = estado.lanc;
  if (!L.tabela) return;
  const abrir = (no) => no.filhos.forEach((f) => {
    if (f.nivel < L.tabela.dims.length - 1) { L.expandidos.add(f.caminho); abrir(f); }
  });
  abrir(L.tabela.raiz);
  desenharTabelaLanc();
});
$('btn-recolher-lanc').addEventListener('click', () => { estado.lanc.expandidos = new Set(); desenharTabelaLanc(); });
$('btn-limpar-selecao-lanc').addEventListener('click', () => { estado.lanc.selecao.clear(); aplicarSelecaoLanc(); });
$('tabela-lanc').addEventListener('click', (e) => {
  const L = estado.lanc;
  const botao = e.target.closest('.btn-exp');
  if (botao) {
    const { caminho } = L.linhas[Number(botao.dataset.i)];
    if (L.expandidos.has(caminho)) L.expandidos.delete(caminho); else L.expandidos.add(caminho);
    desenharTabelaLanc();
    return;
  }
  const th = e.target.closest('th');
  if (th) {
    const col = th.dataset.col;
    if (!col) return; // cabeçalho de grupo ("Ano 1"…) não ordena
    L.ordem = L.ordem.col === col ? { col, desc: !L.ordem.desc } : { col, desc: col !== 'nome' };
    desenharTabelaLanc();
    return;
  }
  const tr = e.target.closest('tbody tr');
  if (tr) clicarLinhaLanc(L.linhas[Number(tr.dataset.i)], e.ctrlKey || e.metaKey);
});

// =====================================================================
// "Copiar como imagem": uma única função para todas as páginas.
// Cada página (menos Filtros) ganha o botão na barra de seletores e cada
// card de gráfico/tabela ganha um ícone de câmera. A imagem é gerada no
// próprio navegador (html2canvas) — nada é enviado a servidores.
// Conteúdo da página: [data-captura] ou, se não houver, .area-principal.
// =====================================================================
const SELETOR_BLOCOS = '.card-grafico, .card-tabela, .card-preco, .card-p2, .ec-g, [data-captura-bloco]';
const SELETOR_LEGENDAS = '.card-legenda, .ec-legenda-card, #p2-legenda';
let promessaHtml2canvas = null;

function carregarHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  promessaHtml2canvas = promessaHtml2canvas || new Promise((ok, erro) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    sc.onload = () => ok(window.html2canvas);
    sc.onerror = () => { promessaHtml2canvas = null; erro(new Error('não foi possível carregar o gerador de imagem')); };
    document.head.appendChild(sc);
  });
  return promessaHtml2canvas;
}

// ----- textos do rodapé -----
function resumoFiltros() {
  const partes = [];
  for (const d of estado.dims) {
    const f = estado.filtros[d.key];
    if (!filtroAtivo(f)) continue;
    const v = [...f.valores];
    const lista = v.slice(0, 3).join(', ') + (v.length > 3 ? ` (+${v.length - 3})` : '');
    partes.push(`${d.rotulo}: ${f.modo === 'exc' ? 'todos exceto ' : ''}${lista}`);
  }
  let texto = partes.length ? partes.join('; ') : 'nenhum';
  if (elLigado()) texto += ' · com ELs e MAT+1';
  return texto;
}
// período: seletores da barra cujo nome é Período, Tempo, Lançados desde ou Horizonte
function periodoDaPagina(main) {
  const barra = main.querySelector(':scope > .barra-seletores');
  if (!barra) return '';
  const partes = [];
  barra.querySelectorAll('label, .seletor, .lanc-faixa').forEach((l) => {
    const primeiro = l.querySelector(':scope > span') || l.firstChild;
    const nome = primeiro ? primeiro.textContent.trim().replace(/\s+/g, ' ') : '';
    if (!/^(Período|Tempo|Lançados desde|Horizonte)/i.test(nome)) return;
    const selects = [...l.querySelectorAll('select')];
    const valores = selects.length ? selects.map((s) => (s.selectedOptions[0] || {}).text || '')
      : [...l.querySelectorAll('input[type=text]')].map((i) => i.value);
    if (valores.some(Boolean)) partes.push(`${nome} ${valores.filter(Boolean).join(' a ')}`);
  });
  return partes.join(', ');
}
function rodapeCaptura(main) {
  const p = main ? periodoDaPagina(main) : '';
  return [`Fonte: ${estado.nomeArquivo || '-'}`, p, `Filtros: ${resumoFiltros()}`].filter(Boolean).join(' · ');
}

// ----- aviso rápido -----
function avisoRapido(texto) {
  let t = $('aviso-rapido');
  if (!t) { t = document.createElement('div'); t.id = 'aviso-rapido'; document.body.appendChild(t); }
  t.textContent = texto;
  t.classList.add('visivel');
  clearTimeout(t._tempo);
  t._tempo = setTimeout(() => t.classList.remove('visivel'), 2800);
}

// Figura 2× de um gráfico, desenhada numa cópia limpa (sem destaque do mouse nem tooltip)
function imagemDoGrafico(inst, largura, altura) {
  const div = document.createElement('div');
  div.style.cssText = `position:absolute;left:-30000px;top:0;width:${largura}px;height:${altura}px`;
  document.body.appendChild(div);
  try {
    const copia = echarts.init(div, null, { width: largura, height: altura });
    copia.setOption({ ...inst.getOption(), animation: false });
    const url = copia.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#FFFFFF' });
    copia.dispose();
    return url;
  } catch {
    return inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#FFFFFF' });
  } finally {
    div.remove();
  }
}

// Copia de um elemento pronta para virar imagem: gráficos viram figuras em 2×,
// campos levam o valor atual, áreas com rolagem mostram tudo (sem barras)
function clonarParaCaptura(original) {
  const clone = original.cloneNode(true);
  const orig = [original, ...original.querySelectorAll('*')];
  const copia = [clone, ...clone.querySelectorAll('*')];
  const trocas = [];
  orig.forEach((o, i) => {
    const c = copia[i];
    if (!c) return;
    const est = getComputedStyle(o);
    if (/(auto|scroll)/.test(est.overflowX + est.overflowY)) {
      c.style.overflow = 'visible'; c.style.maxHeight = 'none'; c.style.height = 'auto';
      // tabela mais larga que a tela: transborda para a direita (os cards em volta não cortam)
      if (o.scrollWidth > o.clientWidth + 1 && !o.querySelector('[_echarts_instance_]')) {
        for (let p = c.parentElement; p; p = p.parentElement) p.style.overflow = 'visible';
      }
    }
    if (o.tagName === 'INPUT') {
      if (o.type === 'checkbox' || o.type === 'radio') { if (o.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else c.setAttribute('value', o.value);
    } else if (o.tagName === 'SELECT') {
      [...c.options].forEach((op, k) => { if (k === o.selectedIndex) op.setAttribute('selected', ''); else op.removeAttribute('selected'); });
    } else if (o.tagName === 'TEXTAREA') {
      const div = document.createElement('div');
      div.className = o.closest('.port-leitura') ? 'port-leitura-texto' : 'captura-texto';
      div.textContent = o.value || ' ';
      trocas.push([c, div]);
    } else if (o.hasAttribute && o.hasAttribute('_echarts_instance_')) {
      const inst = echarts.getInstanceByDom(o);
      if (inst && o.clientWidth) {
        const img = document.createElement('img');
        img.src = imagemDoGrafico(inst, o.clientWidth, o.clientHeight);
        img.style.cssText = `width:${o.clientWidth}px;height:${o.clientHeight}px;display:block`;
        c.innerHTML = '';
        c.appendChild(img);
      }
    } else if (o.tagName === 'CANVAS') {
      const cv = c;
      cv.width = o.width; cv.height = o.height;
      try { cv.getContext('2d').drawImage(o, 0, 0); } catch { /* sem cópia */ }
    }
  });
  trocas.forEach(([c, novo]) => c.replaceWith(novo));
  return clone;
}

// largura do bloco: gráficos com rolagem horizontal alargam o layout todo;
// tabelas largas só transbordam (os gráficos ficam no tamanho da tela)
function larguraTotal(el) {
  let extra = 0;
  [el, ...el.querySelectorAll('*')].forEach((o) => {
    if (o.scrollWidth > o.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(o).overflowX) && o.querySelector('[_echarts_instance_]')) {
      extra = Math.max(extra, o.scrollWidth - o.clientWidth);
    }
  });
  return el.getBoundingClientRect().width + extra;
}

// elementos: blocos a capturar; lado = lado a lado (gráfico + legenda); nome = nome do PNG
async function gerarImagem(elementos, { lado = false, main = null } = {}) {
  const h2c = await carregarHtml2canvas();
  const palco = document.createElement('div');
  palco.className = 'captura-palco' + (lado ? ' lado' : '');
  const larguras = elementos.map(larguraTotal);
  palco.style.width = (lado ? larguras.reduce((s, l) => s + l, 0) + 12 * (elementos.length - 1) : Math.max(...larguras)) + 28 + 'px';
  const corpo = document.createElement('div');
  corpo.className = 'captura-corpo';
  elementos.forEach((el, i) => {
    const c = clonarParaCaptura(el);
    if (lado) { c.style.width = larguras[i] + 'px'; c.style.flex = 'none'; }
    // conteúdo da página sem a barra de seletores e sem a coluna de KPIs
    c.querySelectorAll('.barra-seletores, .coluna-kpis, [data-barra-captura]').forEach((x) => x.remove());
    corpo.appendChild(c);
  });
  palco.appendChild(corpo);
  const rodape = document.createElement('div');
  rodape.className = 'captura-rodape';
  rodape.textContent = rodapeCaptura(main);
  palco.appendChild(rodape);
  (main || document.body).appendChild(palco); // dentro da página: mantém os estilos dela
  try {
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    // tamanho total, inclusive o que transborda (tabelas largas)
    const largura = Math.max(palco.offsetWidth, palco.scrollWidth + 14);
    const altura = Math.max(palco.offsetHeight, palco.scrollHeight);
    const canvas = await h2c(palco, { backgroundColor: '#FFFFFF', scale: 2, logging: false, useCORS: true, width: largura, height: altura });
    return await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  } finally {
    palco.remove();
  }
}

// Gera, copia para a área de transferência e, se não der, baixa o PNG
async function copiarComoImagem(elementos, opcoes = {}) {
  const pagina = (PAGINAS.find(([p]) => p === estado.pagina) || ['', 'pagina'])[1];
  const data = new Date();
  const nome = `${pagina.replace(/\s+/g, '_')}_${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}.png`;
  avisoRapido('Gerando imagem…');
  const promessa = gerarImagem(elementos, opcoes);
  promessa.catch(() => {}); // o erro é tratado abaixo
  try {
    // a cópia precisa começar ainda no clique: entrega a imagem como promessa
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sem área de transferência');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': promessa })]);
    avisoRapido('Imagem copiada — cole com Ctrl+V');
  } catch {
    try {
      const blob = await promessa;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      avisoRapido(`O navegador não deixou copiar: imagem baixada (${nome})`);
    } catch (e) {
      console.error(e);
      avisoRapido('Não foi possível gerar a imagem');
    }
  }
}

// conteúdo principal de uma página
function conteudoDaPagina(main) {
  return main.querySelector('[data-captura]') || main.querySelector('.area-principal') || main;
}
// legenda compartilhada perto de um card de gráfico (até 3 níveis acima)
function legendaDoBloco(card) {
  if (!card.querySelector('[_echarts_instance_]') && !card.matches('.ec-g')) return null;
  let p = card.parentElement;
  for (let k = 0; k < 3 && p; k++, p = p.parentElement) {
    const leg = [...p.querySelectorAll(SELETOR_LEGENDAS)].find((l) => !l.contains(card) && !card.contains(l));
    if (leg) return leg;
  }
  return null;
}

// Instala o botão de cada página e o ícone de cada card (pode ser chamada várias vezes)
function instalarCapturas() {
  document.querySelectorAll('main.pagina').forEach((main) => {
    if (main.id === 'pagina-filtros') return;
    const barra = main.querySelector(':scope > .barra-seletores') || main.querySelector('[data-barra-captura]');
    if (barra && !barra.querySelector('.btn-captura-pagina')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-captura-pagina';
      b.innerHTML = '📷 Copiar como imagem';
      b.title = 'Copia os gráficos e tabelas desta página (sem seletores e KPIs)';
      b.addEventListener('click', () => copiarComoImagem([conteudoDaPagina(main)], { main }));
      barra.appendChild(b);
    }
    main.querySelectorAll(SELETOR_BLOCOS).forEach((card) => {
      if (card.querySelector(':scope > .btn-captura-bloco')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-captura-bloco';
      b.textContent = '📷';
      b.title = 'Copiar este bloco como imagem';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const leg = legendaDoBloco(card);
        copiarComoImagem(leg ? [card, leg] : [card], { lado: !!leg, main });
      });
      card.classList.add('com-captura');
      card.appendChild(b);
    });
  });
}

// =====================================================================
// Taxonomia (CLASSIF. GERAL N1–N5) separada da base de valores.
// Prioridade: 1) salva no navegador (IndexedDB); 2) taxonomia.csv do
// repositório; 3) colunas CLASSIF. GERAL da própria base.
// Chave: cd_apresentacao. Nada é enviado a servidores.
// =====================================================================
const NIVEIS_TAX = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
const COLS_TAX = ['CLASSIF. GERAL N1', 'CLASSIF. GERAL N2', 'CLASSIF. GERAL N3', 'CLASSIF. GERAL N4', 'CLASSIF. GERAL N5'];
const SEM_CATEGORIA = 'Sem categoria';
const MAX_LINHAS_CAT = 400; // linhas desenhadas de uma vez (o resto aparece com a busca)
// mapa: cd_apresentacao -> { desc, n: [N1..N5] }; origem: 'navegador' | 'repositorio' | 'base'
estado.tax = { origem: 'base', atualizado: null, mapa: null, antes: new Map(), selecionadas: new Set(), modo: 'tabela' };

// ----- IndexedDB (com try/catch: navegador sem armazenamento segue funcionando) -----
function abrirBanco() {
  return new Promise((ok, erro) => {
    try {
      const req = indexedDB.open('dashboard-farma', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    } catch (e) { erro(e); }
  });
}
async function bancoLer(chave) {
  try {
    const db = await abrirBanco();
    return await new Promise((ok) => {
      const req = db.transaction('kv').objectStore('kv').get(chave);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(undefined);
    });
  } catch { return undefined; }
}
async function bancoGravar(chave, valor) {
  try {
    const db = await abrirBanco();
    await new Promise((ok, erro) => {
      const t = db.transaction('kv', 'readwrite');
      if (valor === undefined) t.objectStore('kv').delete(chave); else t.objectStore('kv').put(valor, chave);
      t.oncomplete = ok; t.onerror = () => erro(t.error);
    });
    return true;
  } catch { return false; }
}

// ----- leitura do CSV de taxonomia (";" ou ",", UTF-8 ou Latin-1) -----
function decodificarTexto(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}
function lerTaxonomiaCsv(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = lerCsv(texto, sep);
  if (!linhas.length) throw new Error('arquivo vazio');
  const cab = linhas[0].map(normalizar);
  const iCod = cab.indexOf(normalizar(COL_SKU));
  if (iCod < 0) throw new Error(`não encontrei a coluna "${COL_SKU}"`);
  const iDesc = cab.indexOf(normalizar('Apresentacao Desc Longa'));
  const iN = COLS_TAX.map((c, k) => { const i = cab.indexOf(normalizar(c)); return i >= 0 ? i : cab.indexOf('n' + (k + 1)); });
  if (iN.every((i) => i < 0)) throw new Error('não encontrei as colunas CLASSIF. GERAL N1 a N5');
  const mapa = new Map();
  for (const l of linhas.slice(1)) {
    const cod = String(l[iCod] || '').trim();
    if (!cod) continue;
    mapa.set(cod, { desc: iDesc >= 0 ? String(l[iDesc] || '').trim() : '', n: iN.map((i) => (i >= 0 ? String(l[i] || '').trim() : '')) });
  }
  return mapa;
}

// ----- de onde vem a taxonomia -----
async function carregarFonteTaxonomia() {
  const salva = await bancoLer('taxonomia');
  if (salva && Array.isArray(salva.linhas) && salva.linhas.length) {
    estado.tax.mapa = new Map(salva.linhas.map(([c, desc, n]) => [c, { desc, n }]));
    estado.tax.origem = 'navegador';
    estado.tax.atualizado = salva.atualizado || null;
  } else {
    await carregarTaxonomiaRepositorio();
  }
  mostrarOrigemTaxonomia();
}
async function carregarTaxonomiaRepositorio() {
  estado.tax.mapa = null;
  estado.tax.origem = 'base';
  estado.tax.atualizado = null;
  try {
    const resp = await fetch('taxonomia.csv', { cache: 'no-cache' });
    if (!resp.ok) return; // não existe: segue com a base
    const mapa = lerTaxonomiaCsv(decodificarTexto(await resp.arrayBuffer()));
    if (mapa.size) { estado.tax.mapa = mapa; estado.tax.origem = 'repositorio'; }
  } catch { /* sem arquivo: segue com a base */ }
}
function textoOrigemTaxonomia() {
  const t = estado.tax;
  if (t.origem === 'navegador') {
    const d = t.atualizado ? new Date(t.atualizado) : null;
    return `Taxonomia: navegador${d ? ` (atualizada em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')})` : ''}`;
  }
  return t.origem === 'repositorio' ? 'Taxonomia: repositório' : 'Taxonomia: da base';
}
function mostrarOrigemTaxonomia() {
  const texto = textoOrigemTaxonomia();
  document.querySelectorAll('.texto-taxonomia').forEach((e) => { e.textContent = texto; });
}

async function salvarTaxonomia() {
  const t = estado.tax;
  t.origem = 'navegador';
  t.atualizado = Date.now();
  const linhas = [...t.mapa].map(([c, v]) => [c, v.desc || '', v.n]);
  const ok = await bancoGravar('taxonomia', { linhas, atualizado: t.atualizado });
  if (!ok) avisoRapido('Não foi possível salvar a taxonomia neste navegador (armazenamento bloqueado).');
  mostrarOrigemTaxonomia();
}

// ----- junção com a base: a taxonomia substitui as colunas CLASSIF. GERAL -----
// cat_orig guarda os valores da base (para voltar a eles sem recarregar o arquivo)
async function aplicarTaxonomia() {
  if (!estado.conn) return;
  const c = estado.conn;
  const sets = NIVEIS_TAX.map((k, i) => `d_${k} = o.c${i + 1}`).join(', ');
  await c.query(`UPDATE fato SET ${sets} FROM cat_orig o WHERE fato.rid = o.rid`);
  const mapa = estado.tax.mapa;
  if (!mapa) return;
  await c.query('CREATE OR REPLACE TABLE tax (sku VARCHAR, n1 VARCHAR, n2 VARCHAR, n3 VARCHAR, n4 VARCHAR, n5 VARCHAR)');
  const linhas = [...mapa].map(([cod, v]) => `(${[cod, ...v.n].map((x) => sqlTexto(x || '')).join(', ')})`);
  for (let i = 0; i < linhas.length; i += 2000) {
    await c.query(`INSERT INTO tax VALUES ${linhas.slice(i, i + 2000).join(', ')}`);
  }
  const vazio = (k) => `COALESCE(NULLIF(TRIM(t.n${k}), ''), '(vazio)')`;
  await c.query(`UPDATE fato SET ${NIVEIS_TAX.map((k, i) => `d_${k} = ${vazio(i + 1)}`).join(', ')}
    FROM tax t WHERE fato.sku = t.sku AND NOT fato.is_el`);
  // apresentações da base que não estão na taxonomia
  await c.query(`UPDATE fato SET ${NIVEIS_TAX.map((k) => `d_${k} = ${sqlTexto(SEM_CATEGORIA)}`).join(', ')}
    WHERE NOT is_el AND sku NOT IN (SELECT sku FROM tax)`);
}

// a taxonomia mudou: refaz a junção e atualiza todas as páginas
let esperaTax = null;
async function taxonomiaMudou(imediato = false) {
  clearTimeout(esperaTax);
  const executar = async () => {
    if (!estado.conn) return;
    // base sem as colunas CLASSIF. GERAL: com taxonomia, os filtros Categoria 01–05 passam a existir
    const faltam = estado.tax.mapa && NIVEIS_TAX.some((k) => !estado.dims.some((d) => d.key === k));
    await aplicarTaxonomia();
    estado.cacheValoresEL = {};
    if (faltam) {
      estado.dims = DIMENSOES.filter((d) => estado.dims.some((x) => x.key === d.key) || NIVEIS_TAX.includes(d.key));
      prepararInterface();
    }
    await carregarLinhasCategorizacao();
    await atualizarTudo();
    redesenharCatQuandoLivre();
  };
  if (imediato) return executar();
  esperaTax = setTimeout(executar, 400);
}

// ----- botões da tela de carregamento -----
$('input-taxonomia').addEventListener('change', async (e) => {
  const arquivo = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  try {
    const mapa = lerTaxonomiaCsv(decodificarTexto(await arquivo.arrayBuffer()));
    if (!mapa.size) throw new Error('nenhuma apresentação no arquivo');
    estado.tax.mapa = mapa;
    estado.tax.antes = new Map();
    await salvarTaxonomia();
    avisoRapido(`Taxonomia carregada: ${inteiro(mapa.size)} apresentações (salva neste navegador)`);
    await taxonomiaMudou(true);
  } catch (erro) {
    alert('Não foi possível ler a taxonomia: ' + (erro && erro.message ? erro.message : erro));
  }
});
$('btn-tax-repo').addEventListener('click', async () => {
  if (!confirm('Descartar a taxonomia salva neste navegador e usar a do repositório (taxonomia.csv)?\n\nDica: exporte a taxonomia antes, se quiser guardar uma cópia.')) return;
  await bancoGravar('taxonomia', undefined);
  await carregarTaxonomiaRepositorio();
  estado.tax.antes = new Map();
  mostrarOrigemTaxonomia();
  avisoRapido(textoOrigemTaxonomia());
  await taxonomiaMudou(true);
});

// =====================================================================
// Página "Categorização"
// =====================================================================
const normCat = (v) => (v === undefined || v === null || v === '(vazio)' || v === '(não informado)' ? '' : String(v));
// N1–N5 atuais de uma apresentação (null = não está na taxonomia)
function niveisAtuais(l) {
  if (estado.tax.mapa) { const v = estado.tax.mapa.get(l.sku); return v ? v.n : null; }
  return l.base;
}
const semCategoria = (n) => !n || n.every((x) => !x);

async function carregarLinhasCategorizacao() {
  if (!estado.conn) return;
  const linhas = await consultar(`SELECT f.sku, any_value(d_apres) apres, any_value(d_produto) produto,
      any_value(d_corp) corp, any_value(d_molecula) mol, any_value(d_ct4) ct4, SUM(rcd_MAT0) rcd,
      any_value(o.c1) b1, any_value(o.c2) b2, any_value(o.c3) b3, any_value(o.c4) b4, any_value(o.c5) b5
    FROM fato f JOIN cat_orig o ON o.rid = f.rid WHERE NOT f.is_el GROUP BY f.sku`);
  estado.tax.linhas = linhas.map((l) => ({ ...l, rcd: l.rcd || 0, base: [l.b1, l.b2, l.b3, l.b4, l.b5].map(normCat) }));
  estado.tax.linhas.sort((a, b) => b.rcd - a.rcd);
  estado.tax.porSku = new Map(estado.tax.linhas.map((l) => [l.sku, l]));
}

// valores existentes num nível, respeitando o nível acima (hierarquia)
function valoresNivel(k, pai) {
  const set = new Set();
  const add = (n) => { if (n && n[k] && (k === 0 || !pai || n[k - 1] === pai)) set.add(n[k]); };
  if (estado.tax.mapa) estado.tax.mapa.forEach((v) => add(v.n));
  else (estado.tax.linhas || []).forEach((l) => add(l.base));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

// muda N1–N5 de uma ou mais apresentações (valores null = não mexe)
function alterarCategorias(skus, novos) {
  const t = estado.tax;
  if (!t.mapa) {
    // vinha da base: a partir de agora a taxonomia é a do navegador (começa com os valores da base)
    t.mapa = new Map();
    for (const l of t.linhas || []) if (!semCategoria(l.base)) t.mapa.set(l.sku, { desc: l.apres, n: [...l.base] });
  }
  for (const sku of skus) {
    const atual = t.mapa.get(sku);
    if (!t.antes.has(sku)) t.antes.set(sku, atual ? [...atual.n] : null);
    const l = t.porSku && t.porSku.get(sku);
    const n = atual ? [...atual.n] : ['', '', '', '', ''];
    novos.forEach((v, k) => { if (v !== null && v !== undefined) n[k] = v.trim(); });
    t.mapa.set(sku, { desc: (atual && atual.desc) || (l && l.apres) || '', n });
  }
  salvarTaxonomia();
  taxonomiaMudou();
}

function desfazerAlteracoes() {
  const t = estado.tax;
  if (!t.antes.size) return;
  if (!confirm(`Desfazer as alterações de ${t.antes.size} apresentações feitas nesta sessão?`)) return;
  t.antes.forEach((n, sku) => {
    if (n === null) t.mapa.delete(sku);
    else t.mapa.set(sku, { ...(t.mapa.get(sku) || { desc: '' }), n: [...n] });
  });
  t.antes = new Map();
  salvarTaxonomia();
  taxonomiaMudou(true);
}

function linhasFiltradasCat() {
  const t = estado.tax;
  const modo = $('cat-mostrar').value;
  const busca = normalizar($('cat-busca').value || '');
  return (t.linhas || []).filter((l) => {
    const n = niveisAtuais(l);
    if (modo === 'sem' && !semCategoria(n)) return false;
    if (modo === 'alt' && !t.antes.has(l.sku)) return false;
    if (!busca) return true;
    return normalizar([l.sku, l.apres, l.produto, l.corp, l.mol, l.ct4, ...(n || [])].join(' ')).includes(busca);
  });
}

function desenharCategorizacao() {
  const t = estado.tax;
  if (!t.linhas) return;
  mostrarOrigemTaxonomia();
  // contador: sem categoria
  const totalRcd = t.linhas.reduce((s, l) => s + Math.max(0, l.rcd), 0);
  const sem = t.linhas.filter((l) => semCategoria(niveisAtuais(l)));
  const rcdSem = sem.reduce((s, l) => s + Math.max(0, l.rcd), 0);
  $('cat-contador').textContent = `${inteiro(sem.length)} ${sem.length === 1 ? 'apresentação' : 'apresentações'} sem categoria (${percentual(divisao(rcdSem, totalRcd))} do RCD MAT)`;
  $('btn-cat-desfazer').disabled = !t.antes.size;
  $('cat-bloco-tabela').hidden = t.modo !== 'tabela';
  $('cat-bloco-arvore').hidden = t.modo !== 'arvore';
  document.querySelectorAll('#cat-modo button').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === t.modo));
  if (t.modo === 'arvore') desenharArvoreCat(); else desenharTabelaCat();
  desenharSemVendaCat();
}

function desenharTabelaCat() {
  const t = estado.tax;
  const lista = linhasFiltradasCat();
  const visiveis = lista.slice(0, MAX_LINHAS_CAT);
  t.visiveis = visiveis;
  for (const s of [...t.selecionadas]) if (!t.porSku.has(s)) t.selecionadas.delete(s);
  const campo = (l, n, k) => `<input class="cat-campo" data-sku="${escaparHtml(l.sku)}" data-k="${k}" value="${escaparHtml(n ? n[k] : '')}"
    placeholder="${k === 0 && semCategoria(n) ? SEM_CATEGORIA : ''}" autocomplete="off">`;
  const corpo = visiveis.map((l) => {
    const n = niveisAtuais(l);
    const novo = estado.tax.mapa && !estado.tax.mapa.has(l.sku);
    const semCat = semCategoria(n);
    const alterado = t.antes.has(l.sku);
    return `<tr class="${semCat ? 'cat-sem' : ''}${alterado ? ' cat-alterada' : ''}">
      <td><input type="checkbox" class="cat-sel" data-sku="${escaparHtml(l.sku)}" ${t.selecionadas.has(l.sku) ? 'checked' : ''}></td>
      <td class="cat-cod">${escaparHtml(l.sku)}${novo ? ' <span class="selo-novo">NOVO</span>' : ''}</td>
      <td class="cat-texto" title="${escaparHtml(l.apres)}">${escaparHtml(l.apres)}</td>
      <td class="cat-texto">${escaparHtml(l.produto)}</td><td class="cat-texto">${escaparHtml(l.corp)}</td>
      <td class="cat-texto">${escaparHtml(l.mol)}</td><td class="cat-texto" title="${escaparHtml(l.ct4)}">${escaparHtml(l.ct4)}</td>
      <td class="cat-num">${inteiro(l.rcd)}</td>
      ${[0, 1, 2, 3, 4].map((k) => `<td>${campo(l, n, k)}</td>`).join('')}
      <td class="cat-status">${alterado ? 'alterado' : semCat ? SEM_CATEGORIA : ''}</td></tr>`;
  }).join('');
  const todasMarcadas = visiveis.length && visiveis.every((l) => t.selecionadas.has(l.sku));
  $('tabela-cat').innerHTML = `<thead><tr>
      <th><input type="checkbox" id="cat-sel-todas" ${todasMarcadas ? 'checked' : ''} title="Selecionar as linhas mostradas"></th>
      <th>cd_apresentacao</th><th>Apresentação</th><th>Produto</th><th>Corporação</th><th>Molécula</th>
      <th>Classe Terapêutica Nível 4</th><th>RCD MAT</th><th>N1</th><th>N2</th><th>N3</th><th>N4</th><th>N5</th><th>Status</th>
    </tr></thead><tbody>${corpo || '<tr><td colspan="14" class="cat-vazio">Nenhuma apresentação com este filtro.</td></tr>'}</tbody>`;
  $('cat-nota').textContent = lista.length > visiveis.length
    ? `Mostrando ${inteiro(visiveis.length)} de ${inteiro(lista.length)} apresentações (maiores RCD MAT). Use a busca para achar as demais.`
    : `${inteiro(lista.length)} apresentações.`;
  $('cat-massa-qtd').textContent = t.selecionadas.size ? `${inteiro(t.selecionadas.size)} selecionadas` : 'nenhuma selecionada';
  $('btn-cat-aplicar').disabled = !t.selecionadas.size;
}

// Árvore N1 > N2 > N3 > N4 > N5 com nº de SKUs e RCD MAT de cada nó
function desenharArvoreCat() {
  const raiz = { filhos: new Map(), skus: 0, rcd: 0 };
  for (const l of estado.tax.linhas) {
    const n = niveisAtuais(l);
    const caminho = semCategoria(n) ? [SEM_CATEGORIA] : n.map((x) => x || '(vazio)');
    raiz.skus++; raiz.rcd += l.rcd;
    let no = raiz;
    for (const nome of caminho) {
      if (!no.filhos.has(nome)) no.filhos.set(nome, { filhos: new Map(), skus: 0, rcd: 0 });
      no = no.filhos.get(nome);
      no.skus++; no.rcd += l.rcd;
    }
  }
  const html = (no, nivel) => [...no.filhos].sort((a, b) => b[1].rcd - a[1].rcd).map(([nome, f]) => {
    const info = `<span class="arv-nome${nome === SEM_CATEGORIA ? ' arv-sem' : ''}">${escaparHtml(nome)}</span>
      <span class="arv-info">${inteiro(f.skus)} SKUs · RCD MAT ${abreviar(f.rcd)} · ${percentual(divisao(f.rcd, raiz.rcd))}</span>`;
    if (!f.filhos.size) return `<div class="arv-folha arv-n${nivel}">${info}</div>`;
    return `<details class="arv-n${nivel}" ${nivel === 1 ? 'open' : ''}><summary>N${nivel} · ${info}</summary>${html(f, nivel + 1)}</details>`;
  }).join('');
  $('cat-arvore').innerHTML = `<div class="arv-total">Total: ${inteiro(raiz.skus)} SKUs · RCD MAT ${abreviar(raiz.rcd)}</div>${html(raiz, 1)}`;
}

// códigos da taxonomia que não existem na base carregada
function desenharSemVendaCat() {
  const t = estado.tax;
  const codigos = t.mapa ? [...t.mapa].filter(([c]) => !t.porSku.has(c)) : [];
  $('cat-bloco-semvenda').hidden = !codigos.length;
  if (!codigos.length) return;
  $('cat-semvenda-titulo').textContent = `Códigos na taxonomia sem venda na base (${inteiro(codigos.length)})`;
  $('tabela-cat-semvenda').innerHTML = `<thead><tr><th>cd_apresentacao</th><th>N1</th><th>N2</th><th>N3</th><th>N4</th><th>N5</th></tr></thead>
    <tbody>${codigos.slice(0, 2000).map(([c, v]) => `<tr><td>${escaparHtml(c)}</td>${v.n.map((x) => `<td>${escaparHtml(x)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ----- caixa com busca (uma só, reaproveitada por todos os campos N1–N5) -----
const caixaCat = { input: null, original: '' };
function abrirOpcoesCat(input) {
  caixaCat.input = input;
  const k = Number(input.dataset.k);
  let pai = null;
  if (k > 0) {
    // nível acima: o da mesma linha (ou o da edição em massa)
    const vizinho = input.closest('tr, .cat-massa').querySelector(`[data-k="${k - 1}"]`);
    pai = vizinho ? vizinho.value.trim() : null;
  }
  const texto = normalizar(input.value || '');
  const todos = valoresNivel(k, pai || null);
  const opcoes = todos.filter((v) => !texto || normalizar(v).includes(texto)).slice(0, 200);
  const painel = $('cat-opcoes');
  const digitado = input.value.trim();
  const novo = digitado && !todos.some((v) => v === digitado) ? `<div class="cat-op cat-op-novo" data-v="${escaparHtml(digitado)}">+ Usar novo valor "${escaparHtml(digitado)}"</div>` : '';
  painel.innerHTML = novo + (opcoes.map((v) => `<div class="cat-op" data-v="${escaparHtml(v)}">${escaparHtml(v)}</div>`).join('')
    || (novo ? '' : `<div class="cat-op-vazio">${pai ? `Nenhum valor em "${escaparHtml(pai)}". Digite um novo.` : 'Digite um valor novo.'}</div>`));
  const r = input.getBoundingClientRect();
  Object.assign(painel.style, { left: r.left + 'px', top: r.bottom + 2 + 'px', minWidth: Math.max(r.width, 200) + 'px' });
  painel.hidden = false;
}
function fecharOpcoesCat() { $('cat-opcoes').hidden = true; }
// redesenha a tabela só quando nenhum campo dela está em edição (não tira o foco de quem digita)
function redesenharCatQuandoLivre() {
  if (estado.pagina !== 'cat') return;
  const ativo = document.activeElement;
  if (ativo && ativo.closest && ativo.closest('#tabela-cat input.cat-campo')) { estado.tax.redesenhar = true; return; }
  estado.tax.redesenhar = false;
  desenharCategorizacao();
}
function confirmarCampoCat(input) {
  const valor = input.value.trim();
  if (input.dataset.sku) {
    const l = estado.tax.porSku.get(input.dataset.sku);
    const n = niveisAtuais(l);
    if ((n ? n[Number(input.dataset.k)] : '') === valor) return;
    const novos = [null, null, null, null, null];
    novos[Number(input.dataset.k)] = valor;
    alterarCategorias([input.dataset.sku], novos);
    // marca a linha na hora (a tabela inteira é redesenhada depois)
    const tr = input.closest('tr');
    tr.classList.add('cat-alterada');
    tr.classList.toggle('cat-sem', semCategoria(niveisAtuais(l)));
    tr.querySelector('.cat-status').textContent = 'alterado';
  }
}

$('pagina-cat').addEventListener('focusin', (e) => {
  const input = e.target.closest('.cat-campo, .cat-massa-campo');
  if (!input) return;
  caixaCat.original = input.value;
  abrirOpcoesCat(input);
});
$('pagina-cat').addEventListener('input', (e) => {
  const input = e.target.closest('.cat-campo, .cat-massa-campo');
  if (input) abrirOpcoesCat(input);
});
$('pagina-cat').addEventListener('focusout', (e) => {
  const input = e.target.closest('.cat-campo');
  if (!input) { if (e.target.closest('.cat-massa-campo')) setTimeout(fecharOpcoesCat, 150); return; }
  // pequena espera: o clique numa opção acontece antes de confirmar
  setTimeout(() => {
    if (document.activeElement === input) return;
    fecharOpcoesCat();
    confirmarCampoCat(input);
    if (estado.tax.redesenhar) setTimeout(redesenharCatQuandoLivre, 600);
  }, 150);
});
$('pagina-cat').addEventListener('keydown', (e) => {
  const input = e.target.closest('.cat-campo, .cat-massa-campo');
  if (!input) return;
  if (e.key === 'Enter') { e.preventDefault(); fecharOpcoesCat(); input.blur(); }
  if (e.key === 'Escape') { input.value = caixaCat.original; fecharOpcoesCat(); input.blur(); }
});
$('cat-opcoes').addEventListener('mousedown', (e) => {
  const op = e.target.closest('.cat-op');
  if (!op || !caixaCat.input) return;
  e.preventDefault();
  caixaCat.input.value = op.dataset.v;
  fecharOpcoesCat();
  caixaCat.input.blur();
});

// seleção e edição em massa
$('tabela-cat').addEventListener('change', (e) => {
  const t = estado.tax;
  if (e.target.id === 'cat-sel-todas') {
    for (const l of t.visiveis || []) { if (e.target.checked) t.selecionadas.add(l.sku); else t.selecionadas.delete(l.sku); }
    desenharTabelaCat();
  } else if (e.target.classList.contains('cat-sel')) {
    if (e.target.checked) t.selecionadas.add(e.target.dataset.sku); else t.selecionadas.delete(e.target.dataset.sku);
    $('cat-massa-qtd').textContent = t.selecionadas.size ? `${inteiro(t.selecionadas.size)} selecionadas` : 'nenhuma selecionada';
    $('btn-cat-aplicar').disabled = !t.selecionadas.size;
  }
});
$('btn-cat-aplicar').addEventListener('click', () => {
  const t = estado.tax;
  const campos = [...document.querySelectorAll('.cat-massa-campo')];
  const novos = campos.map((c) => (c.value.trim() ? c.value.trim() : null)); // vazio = não mexe
  if (!t.selecionadas.size || novos.every((v) => v === null)) { avisoRapido('Escolha as linhas e ao menos um nível para aplicar.'); return; }
  alterarCategorias([...t.selecionadas], novos);
  avisoRapido(`Categorias aplicadas a ${inteiro(t.selecionadas.size)} apresentações`);
  t.selecionadas.clear();
  campos.forEach((c) => { c.value = ''; });
});

// ----- exportações (CSV ";" em UTF-8, abre direto no Excel) -----
function baixarCsv(nome, cab, linhas) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const texto = '﻿' + [cab, ...linhas].map((l) => l.map(q).join(';')).join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
// taxonomia completa: todas as apresentações da base + códigos que só existem na taxonomia
function linhasTaxonomiaCompleta() {
  const t = estado.tax;
  const linhas = (t.linhas || []).map((l) => [l.sku, l.apres, ...(niveisAtuais(l) || ['', '', '', '', ''])]);
  if (t.mapa) t.mapa.forEach((v, c) => { if (!t.porSku.has(c)) linhas.push([c, v.desc || '', ...v.n]); });
  return linhas;
}
$('btn-cat-exportar').addEventListener('click', () => baixarCsv('taxonomia_completa.csv', [COL_SKU, 'Apresentacao Desc Longa', ...COLS_TAX], linhasTaxonomiaCompleta()));
$('btn-cat-exportar-alt').addEventListener('click', () => {
  const t = estado.tax;
  if (!t.antes.size) { avisoRapido('Nenhuma alteração nesta sessão.'); return; }
  const linhas = [...t.antes.keys()].map((sku) => {
    const l = t.porSku.get(sku);
    const v = t.mapa.get(sku);
    return [sku, (l && l.apres) || (v && v.desc) || '', ...(v ? v.n : ['', '', '', '', ''])];
  });
  baixarCsv('taxonomia_alteracoes.csv', [COL_SKU, 'Apresentacao Desc Longa', ...COLS_TAX], linhas);
});
// para o repositório: só códigos e classificações (nenhum nome de produto, corporação etc.)
$('btn-cat-exportar-repo').addEventListener('click', () => {
  const linhas = linhasTaxonomiaCompleta().map(([c, , ...n]) => [c, ...n]).filter((l) => l.slice(1).some(Boolean));
  baixarCsv('taxonomia.csv', [COL_SKU, ...COLS_TAX], linhas);
});

$('btn-cat-desfazer').addEventListener('click', desfazerAlteracoes);
$('cat-mostrar').addEventListener('change', desenharCategorizacao);
$('cat-busca').addEventListener('input', () => { clearTimeout(estado.tax.tempoBusca); estado.tax.tempoBusca = setTimeout(desenharCategorizacao, 200); });
document.querySelectorAll('#cat-modo button').forEach((b) => b.addEventListener('click', () => { estado.tax.modo = b.dataset.modo; desenharCategorizacao(); }));
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#cat-opcoes, .cat-campo, .cat-massa-campo')) fecharOpcoesCat(); });

estado.promessaTax = carregarFonteTaxonomia();

// =====================================================================
// Menu de páginas (caixa suspensa "Página: …")
// Filtros sempre em primeiro; páginas novas entram na lista abaixo.
// =====================================================================
const CHAVE_PAGINA = 'dashboard-farma:pagina';
const PAGINAS = [
  ['filtros', 'Filtros'],
  ['cat', 'Categorização'],
  ['analise', 'Gráfico e Tabela'],
  ['pareto', 'Pareto'],
  ['port', 'Portfólio'],
  ['lanc', 'Lançamentos Mercado'],
  ['preco', 'Preço'],
  ['preco2', 'Preço 2'],
  ['preco3', 'Preço 3'],
  ['el', 'EL'],
  ['elcomp', 'EL Compilado'],
];

function montarMenu() {
  $('menu-lista').innerHTML = PAGINAS.map(([p, nome]) =>
    `<button type="button" class="menu-item" data-pagina="${p}">${nome}${p === 'filtros' ? ' <span class="contador-filtros"></span>' : ''}</button>`).join('');
  $('menu-botao').addEventListener('click', () => { $('menu-lista').hidden = !$('menu-lista').hidden; });
  $('menu-lista').addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    $('menu-lista').hidden = true;
    trocarPagina(item.dataset.pagina);
  });
  document.addEventListener('mousedown', (e) => { if (!$('menu-paginas').contains(e.target)) $('menu-lista').hidden = true; });
  marcarMenu('filtros');
}

function marcarMenu(pagina) {
  const nome = (PAGINAS.find(([p]) => p === pagina) || PAGINAS[0])[1];
  $('menu-atual').textContent = nome;
  $('menu-selo').hidden = pagina !== 'filtros';
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('ativa', b.dataset.pagina === pagina));
}

montarMenu(); // no fim do arquivo: a lista PAGINAS já existe
instalarCapturas(); // botão "Copiar como imagem" em todas as páginas (menos Filtros)
// caixa suspensa reaproveitada pela página EL Compilado (compilado.js)
window.componentes = { criarSeletor: criarSeletorPreco };
