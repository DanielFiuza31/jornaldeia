import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const SOURCES = JSON.parse(await fs.readFile(path.join(ROOT, 'news-sources.json'), 'utf8'));
const seed = JSON.parse(await fs.readFile(path.join(ROOT, 'news.json'), 'utf8'));
const refreshMs = Math.max(5, Number(SOURCES.refreshMinutes || 30)) * 60_000;
let newsCache = { until: 0, items: seed.items, sourceStatus: [] };
let newsRefreshPromise = null;
let githubCache = { day: { until: 0, items: [] }, week: { until: 0, items: [] } };
const translationCache = new Map();
const dailyTranslationLimit = 4700;
let translationDay = new Date().toISOString().slice(0, 10);
let translatedCharacters = 0;

const namedEntities = {
  nbsp: ' ', aacute: 'á', Aacute: 'Á', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã',
  agrave: 'à', Agrave: 'À', auml: 'ä', Auml: 'Ä', eacute: 'é', Eacute: 'É',
  ecirc: 'ê', Ecirc: 'Ê', egrave: 'è', Egrave: 'È', euml: 'ë', Euml: 'Ë',
  iacute: 'í', Iacute: 'Í', icirc: 'î', Icirc: 'Î', igrave: 'ì', Igrave: 'Ì',
  iuml: 'ï', Iuml: 'Ï', oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô',
  otilde: 'õ', Otilde: 'Õ', ograve: 'ò', Ograve: 'Ò', ouml: 'ö', Ouml: 'Ö',
  uacute: 'ú', Uacute: 'Ú', ucirc: 'û', Ucirc: 'Û', ugrave: 'ù', Ugrave: 'Ù',
  uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç', yacute: 'ý', Yacute: 'Ý',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–',
  hellip: '…', bull: '•', trade: '™', copy: '©', reg: '®', ordm: 'º', ordf: 'ª',
  euro: '€', pound: '£', cent: '¢', times: '×', divide: '÷'
};
function truncateText(value = '', limit = 650) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const boundary = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, boundary > limit * 0.7 ? boundary : limit).replace(/[\s.,;:!?…-]+$/, '')}…`;
}
function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z][a-z\d]+);/gi, (entity, name) => namedEntities[name] || entity);
}
function plainText(value = '') {
  return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tagValue(xml, tag) {
  const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safe}>`, 'i'));
  return match ? plainText(match[1]) : '';
}
function imageFromFeed(xml, articleUrl) {
  const candidates = [];
  for (const match of xml.matchAll(/<(media:thumbnail|media:content|enclosure)\b([^>]*)\/?\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const url = attrs.match(/\burl=["']([^"']+)["']/i)?.[1];
    const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1] || '';
    const medium = attrs.match(/\bmedium=["']([^"']+)["']/i)?.[1] || '';
    if (url && (tag === 'media:thumbnail' || medium.toLowerCase() === 'image' || type.toLowerCase().startsWith('image/'))) candidates.push(url);
  }
  for (const match of xml.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const url = attrs.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1];
    if (url) candidates.push(url);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(decodeXml(candidate), articleUrl);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch {}
  }
  return '';
}
function toIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}
async function translateText(text, sourceLanguage = 'en') {
  const input = String(text || '').trim();
  if (!input || sourceLanguage === 'pt') return input;
  const cacheKey = `${sourceLanguage}:${input}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== translationDay) { translationDay = today; translatedCharacters = 0; }
  if (translatedCharacters + input.length > dailyTranslationLimit) return null;
  translatedCharacters += input.length;
  try {
    const endpoint = new URL('https://api.mymemory.translated.net/get');
    endpoint.searchParams.set('q', input.slice(0, 900));
    endpoint.searchParams.set('langpair', `${sourceLanguage}|pt`);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'EstadoDaArteIA/0.1 (+Portuguese AI news translation)' } });
    if (!response.ok) return null;
    const payload = await response.json();
    const translated = decodeXml(payload?.responseData?.translatedText || '').trim();
    if (Number(payload?.responseStatus) !== 200 || !translated) return null;
    translationCache.set(cacheKey, translated);
    return translated;
  } catch { return null; }
}
async function translateItem(item, sourceLanguage = 'en') {
  if (sourceLanguage === 'pt') return { ...item, translationStatus: 'native' };
  const summaryInput = truncateText(item.summary || '', 320);
  const [title, summary] = await Promise.all([
    item.kind === 'repository' ? Promise.resolve(item.title) : translateText(item.title, sourceLanguage),
    summaryInput ? translateText(summaryInput, sourceLanguage) : Promise.resolve('')
  ]);
  const translatedTitle = title || item.title;
  const translatedSummary = summary || item.summary;
  const changed = translatedTitle !== item.title || translatedSummary !== item.summary;
  return {
    ...item,
    title: translatedTitle,
    summary: translatedSummary,
    ...(changed ? { originalTitle: translatedTitle !== item.title ? item.title : '', originalSummary: translatedSummary !== item.summary ? item.summary : '' } : {}),
    translationStatus: changed ? (title && summary ? 'translated' : 'partial') : 'unavailable'
  };
}
function rssEntries(xml) {
  const matches = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return matches.map((block) => {
    const title = tagValue(block, 'title');
    const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    const link = tagValue(block, 'link') || (linkTag ? decodeXml(linkTag[1]) : '');
    const summary = tagValue(block, 'description') || tagValue(block, 'summary') || tagValue(block, 'content:encoded');
    const date = tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated') || tagValue(block, 'dc:date');
    const source = tagValue(block, 'source');
    return { title, link, summary, imageUrl: imageFromFeed(block, link), publishedAt: toIsoDate(date), feedSource: source };
  }).filter((item) => item.title && item.link && /^https?:\/\//i.test(item.link));
}
function looksLikeAi(item) {
  const text = `${item.title} ${plainText(item.summary).slice(0, 800)}`;
  return /\b(ai|artificial intelligence|machine learning|llm|copilot|chatgpt|openai|anthropic|gemini|deepseek|gpt[-\s]?\d|claude|mistral|midjourney|stable diffusion|sora|veo|runway|perplexity)\b|intelig[eê]ncia artificial|\bia\b|ia generativa|modelo de ia|agente de ia|人工智能|大模型|机器人/i.test(text);
}
function normalizedUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ocid']) parsed.searchParams.delete(key);
    return parsed.toString().replace(/\/$/, '');
  } catch { return url; }
}
async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { 'User-Agent': 'EstadoDaArteIA/0.1 (+editorial RSS reader)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  if (!xml.includes('<rss') && !xml.includes('<feed') && !xml.includes('<rdf:RDF')) throw new Error('Resposta não parece RSS/Atom');
  const items = rssEntries(xml).filter(looksLikeAi).slice(0, Number(SOURCES.maxPerFeed || 18)).map((item) => ({
    id: `${feed.id}-${Buffer.from(normalizedUrl(item.link)).toString('base64url').slice(0, 16)}`,
    title: item.title,
    summary: item.summary ? truncateText(plainText(item.summary), 650) : '',
    source: item.feedSource || feed.name,
    sourceUrl: feed.sourceUrl,
    publishedAt: item.publishedAt || new Date().toISOString(),
    region: feed.region,
    category: 'noticias',
    kind: feed.region === 'github' ? 'github' : 'news',
    sourceLanguage: feed.language || 'en',
    imageUrl: item.imageUrl,
    url: item.link
  }));
  return items;
}
async function refreshNews() {
  const results = await Promise.allSettled(SOURCES.feeds.map(async (feed) => ({ feed, items: await fetchFeed(feed) })));
  const live = [];
  const sourceStatus = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const feed = SOURCES.feeds[i];
    if (result.status === 'fulfilled') {
      live.push(...result.value.items);
      sourceStatus.push({ id: feed.id, name: feed.name, region: feed.region, status: 'ok', count: result.value.items.length });
    } else {
      sourceStatus.push({ id: feed.id, name: feed.name, region: feed.region, status: 'unavailable', error: String(result.reason?.message || result.reason) });
    }
  }
  const merged = new Map();
  for (const item of [...seed.items, ...live]) {
    const key = normalizedUrl(item.url || item.sourceUrl);
    if (!merged.has(key)) merged.set(key, item);
  }
  const rawItems = [...merged.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  let reservedCharacters = 0;
  const translatable = new Set();
  for (const item of rawItems) {
    if (item.sourceLanguage !== 'en') continue;
    const titleCached = item.kind === 'repository' || translationCache.has(`en:${item.title}`);
    const summaryText = item.summary ? item.summary.slice(0, 320) : '';
    const summaryCached = !summaryText || translationCache.has(`en:${summaryText}`);
    const needed = (titleCached ? 0 : item.title.length) + (summaryCached ? 0 : summaryText.length);
    if (!needed || reservedCharacters + needed <= dailyTranslationLimit) {
      translatable.add(item.id);
      reservedCharacters += needed;
    }
  }
  const items = await Promise.all(rawItems.map(async (item) => {
    if (!item.sourceLanguage) return item;
    if (item.sourceLanguage === 'pt') { const { sourceLanguage, ...native } = item; return { ...native, translationStatus: 'native' }; }
    const { sourceLanguage, ...ready } = item;
    return translatable.has(item.id) ? translateItem(ready, sourceLanguage) : { ...ready, translationStatus: 'unavailable' };
  }));
  const untranslatedCount = items.filter(item => ['unavailable', 'partial'].includes(item.translationStatus)).length;
  const portugueseItems = items.filter(item => !['unavailable', 'partial'].includes(item.translationStatus));
  newsCache = { until: Date.now() + refreshMs, items: portugueseItems, sourceStatus, untranslatedCount };
  return newsCache;
}
async function loadNews() {
  if (newsCache.until > Date.now()) return newsCache;
  if (newsRefreshPromise) return newsRefreshPromise;
  newsRefreshPromise = refreshNews().finally(() => { newsRefreshPromise = null; });
  return newsRefreshPromise;
}
function cleanGithubText(value = '') { return plainText(value).replace(/\s+/g, ' ').trim(); }
function headlineFromDescription(value = '') {
  const sentence = String(value).split(/\s+[—–-]\s+|(?<=[.!?])\s/)[0].trim().replace(/[.!?]+$/, '');
  if (!sentence) return 'Projeto de IA em destaque no GitHub';
  if (sentence.length <= 88) return sentence;
  return `${sentence.slice(0, 85).replace(/\s+\S*$/, '')}…`;
}
function localizeRepository(item) {
  const repository = item.title;
  if (repository.toLowerCase() === 'dream-num/univer') {
    return {
      ...item,
      repository,
      title: 'Univer reúne planilhas, documentos e apresentações em um só ambiente',
      summary: 'Plataforma de escritório para agentes de IA, com planilhas, documentos, apresentações, quadros, tabelas relacionais e arquivos PDF.',
      originalSummary: item.summary,
      translationStatus: 'translated'
    };
  }
  if (item.translationStatus === 'unavailable') {
    return {
      ...item,
      repository,
      title: 'Projeto de IA em destaque no GitHub',
      summary: 'Repositório de código aberto relacionado à inteligência artificial. Consulte a página do projeto para ver recursos e documentação.',
      originalSummary: item.summary,
      translationStatus: 'fallback'
    };
  }
  return { ...item, repository, title: headlineFromDescription(item.summary) };
}
async function loadGithubTrending(period = 'day') {
  const key = period === 'week' ? 'week' : 'day';
  if (githubCache[key].until > Date.now()) return githubCache[key].items;
  const since = key === 'week' ? 'weekly' : 'daily';
  try {
    const response = await fetch(`https://github.com/trending?since=${since}`, {
      headers: { 'User-Agent': 'EstadoDaArteIA/0.1 (+public GitHub Trending reader)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];
    const items = articles.map((article) => {
      const repoMatch = article.match(/<h2\b[\s\S]*?<a\b[^>]*href=["']\/(\w[\w.-]*\/[\w.-]+)["']/i);
      if (!repoMatch) return null;
      const repo = repoMatch[1];
      const description = cleanGithubText((article.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
      if (!looksLikeAi({ title: repo, summary: description })) return null;
      const starMatch = cleanGithubText(article).match(/([\d,]+)\s+stars?\s+(today|this week)/i);
      const starText = starMatch ? `${starMatch[1]} estrelas ${starMatch[2] === 'today' ? 'hoje' : 'nesta semana'}` : '';
      const language = cleanGithubText((article.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '');
      return { id: `gh-${repo}-${key}`, title: repo, summary: description, source: `GitHub Trending · ${key === 'week' ? 'semana' : 'hoje'}`, sourceUrl: `https://github.com/${repo}`, publishedAt: new Date().toISOString(), region: 'github', category: language || 'repositório', kind: 'repository', url: `https://github.com/${repo}`, trend: starText };
    }).filter(Boolean).slice(0, 8);
    const localizedItems = await Promise.all(items.map(async (item) => localizeRepository(await translateItem(item, 'en'))));
    githubCache[key] = { until: Date.now() + refreshMs, items: localizedItems };
    return localizedItems;
  } catch {
    githubCache[key] = { until: Date.now() + 5 * 60_000, items: [] };
    return [];
  }
}
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url.pathname === '/api/news') {
    const [news, trending] = await Promise.all([loadNews(), loadGithubTrending(url.searchParams.get('period'))]);
    const items = [...news.items, ...trending].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    response.writeHead(200, { 'Content-Type': mimeTypes['.json'], 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ generatedAt: new Date().toISOString(), cachedUntil: new Date(newsCache.until).toISOString(), sourceStatus: news.sourceStatus, untranslatedCount: news.untranslatedCount || 0, items }));
    return;
  }
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(ROOT, `.${relative}`);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found');
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Estado da Arte I. A. disponível em http://${HOST}:${PORT}`);
  void loadNews().catch(() => {});
  void loadGithubTrending('day').catch(() => {});
  void loadGithubTrending('week').catch(() => {});
  setInterval(() => {
    void loadNews().catch(() => {});
    void loadGithubTrending('day').catch(() => {});
    void loadGithubTrending('week').catch(() => {});
  }, refreshMs);
});
