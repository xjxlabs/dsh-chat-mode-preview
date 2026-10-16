import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import Presets from '@deepseek-ai/dsh-agent-presets';
import type { AgentPresetMountOperation } from '@deepseek-ai/dsh-agent-presets';
import { CHAT_PRESET_ID } from '../../lib/chat-runtime.js';
import { apply as applyChatPresetAdmission } from '../../lib/chat-preset-admission.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.env.DSH_SOURCE_ROOT ?? resolve(here, '../../../deepseek-harness'));
const fixtureRoot = join(source, 'packages/preset/agent-presets/tests/fixtures');
const fixturePlugin = pathToFileURL(join(fixtureRoot, 'plugins/contribute.js')).href;
let ctx: Context;
let chatRoot: string;

async function agentOn(
  id: string,
  preset: string,
  operation: AgentPresetMountOperation = 'create',
): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    meta: { agentPreset: preset },
    setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, preset, operation),
  });
  return handle.agent;
}

const selectedEvents = (agent: Agent) => agent.session.snapshotEvents()
  .filter(event => event.type === 'agent-preset/selected');

beforeAll(async () => {
  chatRoot = await mkdtemp(join(tmpdir(), 'dsh-p1d-chat-root-'));
  const chatDir = join(chatRoot, CHAT_PRESET_ID);
  await mkdir(chatDir);
  await writeFile(join(chatDir, 'agent.cordis.yml'), [
    '- id: chat-probe',
    `  name: '${fixturePlugin}'`,
    '  config:',
    '    tool: chat-probe',
    '',
  ].join('\n'));

  ctx = new Context();
  ctx.baseUrl = pathToFileURL(fixtureRoot).href + '/';
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SystemPrompt, { persona: '' });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(Projections);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Presets, {
    default: 'standard',
    roots: [
      { path: chatRoot, trust: 'system' },
      { path: join(fixtureRoot, 'system'), trust: 'system' },
    ],
    includeShippedRoot: false,
    includeUserRoot: false,
  });
});

afterAll(async () => {
  await ctx?.fiber.dispose();
  if (chatRoot) await rm(chatRoot, { recursive: true, force: true });
});

test('Chat create and resume stay on Chat while Standard Sessions remain unrestricted', async () => {
  const owner = await ctx.plugin(Object.assign((inner: Context) => {
    applyChatPresetAdmission(inner);
  }, { inject: ['agentPresets'] }));
  try {
    const created = await agentOn('p1d-chat-created', CHAT_PRESET_ID, 'create');
    const resumed = await agentOn('p1d-chat-resumed', CHAT_PRESET_ID, 'resume');
    const standard = await agentOn('p1d-standard', 'standard');

    expect((await ctx.agentPresets.recompose(created.ctx, CHAT_PRESET_ID)).id)
      .toBe(CHAT_PRESET_ID);
    await expect(ctx.agentPresets.recompose(resumed.ctx, 'standard'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' });
    expect((await ctx.agentPresets.recompose(standard.ctx, 'minimal')).id).toBe('minimal');
  } finally {
    await owner.dispose();
  }
});

test('direct recompose and select cannot move Chat, and rejected select records nothing', async () => {
  const owner = await ctx.plugin(Object.assign((inner: Context) => {
    applyChatPresetAdmission(inner);
  }, { inject: ['agentPresets'] }));
  try {
    const direct = await agentOn('p1d-chat-direct', CHAT_PRESET_ID);
    const selected = await agentOn('p1d-chat-select', CHAT_PRESET_ID);

    await expect(ctx.agentPresets.recompose(direct.ctx, 'standard'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' });
    await expect(ctx.agentPresets.select(selected, 'standard'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' });
    expect(ctx.agentPresets.composedPreset(direct.ctx)).toBe(CHAT_PRESET_ID);
    expect(ctx.agentPresets.composedPreset(selected.ctx)).toBe(CHAT_PRESET_ID);
    expect(selectedEvents(selected)).toEqual([]);
  } finally {
    await owner.dispose();
  }
});

test('live Chat composition is locked and the policy unloads with its plugin fiber', async () => {
  const owner = await ctx.plugin(Object.assign((inner: Context) => {
    applyChatPresetAdmission(inner);
  }, { inject: ['agentPresets'] }));
  const agent = await agentOn('p1d-live-chat', 'standard');

  expect((await ctx.agentPresets.recompose(agent.ctx, CHAT_PRESET_ID)).id)
    .toBe(CHAT_PRESET_ID);
  await expect(ctx.agentPresets.recompose(agent.ctx, 'minimal'))
    .rejects.toMatchObject({ code: 'agent-preset/denied' });

  await owner.dispose();
  expect((await ctx.agentPresets.recompose(agent.ctx, 'minimal')).id).toBe('minimal');
});
