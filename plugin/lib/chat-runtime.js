import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';

export const CHAT_PRESET_ID = 'no-workspace-chat';
const CHAT_SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function verifyTrustedChatPreset(ctx) {
  const roster = ctx.agentPresets;
  const root = ctx.noWorkspacePresetRoot;
  if (!roster || typeof roster.resolve !== 'function' || !root?.chatPresetPath) {
    throw new Error('Trusted Chat preset services are not available.');
  }
  const preset = await roster.resolve(CHAT_PRESET_ID);
  if (preset.id !== CHAT_PRESET_ID || preset.trust !== 'system' || preset.broken !== undefined) {
    throw new Error('Chat preset must be a healthy system-trust preset.');
  }
  const [actual, expected] = await Promise.all([
    realpath(preset.path),
    realpath(root.chatPresetPath),
  ]);
  if (!samePath(actual, expected)) {
    throw new Error('Chat preset does not resolve to the plugin-owned composition.');
  }
  return preset;
}

function explicitAbsolutePath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || !isAbsolute(value) || value.includes('\0')) {
    throw new TypeError(`${label} must be an explicit absolute path.`);
  }
  return resolve(value);
}

// node:path follows the host platform: Windows comparisons ignore case;
// POSIX comparisons preserve it. Keep stored and displayed spelling intact.
function samePath(left, right) {
  return typeof left === 'string' && isAbsolute(left)
    && typeof right === 'string' && isAbsolute(right)
    && relative(left, right) === '';
}

function contains(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..');
}

export function resolveChatRuntimeRoot({
  dshHome,
  chatRuntimeRoot,
  workspacePaths = [],
  processCwd = process.cwd(),
  userHome = homedir(),
} = {}) {
  const home = explicitAbsolutePath(dshHome, 'DSH_HOME');
  const root = chatRuntimeRoot === undefined
    ? join(home, 'runtime', 'chat')
    : explicitAbsolutePath(chatRuntimeRoot, 'chatRuntimeRoot');

  if (samePath(root, parse(root).root) || contains(root, home)) {
    throw new Error('chatRuntimeRoot cannot be a volume root, DSH_HOME, or an ancestor of DSH_HOME.');
  }
  if (samePath(root, resolve(userHome)) || samePath(root, resolve(processCwd))) {
    throw new Error('chatRuntimeRoot must be dedicated, not the user home or process cwd.');
  }
  for (const value of workspacePaths) {
    const workspace = explicitAbsolutePath(value, 'Workspace path');
    if (contains(workspace, root) || contains(root, workspace)) {
      throw new Error(`chatRuntimeRoot overlaps Workspace path "${workspace}".`);
    }
  }
  return root;
}

async function rejectLinkedOrNonDirectoryPath(path) {
  const { root } = parse(path);
  let cursor = root;
  for (const segment of relative(root, path).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`unsafe chat runtime directory: ${cursor}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export async function allocateChatDirectory(options, sessionId) {
  if (!CHAT_SESSION_ID.test(sessionId)) {
    throw new TypeError('Chat directory identity must be a server-generated UUID Session ID.');
  }
  const root = resolveChatRuntimeRoot(options);
  await rejectLinkedOrNonDirectoryPath(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await rejectLinkedOrNonDirectoryPath(root);
  const canonicalRoot = await realpath(root);
  const cwd = join(canonicalRoot, sessionId);
  await mkdir(cwd, { mode: 0o700 });
  await rejectLinkedOrNonDirectoryPath(cwd);
  const canonicalCwd = await realpath(cwd);
  if (!samePath(join(canonicalRoot, sessionId), canonicalCwd)) {
    throw new Error('Chat directory escaped chatRuntimeRoot.');
  }
  return canonicalCwd;
}

function workspacePaths(ctx) {
  const workspaces = ctx.workspaceRegistry.list();
  if (!Array.isArray(workspaces)) throw new Error('workspaceRegistry.list() must return an array.');
  return workspaces.map((workspace) => workspace.path);
}

function requireExistingDirectoryPath(path) {
  const { root } = parse(path);
  let cursor = root;
  for (const segment of relative(root, path).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    let info;
    try {
      info = lstatSync(cursor);
    } catch (error) {
      throw new Error(`Chat runtime directory is unavailable: ${cursor}`, { cause: error });
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Chat runtime directory is unsafe: ${cursor}`);
    }
  }
}

/** Validate a live or recovered Chat Session against the server-owned runtime root. */
export function assertControlledChatDirectory(ctx, policy, session) {
  const sessionId = session?.id;
  if (typeof sessionId !== 'string'
      || !CHAT_SESSION_ID.test(sessionId)
      || session.header?.id !== sessionId) {
    throw new Error('Chat Session has an invalid server-owned identity.');
  }
  const root = resolveChatRuntimeRoot({
    ...policy,
    workspacePaths: workspacePaths(ctx),
  });
  const cwd = explicitAbsolutePath(session.header.cwd, 'Chat Session cwd');
  if (!samePath(join(root, sessionId), cwd)) {
    throw new Error('Chat Session cwd is outside its server-owned runtime directory.');
  }
  requireExistingDirectoryPath(root);
  requireExistingDirectoryPath(cwd);
  const canonicalRoot = realpathSync(root);
  const canonicalCwd = realpathSync(cwd);
  if (!samePath(join(canonicalRoot, sessionId), canonicalCwd)) {
    throw new Error('Chat Session cwd escaped its server-owned runtime directory.');
  }
  return canonicalCwd;
}

export function resolveChatRuntimePolicy(config = {}, env = process.env) {
  const dshHome = config.dshHome ?? env.DSH_HOME;
  return {
    dshHome: explicitAbsolutePath(dshHome, 'DSH_HOME'),
    ...(config.chatRuntimeRoot === undefined
      ? {}
      : { chatRuntimeRoot: explicitAbsolutePath(config.chatRuntimeRoot, 'chatRuntimeRoot') }),
  };
}

export async function createChatSession(ctx, policy) {
  const directoryPolicy = {
    ...policy,
    workspacePaths: workspacePaths(ctx),
  };
  // Validate all path inputs before consulting or mounting a preset. Creation
  // still allocates nothing until both boundaries have passed.
  resolveChatRuntimeRoot(directoryPolicy);
  await verifyTrustedChatPreset(ctx);
  const sessionId = `session-${randomUUID()}`;
  const cwd = await allocateChatDirectory(directoryPolicy, sessionId);
  const created = await ctx.sessionController.create({
    sessionId,
    cwd,
    agentPreset: CHAT_PRESET_ID,
  });
  if (created.sessionId !== sessionId || created.agentPreset !== CHAT_PRESET_ID) {
    throw new Error('Session Controller returned an unexpected Chat identity or preset.');
  }
  const session = ctx.sessions.get(sessionId);
  if (session === undefined || !samePath(session.header.cwd, cwd) || session.header.agentPreset !== CHAT_PRESET_ID) {
    throw new Error('Chat Session was not published with the requested cwd and preset.');
  }
  if (!await ctx.sessions.flush(session)) {
    throw new Error('Chat Session has no active durability participant.');
  }
  const stored = await ctx.sessionPersistence.stat(sessionId);
  if (stored === undefined
      || stored.header.id !== sessionId
      || !samePath(stored.header.cwd, cwd)
      || stored.header.agentPreset !== CHAT_PRESET_ID) {
    throw new Error('Chat Session failed durable identity verification.');
  }
  return { ok: true, sessionId };
}
