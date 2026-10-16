import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveChatRuntimeRoot, allocateChatDirectory } from './runtime-root.mjs';

test('root derives only from explicit DSH_HOME, never ambient cwd or home', () => {
  const home = join(tmpdir(), 'p0-home');
  assert.equal(resolveChatRuntimeRoot({ dshHome: home }), join(home, 'runtime', 'chat'));
  for (const value of [undefined, '', ' ', '.', 'relative']) {
    assert.throws(() => resolveChatRuntimeRoot({ dshHome: value }), /explicit absolute/);
  }
  assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: '' }), /absolute/);
  assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: home }), /cannot contain/);
  assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: tmpdir() }), /cannot contain/);
  for (const forbidden of [homedir(), process.cwd()]) {
    assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: forbidden }), /cannot contain|dedicated/);
  }
  const explicit = join(tmpdir(), 'dedicated-p0-runtime');
  assert.equal(resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: explicit }), explicit);
  assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, workspacePaths: [home] }), /overlaps/);
  assert.throws(() => resolveChatRuntimeRoot({ dshHome: home, chatRuntimeRoot: explicit, workspacePaths: [join(explicit, 'project')] }), /overlaps/);
});

test('sessions receive distinct directories; existing names and traversal are rejected', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-p0-path-'));
  const id = `session-${randomUUID()}`;
  const first = await allocateChatDirectory({ dshHome: home }, id);
  const second = await allocateChatDirectory({ dshHome: home }, `session-${randomUUID()}`);
  assert.notEqual(first, second);
  await assert.rejects(allocateChatDirectory({ dshHome: home }, id), /EEXIST/);
  for (const bad of ['../escape', 'session-x', '/absolute']) {
    await assert.rejects(allocateChatDirectory({ dshHome: home }, bad), /UUID/);
  }
  console.log(`Retained P0 path fixture: ${home}`);
});

test('junction/symlink root cannot redirect a Chat directory into another tree', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-p0-link-'));
  const target = join(home, 'other-tree');
  await mkdir(target);
  const link = join(home, 'linked-root');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(allocateChatDirectory({ dshHome: home, chatRuntimeRoot: link }, `session-${randomUUID()}`), /unsafe directory/);
  console.log(`Retained P0 link fixture: ${home}`);
});
