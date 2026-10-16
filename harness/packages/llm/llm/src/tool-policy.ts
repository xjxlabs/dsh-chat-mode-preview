/** Final, intersecting model-tool projections shared by request owners. */
import type { ToolSchema } from './types.ts'

/** A canonical schema associated with its owner's opaque registration identity. */
export interface ToolSchemaGrant {
  /** Current runtime registration, never a name or serialized identifier. */
  readonly identity: object
  /** Schema supplied by that registration, not by a transformer. */
  readonly schema: ToolSchema
}

/** A live catalog of admitted registrations; an empty catalog denies every tool. */
export type ToolSchemaPolicy = () => readonly ToolSchemaGrant[]

/**
 * Intersect candidate names with canonical registration catalogs. Every policy
 * must admit the same identity; schema contents are not an authorization fact.
 * @param tools - schemas after ordinary transformations.
 * @param policies - captured policies for this operation.
 * @returns canonical schemas without cloning their trees, or unchanged input with no policies.
 */
export function projectToolSchemas(tools: ToolSchema[], policies: readonly ToolSchemaPolicy[]): ToolSchema[] {
  if (policies.length === 0) return tools
  const catalogs = policies.map(policy => new Map(policy().map(grant => [grant.schema.name, grant])))
  const seen = new Set<string>()
  const result: ToolSchema[] = []
  for (const candidate of tools) {
    if (seen.has(candidate.name)) continue
    seen.add(candidate.name)
    const canonical = catalogs[0]?.get(candidate.name)
    if (canonical === undefined) continue
    if (!catalogs.every(catalog => catalog.get(candidate.name)?.identity === canonical.identity)) continue
    result.push(canonical.schema)
  }
  return result
}
