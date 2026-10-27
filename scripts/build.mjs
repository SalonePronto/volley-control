import { readFile, mkdir, writeFile } from 'node:fs/promises';
const assets = {};
for (const [url, file, type] of [
  ['/', 'web/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'web/app.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'web/style.css', 'text/css; charset=utf-8'],
])
  assets[url] = { body: await readFile(file, 'utf8'), type };
await mkdir('dist', { recursive: true });
let code = await readFile('worker/index.mjs', 'utf8');
code = code.replace(/export (?=(?:const|function|async function) )/g, '');
code = code.replace(
  "import { ASSETS } from './assets.mjs';",
  'const ASSETS = ' + JSON.stringify(assets) + ';',
);
await writeFile('dist/worker.mjs', code);
console.log('Worker standalone costruito; nessun deploy automatico.');
await writeFile('dist/domain.mjs', await readFile('worker/domain.mjs', 'utf8'));
