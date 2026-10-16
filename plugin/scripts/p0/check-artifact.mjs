// Historical pre-B0 concatenation probe; never regenerates artifacts.
// After cc80f6f, exactMatch is NOT the current generator's check result.
// The authoritative gate is: node scripts/build-client.mjs --check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../build-client.mjs');
const id = JSON.parse(read('../../package.json')).name;
const lf = value => value.replaceAll('\r\n', '\n');
// JavaScript template literals normalize physical source line endings to LF.
const prologue = lf(source.match(/const PROLOGUE = \x60([\s\S]*?)\x60;/)[1]).replaceAll('${id}', id);
const epilogue = lf(source.match(/const EPILOGUE = \x60([\s\S]*?)\x60;/)[1]);
const expected = prologue + read('../../plugin.client.js') + epilogue;
const actual = read('../../lib/client.js');
console.log(JSON.stringify({
  artifact: fileURLToPath(new URL('../../lib/client.js', import.meta.url)),
  exactMatch: actual === expected,
  equalAfterCRLFNormalization: lf(actual) === lf(expected),
  actualCRLF: actual.split('\r\n').length - 1,
  expectedCRLF: expected.split('\r\n').length - 1,
}, null, 2));
if (lf(actual) !== lf(expected)) process.exitCode = 1;
