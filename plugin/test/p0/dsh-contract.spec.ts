// P0 compatibility probe: real DSH source services, Loader and JSONL backend.
// Empty probe presets are fixtures, not the product Chat preset.
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import Projections from '@deepseek-ai/dsh-session-projection';
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query';
import Presets from '@deepseek-ai/dsh-agent-presets';
import Typert from '@deepseek-ai/dsh-typert-registry';
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts';
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts';
import { ApiSessionList } from '@deepseek-ai/dsh-api-session-controller/src/list.ts';
import { SessionHistoryController } from '@deepseek-ai/dsh-api-session-controller/src/history.ts';
import { installModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/src/model-selection-projection.ts';
import { allocateChatDirectory } from './runtime-root.mjs';
import { CHAT_PRESET_ID, createChatSession } from '../../lib/chat-runtime.js';
import { UiWorkspaceService } from 'p0-workspace-navigation';

const home = process.env.DSH_HOME!;
const evidence = process.env.P0_EVIDENCE!;
const writer = process.env.P0_PHASE === 'write';
const presetId = 'p0-chat-contract';
let ctx: Context;
let agents: ApiSessionAgentController;
let commands: SessionCommandController;
let listing: ApiSessionList;
let history: SessionHistoryController;
const metadata = join(evidence, 'sessions.json');
let records: Record<string, { id: string; cwd?: string; cursor: number }> = {};

class PointQuery extends Query {
  async searchSessions(): Promise<never> { throw new Error('P0 does not exercise full text search'); }
  async searchEvents(): Promise<never> { throw new Error('P0 does not exercise full text search'); }
}

beforeAll(async () => {
  const roots = join(evidence, 'presets');
  for (const id of [presetId, 'p0-alternative', CHAT_PRESET_ID]) {
    await mkdir(join(roots, id), { recursive: true });
    await writeFile(join(roots, id, 'agent.cordis.yml'), '[]\n');
  }
  const configPath = join(evidence, 'cordis.yml');
  const modules = new Map<string, unknown>([
    ['sessions', SessionStore], ['agents', AgentRegistry], ['loop', AgentLoop],
    ['llm', LlmRuntime], ['prompt', SystemPrompt], ['tools', ToolRuntime],
    ['projections', Projections], ['persistence', Jsonl], ['query', PointQuery],
    ['presets', Presets], ['typert', Typert],
  ]);
  const configs: Record<string, object> = {
    loop: { agents: [] }, prompt: { persona: 'P0 persistence probe; no model requests.' },
    persistence: { root: join(home, 'sessions') },
    presets: { default: presetId, roots: [{ path: roots, trust: 'system' }],
      includeShippedRoot: false, includeUserRoot: false },
  };
  await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({ name, config: configs[name] ?? {} }))));
  ctx = new Context();
  ctx.baseUrl = pathToFileURL(evidence).href + '/';
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (!modules.has(name)) throw new Error(`unexpected module: ${name}`);
    return modules.get(name);
  } } as never;
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } });
  await ctx.loader.await();
  ctx.provide('noWorkspacePresetRoot', {
    path: roots,
    chatPresetPath: join(roots, CHAT_PRESET_ID, 'agent.cordis.yml'),
  } as never);
  expect(ctx.get('sessionPersistence')).toBeDefined();
  expect(ctx.get('agentLoop')).toBeDefined();
  // Only model choice is a test fixture; no network provider or model call runs.
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p0', model: 'p0' }) } as never);
  installModelSelectionProjection(ctx);
  agents = new ApiSessionAgentController(ctx);
  commands = new SessionCommandController(ctx, agents, evidence);
  ctx.provide('sessionController', { create: request => commands.create(request) } as never);
  listing = new ApiSessionList(ctx, { coldBlankProbeMaxEvents: 256, coldBlankProbeMaxBytes: 1048576 });
  history = new SessionHistoryController(ctx, () => {});
  if (!writer) records = JSON.parse(await readFile(metadata, 'utf8'));
});

