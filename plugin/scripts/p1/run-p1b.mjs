import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.env.DSH_SOURCE_ROOT ?? join(repo, '../deepseek-harness'));
const result = spawnSync(process.execPath, [
  join(source, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--config',
  'test/p1/vitest.config.mjs',
], {
  cwd: repo,
  env: { ...process.env, DSH_SOURCE_ROOT: source },
  encoding: 'utf8',
  timeout: 90000,
  windowsHide: true,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
