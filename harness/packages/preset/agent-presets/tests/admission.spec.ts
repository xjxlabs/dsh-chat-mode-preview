/** Preset admission is checked at the composition commit point. */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentPresets, {
  type AgentPresetAdmissionOperation,
  type AgentPresetMountOperation,
  type Config,
} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [
  { path: join(FIXTURES, 'system'), trust: 'system' as const },
]
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(async (ctx) => {
    await ctx.fiber.dispose()
  }))
})

async function harness(
  roster: Config = {
    default: 'standard',
    roots: ROOTS,
    includeShippedRoot: false,
    includeUserRoot: false,
  },
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, roster)
  return ctx
}

async function agentOn(
  ctx: Context,
  id: string,
  preset: string,
  operation: AgentPresetMountOperation = 'create',
): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    meta: { agentPreset: preset },
    setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, preset, operation),
  })
  return handle.agent
}

const selectedEvents = (agent: Agent): unknown[] => agent.session.snapshotEvents()
  .filter(event => event.type === 'agent-preset/selected')

describe('preset composition admission', () => {
  it('preserves create and recompose behavior when no guard is registered', async () => {
    const ctx = await harness()
    const agent = await agentOn(ctx, 'admission-none', 'standard')

    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
    expect((await ctx.agentPresets.recompose(agent.ctx, 'minimal')).id).toBe('minimal')
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('minimal')
  })

  it.each(['create', 'resume'] as const)(
    'passes the explicit %s operation and rolls a denied mount back before publication',
    async (operation) => {
      const ctx = await harness()
      const observed: AgentPresetAdmissionOperation[] = []
      ctx.agentPresets.guard((admission) => {
        observed.push(admission.operation)
        return admission.targetPreset === 'minimal' ? `${operation} denied` : undefined
      })

      const allowed = await agentOn(ctx, `admission-${operation}-allowed`, 'standard', operation)
      expect(ctx.agentPresets.composedPreset(allowed.ctx)).toBe('standard')
      const deniedId = SessionId(`admission-${operation}-denied`)
      await expect(agentOn(ctx, deniedId, 'minimal', operation))
        .rejects.toMatchObject({
          code: 'agent-preset/denied',
          details: { operation, sessionId: deniedId, targetPreset: 'minimal' },
        })
      expect(ctx.agents.get(deniedId)).toBeUndefined()
      expect(ctx.sessions.get(deniedId)).toBeUndefined()
      expect(observed).toEqual([operation, operation])
    },
  )

  it('keeps the old binding and never ensures the denied target composition', async () => {
    const ctx = await harness()
    const agent = await agentOn(ctx, 'admission-recompose', 'standard')
    const ensureStanding = vi.spyOn(
      ctx.agentPresets as unknown as { ensureStanding: (...args: unknown[]) => Promise<unknown> },
      'ensureStanding',
    )
    const toolsChanged = vi.fn()
    ctx.on('tools/change', toolsChanged)
    ctx.agentPresets.guard(admission => admission.targetPreset === 'minimal'
      ? 'minimal is not admitted'
      : undefined)

    await expect(ctx.agentPresets.recompose(agent.ctx, 'minimal'))
      .rejects.toMatchObject({
        code: 'agent-preset/denied',
        details: {
          operation: 'recompose',
          currentPreset: 'standard',
          targetPreset: 'minimal',
        },
      })
    expect(ensureStanding).not.toHaveBeenCalled()
    expect(toolsChanged).not.toHaveBeenCalled()
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
  })

  it('does not record a selected event when a queued switch is denied', async () => {
    const ctx = await harness()
    const agent = await agentOn(ctx, 'admission-select', 'standard')
    ctx.agentPresets.guard(admission => admission.targetPreset === 'minimal'
      ? 'selection denied'
      : undefined)

    await expect(ctx.agentPresets.select(agent, 'minimal'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' })
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
    expect(selectedEvents(agent)).toEqual([])
  })

  it('rechecks admission at each concurrent select queue turn', async () => {
    const ctx = await harness()
    const agent = await agentOn(ctx, 'admission-select-race', 'standard')
    ctx.agentPresets.guard(admission => (
      admission.currentPreset === 'minimal' && admission.targetPreset === 'standard'
        ? 'cannot leave minimal'
        : undefined
    ))

    const results = await Promise.allSettled([
      ctx.agentPresets.select(agent, 'minimal'),
      ctx.agentPresets.select(agent, 'standard'),
    ])

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 'minimal' })
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'agent-preset/denied' },
    })
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('minimal')
    expect(selectedEvents(agent)).toHaveLength(1)
  })

  it('makes multiple guards monotonic and the direct disposer exact', async () => {
    const ctx = await harness()
    const order: string[] = []
    ctx.agentPresets.guard(() => { order.push('allow'); return undefined })
    const dispose = ctx.agentPresets.guard(() => { order.push('deny'); return 'owned denial' })
    ctx.agentPresets.guard(() => { order.push('later'); return undefined })

    await expect(agentOn(ctx, 'admission-multi-denied', 'standard'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' })
    expect(order).toEqual(['allow', 'deny'])

    dispose()
    const allowed = await agentOn(ctx, 'admission-multi-allowed', 'standard')
    expect(ctx.agentPresets.composedPreset(allowed.ctx)).toBe('standard')
    expect(order).toEqual(['allow', 'deny', 'allow', 'later'])
  })

  it('removes a guard automatically with its owning plugin fiber', async () => {
    const ctx = await harness()
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      inner.agentPresets.guard(() => 'fiber-owned denial')
    }, { inject: ['agentPresets'] }))

    await expect(agentOn(ctx, 'admission-owner-denied', 'standard'))
      .rejects.toMatchObject({ code: 'agent-preset/denied' })
    await owner.dispose()

    const allowed = await agentOn(ctx, 'admission-owner-allowed', 'standard')
    expect(ctx.agentPresets.composedPreset(allowed.ctx)).toBe('standard')
  })
})
