// Generate lib/client.js from plugin.client.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const id = pkg.name;

const PROLOGUE = `window.__ModuleLoader__.load({
  id: '${id}',
  factory: (require) => {
    const React = require('react');
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return function () {};
        const prev = document.querySelector('style[data-plugin="${id}"]');
        if (prev) {
          prev.textContent = css;
          return function () { prev.remove(); };
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = '${id}';
        tag.textContent = css;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }
    };
    return (function () {
`;

const EPILOGUE = `
    })();
  }
});
`;

const fragment = readFileSync(join(root, 'plugin.client.js'), 'utf8');
// Git may check out text as CRLF, while JS template literals use LF at runtime.
// Canonicalize only CRLF pairs; all other bytes (including lone CR) stay significant.
const normalizeEol = (text) => text.replaceAll('\r\n', '\n');
const out = PROLOGUE + normalizeEol(fragment) + EPILOGUE;
const target = join(root, 'lib', 'client.js');

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (normalizeEol(current) !== out) {
    console.error('lib/client.js is stale — run: node scripts/build-client.mjs');
    process.exit(1);
  }
  console.log('lib/client.js is up to date');
} else {
  writeFileSync(target, out);
  console.error(`wrote lib/client.js (${out.length} bytes)`);
}
