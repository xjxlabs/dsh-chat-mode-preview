import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { handleNoWorkspaceRpc } from '../lib/index.js';
import { CHAT_PRESET_PATH } from '../lib/preset-root.js';

function harness() {
  let session;
  let creates = 0;
  let detached;
  const ctx = {
    agentPresets: { resolve: async () => ({
      id: 'no-workspace-chat', trust: 'system', path: CHAT_PRESET_PATH,
    }) },
    noWorkspacePresetRoot: { chatPresetPath: CHAT_PRESET_PATH },
    workspaceRegistry: { list: () => [{
      id: 'w1', title: 'Workspace', path: join(tmpdir(), `rpc-workspace-${crypto.randomUUID()}`),
      sessionIds: ['session-detach'],
      async detachSession(id) { detached = id; },
    }] },
    sessionController: { async create(request) {
      creates += 1;
      session = { id: request.sessionId, header: {
        id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset,
      } };
      return { sessionId: request.sessionId, agentPreset: request.agentPreset };
    } },
    sessions: { get: () => session, flush: async () => true },
    sessionPersistence: { stat: async () => ({ header: session.header, revision: 1 }) },
  };
  ctx.get = (key) => ctx[key];
  return { ctx, creates: () => creates, detached: () => detached };
}

test('openChat accepts only an empty object and never accepts client identity or capability fields', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1c-rpc-reject-'));
  const h = harness();
  for (const payload of [null, [], { cwd: 'C:\\escape' }, { sessionId: 'chosen' },
    { agentPreset: 'standard' }, { extra: true }]) {
    const result = await handleNoWorkspaceRpc(h.ctx, { dshHome }, 'openChat', payload,
      new AbortController().signal);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'gateway/bad-request');
  }
  assert.equal(h.creates(), 0);
});

test('openChat delegates an empty request to server-owned durable Chat creation', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1c-rpc-open-'));
  const h = harness();
  const result = await handleNoWorkspaceRpc(h.ctx, { dshHome }, 'openChat', {},
    new AbortController().signal);
  assert.equal(result.ok, true);
  assert.equal(result.value.ok, true);
  assert.match(result.value.sessionId, /^session-[0-9a-f-]{36}$/);
  assert.equal(h.creates(), 1);
});

test('detach accepts only sessionId and uses the authoritative Workspace registry', async () => {
  const h = harness();
  const signal = new AbortController().signal;
  for (const payload of [{}, { sessionId: 'session-detach', cwd: 'C:\\escape' }, null]) {
    const result = await handleNoWorkspaceRpc(h.ctx, {}, 'detach', payload, signal);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'gateway/bad-request');
  }
  const result = await handleNoWorkspaceRpc(h.ctx, {}, 'detach', { sessionId: 'session-detach' }, signal);
  assert.equal(result.ok, true);
  assert.equal(result.value.detached, true);
  assert.equal(h.detached(), 'session-detach');
});

test('RPC rejects unknown endpoints and already-cancelled calls without side effects', async () => {
  const h = harness();
  const unknown = await handleNoWorkspaceRpc(h.ctx, {}, 'create', {}, new AbortController().signal);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'gateway/bad-request');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await handleNoWorkspaceRpc(h.ctx, {}, 'openChat', {}, controller.signal);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error.code, 'gateway/cancelled');
  assert.equal(h.creates(), 0);
});
