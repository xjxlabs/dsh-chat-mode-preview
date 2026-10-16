import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Context } from '@deepseek-ai/cordis';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const expectedSlots = {
  'dsh-plugin-smooth-stream': ['conversation.chat.node', 'settings.section'],
  'dsh-plugin-no-workspace': ['sidebar', 'conversation.composer.bar', 'conversation.hero.workspace', 'conversation.hero.agentPreset', 'conversation.input.mode'],
  'dsh-plugin-rollout-scout': ['sidebar.footer.action', 'shell.overlay'],
};
const requiredModules = {
  slots: '@deepseek-ai/dsh-client-ui-slots',
  sessions: '@deepseek-ai/dsh-api-session-controller',
  workspaces: '@deepseek-ai/dsh-api-workspace-controller',
  connection: '@deepseek-ai/dsh-client-connection',
  locale: '@deepseek-ai/dsh-client-locale',
  modules: '@deepseek-ai/dsh-client-modules',
  timer: '@deepseek-ai/dsh-cordis-client-runner',
};

test('client waits for its declared DSH services and registers after they become available', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://qa.test/' });
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); dom.window.close(); });
  let plugin;
  const warnings = [];
  const window = dom.window;
  window.__ModuleLoader__ = { load({ id, factory }) {
    assert.equal(id, pkg.name);
    plugin = factory(name => name === 'react' ? React : name === 'react-dom' ? ReactDOM : {});
  } };
  runInNewContext(bundle, {
    window, document: window.document, navigator: window.navigator,
    MutationObserver: window.MutationObserver, queueMicrotask,
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args), log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  assert.ok(plugin.inject?.includes('slots'), 'Do not apply before slots are ready');
  const injected = [];
  const slots = {
    inject(name, register) { injected.push(name); return register(); },
    register: () => () => {}, entries: () => [], subscribe: () => () => {},
  };
  const services = {
    slots, sessions: { open() {}, list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {} }) } },
    workspaces: { list: { subscribe: () => () => {}, getSnapshot: () => ({ items: [] }) } },
    connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
    locale: {}, modules: {}, timer: {},
  };
  const fiber = ctx.plugin(plugin);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fiber.state, 0);
  assert.deepEqual(injected, []);
  for (const service of plugin.inject) {
    assert.ok(pkg.dsh.client.inject.includes(requiredModules[service]), `Missing provider module for ${service}`);
    ctx.provide(service, services[service]);
  }
  await fiber;
  assert.equal(fiber.state, 2, String(fiber.error ?? 'client did not start'));
  assert.deepEqual(injected.sort(), expectedSlots[pkg.name].sort());
  assert.equal(warnings.length, 0, 'Registration must not hide initialization errors');
});
