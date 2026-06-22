/**
 * Build + serve the smoke harness for Playwright (NFR-A-03 / M2).
 *
 * Bundles smoke/driver.ts with the real `@cesium/engine`, stages Cesium's
 * runtime Workers/Assets/ThirdParty next to it (served over http so Cesium's
 * web-workers and XHR are not blocked by a file:// origin), and serves the
 * result. Referenced by playwright.config.ts `webServer`.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.served');
const cesium = join(here, '..', 'node_modules', '@cesium', 'engine');
const PORT = process.env.SMOKE_PORT ? Number(process.env.SMOKE_PORT) : 4178;

mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(here, 'driver.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: join(out, 'bundle.js'),
  logLevel: 'error',
});
copyFileSync(join(here, 'index.html'), join(out, 'index.html'));
cpSync(join(cesium, 'Build', 'Workers'), join(out, 'Workers'), { recursive: true });
cpSync(join(cesium, 'Build', 'ThirdParty'), join(out, 'ThirdParty'), { recursive: true });
cpSync(join(cesium, 'Source', 'Assets'), join(out, 'Assets'), { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
};
const server = createServer((req, res) => {
  const path = join(out, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
server.listen(PORT, () => console.log(`smoke server on http://localhost:${PORT}`));
