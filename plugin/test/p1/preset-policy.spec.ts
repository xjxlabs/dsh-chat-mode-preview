import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Group from '@deepseek-ai/cordis-plugin-group';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import Projections from '@deepseek-ai/dsh-session-projection';
import Presets from '@deepseek-ai/dsh-agent-presets';
import * as Persona from '@deepseek-ai/dsh-persona';
import WebRuntime from '@deepseek-ai/dsh-web';
import * as ToolWeb from '@deepseek-ai/dsh-tool-web';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import * as BasicCompaction from '@deepseek-ai/dsh-compaction-basic';
import * as ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import { CHAT_PRESET_ID } from '../../lib/chat-runtime.js';
import { CHAT_PRESET_PATH, CHAT_PRESET_ROOT } from '../../lib/preset-root.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modules = new Map<string, unknown>([
  ['@deepseek-ai/dsh-persona', Persona],
  ['@deepseek-ai/dsh-tool-web', ToolWeb],
  ['@deepseek-ai/dsh-compaction-basic', BasicCompaction],
  ['@deepseek-ai/dsh-compaction-tool-result-pruner', ToolResultPruner],
]);
const signal = new AbortController().signal;
let ctx: Context;
let agent: Agent;
let duplicateRoot: string;
let harnessRoot: string;

function tool(name: string, onRun: () => void): ToolDefinition {
  return {
    name,
    description: `P1B leak probe ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      onRun();
      return `ran:${name}`;
    },
  };
}

async function execute(name: string, argumentsValue: object = {}) {
  return await ctx.tools.execute({
    signal,
    callId: ToolCallId(`p1b-${name}`),
    name,
    arguments: argumentsValue,
    agent,
  });
}

async function modelToolNames(): Promise<string[]> {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  return assembly.tools.map((entry) => entry.name).sort();
}

beforeAll(async () => {
  harnessRoot = await mkdtemp(join(tmpdir(), 'dsh-p1b-harness-'));
  for (const specifier of modules.keys()) {
    const packageDir = join(harnessRoot, 'node_modules', ...specifier.split('/'));
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: specifier, type: 'module' }));
  }
  duplicateRoot = await mkdtemp(join(tmpdir(), 'dsh-p1b-user-preset-'));
  const duplicate = join(duplicateRoot, CHAT_PRESET_ID);
  await mkdir(duplicate);
  await writeFile(join(duplicate, 'agent.cordis.yml'), '[]\n');

  ctx = new Context();
  ctx.baseUrl = pathToFileURL(harnessRoot).href + '/';
  await ctx.plugin(Loader);
  ctx.loader.builtins.group = Group;
  ctx.loader.internal = { version: 'v2', async import(specifier: string, parentURL: string) {
    if (modules.has(specifier)) return modules.get(specifier);
    if (specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
      return await import(new URL(specifier, parentURL).href);
    }
    throw new Error(`unexpected preset module: ${specifier}`);
  } } as never;

  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SystemPrompt, { persona: 'host persona must be shadowed' });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(Projections);
  await ctx.plugin(TokenMeter);
  await ctx.plugin(WebRuntime);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Presets, {
    default: 'standard',
    roots: [
      { path: CHAT_PRESET_ROOT, trust: 'system' },
      { path: duplicateRoot, trust: 'user' },
    ],
    includeShippedRoot: false,
    includeUserRoot: false,
  });
  const handle = await ctx.agents.create({
    sessionId: SessionId('session-00000000-0000-4000-8000-000000000001'),
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, CHAT_PRESET_ID),
  });
  agent = handle.agent;
});

afterAll(async () => {
  await ctx?.fiber.dispose();
  if (duplicateRoot) await rm(duplicateRoot, { recursive: true, force: true });
  if (harnessRoot) await rm(harnessRoot, { recursive: true, force: true });
});

test('preset resolves from the plugin-owned system root despite a user duplicate', async () => {
  const preset = await ctx.agentPresets.resolve(CHAT_PRESET_ID);
  expect(preset.trust).toBe('system');
  expect(await realpath(preset.path)).toBe(await realpath(CHAT_PRESET_PATH));
});

test('mounted Chat exposes exactly web_search with a complete context-free persona and compaction', async () => {
  expect(await modelToolNames()).toEqual(['web_search']);
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  expect(assembly.sections).toHaveLength(1);
  expect(assembly.sections[0]?.text).toContain('helpful conversational assistant');
  expect(assembly.contexts).toEqual([]);
  expect(ctx.agentPresets.serviceFor(agent, 'compaction')).toBeDefined();
  expect(ctx.agentPresets.serviceFor(agent, 'toolResultPruner')).toBeDefined();
});

test('later global tools remain hidden and cannot execute in Chat', async () => {
  let calls = 0;
  const dispose = ctx.tools.register(tool('shell_probe', () => { calls += 1; }));
  try {
    expect(ctx.tools.schemas(agent).map((entry) => entry.name).sort()).toEqual(['web_search']);
    expect(await modelToolNames()).toEqual(['web_search']);
    const result = await execute('shell_probe');
    expect(result.isError).toBe(true);
    expect(calls).toBe(0);
  } finally {
    dispose();
  }
});

test('later agent-local tools are removed from model schema and denied without side effects', async () => {
  let calls = 0;
  const dispose = agent.ctx.tools.register(tool('local_probe', () => { calls += 1; }));
  try {
    expect(ctx.tools.schemas(agent).map((entry) => entry.name).sort()).toEqual(['web_search']);
    expect(await modelToolNames()).toEqual(['web_search']);
    const result = await execute('local_probe');
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('unknown tool') });
    expect(calls).toBe(0);
  } finally {
    dispose();
  }
});

test('forbidden capability names and run_code fail closed while web_search reaches its provider seam', async () => {
  for (const name of ['bash', 'read_file', 'fs_search', 'skill', 'subagent', 'workflow', 'goal', 'plan', 'run_code']) {
    const result = await execute(name);
    expect(result.isError, name).toBe(true);
  }
  const search = await execute('web_search', { queries: ['DSH Chat Mode'] });
  expect(search.isError).toBe(true);
  expect(search.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/web provider|provider/i) });
});
