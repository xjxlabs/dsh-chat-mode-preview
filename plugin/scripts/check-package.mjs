// Exercise npm's real packaging lifecycle in a temporary output directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'message-edit-package-'));
try {
  assert.ok(process.env.npm_execpath, 'Run this check through npm run check:package');
  const result = spawnSync(process.execPath, [
    process.env.npm_execpath, 'pack', '--json', '--silent', '--pack-destination', output,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  const [pack] = JSON.parse(result.stdout);
  const files = new Map(pack.files.map(file => [file.path, file.size]));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const syntax = spawnSync(process.execPath, ['--check', join(root, pkg.main)], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.error?.message || syntax.stderr);
  const required = new Set([
    pkg.main, 'lib/client.js', 'plugin.client.js',
    'lib/chat-search.js', 'lib/chat-tools-policy.js',
    'cordis.patch.yml', 'package.json', 'LICENSE',
    'presets/no-workspace-chat/agent.cordis.yml',
    'presets/no-workspace-chat/preset.yml',
    ...Object.values(pkg.exports).map(entry => typeof entry === 'string' ? entry : entry.default),
  ]);
  for (const path of required) {
    assert.ok(files.get(path.replace(/^\.\//, '')) > 0, `Missing or empty package file: ${path}`);
  }
  assert.ok(![...files.keys()].some(path => /^(node_modules|test|\.github|\.git)\//.test(path)),
    'Development files must not ship in the package');
  console.log(`Package verified: ${pack.filename}; ${files.size} files; all runtime entries present.`);
} finally {
  // Only remove the unique temporary directory created by this invocation.
  rmSync(output, { recursive: true, force: true });
}
