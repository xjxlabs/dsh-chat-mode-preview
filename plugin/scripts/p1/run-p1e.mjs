import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.env.DSH_SOURCE_ROOT ?? join(repo, '../deepseek-harness'));
const vitest = join(source, 'node_modules/vitest/vitest.mjs');

function run(args, cwd) {
  const result = spawnSync(process.execPath, [vitest, 'run', ...args], {
    cwd,
    env: { ...process.env, DSH_SOURCE_ROOT: source },
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['--config', 'test/p1/vitest.config.mjs'], repo);
run(['--config', 'test/p1e/vitest.config.mjs'], repo);
run([
  'packages/preset/agent-presets/tests/admission.spec.ts',
  'packages/preset/agent-presets/tests/shipped-root.spec.ts',
  'packages/api/session-controller/tests/session-presets.host.spec.ts',
], source);