afterAll(async () => {
  if (writer && ctx) await writeFile(metadata, JSON.stringify(records, null, 2));
  await ctx?.fiber.dispose();
});

if (writer) {
  test('native create + flush: blank and history sessions use isolated cwd with no Workspace', async () => {
    for (const key of ['blank', 'history']) {
      const id = SessionId(`session-${randomUUID()}`);
      const cwd = await allocateChatDirectory({ dshHome: home }, id);
      const created = await commands.create({ sessionId: id, cwd, agentPreset: presetId });
      expect(created.agentPreset).toBe(presetId);
      const session = ctx.sessions.get(id)!;
      if (key === 'history') {
        session.append('turn/start', { turn: 1 });
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'P0 历史：保留中文、来源和约束。' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' });
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
      }
      expect(await ctx.sessions.flush(session)).toBe(true);
      // Inspect persisted bytes through a separate backend BEFORE disposing the writer.
      const observer = new Context();
      await observer.plugin(Jsonl, { root: join(home, 'sessions') });
      try {
        const reader = await observer.sessionPersistence.open(id, 'read');
        try { expect((await reader.read()).length).toBe(session.seq); }
        finally { await reader.close(); }
      } finally { await observer.fiber.dispose(); }
      expect((await listing.list()).some(row => row.sessionId === id)).toBe(true);
      expect(session.header.cwd).toBe(cwd);
      records[key] = { id, cwd, cursor: session.seq - 1 };
    }
  });

  test('production Chat creation publishes and verifies one durable isolated Session', async () => {
    ctx.provide('workspaceRegistry', { list: () => [] } as never);
    const created = await createChatSession(ctx, { dshHome: home });
    const session = ctx.sessions.get(SessionId(created.sessionId))!;
    expect(session.header.agentPreset).toBe(CHAT_PRESET_ID);
    expect(await ctx.sessionPersistence.stat(SessionId(created.sessionId))).toMatchObject({
      header: { id: created.sessionId, cwd: session.header.cwd, agentPreset: CHAT_PRESET_ID },
    });
    records.production = { id: created.sessionId, cwd: session.header.cwd, cursor: session.seq - 1 };
  });

  test('negative control: persisted cwd-less session is not a recoverable Web session', async () => {
    const id = SessionId(`session-${randomUUID()}`);
    const handle = await ctx.agents.create({ sessionId: id, meta: { agentPreset: presetId },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, presetId); } });
    await ctx.sessions.flush(handle.agent.session);
    records.cwdless = { id, cursor: handle.agent.session.seq - 1 };
    await expect(history.page({ address: { kind: 'session', sessionId: id },
      throughSeq: handle.agent.session.seq - 1 }, new AbortController().signal)).rejects.toMatchObject({ code: 'session/not-found' });
  });

  test('bare Session control: flush alone does not create storage ownership', async () => {
    expect((ctx.sessionPersistence as unknown as Record<string, unknown>).ensureMaterialized).toBeUndefined();
    const id = SessionId(`session-${randomUUID()}`);
    const cwd = await allocateChatDirectory({ dshHome: home }, id);
    await ctx.sessions.create(id, { meta: { cwd } });
    expect(await ctx.sessions.flush(ctx.sessions.get(id)!)).toBe(true);
    expect(await ctx.sessionPersistence.stat(id)).toBeUndefined();
    records.bare = { id, cwd, cursor: -1 };
  });

  test('existing API defaults omitted cwd to its process-derived default, not absence', async () => {
    const created = await commands.create({ agentPreset: presetId });
    expect(ctx.sessions.get(created.sessionId)!.header.cwd).toBe(evidence);
  });

  test('registered preset roots work, but blank preset switching has no Chat lock', async () => {
    expect((await ctx.agentPresets.list()).map(p => p.id)).toContain(presetId);
    const created = await commands.create({ cwd: evidence, agentPreset: presetId });
    const agent = ctx.agents.get(created.sessionId)!;
    await expect(ctx.agentPresets.select(agent, 'p0-alternative')).resolves.toBe('p0-alternative');
    expect(agent.session.header.agentPreset).toBe(presetId);
    expect(ctx.sessionProjections.stateOf(agent.session, 'agentPreset')).toBe('p0-alternative');
    agent.session.append('turn/start', { turn: 1 });
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await expect(ctx.agentPresets.select(agent, presetId)).rejects.toMatchObject({ code: 'agent-preset/locked' });
  });

  test('native Workspace navigation reuses a non-standard blank and creates without specifying preset', async () => {
    const scope = new Context();
    const state = { phase: 'ready', current: 'current', ids: ['candidate'],
      byId: { candidate: { id: 'candidate', cwd: evidence, blank: true,
        projectionValues: { agentPreset: 'p0-alternative' } } } };
    const workspace = { phase: 'ready', archivedSessionIds: [], items: [
      { workspaceId: 'workspace', path: evidence, sessionIds: ['candidate'] },
    ] };
    const create = vi.fn(async () => 'new-session');
    const snapshot = (value: unknown) => ({ getSnapshot: () => value, subscribe: () => () => {} });
    const service = new UiWorkspaceService(scope, {} as never,
      { list: snapshot(workspace) } as never,
      { list: snapshot(state), create } as never);
    try {
      expect(await service.connectWorkspace('workspace' as never)).toBe('candidate');
      expect(create).not.toHaveBeenCalled();
      state.ids = [];
      expect(await service.connectWorkspace('workspace' as never)).toBe('new-session');
      expect(create).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace' });
    } finally { await scope.fiber.dispose(); }
  });

  test('flush failure rejects rather than acknowledging durability', async () => {
    const created = await commands.create({ cwd: evidence, agentPreset: presetId });
    const session = ctx.sessions.get(created.sessionId)!;
    session.append('turn/start', { turn: 1 });
    const persistence = ctx.sessionPersistence as unknown as { persistBatch(): Promise<void> };
    const fail = vi.spyOn(persistence, 'persistBatch').mockRejectedValue(new Error('P0 injected disk failure'));
    try { await expect(ctx.sessions.flush(session)).rejects.toThrow('P0 injected disk failure'); }
    finally { fail.mockRestore(); }
    await ctx.sessions.flush(session);
  });
} else {
  test('fresh process lists isolated blank/history sessions and excludes cwd-less/bare controls', async () => {
    expect(ctx.sessions.get(SessionId(records.blank.id))).toBeUndefined();
    const rows = await listing.list();
    for (const key of ['blank', 'history', 'production']) {
      expect(rows.find(row => row.sessionId === records[key].id)).toMatchObject({
        cwd: records[key].cwd, blank: key !== 'history',
      });
    }
    expect(rows.some(row => row.sessionId === records.cwdless.id)).toBe(false);
    expect(rows.some(row => row.sessionId === records.bare.id)).toBe(false);
  });

  test('fresh process reads history before activation and resumes original cwd/preset', async () => {
    for (const key of ['blank', 'history', 'production']) {
      const record = records[key];
      const id = SessionId(record.id);
      const page = await history.page({ address: { kind: 'session', sessionId: id }, throughSeq: record.cursor }, new AbortController().signal);
      if (key === 'history') expect(JSON.stringify(page)).toContain('P0 历史：保留中文、来源和约束。');
      const resumed = await agents.resolveAgent(id);
      if ('error' in resumed) throw resumed.error;
      expect(resumed.agent.session.header.cwd).toBe(record.cwd);
      const expectedPreset = key === 'production' ? CHAT_PRESET_ID : presetId;
      expect(ctx.agentPresets.composedPreset(resumed.agent.ctx)).toBe(expectedPreset);
      expect(agents.presetForSession(resumed.agent.session)).toBe(expectedPreset);
    }
    expect(await agents.resolveAgent(SessionId(records.cwdless.id))).toMatchObject({ error: { code: 'session/not-found' } });
    expect(await ctx.sessionPersistence.stat(SessionId(records.bare.id))).toBeUndefined();
  });
}
