# Dashboard de Mercado Farmacêutico

Site simples (só HTML, CSS e JavaScript) para analisar a base de mercado farmacêutico.

## Privacidade

**Nenhum dado fica neste repositório nem é enviado para servidor algum.**
Quem usa o site escolhe um arquivo CSV do próprio computador e todo o
processamento acontece dentro do navegador. Ao fechar a página, os dados
somem da memória.

O único arquivo de dados aqui é `exemplo.csv`, com 200 linhas **fictícias**
(empresas e produtos inventados), só para testar.

## Como usar

1. Abra o site publicado (GitHub Pages).
2. Clique em **Carregar arquivo** e escolha o CSV exportado do Excel
   (separador `;`, decimal com vírgula, UTF-8 ou Latin-1).
   Ou clique em **Usar dados de exemplo**.
3. Na aba **Filtros**, marque o que quiser analisar. Os filtros valem para todas as abas.
4. Na aba **Gráfico e Tabela**, escolha a dimensão do gráfico, da tabela e o período (MAT ou YTD).

## Lançamentos Mercado

A página **Lançamentos Mercado** mostra só os produtos lançados no período escolhido em
"Lançados desde" (padrão: últimos 36 meses da base), respeitando os filtros da página Filtros.
A data de lançamento vem da coluna `Lancamento Apresentacao` (data do Excel, ex.: 45778 = 01/05/2025)
ou do primeiro mês com unidades vendidas. No nível "Produto/Marca", a marca é lançada no mês da sua
primeira apresentação. O eixo pode ser o calendário ou "Mesmo ponto de partida" (Mês 1 = mês de
lançamento de cada produto). Com "Incluir ELs e MAT+1" ligado, as ELs também entram como lançamentos.

O `exemplo.csv` tem 13 apresentações (10 marcas) com lançamentos fictícios entre out-23 e jun-26.

## Correção de preço (Infoprice)

Na página **Filtros**, a seção "Correção de preço (Infoprice)" aceita um ou mais CSVs do Infoprice
(separador ",", decimal ".", coluna `TEMPO` semanal e uma coluna por SKU). Eles também são lidos
só no navegador. O site sugere a correspondência de cada coluna com uma apresentação da base RM
(de-para), que pode ser revisada, exportada e importada; o de-para fica guardado apenas no navegador.
O RC de cada mês com Infoprice passa a ser a média das semanas do mês, e o RCON = RC × Unidades.

O arquivo `exemplo_infoprice.csv` tem preços **fictícios** dos produtos do `exemplo.csv`, para teste.

## Estudo de Lançamento (aba EL)

A aba **EL** reproduz o formulário de Estudo de Lançamento com todos os campos editáveis e os
cálculos atualizados enquanto se digita. Um arquivo `.html` no formato do `exemplo_el.html` pode ser
importado (lido pelos rótulos das linhas e colunas). As ELs ficam **só no navegador**; use
"Exportar ELs" (arquivo `.json`) como backup e "Importar ELs" para restaurar.

Com o interruptor **"Incluir ELs e MAT+1"** (topo do dashboard) ligado, cada EL vira um SKU
virtual na base: os meses 1–12 da EL entram no MAT atual e os meses 13–24 formam o período projetado
**MAT+1** (os SKUs reais são projetados pela evolução definida no bloco "Projeção MAT+1" da aba EL).
Desligado, o dashboard fica exatamente como sem as ELs.

A página **EL Compilado** junta todas as ELs num OnePage (cards, gráficos e tabela resumo) pensado
para imprimir em uma folha A4 paisagem (botão "Imprimir / PDF"). Na Medida **UN**, os gráficos comparam
Sell-out (Demanda UN, linha contínua) e Sell-in (Sell-In UN, linha tracejada).

O `exemplo_el.html` é **fictício**, apenas para teste.

## Como publicar no GitHub Pages

No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
escolha a branch `main` e a pasta `/ (root)`, e clique em **Save**.
Em alguns minutos o endereço do site aparece nessa mesma tela.

> Abrir o `index.html` com dois cliques direto do computador não funciona
> (o navegador bloqueia por segurança). Use o endereço do GitHub Pages.

## Versão

No `index.html`, os links do `app.js` e do `style.css` têm `?v=AAAAMMDD-N`.
Atualize esse número a cada mudança: isso força o navegador a baixar a versão nova.
O número aparece no rodapé do site.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura das telas |
| `style.css` | Cores e layout |
| `app.js` | Leitura do CSV, filtros, gráficos e tabela |
| `exemplo.csv` | Dados fictícios para teste |
| `exemplo_infoprice.csv` | Preços Infoprice fictícios para teste |
| `el.js` | Aba EL (Estudo de Lançamento) |
| `exemplo_el.html` | EL fictícia para teste |
| `compilado.js` | Página EL Compilado (OnePage de todas as ELs) |
