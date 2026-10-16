import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneSession } from '../lib/index.js';
import { CHAT_PRESET_PATH } from '../lib/preset-root.js';

const trustedPreset = {
  agentPresets: { resolve: async () => ({
    id: 'no-workspace-chat', trust: 'system', path: CHAT_PRESET_PATH,
  }) },
  noWorkspacePresetRoot: { chatPresetPath: CHAT_PRESET_PATH },
};

test('a standalone blank is durable before its ID is returned', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-no-workspace-persist-'));
  let session;
  const calls = [];
  const result = await createStandaloneSession({
    ...trustedPreset,
    workspaceRegistry: { list: () => [] },
    sessionController: { async create(request) {
      calls.push('create');
      session = { id: request.sessionId, header: { id: request.sessionId,
        cwd: request.cwd, agentPreset: request.agentPreset } };
      return { sessionId: request.sessionId, agentPreset: request.agentPreset };
    } },
    sessions: { get: () => session, async flush(value) { assert.equal(value, session); calls.push('flush'); return true; } },
    sessionPersistence: { async stat() { calls.push('stat'); return { header: session.header, revision: 1 }; } },
  }, { dshHome });
  assert.equal(result.sessionId, session.id);
  assert.deepEqual(calls, ['create', 'flush', 'stat']);
});

test('failed single-Session flush does not report a successfully created durable session', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-no-workspace-failed-persist-'));
  let session;
  await assert.rejects(createStandaloneSession({
    ...trustedPreset,
    workspaceRegistry: { list: () => [] },
    sessionController: { async create(request) {
      session = { id: request.sessionId, header: { id: request.sessionId,
        cwd: request.cwd, agentPreset: request.agentPreset } };
      return { sessionId: request.sessionId, agentPreset: request.agentPreset };
    } },
    sessions: { get: () => session, flush: async () => { throw new Error('disk failed'); } },
    sessionPersistence: { stat: async () => undefined },
  }, { dshHome }), /disk failed/);
});
