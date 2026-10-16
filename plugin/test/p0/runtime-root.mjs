// P0 experiment only. Not imported by the shipped plugin.
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, parse } from 'node:path';
import { homedir } from 'node:os';

function absolute(value, label) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)
      || value.includes('\0')) throw new Error(`${label} must be an explicit absolute path`);
  return resolve(value);
}

function contains(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..';
}

export function resolveChatRuntimeRoot({ dshHome, chatRuntimeRoot, workspacePaths = [] } = {}) {
  const home = absolute(dshHome, 'DSH_HOME');
  const root = chatRuntimeRoot === undefined
    ? join(home, 'runtime', 'chat') : absolute(chatRuntimeRoot, 'chatRuntimeRoot');
  if (contains(root, home) || root === parse(root).root) {
    throw new Error('chatRuntimeRoot cannot contain DSH_HOME or be a volume root');
  }
  // Ambient locations are forbidden targets, never defaults.
  if (relative(root, homedir()) === '' || relative(root, process.cwd()) === '') {
    throw new Error('chatRuntimeRoot must be dedicated, not home or process cwd');
  }
  for (const workspace of workspacePaths) {
    const path = absolute(workspace, 'Workspace path');
    if (contains(path, root) || contains(root, path)) throw new Error('chatRuntimeRoot overlaps a Workspace');
  }
  return root;
}

async function rejectLinks(path) {
  const { root } = parse(path);
  let cursor = root;
  for (const segment of relative(root, path).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`unsafe directory: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function allocateChatDirectory(options, generatedId) {
  if (!/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(generatedId)) {
    throw new Error('directory identity must be a server-generated UUID Session ID');
  }
  const root = resolveChatRuntimeRoot(options);
  await rejectLinks(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const cwd = join(canonicalRoot, generatedId);
  // Exclusive allocation: never adopt a directory supplied by another actor.
  await mkdir(cwd, { mode: 0o700 });
  await rejectLinks(cwd);
  const canonical = await realpath(cwd);
  if (relative(canonicalRoot, canonical) !== generatedId) throw new Error('directory escaped runtime root');
  return canonical;
}
