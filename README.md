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

## Como publicar no GitHub Pages

No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
escolha a branch `main` e a pasta `/ (root)`, e clique em **Save**.
Em alguns minutos o endereço do site aparece nessa mesma tela.

> Abrir o `index.html` com dois cliques direto do computador não funciona
> (o navegador bloqueia por segurança). Use o endereço do GitHub Pages.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura das telas |
| `style.css` | Cores e layout |
| `app.js` | Leitura do CSV, filtros, gráficos e tabela |
| `exemplo.csv` | Dados fictícios para teste |
