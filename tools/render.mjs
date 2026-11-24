#!/usr/bin/env node
// Render GLB files to images with three.js in headless Chromium.
//   node tools/render.mjs out.png view file1.glb [file2.glb ...] [--cols N --sp M --w 1200 --h 700 --zoom 1.1]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const args = process.argv.slice(2);
const opts = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
const [outFile, view, ...glbs] = files;
const root = resolve(new URL('..', import.meta.url).pathname);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const w = +(opts.w || 1200), h = +(opts.h || 700);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.route('http://local/**', (route) => {
  const url = new URL(route.request().url());
  let p = decodeURIComponent(url.pathname);
  const file = p.startsWith('/three/') ? resolve(root, 'node_modules', 'three', p.slice(7)) : resolve(root, '.' + p);
  if (!existsSync(file)) return route.fulfill({ status: 404, body: 'nf ' + file });
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }[extname(file)] || 'application/octet-stream';
  route.fulfill({ status: 200, body: readFileSync(file), contentType: type });
});
const q = new URLSearchParams({ f: glbs.map((g) => '/' + g).join(','), view, w, h, ...opts });
await page.goto('http://local/tools/' + (opts.page || 'render') + '.html?' + q);
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
await page.screenshot({ path: outFile, type: outFile.endsWith('.jpg') ? 'jpeg' : 'png', quality: outFile.endsWith('.jpg') ? 88 : undefined });
await browser.close();
console.log('wrote', outFile);
