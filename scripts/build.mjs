import { readFile, mkdir, writeFile } from 'node:fs/promises';
const assets = {};
for (const [url, file, type] of [
  ['/', 'web/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'web/app.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'web/style.css', 'text/css; charset=utf-8'],
  ['/manifest.webmanifest', 'web/manifest.webmanifest', 'application/manifest+json'],
])
  assets[url] = { body: await readFile(file, 'utf8'), type };
Object.assign(assets, JSON.parse(await readFile('web/icons.json', 'utf8')));
await mkdir('dist', { recursive: true });
let code = await readFile('worker/index.mjs', 'utf8');
const domain = (await readFile('worker/domain.mjs', 'utf8')).replace(
  /export (?=(?:const|function|async function) )/g,
  '',
);
const domainImport = /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/domain\.mjs['"];?/;
code = code.replace(
  "import { ASSETS } from './assets.mjs';",
  'const ASSETS = ' + JSON.stringify(assets) + ';',
);
if (!domainImport.test(code)) throw new Error('Import del dominio non trovato: build interrotta.');
code = code
  .replace(domainImport, () => domain)
  .replace(/export (?=(?:const|function|async function) )/g, '');
if (/^import\s/m.test(code)) throw new Error('Il bundle deve essere privo di import esterni.');
await writeFile('dist/worker.mjs', code);
console.log('Worker autonomo costruito: un solo modulo, nessun deploy automatico.');
