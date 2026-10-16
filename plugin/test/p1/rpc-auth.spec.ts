import { afterAll, beforeAll, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import type { ClientRequest, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials';
import * as NoWorkspace from '../../lib/index.js';
import { CHAT_PRESET_PATH, CHAT_PRESET_ROOT } from '../../lib/preset-root.js';

class RecordCredentials {
  record: CredentialRecord | undefined;
  readRecord(): Promise<CredentialRecord | undefined> { return Promise.resolve(this.record); }
  async modifyRecord(_key: unknown, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    this.record = await mutate(this.record);
    return this.record;
  }
  deleteRecord(): Promise<void> { this.record = undefined; return Promise.resolve(); }
}

function fakeRequest(headers: Record<string, string>, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = Readable.from(chunks) as unknown as IncomingMessage;
  Object.assign(request, {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
  });
  return request;
}

function fakeResponse() {
  const state: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const chunks: Buffer[] = [];
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status;
      if (headers) state.headers = headers;
      return this;
    },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true; },
    end(this: { writableEnded: boolean }, value?: string | Uint8Array) {
      if (value !== undefined) chunks.push(Buffer.from(value));
      if (chunks.length > 0) state.body = Buffer.concat(chunks).toString();
      this.writableEnded = true;
      return this;
    },
  }) as unknown as ServerResponse;
  return { response, state };
}

function browserCookie(connection: HostConnectionHandle, authority: string): string {
  const url = new URL(connection.authenticatedUrl(`http://${authority}`));
  const exchange = fakeResponse();
  connection.authorizeIndex(fakeRequest({ host: authority }, `${url.pathname}${url.search}`), exchange.response);
  const cookie = exchange.state.headers?.['set-cookie'];
  if (!cookie) throw new Error('browser auth did not issue a cookie');
  return cookie.split(';', 1)[0]!;
}

let ctx: Context;
let route: { handler(request: IncomingMessage, response: ServerResponse): Promise<void> };
let cookie: string;
let createCalls = 0;

beforeAll(async () => {
  const routes: Array<{ kind: string; path: string; handler: typeof route.handler }> = [];
  ctx = new Context();
  ctx.provide('credentials', new RecordCredentials() as never);
  ctx.provide('webServer', {
    register(value: (typeof routes)[number]) { routes.push(value); return () => routes.splice(routes.indexOf(value), 1); },
  } as never);
  await ctx.plugin(Connection, { trustedHosts: ['harness.example'] });

  let session: { id: string; header: { id: string; cwd: string; agentPreset: string } } | undefined;
  ctx.provide('sessions', {
    get: () => session,
    flush: async () => true,
  } as never);
  ctx.provide('agents', {} as never);
  ctx.provide('agentPresets', {
    resolve: async () => ({
      id: 'no-workspace-chat', trust: 'system', path: CHAT_PRESET_PATH,
    }),
    guard: () => () => {},
  } as never);
  ctx.provide('noWorkspacePresetRoot', { path: CHAT_PRESET_ROOT, chatPresetPath: CHAT_PRESET_PATH } as never);
  ctx.provide('sessionController', { create: async (request: { sessionId: string; cwd: string; agentPreset: string }) => {
    createCalls += 1;
    session = { id: request.sessionId, header: {
      id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset,
    } };
    return { sessionId: request.sessionId, agentPreset: request.agentPreset };
  } } as never);
  ctx.provide('sessionPersistence', { stat: async () => ({ header: session!.header, revision: 1 }) } as never);
  ctx.provide('sessionQuery', {} as never);
  ctx.provide('workspaceRegistry', { list: () => [] } as never);
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p1c-auth-'));
  await ctx.plugin(NoWorkspace, { dshHome });
  route = routes.find((value) => value.path === '/no-workspace')!;
  cookie = browserCookie(ctx.connection as HostConnectionHandle, 'harness.example');
});

afterAll(async () => { await ctx?.fiber.dispose(); });

test('dedicated RPC channel rejects untrusted and unauthenticated requests before dispatch', async () => {
  const request: ClientRequest = {
    type: 'client-request', rpcId: Connection.RpcId('p1c-denied'), method: 'openChat', payload: {},
  };
  const forbidden = fakeResponse();
  await route.handler(fakeRequest({ host: 'other.example' }, '/no-workspace/openChat', request), forbidden.response);
  expect(forbidden.state).toMatchObject({ status: 403, body: 'forbidden' });
  const unauthorized = fakeResponse();
  await route.handler(fakeRequest({ host: 'harness.example' }, '/no-workspace/openChat', request), unauthorized.response);
  expect(unauthorized.state).toMatchObject({ status: 401, body: 'unauthorized' });
  expect(createCalls).toBe(0);
});

test('authenticated openChat rejects client-owned fields and accepts an empty payload', async () => {
  const rejected = fakeResponse();
  await route.handler(fakeRequest({ host: 'harness.example', cookie }, '/no-workspace/openChat', {
    type: 'client-request', rpcId: 'p1c-reject', method: 'openChat',
    payload: { cwd: 'C:\\escape', sessionId: 'chosen', agentPreset: 'standard' },
  }), rejected.response);
  expect(JSON.parse(rejected.state.body!)).toMatchObject({
    result: { ok: false, error: { code: 'gateway/bad-request' } },
  });
  expect(createCalls).toBe(0);

  const accepted = fakeResponse();
  await route.handler(fakeRequest({ host: 'harness.example', cookie }, '/no-workspace/openChat', {
    type: 'client-request', rpcId: 'p1c-open', method: 'openChat', payload: {},
  }), accepted.response);
  expect(JSON.parse(accepted.state.body!)).toMatchObject({
    result: { ok: true, value: { ok: true, sessionId: expect.stringMatching(/^session-/) } },
  });
  expect(createCalls).toBe(1);
});

test('legacy raw HTTP write shape is not an RPC envelope and cannot dispatch', async () => {
  const response = fakeResponse();
  await route.handler(fakeRequest({ host: 'harness.example', cookie }, '/no-workspace/create', {}), response.response);
  expect(JSON.parse(response.state.body!)).toMatchObject({
    result: { ok: false, error: { code: 'gateway/bad-request' } },
  });
  expect(createCalls).toBe(1);
});
