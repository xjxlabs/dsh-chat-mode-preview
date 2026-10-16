// Separate Vitest processes prove cold recovery without in-memory singleton reuse.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.env.DSH_SOURCE_ROOT ?? join(repo, '../deepseek-harness'));
await mkdir(join(repo, 'scratch'), { recursive: true });
const evidence = await mkdtemp(join(repo, 'scratch', 'p0-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)));
Object.assign(env, { DSH_SOURCE_ROOT: source, DSH_HOME: join(evidence, 'home'), P0_EVIDENCE: evidence });
const results = [];
for (const phase of ['paths', 'write', 'read']) {
  const args = phase === 'paths'
    ? ['--test', 'test/p0/runtime-root.test.mjs']
    : [join(source, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'test/p0/vitest.config.mjs',
      '--reporter=default', '--reporter=json', `--outputFile.json=${join(evidence, phase + '.json')}`];
  const result = spawnSync(process.execPath, args, {
    cwd: repo, env: { ...env, P0_PHASE: phase }, encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  await writeFile(join(evidence, phase + '.log'), output);
  console.log(output);
  results.push({ phase, status: result.status, signal: result.signal, error: result.error?.message });
  if (result.status !== 0) break;
}
await writeFile(join(evidence, 'result.json'), JSON.stringify({ source, node: process.version, results }, null, 2));
console.log(`P0 evidence retained: ${evidence}`);
if (results.length !== 3 || results.some(result => result.status !== 0)) process.exitCode = 1;
