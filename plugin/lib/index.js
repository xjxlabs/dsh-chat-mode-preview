// dsh-plugin-no-workspace — host half.
//
// Owns the authenticated /no-workspace Connection RPC channel and Cordis
// service orchestration. No generic HTTP write route is registered.

import { createChatSession, resolveChatRuntimePolicy } from './chat-runtime.js';
import {
  apply as applyChatPresetAdmission,
  applyChatCwdAdmission,
} from './chat-preset-admission.js';

export const NO_WORKSPACE_RPC_CHANNEL = '/no-workspace';

export const name = 'no-workspace';
export const inject = [
  'sessions',
  'agents',
  'agentPresets',
  'noWorkspacePresetRoot',
  'sessionController',
  'sessionPersistence',
  'sessionQuery',
  'connection',
  'workspaceRegistry',
];

function sessionIdOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('sessionId must be a non-empty string.');
  }
  return value.trim();
}

/**
 * Detach a session from all workspaces it belongs to.
 */
export async function detachSessionFromWorkspaces(ctx, sessionId) {
  const targetId = sessionIdOf(sessionId);
  const registry = ctx.get('workspaceRegistry') || ctx.workspaceRegistry;
  if (!registry) {
    throw new Error('workspaceRegistry service is not available.');
  }

  const rawWorkspaces = typeof registry.list === 'function' ? registry.list() : [];
  const workspaces = Array.isArray(rawWorkspaces) ? rawWorkspaces : [];
  const matches = workspaces.filter(
    (w) => w && Array.isArray(w.sessionIds) && w.sessionIds.includes(targetId)
  );

  if (matches.length === 0) {
    return { ok: true, detached: false, message: 'Session is not attached to any workspace.' };
  }

  const fromWorkspaces = [];
  for (const workspace of matches) {
    if (typeof workspace.detachSession === 'function') {
      await workspace.detachSession(targetId);
      fromWorkspaces.push({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
      });
    }
  }

  return {
    ok: true,
    detached: true,
    detachedCount: fromWorkspaces.length,
    fromWorkspaces,
  };
}

/**
 * Create a new standalone session without associating it with any workspace.
 */
export async function createStandaloneSession(ctx, policy) {
  return createChatSession(ctx, policy);
}

function rpcFailure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function payloadRecord(payload) {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload
    : undefined;
}

function cancelled(signal) {
  return signal?.aborted
    ? rpcFailure('gateway/cancelled', 'No Workspace operation was cancelled.')
    : undefined;
}

export async function handleNoWorkspaceRpc(ctx, runtimePolicy, endpoint, payload, signal) {
  const aborted = cancelled(signal);
  if (aborted) return aborted;
  try {
    const record = payloadRecord(payload);
    if (endpoint === 'openChat') {
      if (record === undefined || Object.keys(record).length !== 0) {
        return rpcFailure(
          'gateway/bad-request',
          'openChat payload must be an empty object; cwd, sessionId and agentPreset are server-owned.',
        );
      }
      const value = await createStandaloneSession(ctx, runtimePolicy);
      return cancelled(signal) ?? { ok: true, value };
    }
    if (endpoint === 'detach') {
      if (record === undefined
          || Object.keys(record).length !== 1
          || !Object.hasOwn(record, 'sessionId')) {
        return rpcFailure('gateway/bad-request', 'detach payload must contain only sessionId.');
      }
      const value = await detachSessionFromWorkspaces(ctx, record.sessionId);
      return cancelled(signal) ?? { ok: true, value };
    }
    return rpcFailure('gateway/bad-request', `Unknown No Workspace RPC endpoint: ${endpoint}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return error instanceof TypeError
      ? rpcFailure('gateway/bad-request', message)
      : rpcFailure('gateway/internal', message);
  }
}

export function apply(ctx, config = {}) {
  const runtimePolicy = resolveChatRuntimePolicy(config);
  if (!ctx.connection?.rpc || typeof ctx.connection.rpc.handle !== 'function') {
    throw new Error('Authenticated Connection RPC is not available.');
  }
  applyChatPresetAdmission(ctx);
  applyChatCwdAdmission(ctx, runtimePolicy);
  ctx.connection.rpc.handle(
    NO_WORKSPACE_RPC_CHANNEL,
    (endpoint, payload, signal) => handleNoWorkspaceRpc(ctx, runtimePolicy, endpoint, payload, signal),
  );
}
