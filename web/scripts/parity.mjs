// Visual parity: screenshots each Screens/* story next to its prototype board at the artboard size.
// Usage: npm run build-storybook && node scripts/parity.mjs   (writes web/parity-out/<board>.{story,proto}.png)
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const protoDir = resolve(root, '../design/prototype/project');
const staticDir = resolve(root, 'storybook-static');
const outDir = resolve(root, 'parity-out');
const canvas = JSON.parse(readFileSync(join(protoDir, 'canvas.json'), 'utf8'));

// Same rule as src/screens/storyIds.ts: kebab-case of title and export name.
const kebab = (s) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const stories = {
  Main: ['Screens/Overview', 'Main'], NeedsYou: ['Screens/Runs', 'NeedsYou'], SignIn: ['Screens/Entry', 'SignIn'],
  ProjectsEmpty: ['Screens/Entry', 'ProjectsEmpty'], Projects: ['Screens/Entry', 'Projects'],
  Setup1: ['Screens/Setup', 'Setup1'], Setup2: ['Screens/Setup', 'Setup2'], Setup3: ['Screens/Setup', 'Setup3'],
  Setup4: ['Screens/Setup', 'Setup4'], SetupReady: ['Screens/Setup', 'SetupReady'],
  Runs: ['Screens/Runs', 'Runs'], RunsProblems: ['Screens/Runs', 'RunsProblems'],
  ...Object.fromEntries(['Starting', 'Running', 'Idle', 'Reconnect', 'Succeeded', 'Failed', 'TimedOut', 'Cancelled'].map((s) => [`Run${s}`, ['Screens/Run detail', `Run${s}`]])),
  ...Object.fromEntries(['Skills', 'SkillDelete', 'Rules', 'Agent'].map((s) => [`Desk${s}`, ['Screens/Desk', `Desk${s}`]])),
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createServer((req, res) => {
  const p = join(staticDir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(staticDir) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
});
if (!existsSync(staticDir)) throw new Error('storybook-static missing: run npm run build-storybook first');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(process.env.PARITY_CHROMIUM ? { executablePath: process.env.PARITY_CHROMIUM } : {}); // or run: npx playwright install chromium
let pairs = 0;
try {
  for (const file of canvas.order) {
    const name = file.replace(/\.dc\.html$/, '');
    const { w, h } = canvas.boards[file];
    const [title, exp] = stories[name] ?? [];
    if (!title) throw new Error(`no story mapped for ${name}`);
    const id = `${title.split('/').map(kebab).join('-')}--${kebab(exp)}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#storybook-root > *', { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, `${name}.story.png`) });
    await page.goto(pathToFileURL(join(protoDir, file)).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, `${name}.proto.png`) });
    await ctx.close();
    pairs += 1;
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${pairs} pairs written to ${outDir}`);
