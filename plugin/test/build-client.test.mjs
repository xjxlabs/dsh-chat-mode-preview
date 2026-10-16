import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const tempRoot = await realpath(tmpdir());
const root = await realpath(await mkdtemp(join(tempRoot, 'dsh-build-client-test-')));
const generator = await readFile(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8');
const fragment = '// Keep literal text intact.\nreturn { text: String.raw`first\nsecond` };\n';
const withEol = (text, eol) => text.replaceAll('\r\n', '\n').replaceAll('\n', eol);
let nextFixture = 0;

after(async () => {
  const target = await realpath(root);
  assert.equal(target, root);
  assert.equal(dirname(target), tempRoot);
  assert.ok(basename(target).startsWith('dsh-build-client-test-'));
  await rm(target, { recursive: true });
});

async function fixture(scriptEol = '\n', fragmentEol = '\n') {
  const cwd = join(root, String(nextFixture++));
  await mkdir(join(cwd, 'scripts'), { recursive: true });
  await mkdir(join(cwd, 'lib'));
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'build-probe', type: 'module' }));
  await writeFile(join(cwd, 'scripts/build-client.mjs'), withEol(generator, scriptEol));
  await writeFile(join(cwd, 'plugin.client.js'), withEol(fragment, fragmentEol));
  return cwd;
}

function run(cwd, check = false) {
  const result = spawnSync(process.execPath, ['scripts/build-client.mjs', ...(check ? ['--check'] : [])], {
    cwd, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
}

function evaluatedText(source) {
  let text;
  runInNewContext(source, { window: { __ModuleLoader__: { load({ factory }) {
    text = factory(() => ({})).text;
  } } } });
  return text;
}

for (const scriptEol of ['\n', '\r\n']) {
  for (const fragmentEol of ['\n', '\r\n']) {
    test(`deterministic LF output with script=${JSON.stringify(scriptEol)}, fragment=${JSON.stringify(fragmentEol)}`, async () => {
      const cwd = await fixture(scriptEol, fragmentEol);
      succeeds(run(cwd));
      const artifact = join(cwd, 'lib/client.js');
      const output = await readFile(artifact, 'utf8');
      assert.equal(output.includes('\r'), false);
      assert.equal(evaluatedText(output), 'first\nsecond');
      const sourceBefore = await readFile(join(cwd, 'plugin.client.js'), 'utf8');
      for (const artifactEol of ['\n', '\r\n']) {
        const checked = withEol(output, artifactEol);
        await writeFile(artifact, checked);
        succeeds(run(cwd, true));
        assert.equal(await readFile(artifact, 'utf8'), checked, '--check must not rewrite the artifact');
        assert.equal(evaluatedText(checked), 'first\nsecond');
      }
      succeeds(run(cwd));
      assert.equal(await readFile(artifact, 'utf8'), output, 'regeneration must be deterministic');
      assert.equal(await readFile(join(cwd, 'plugin.client.js'), 'utf8'), sourceBefore, 'source must not be rewritten');
    });
  }
}

for (const [label, mutate] of [
  ['code change', text => text.replace('first', 'changed')],
  ['whitespace change', text => text.replace('factory:', 'factory: ')],
  ['truncated artifact', text => text.slice(0, -3)],
  ['lone CR', text => text.replace('\n', '\r')],
]) {
  test(`--check rejects ${label} under LF and CRLF without rewriting`, async () => {
    const cwd = await fixture();
    succeeds(run(cwd));
    const artifact = join(cwd, 'lib/client.js');
    const output = await readFile(artifact, 'utf8');
    for (const eol of ['\n', '\r\n']) {
      const stale = mutate(withEol(output, eol));
      await writeFile(artifact, stale);
      const result = run(cwd, true);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /is stale/);
      assert.equal(await readFile(artifact, 'utf8'), stale);
    }
  });
}

test('--check rejects a stale artifact when only its source changes', async () => {
  const cwd = await fixture();
  succeeds(run(cwd));
  await writeFile(join(cwd, 'plugin.client.js'), fragment.replace('first', 'new source'));
  const result = run(cwd, true);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is stale/);
});
