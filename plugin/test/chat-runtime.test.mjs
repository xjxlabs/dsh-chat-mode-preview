import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, parse, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  CHAT_PRESET_ID,
  allocateChatDirectory,
  assertControlledChatDirectory,
  createChatSession,
  resolveChatRuntimePolicy,
  resolveChatRuntimeRoot,
  verifyTrustedChatPreset,
} from '../lib/chat-runtime.js';
import { CHAT_PRESET_PATH } from '../lib/preset-root.js';

test('runtime policy requires explicit DSH_HOME and never falls back to ambient directories', () => {
  assert.throws(() => resolveChatRuntimePolicy({}, {}), /DSH_HOME must be an explicit absolute path/);
  assert.throws(() => resolveChatRuntimePolicy({ dshHome: '' }, { DSH_HOME: 'ignored' }), /DSH_HOME/);
  const dshHome = join(tmpdir(), 'p1a-home');
  assert.deepEqual(resolveChatRuntimePolicy({}, { DSH_HOME: dshHome }), { dshHome });
  assert.deepEqual(resolveChatRuntimePolicy({ dshHome }, {}), { dshHome });
});

test('runtime root is dedicated and rejects volume, home, cwd, DSH_HOME ancestors, and Workspace overlap', () => {
  const dshHome = join(tmpdir(), 'p1a-home');
  const root = join(dshHome, 'runtime', 'chat');
  assert.equal(resolveChatRuntimeRoot({ dshHome }), root);
  for (const forbidden of [parse(dshHome).root, dshHome, homedir(), process.cwd()]) {
    assert.throws(() => resolveChatRuntimeRoot({ dshHome, chatRuntimeRoot: forbidden }), /volume root|dedicated/);
  }
  assert.throws(() => resolveChatRuntimeRoot({
    dshHome,
    workspacePaths: [join(dshHome, 'runtime')],
  }), /overlaps Workspace/);
  assert.throws(() => resolveChatRuntimeRoot({
    dshHome,
    chatRuntimeRoot: join(tmpdir(), 'chat-root'),
    workspacePaths: [join(tmpdir(), 'chat-root', 'project')],
  }), /overlaps Workspace/);
});

test('dedicated roots use platform case semantics for home, process cwd and Workspace overlap', () => {
  const base = join(parse(tmpdir()).root, 'p1f-case');
  const dshHome = join(base, 'storage');
  const target = join(base, 'Users', 'X');
  const variant = target.toUpperCase();
  for (const field of ['userHome', 'processCwd']) {
    const options = { dshHome, chatRuntimeRoot: variant, [field]: target };
    if (process.platform === 'win32') {
      assert.throws(() => resolveChatRuntimeRoot(options), /dedicated/);
    } else {
      assert.equal(resolveChatRuntimeRoot(options), variant);
    }
  }
  for (const workspace of [target, join(target, 'nested'), base]) {
    const options = { dshHome, chatRuntimeRoot: variant, workspacePaths: [workspace] };
    if (process.platform === 'win32') {
      assert.throws(() => resolveChatRuntimeRoot(options), /overlaps/);
    } else {
      assert.equal(resolveChatRuntimeRoot(options), variant);
    }
  }
});

test('recovery applies platform case semantics to root and cwd without accepting sibling paths', async t => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1f-case-'));
  t.after(() => rm(dshHome, { recursive: true, force: true }));
  const id = `session-${randomUUID()}`;
  const cwd = await allocateChatDirectory({ dshHome }, id);
  const ctx = { workspaceRegistry: { list: () => [] } };
  const session = { id, header: { id, cwd: cwd.toUpperCase() } };
  if (process.platform === 'win32') {
    for (const policy of [
      { dshHome: dshHome.toUpperCase() },
      { dshHome, chatRuntimeRoot: join(dshHome, 'runtime', 'chat').toUpperCase() },
    ]) {
      const recovered = assertControlledChatDirectory(ctx, policy, session);
      // The production contract uses native path equivalence, not realpath's spelling.
      assert.equal(relative(cwd, recovered), '');
      assert.throws(() => assertControlledChatDirectory(ctx, policy, {
        id, header: { id, cwd: cwd.toUpperCase() + '-sibling' },
      }), /outside/);
    }
  } else {
    assert.throws(() => assertControlledChatDirectory(ctx, { dshHome }, session), /outside/);
  }
  assert.throws(() => assertControlledChatDirectory(ctx, { dshHome }, {
    id, header: { id, cwd: cwd + '-sibling' },
  }), /outside/);
});

test('durable cwd comparisons accept only platform-equivalent paths', async t => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1f-durable-case-'));
  t.after(() => rm(dshHome, { recursive: true, force: true }));
  const h = createHarness(dshHome);
  const create = h.ctx.sessionController.create;
  h.ctx.sessionController.create = async request => {
    const result = await create(request);
    h.getSession().header.cwd = h.getSession().header.cwd.toUpperCase();
    return result;
  };
  if (process.platform === 'win32') {
    await assert.doesNotReject(createChatSession(h.ctx, h.policy));
  } else {
    await assert.rejects(createChatSession(h.ctx, h.policy), /requested cwd/);
  }
});

test('allocator creates exclusive per-Session directories and rejects linked roots', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1a-path-'));
  const id = `session-${randomUUID()}`;
  const cwd = await allocateChatDirectory({ dshHome }, id);
  assert.equal(cwd, await realpath(join(dshHome, 'runtime', 'chat', id)));
  await assert.rejects(allocateChatDirectory({ dshHome }, id), /EEXIST/);
  await assert.rejects(allocateChatDirectory({ dshHome }, '../escape'), /server-generated UUID/);

  const target = join(dshHome, 'linked-target');
  const linked = join(dshHome, 'linked-root');
  await mkdir(target);
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(allocateChatDirectory({ dshHome, chatRuntimeRoot: linked },
    `session-${randomUUID()}`), /unsafe chat runtime directory/);
});

