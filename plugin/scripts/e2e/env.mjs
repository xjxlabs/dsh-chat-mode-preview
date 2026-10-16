// Boots a DSH server + headless Edge for an end-to-end run, and restores the
// DSH home afterwards.
//
// The suite runs only in an explicitly prepared disposable profile. All
// fixtures and cleanup resolve through that same home; the regular installed
// user's profile is never an implicit test target.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One explicit disposable home for boot, fixtures and cleanup. The desktop
// CLI shim overrides DSH_HOME, so startDsh invokes the official JS CLI directly.
export const DSH_HOME = path.resolve(process.env.DSH_HOME ?? '.');
if (path.dirname(DSH_HOME) !== path.resolve(os.tmpdir())
    || !path.basename(DSH_HOME).startsWith('dsh-no-workspace-e2e-')) {
  throw new Error('Set DSH_HOME to a new dsh-no-workspace-e2e-* directory under the system temporary directory.');
}
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* server not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function listSessionDirs() {
  if (!fs.existsSync(SESSIONS_ROOT)) return [];
  return fs.readdirSync(SESSIONS_ROOT).flatMap((bucket) => {
    const bucketDir = path.join(SESSIONS_ROOT, bucket);
    if (!fs.statSync(bucketDir).isDirectory()) return [];
    return fs.readdirSync(bucketDir).map((session) => path.join(bucketDir, session));
  });
}

export function snapshotDshHome() {
  return {
    workspaceStore: fs.existsSync(WORKSPACE_STORE) ? fs.readFileSync(WORKSPACE_STORE, 'utf8') : null,
    sessionDirs: new Set(listSessionDirs()),
  };
}

export function restoreDshHome(snapshot, { verbose = true } = {}) {
  const removed = [];
  for (const dir of listSessionDirs()) {
    if (snapshot.sessionDirs.has(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  // Drop bucket directories the run created and then emptied.
  if (fs.existsSync(SESSIONS_ROOT)) {
    for (const bucket of fs.readdirSync(SESSIONS_ROOT)) {
      const bucketDir = path.join(SESSIONS_ROOT, bucket);
      if (fs.statSync(bucketDir).isDirectory() && fs.readdirSync(bucketDir).length === 0) {
        fs.rmdirSync(bucketDir);
      }
    }
  }
  if (snapshot.workspaceStore !== null) fs.writeFileSync(WORKSPACE_STORE, snapshot.workspaceStore);
  if (verbose) console.log(`[env] restored DSH home (removed ${removed.length} session dir(s))`);
  return removed;
}

export function readWorkspaceStore() {
  if (!fs.existsSync(WORKSPACE_STORE)) return null;
  return JSON.parse(fs.readFileSync(WORKSPACE_STORE, 'utf8'));
}

function listenersOnPort(port) {
  // netstat is the only dependency-free way to find the owner on Windows.
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? '';
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (line.includes(`:${port} `) && line.includes('LISTENING')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0') pids.add(pid);
    }
  }
  return [...pids];
}

export async function startDsh({ port, profile = 'desktop', logDir }) {
  if (listenersOnPort(port).length) throw new Error(`Port ${port} is already in use; choose a free test port.`);
  const cli = process.env.DSH_CLI_ENTRY;
  if (!cli || !fs.existsSync(cli)) throw new Error('Set DSH_CLI_ENTRY to the installed official @deepseek-ai/dsh/lib/bin.js.');
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `dsh-${port}.log`), 'w');
  const child = spawn(process.execPath, ['--expose-internals', cli, '--profile', profile, '--no-open', '--port', String(port)], {
    env: { ...process.env, DSH_HOME },
    stdio: ['ignore', out, out],
    detached: false,
  });
  const origin = `http://127.0.0.1:${port}`;
  const ready = await waitForHttp(`${origin}/no-workspace/status`, 90000);
  if (!ready) {
    try { child.kill(); } catch { /* already gone */ }
    throw new Error(`DSH did not come up on ${port} — see ${path.join(logDir, `dsh-${port}.log`)}`);
  }
  return {
    origin,
    url: fs.readFileSync(path.join(logDir, `dsh-${port}.log`), 'utf8')
      .match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)?.[0] ?? origin,
    stop() {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T']);
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}

export async function startEdge({ debugPort, profileDir, appOrigin, width = 1440, height = 900 }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    appOrigin,
  ], { stdio: 'ignore' });
  const ready = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30000);
  if (!ready) throw new Error('Edge did not expose a debugging port');
  return {
    stop() {
      // Edge fans out into child processes. Kill only this test browser's
      // explicit root process tree so no headless renderer survives the run.
      spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T']);
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}
