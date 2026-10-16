import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  name,
  inject,
  apply,
  detachSessionFromWorkspaces,
  createStandaloneSession,
} from '../lib/index.js';
import { CHAT_PRESET_PATH } from '../lib/preset-root.js';

// Host harness with the authenticated Connection RPC registration captured.
function createTestServer(ctxOverrides = {}) {
  let channel;
  let rpcHandler;
  const connection = {
    rpc: { handle(path, handler) {
      channel = path;
      rpcHandler = handler;
      return async () => {};
    } },
  };

  const defaultRegistry = {
    list() {
      return [
        {
          id: 'w1',
          title: 'Workspace 1',
          path: '/path/1',
          sessionIds: ['sess-1', 'sess-shared'],
          async detachSession(id) {
            this.sessionIds = this.sessionIds.filter((s) => s !== id);
          },
        },
        {
          id: 'w2',
          title: 'Workspace 2',
          path: '/path/2',
          sessionIds: ['sess-2', 'sess-shared'],
          async detachSession(id) {
            this.sessionIds = this.sessionIds.filter((s) => s !== id);
          },
        },
      ];
    },
  };

  const dshHome = join(tmpdir(), `dsh-no-workspace-http-${crypto.randomUUID()}`);
  const live = new Map();
  const defaultSessions = {
    get(id) { return live.get(id); },
    async flush() { return true; },
  };

  const ctx = {
    connection,
    agentPresets: {
      resolve: async () => ({
        id: 'no-workspace-chat', trust: 'system', path: CHAT_PRESET_PATH,
      }),
      guard() { return () => {}; },
    },
    noWorkspacePresetRoot: { chatPresetPath: CHAT_PRESET_PATH },
    workspaceRegistry: defaultRegistry,
    sessions: defaultSessions,
    sessionController: {
      async create(request) {
        const session = { id: request.sessionId, header: {
          id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset,
        } };
        live.set(request.sessionId, session);
        return { sessionId: request.sessionId, agentPreset: request.agentPreset };
      },
    },
    sessionPersistence: {
      async stat(id) {
        const session = live.get(id);
        return session === undefined ? undefined : { header: session.header, revision: 1 };
      },
    },
    get(key) {
      return this[key];
    },
    effect(fn) {
      fn();
    },
    ...ctxOverrides,
  };

  apply(ctx, { dshHome });
  if (!rpcHandler) throw new Error('Failed to capture Connection RPC handler from apply()');

  return {
    ctx,
    channel,
    call: (endpoint, payload, signal = new AbortController().signal) =>
      rpcHandler(endpoint, payload, signal),
  };
}