test('recovery accepts only the intact server-owned Session directory', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1e-recovery-'));
  const id = `session-${randomUUID()}`;
  const cwd = await allocateChatDirectory({ dshHome }, id);
  const ctx = { workspaceRegistry: { list: () => [] } };
  const session = { id, header: { id, cwd, agentPreset: CHAT_PRESET_ID } };
  assert.equal(assertControlledChatDirectory(ctx, { dshHome }, session), cwd);

  const outside = await mkdtemp(join(tmpdir(), 'dsh-p1e-outside-'));
  assert.throws(() => assertControlledChatDirectory(ctx, { dshHome }, {
    ...session,
    header: { ...session.header, cwd: outside },
  }), /outside its server-owned runtime directory/);

  const linkedId = `session-${randomUUID()}`;
  const linkedCwd = await allocateChatDirectory({ dshHome }, linkedId);
  await rm(linkedCwd, { recursive: true });
  await symlink(outside, linkedCwd, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertControlledChatDirectory(ctx, { dshHome }, {
    id: linkedId,
    header: { id: linkedId, cwd: linkedCwd, agentPreset: CHAT_PRESET_ID },
  }), /unsafe/);

  await rm(cwd, { recursive: true });
  await writeFile(cwd, 'replaced');
  assert.throws(() => assertControlledChatDirectory(ctx, { dshHome }, session), /unsafe/);
});

function createHarness(dshHome, overrides = {}) {
  let session;
  const calls = [];
  const ctx = {
    agentPresets: { resolve: async () => ({
      id: CHAT_PRESET_ID, trust: 'system', path: CHAT_PRESET_PATH,
    }) },
    noWorkspacePresetRoot: { chatPresetPath: CHAT_PRESET_PATH },
    workspaceRegistry: { list: () => [] },
    sessionController: { async create(request) {
      calls.push(['create', request]);
      session = { id: request.sessionId, header: {
        id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset,
      } };
      return { sessionId: request.sessionId, agentPreset: request.agentPreset };
    } },
    sessions: {
      get: id => id === session?.id ? session : undefined,
      async flush(value) { calls.push(['flush', value.id]); return true; },
    },
    sessionPersistence: { async stat(id) {
      calls.push(['stat', id]);
      return { header: session.header, revision: 1 };
    } },
    ...overrides,
  };
  return { ctx, calls, getSession: () => session, policy: { dshHome } };
}

test('Chat creation accepts only the healthy system-trust plugin composition', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1b-preset-'));
  const harness = createHarness(dshHome);
  await assert.doesNotReject(verifyTrustedChatPreset(harness.ctx));

  harness.ctx.agentPresets.resolve = async () => ({
    id: CHAT_PRESET_ID, trust: 'user', path: CHAT_PRESET_PATH,
  });
  await assert.rejects(createChatSession(harness.ctx, harness.policy), /system-trust/);
  assert.deepEqual(harness.calls, []);

  harness.ctx.agentPresets.resolve = async () => ({
    id: CHAT_PRESET_ID, trust: 'system', path: fileURLToPath(new URL('../lib/index.js', import.meta.url)),
  });
  await assert.rejects(createChatSession(harness.ctx, harness.policy), /plugin-owned composition/);
  assert.deepEqual(harness.calls, []);
});

test('Chat creation owns identity, cwd and preset, then flushes and verifies storage', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1a-create-'));
  const { ctx, calls, policy } = createHarness(dshHome);
  const result = await createChatSession(ctx, policy);
  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^session-[0-9a-f-]{36}$/);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].sessionId, result.sessionId);
  assert.equal(calls[0][1].agentPreset, CHAT_PRESET_ID);
  assert.equal(calls[0][1].cwd, join(await realpath(dshHome), 'runtime', 'chat', result.sessionId));
  assert.deepEqual(calls.slice(1).map(call => call[0]), ['flush', 'stat']);
});

test('Chat creation rejects Workspace overlap before publishing a Session', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1a-overlap-'));
  const { ctx, calls, policy } = createHarness(dshHome);
  ctx.workspaceRegistry.list = () => [{ path: join(dshHome, 'runtime') }];
  await assert.rejects(createChatSession(ctx, policy), /overlaps Workspace/);
  assert.deepEqual(calls, []);
});

test('Chat creation fails closed when flush has no durability participant', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1a-flush-'));
  const harness = createHarness(dshHome);
  harness.ctx.sessions.flush = async () => false;
  await assert.rejects(createChatSession(harness.ctx, harness.policy), /no active durability participant/);
});

test('Chat creation fails closed when stored metadata differs', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1a-stat-'));
  const harness = createHarness(dshHome);
  harness.ctx.sessionPersistence.stat = async () => ({
    header: { ...harness.getSession().header, cwd: join(dshHome, 'wrong') }, revision: 1,
  });
  await assert.rejects(createChatSession(harness.ctx, harness.policy), /durable identity verification/);
});

test('an explicit retry after partial persistence failure gets a new server identity', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1e-retry-'));
  const harness = createHarness(dshHome);
  let flushes = 0;
  harness.ctx.sessions.flush = async () => {
    flushes += 1;
    return flushes > 1;
  };
  await assert.rejects(createChatSession(harness.ctx, harness.policy),
    /no active durability participant/);
  const recovered = await createChatSession(harness.ctx, harness.policy);
  const createdIds = harness.calls
    .filter(call => call[0] === 'create')
    .map(call => call[1].sessionId);
  assert.equal(new Set(createdIds).size, 2);
  assert.equal(recovered.sessionId, createdIds[1]);
});
