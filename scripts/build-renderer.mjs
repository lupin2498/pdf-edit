// Bundles the renderer with esbuild and copies pdf.js runtime assets.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'src', 'renderer', 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(path.join(outdir, 'pdfjs'), { recursive: true });

const pdfjsRoot = path.join(root, 'node_modules', 'pdfjs-dist');
fs.copyFileSync(path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'), path.join(outdir, 'pdfjs', 'pdf.worker.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = path.join(pdfjsRoot, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(outdir, 'pdfjs', dir), { recursive: true });
}

const options = {
  entryPoints: {
    app: path.join(root, 'src', 'renderer', 'js', 'main.js'),
    styles: path.join(root, 'src', 'renderer', 'css', 'app.css'),
  },
  bundle: true,
  outdir,
  format: 'esm',
  target: ['chrome130'],
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
  loader: { '.svg': 'text' },
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  // fontkit/pdf-lib reference Node built-ins that are unused in the browser.
  external: [],
  platform: 'browser',
  mainFields: ['browser', 'module', 'main'],
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  console.log('watching...');
} else {
  await build(options);
}
