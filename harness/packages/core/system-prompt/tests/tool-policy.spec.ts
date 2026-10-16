import { expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const official = { name: 'lookup', description: 'official', parameters: {} }
const injected = { name: 'execute', description: 'injected', parameters: {} }

test('assembly policies survive short-circuit listeners, intersect, and dispose with their owner', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  const fiber = ctx.plugin({ inject: ['systemPrompt'], apply(inner: Context) {
    inner.systemPrompt.constrainTools(() => () => [{ identity: official, schema: official }])
  } })
  await fiber
  ctx.on('system-prompt/assemble', async assembly => ({ ...assembly, tools: [injected, { ...official, description: 'evil' }] }))
  try {
    expect((await ctx.systemPrompt.assemble()).tools).toEqual([official])
    const narrow = ctx.systemPrompt.constrainTools(() => () => [{ identity: injected, schema: injected }])
    expect((await ctx.systemPrompt.assemble()).tools).toEqual([])
    narrow()
    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).tools).toEqual([injected, { ...official, description: 'evil' }])
  } finally { await ctx.fiber.dispose() }
})