describe('Robustness & Security QA Suite: dsh-plugin-no-workspace', () => {

  // =========================================================================
  // 1. CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  describe('1. Concurrency & Race Condition Stress Tests', () => {
    it('handles 50 concurrent detaches on the SAME session without race conditions', async () => {
      let detachCallCount = 0;
      const workspace = {
        id: 'w1',
        title: 'Concurrent Workspace',
        path: '/workspace/concurrent',
        sessionIds: ['shared-target-session'],
        async detachSession(id) {
          detachCallCount++;
          // Simulate non-zero async I/O latency
          await new Promise((r) => setTimeout(r, 5));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) => (key === 'workspaceRegistry' ? { list: () => [workspace] } : undefined),
      };

      // Launch 50 concurrent detach calls
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          detachSessionFromWorkspaces(ctx, 'shared-target-session')
        )
      );

      // All calls should resolve successfully
      for (const res of results) {
        assert.equal(res.ok, true);
        assert.ok(res.detached === true || res.detached === false);
      }

      // First callers found the session and detached it
      assert.ok(detachCallCount >= 1);
      // Final state: session is no longer in workspace
      assert.equal(workspace.sessionIds.includes('shared-target-session'), false);
    });

    it('handles 100 concurrent detaches across MULTIPLE distinct sessions', async () => {
      const sessionCount = 100;
      const sessionIds = Array.from({ length: sessionCount }, (_, i) => `session-${i}`);
      
      const workspaceA = {
        id: 'wa',
        title: 'Workspace A',
        path: '/path/a',
        sessionIds: [...sessionIds.slice(0, 50)],
        async detachSession(id) {
          await new Promise((r) => setTimeout(r, 1));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const workspaceB = {
        id: 'wb',
        title: 'Workspace B',
        path: '/path/b',
        sessionIds: [...sessionIds.slice(50, 100)],
        async detachSession(id) {
          await new Promise((r) => setTimeout(r, 1));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) =>
          key === 'workspaceRegistry'
            ? { list: () => [workspaceA, workspaceB] }
            : undefined,
      };

      const promises = sessionIds.map((id) => detachSessionFromWorkspaces(ctx, id));
      const results = await Promise.all(promises);

      assert.equal(results.length, 100);
      for (let i = 0; i < sessionCount; i++) {
        const res = results[i];
        assert.equal(res.ok, true);
        assert.equal(res.detached, true);
        assert.equal(res.detachedCount, 1);
        const expectedWs = i < 50 ? 'wa' : 'wb';
        assert.equal(res.fromWorkspaces[0].id, expectedWs);
      }

      assert.equal(workspaceA.sessionIds.length, 0);
      assert.equal(workspaceB.sessionIds.length, 0);
    });

    it('handles high-load mixed concurrent detaches (existing vs non-existing sessions)', async () => {
      const workspace = {
        id: 'w-mix',
        title: 'Mixed Workspace',
        path: '/path/mix',
        sessionIds: ['valid-1', 'valid-2', 'valid-3'],
        async detachSession(id) {
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) => (key === 'workspaceRegistry' ? { list: () => [workspace] } : undefined),
      };

      const requests = [];
      for (let i = 0; i < 150; i++) {
        const target = i % 2 === 0 ? `valid-${(i % 3) + 1}` : `ghost-session-${i}`;
        requests.push(detachSessionFromWorkspaces(ctx, target));
      }

      const results = await Promise.all(requests);
      assert.equal(results.length, 150);
      for (const res of results) {
        assert.equal(res.ok, true);
      }
    });

    it('handles concurrent createStandaloneSession calls with unique server identities', async () => {
      const app = createTestServer();
      const count = 20;
      const policy = { dshHome: join(tmpdir(), `dsh-no-workspace-concurrent-${crypto.randomUUID()}`) };
      const results = await Promise.all(Array.from({ length: count }, () =>
        createStandaloneSession(app.ctx, policy)));
      assert.equal(new Set(results.map(result => result.sessionId)).size, count);
    });
  });

  // =========================================================================
  // 2. DETACHING FROM MULTIPLE, ZERO, OR MALFORMED WORKSPACES
  // =========================================================================
  describe('2. Multi-workspace, Zero-workspace & Malformed Workspace Registry', () => {
    it('detaches a session belonging to ZERO workspaces gracefully', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            { id: 'w1', sessionIds: ['s1', 's2'], detachSession: async () => {} },
            { id: 'w2', sessionIds: ['s3'], detachSession: async () => {} },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'isolated-session');
      assert.deepEqual(result, {
        ok: true,
        detached: false,
        message: 'Session is not attached to any workspace.',
      });
    });

    it('detaches a session belonging to MULTIPLE (3+) workspaces simultaneously', async () => {
      const detachedCalls = [];
      const workspaces = [
        {
          id: 'w1',
          title: 'Workspace 1',
          path: '/w1',
          sessionIds: ['multi-sess', 'other-1'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w1', id });
          },
        },
        {
          id: 'w2',
          title: 'Workspace 2',
          path: '/w2',
          sessionIds: ['multi-sess', 'other-2'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w2', id });
          },
        },
        {
          id: 'w3',
          title: 'Workspace 3',
          path: '/w3',
          sessionIds: ['other-3'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w3', id });
          },
        },
        {
          id: 'w4',
          title: 'Workspace 4',
          path: '/w4',
          sessionIds: ['multi-sess'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w4', id });
          },
        },
      ];

      const ctx = {
        get: () => ({ list: () => workspaces }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'multi-sess');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 3);
      assert.equal(result.fromWorkspaces.length, 3);
      assert.deepEqual(
        result.fromWorkspaces.map((w) => w.id),
        ['w1', 'w2', 'w4']
      );
      assert.equal(detachedCalls.length, 3);
    });

    it('handles workspaces with missing or corrupt sessionIds (null, undefined, non-array)', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            null,
            undefined,
            {},
            { id: 'w-null', sessionIds: null, detachSession: async () => {} },
            { id: 'w-undefined', sessionIds: undefined, detachSession: async () => {} },
            { id: 'w-string', sessionIds: 'sess-1', detachSession: async () => {} },
            { id: 'w-number', sessionIds: 12345, detachSession: async () => {} },
            { id: 'w-obj', sessionIds: { 'sess-1': true }, detachSession: async () => {} },
            {
              id: 'w-valid',
              title: 'Valid',
              path: '/valid',
              sessionIds: ['sess-1'],
              detachSession: async () => {},
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'sess-1');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 1);
      assert.equal(result.fromWorkspaces[0].id, 'w-valid');
    });

    it('handles workspace without detachSession method without crashing', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w-no-method',
              title: 'No Method',
              path: '/no-method',
              sessionIds: ['sess-orphan'],
              // detachSession is intentionally undefined
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'sess-orphan');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 0);
      assert.equal(result.fromWorkspaces.length, 0);
    });

    it('propagates error when workspace.detachSession throws an unexpected error', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w-failing',
              title: 'Failing WS',
              path: '/fail',
              sessionIds: ['sess-fail'],
              async detachSession() {
                throw new Error('EACCES: permission denied during workspace state write');
              },
            },
          ],
        }),
      };

      await assert.rejects(
        () => detachSessionFromWorkspaces(ctx, 'sess-fail'),
        /EACCES: permission denied/
      );
    });

    it('throws when workspaceRegistry service is missing from context', async () => {
      const ctx = {
        get: () => undefined,
      };

      await assert.rejects(
        () => detachSessionFromWorkspaces(ctx, 'some-session'),
        /workspaceRegistry service is not available\./
      );
    });

    it('uses fallback ctx.workspaceRegistry if ctx.get returns undefined', async () => {
      const ctx = {
        get: () => undefined,
        workspaceRegistry: {
          list: () => [
            {
              id: 'fallback-ws',
              title: 'Fallback',
              path: '/fb',
              sessionIds: ['fb-sess'],
              detachSession: async () => {},
            },
          ],
        },
      };

      const result = await detachSessionFromWorkspaces(ctx, 'fb-sess');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.fromWorkspaces[0].id, 'fallback-ws');
    });

    it('handles registry where list() is not a function gracefully', async () => {
      const ctx = {
        get: () => ({
          list: null, // not a function
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'any-session');
      assert.equal(result.ok, true);
      assert.equal(result.detached, false);
      assert.equal(result.message, 'Session is not attached to any workspace.');
    });

    it('handles registry where list() returns non-array (null/undefined) gracefully', async () => {
      const ctx = {
        get: () => ({
          list: () => null,
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'any-session');
      assert.equal(result.ok, true);
      assert.equal(result.detached, false);
    });
  });

  // =========================================================================
  // 3. SESSION ID VALIDATION & INJECTION / ATTACK PAYLOADS
  // =========================================================================
  describe('3. Session ID Validation & Malicious Payloads', () => {
    const invalidSessionIds = [
      { label: 'null', val: null },
      { label: 'undefined', val: undefined },
      { label: 'empty string', val: '' },
      { label: 'spaces only', val: '   ' },
      { label: 'tabs and newlines only', val: '\t\n\r  ' },
      { label: 'number integer', val: 12345 },
      { label: 'number float', val: 3.1415 },
      { label: 'boolean true', val: true },
      { label: 'boolean false', val: false },
      { label: 'empty object', val: {} },
      { label: 'array', val: ['s1'] },
      { label: 'function', val: () => {} },
      { label: 'symbol', val: Symbol('s1') },
      { label: 'NaN', val: NaN },
      { label: 'Infinity', val: Infinity },
    ];

    for (const { label, val } of invalidSessionIds) {
      it(`rejects invalid sessionId type/value (${label}) with TypeError`, async () => {
        const ctx = { get: () => ({ list: () => [] }) };
        await assert.rejects(
          () => detachSessionFromWorkspaces(ctx, val),
          (err) => {
            assert.ok(err instanceof TypeError);
            assert.match(err.message, /sessionId must be a non-empty string\./);
            return true;
          }
        );
      });
    }

    it('trims leading and trailing whitespace from valid sessionId before lookup', async () => {
      let passedTarget = null;
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w1',
              title: 'W1',
              path: '/w1',
              sessionIds: ['valid-trimmed-id'],
              detachSession: async (id) => {
                passedTarget = id;
              },
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, '   \t valid-trimmed-id \n  ');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(passedTarget, 'valid-trimmed-id');
    });

    const attackPayloads = [
      { type: 'Path Traversal (Unix)', payload: '../../../../etc/passwd' },
      { type: 'Path Traversal (Windows)', payload: '..\\..\\Windows\\System32\\calc.exe' },
      { type: 'Path Traversal (Absolute)', payload: '/etc/shadow' },
      { type: 'SQL Injection 1', payload: "' OR '1'='1" },
      { type: 'SQL Injection 2', payload: '"; DROP TABLE sessions; --' },
      { type: 'Command Injection (Bash)', payload: '; rm -rf / ; echo 1' },
      { type: 'Command Injection (Subshell)', payload: '$(whoami)' },
      { type: 'Command Injection (Windows)', payload: '& calc.exe &' },
      { type: 'Command Injection (Pipe)', payload: '| net user evil /add' },
      { type: 'XSS Script Tag', payload: '<script>alert(document.cookie)</script>' },
      { type: 'XSS Image Tag', payload: '<img src=x onerror=alert(1)>' },
      { type: 'XSS SVG Tag', payload: '<svg/onload=alert`xss`>' },
      { type: 'Null Byte Injection', payload: 'session\x00_hidden' },
      { type: 'Control Characters (Escape/Bell)', payload: '\x1b[31mRed\x07' },
      { type: 'Unicode RTL Override', payload: '\u202Ereversed_id\u202D' },
      { type: 'Unicode Emojis & Multibyte', payload: '👾-session-🚀-🔥-123' },
      { type: 'Massive string (100,000 chars)', payload: 's'.repeat(100000) },
    ];

    for (const { type, payload } of attackPayloads) {
      it(`safely handles malicious / unusual sessionId string: ${type}`, async () => {
        let searchedTarget = null;
        const ctx = {
          get: () => ({
            list: () => [
              {
                id: 'w1',
                title: 'W1',
                path: '/w1',
                sessionIds: [payload.trim()],
                detachSession: async (id) => {
                  searchedTarget = id;
                },
              },
            ],
          }),
        };

        const result = await detachSessionFromWorkspaces(ctx, payload);
        assert.equal(result.ok, true);
        assert.equal(result.detached, true);
        assert.equal(searchedTarget, payload.trim());
      });
    }
  });

  // =========================================================================
  // 4. LEGACY HTTP WRITE ENTRY REMOVAL
  // =========================================================================
  describe('4. Legacy HTTP write endpoints removed by P1C', () => {
    it('has no generic webServer injection or legacy route registration', () => {
      assert.ok(!inject.includes('webServer'));
    });
  });
  // =========================================================================
  // 5. CONTROLLED CHAT SESSION CREATION
  // =========================================================================
  describe('5. Controlled Chat Session Creation', () => {
    it('uses a server-generated identity and a dedicated runtime directory', async () => {
      const app = createTestServer();
      const dshHome = join(tmpdir(), `dsh-no-workspace-controlled-${crypto.randomUUID()}`);
      const result = await createStandaloneSession(app.ctx, { dshHome });
      const session = app.ctx.sessions.get(result.sessionId);
      assert.match(result.sessionId, /^session-[0-9a-f-]{36}$/);
      assert.equal(session.header.cwd, join(dshHome, 'runtime', 'chat', result.sessionId));
      assert.equal(session.header.agentPreset, 'no-workspace-chat');
    });

    it('does not accept an omitted runtime policy', async () => {
      const app = createTestServer();
      await assert.rejects(createStandaloneSession(app.ctx), /DSH_HOME/);
    });

    it('propagates native Session Controller failures without acknowledging creation', async () => {
      const app = createTestServer({
        sessionController: { create: async () => { throw new Error('QuotaExceeded'); } },
      });
      await assert.rejects(createStandaloneSession(app.ctx, {
        dshHome: join(tmpdir(), `dsh-no-workspace-failed-${crypto.randomUUID()}`),
      }), /QuotaExceeded/);
    });
  });

  // =========================================================================
  // 6. PLUGIN METADATA & APPLY LIFECYCLE
  // =========================================================================
  describe('6. Plugin Lifecycle & Cordis Metadata', () => {
    it('exports correct plugin name and inject array', () => {
      assert.equal(name, 'no-workspace');
      assert.ok(Array.isArray(inject));
      assert.ok(inject.includes('sessions'));
      assert.ok(inject.includes('connection'));
      assert.ok(inject.includes('workspaceRegistry'));
      assert.ok(!inject.includes('webServer'));
    });

    it('apply() requires authenticated Connection RPC', () => {
      assert.throws(() => apply({}, {
        dshHome: join(tmpdir(), 'dsh-no-workspace-no-connection'),
      }), /Connection/);
    });

    it('apply() registers only the dedicated Connection channel', () => {
      let registered;
      const ctx = {
        agentPresets: { guard() { return () => {}; } },
        connection: { rpc: { handle(channel, handler) {
          registered = { channel, handler };
          return async () => {};
        } } },
      };
      apply(ctx, { dshHome: join(tmpdir(), 'dsh-no-workspace-rpc') });
      assert.equal(registered.channel, '/no-workspace');
      assert.equal(typeof registered.handler, 'function');
    });

    it('apply() never registers a generic HTTP route', () => {
      const ctx = {
        agentPresets: { guard() { return () => {}; } },
        webServer: { register() { throw new Error('generic HTTP route must not be used'); } },
        connection: { rpc: { handle() { return async () => {}; } } },
      };
      apply(ctx, { dshHome: join(tmpdir(), 'dsh-no-workspace-apply') });
    });
  });
});

