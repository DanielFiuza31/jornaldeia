import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'dist');
const PORT = Number(process.env.STATIC_BUILD_PORT || 4180);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const seed = JSON.parse(await fs.readFile(path.join(ROOT, 'news.json'), 'utf8'));
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore'
});

let childError;
child.once('error', error => { childError = error; });

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (childError) throw childError;
    if (child.exitCode !== null) throw new Error(`O servidor encerrou antes de iniciar (código ${child.exitCode}).`);
    try {
      const response = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('O servidor de notícias não ficou pronto em 90 segundos.');
}

async function readPeriod(period) {
  const response = await fetch(`${BASE_URL}/api/news?period=${period}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`A consulta de notícias (${period}) respondeu HTTP ${response.status}.`);
  return response.json();
}

try {
  await waitForServer();
  const [day, week] = await Promise.all([readPeriod('day'), readPeriod('week')]);
  const periods = {
    day: day.items?.length ? day.items : seed.items,
    week: week.items?.length ? week.items : seed.items
  };
  const all = new Map();
  for (const item of [...periods.week, ...periods.day]) {
    const key = item.id || item.url || item.title;
    if (!all.has(key)) all.set(key, item);
  }
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    cachedUntil: week.cachedUntil || day.cachedUntil || generatedAt,
    sourceStatus: week.sourceStatus?.length ? week.sourceStatus : day.sourceStatus || [],
    untranslatedCount: Math.max(Number(day.untranslatedCount) || 0, Number(week.untranslatedCount) || 0),
    periods,
    items: [...all.values()].sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
  };

  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(ROOT, 'index.html'), path.join(OUTPUT, 'index.html')),
    fs.copyFile(path.join(ROOT, 'noticia.html'), path.join(OUTPUT, 'noticia.html')),
    fs.copyFile(path.join(ROOT, 'news-sources.json'), path.join(OUTPUT, 'news-sources.json')),
    fs.cp(path.join(ROOT, 'assets'), path.join(OUTPUT, 'assets'), { recursive: true }),
    fs.writeFile(path.join(OUTPUT, 'news.json'), `${JSON.stringify(payload, null, 2)}\n`)
  ]);
  console.log(`Publicação estática pronta: ${payload.items.length} matérias/projetos; ${periods.day.length} hoje e ${periods.week.length} na semana.`);
} finally {
  child.kill('SIGTERM');
}
