import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detachSessionFromWorkspaces, createStandaloneSession } from '../lib/index.js';
import { CHAT_PRESET_PATH } from '../lib/preset-root.js';

test('detachSessionFromWorkspaces: handles session not in any workspace', async () => {
  const fakeRegistry = {
    list() {
      return [
        { id: 'w1', title: 'Alpha', path: '/alpha', sessionIds: ['s1', 's2'], detachSession: async () => {} },
      ];
    },
  };
  const ctx = {
    get: (key) => key === 'workspaceRegistry' ? fakeRegistry : undefined,
  };

  const result = await detachSessionFromWorkspaces(ctx, 's999');
  assert.equal(result.ok, true);
  assert.equal(result.detached, false);
});

test('detachSessionFromWorkspaces: detaches session attached to a workspace', async () => {
  let detachedId = null;
  const fakeRegistry = {
    list() {
      return [
        {
          id: 'w1',
          title: 'Alpha',
          path: '/alpha',
          sessionIds: ['s1', 's2'],
          detachSession: async (id) => { detachedId = id; },
        },
      ];
    },
  };
  const ctx = {
    get: (key) => key === 'workspaceRegistry' ? fakeRegistry : undefined,
  };

  const result = await detachSessionFromWorkspaces(ctx, 's1');
  assert.equal(result.ok, true);
  assert.equal(result.detached, true);
  assert.equal(result.detachedCount, 1);
  assert.equal(detachedId, 's1');
  assert.equal(result.fromWorkspaces[0].id, 'w1');
});

test('detachSessionFromWorkspaces: rejects invalid or empty sessionId', async () => {
  const ctx = { get: () => ({ list: () => [] }) };
  await assert.rejects(
    async () => detachSessionFromWorkspaces(ctx, ''),
    /sessionId must be a non-empty string/
  );
  await assert.rejects(
    async () => detachSessionFromWorkspaces(ctx, null),
    /sessionId must be a non-empty string/
  );
});

test('createStandaloneSession: creates a durable native Chat Session without workspaceId', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-no-workspace-index-'));
  let session;
  const ctx = {
    agentPresets: { resolve: async () => ({
      id: 'no-workspace-chat', trust: 'system', path: CHAT_PRESET_PATH,
    }) },
    noWorkspacePresetRoot: { chatPresetPath: CHAT_PRESET_PATH },
    workspaceRegistry: { list: () => [] },
    sessionController: { async create(request) {
      session = { id: request.sessionId, header: {
        id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset,
      } };
      return { sessionId: request.sessionId, agentPreset: request.agentPreset };
    } },
    sessions: {
      get: id => id === session?.id ? session : undefined,
      flush: async () => true,
    },
    sessionPersistence: { stat: async () => ({ header: session.header, revision: 1 }) },
  };

  const result = await createStandaloneSession(ctx, { dshHome });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, session.id);
  assert.equal(session.header.cwd, join(dshHome, 'runtime', 'chat', result.sessionId));
  assert.equal(session.header.agentPreset, 'no-workspace-chat');
});
