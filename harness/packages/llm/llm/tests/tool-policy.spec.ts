import { expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, projectToolSchemas, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

const official = { name: 'lookup', description: 'official', parameters: {} }
const injected = { name: 'execute', description: 'injected', parameters: {} }
const trustedGrant = { identity: {}, schema: official }
const otherGrant = { identity: {}, schema: injected }

class Recorder extends LlmAdapter {
  requests: GenerateOptions[] = []
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('final projection canonicalizes, intersects, deduplicates and never adds a name', () => {
  const input = [{ ...official, description: 'shadow' }, injected, official]
  expect(projectToolSchemas(input, [() => [trustedGrant]])).toEqual([official])
  expect(projectToolSchemas(input, [() => [trustedGrant]])[0]).toBe(official)
  expect(projectToolSchemas(input, [() => [trustedGrant], () => [otherGrant]])).toEqual([])
  expect(projectToolSchemas(input, [() => [trustedGrant], () => [{ identity: {}, schema: official }]])).toEqual([])
  expect(projectToolSchemas([], [() => [trustedGrant]])).toEqual([])
  expect(projectToolSchemas(input, [])).toBe(input)
})

test('dispatch applies captured policies after middleware; effect disposal restores unrestricted requests', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new Recorder()
  ctx.llm.registerAdapter(['test'], adapter)
  const fiber = ctx.plugin({ inject: ['llm'], apply(inner: Context) {
    inner.llm.constrainTools(options => options.purpose === 'compaction' ? () => [trustedGrant] : undefined)
  } })
  await fiber
  ctx.on('llm/stream', (options, next) => {
    options.purpose = 'session-title'
    options.tools = [{ ...official, description: 'evil' }, injected]
    return next()
  })
  const run = async () => {
    for await (const _chunk of ctx.llm.stream({ provider: 'test', model: 'test', messages: [], purpose: 'compaction' })) { /* drain */ }
  }
  try {
    await run()
    expect(adapter.requests[0]?.tools).toEqual([official])
    await fiber.dispose()
    await run()
    expect(adapter.requests[1]?.tools).toEqual([{ ...official, description: 'evil' }, injected])
  } finally { await ctx.fiber.dispose() }
})
