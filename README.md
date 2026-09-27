# Estado da Arte I. A.

Portal editorial de inteligência artificial. A página reúne notícias em português com filtro por Hoje/Esta semana, região e assunto, além de repositórios do GitHub Trending. Quando os feeds fornecem uma imagem da matéria, os cartões exibem essa imagem sem deformar; títulos e resumos de feeds em inglês recebem tradução automática para português, com acesso ao texto original.

## Iniciar

Requer Node.js 18 ou superior. Não há dependências externas para instalar. Inicie com:

```sh
node server.mjs
```

Depois, abra `http://localhost:4173`.

## Publicação gratuita

O projeto está preparado para GitHub Pages. Um fluxo do GitHub Actions consulta as notícias e o GitHub Trending, gera os arquivos estáticos e publica o site a cada 30 minutos. A atualização automática depende de o fluxo agendado estar habilitado no repositório.

No plano gratuito do GitHub, o repositório precisa ser público. Isso torna público o código-fonte do site. Depois de publicar, associe `jornaldeia.com.br` em **Settings → Pages → Custom domain** e configure no Registro.br os registros DNS indicados pelo GitHub. Aponte o domínio somente depois de a página estar publicada e o domínio associado no GitHub.

Para gerar uma cópia estática manualmente, use `npm run build:static`; os arquivos prontos ficam em `dist/`. O servidor local continua disponível com `npm start`.

## Fontes e atualização

- A lista ativa está em `news-sources.json`.
- O servidor consulta RSS/Atom e GitHub Trending durante a geração da publicação.
- O fluxo agendado reconstrói e publica feeds e projetos do GitHub a cada 30 minutos; cada notícia conserva o link para a publicação original.
- Títulos e resumos em inglês são traduzidos pelo serviço MyMemory; matérias sem tradução disponível ficam fora da lista até haver uma versão em português. O veículo e a publicação original continuam vinculados.
- Os cartões usam a imagem fornecida pelo feed ou pela própria matéria quando disponível, com recorte proporcional; a seleção de reserva também mantém URLs de imagens originais.
- Brasil: busca regional em fontes como CNN Brasil, Canaltech, TecMundo e Tecnoblog.
- Estados Unidos: TechCrunch, The Verge, Ars Technica e MIT Technology Review.
- Europa: Euractiv, Comissão Europeia e Tech.eu.
- China: South China Morning Post, Xinhua e China Daily.
- GitHub: GitHub Blog, GitHub Changelog e página oficial do GitHub Trending.
- `news.json` contém uma seleção editorial inicial pesquisada em 26/09/2026 e permite abrir o site mesmo se algum feed estiver indisponível.

A cobertura depende dos feeds públicos e das fontes configuradas; não existe garantia de capturar toda publicação mundial. Não republicamos matérias completas ou imagens dos veículos. Para TechCrunch, a exibição segue os [termos oficiais de RSS](https://techcrunch.com/rss-terms-of-use/): atribuição e link para o texto original.

## Estrutura

- `index.html`: interface do portal.
- `noticia.html`: página de leitura com resumo e link para a publicação original.
- `server.mjs`: servidor local e agregador RSS/Atom/GitHub Trending.
- `news.json`: seleção editorial de reserva.
- `news-sources.json`: feeds, regiões e intervalo de atualização.
