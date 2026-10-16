# Agent Note: Registration identity and final tool projection

Status: implemented

English | [中文](2026-10-03-registration-tool-policies.zh.md)

## Problem

A tool name does not identify its implementation when scoped registrations can shadow inherited tools. An ordinary prompt waterfall also cannot enforce a final tool list: another listener can replace its result or return without delegating.

## Decision

ToolRuntime issues a callable registration handle backed by one runtime-owned record. Identity policies admit records by reference and intersect across scopes. A removed registration becomes inactive; re-registering even the same definition creates a different record. Registration does not clone definitions or traverse schemas. Policies do not attempt to isolate arbitrary code or object mutation within the same process.

ToolRuntime supplies the same admitted records to execution resolution and schema grants. Each grant carries an opaque identity and the registration's model-facing fields. SystemPrompt enforces grants after ordinary assembly; LLM captures applicable policies before middleware and intersects their live grants at adapter dispatch. Candidate names can only be removed, and matching names with different identities are rejected. Projection selects the registration's schema without deep copying or comparing schema content. Without a policy, ordinary shadowing, request assembly and schema processing retain their behavior.

Policy and registration contributions unwind with their owning effects. Captured request policies continue to constrain an in-flight request after their factory is removed; a new composition obtains fresh handles. No runtime identity is persisted. Request owners enforce policy before recording their model input; dispatch repeats admission against live registrations, so revoked tools cannot be reintroduced by middleware.

## Alternatives considered

**Name allowlists.** These cannot distinguish an approved implementation from a same-name shadow.

**Waterfall listener ordering.** An outer listener can modify the result after a filtering listener returns, and a short-circuit listener can bypass that listener entirely.

**Definition snapshots as authority.** Copying schema content does not establish registration identity and adds work to unrestricted tools. Recursive clone implementations also fail for supported deeply nested schemas.

## Consequences

Composition owners retain the registration handle returned by the official registering function rather than looking up a name. The generic runtime contains no product-specific names. Multiple policies sharing a name must share the same registration identity. Same-process plugins remain trusted executable code; these policies authorize ToolRuntime dispatch, not arbitrary JavaScript execution.

The owner tests cover shadowing, re-registration, policy intersection, effect cleanup and post-transform projection. Existing 5,000-level parameter and PTC output-schema tests retain their stack-safe behavior. Real-composition consumers additionally verify first and later requests, compaction and restored compositions against their admitted registration.
