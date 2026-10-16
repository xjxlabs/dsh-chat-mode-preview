import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function harness(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://qa.test/' });
  let plugin;
  const requests = [];
  const opened = [];
  const registrations = new Map();
  let fail = false;
  let sessionSnapshot = { current: 'selected', ids: ['selected'], byId: {} };
  let workspaceSnapshot = { items: [] };
  const listeners = new Set();
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(() => React); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver, queueMicrotask, console, setTimeout, clearTimeout,
  });
  const entry = { options: { priority: 0 }, component: function NativePicker() {} };
  const sidebarEntry = { options: { priority: 0 }, inject: () => ({ startSession() {} }) };
  const composerEntry = { options:{priority:0}, component:function NativeComposer(){return React.createElement('section',{'data-native-composer':''});} };
  const ctx = {
    sessions: { list: { getSnapshot: () => sessionSnapshot, subscribe }, open: id => opened.push(id), refresh: async () => {} },
    workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe } },
    connection: { rpc: { async call(channel, endpoint, payload) {
      requests.push({ channel, endpoint, payload });
      if (fail) { fail = false; return { ok: false, error: { message: 'creation refused' } }; }
      return { ok: true, value: endpoint === 'openChat'
        ? { sessionId: 'created-chat' }
        : { sessionId: 'created-coding', agentPreset: 'standard' } };
    } } },
    slots: { inject(_name, register) { register(); },
      register(options, component) { registrations.set(options.name, {options, component}); return () => registrations.delete(options.name); },
      entries: name => name === 'conversation.hero.workspace' ? [entry]
        : name === 'sidebar' ? [sidebarEntry] : name === 'conversation.composer.bar' ? [composerEntry] : [], subscribe: () => () => {} },
  };
  const dispose = plugin.apply(ctx);
  t.after(() => { dispose(); dom.window.close(); });
  return {
    requests, opened, listeners, registrations,
    pick(id) { entry.component({ useWorkspaces: select => select(workspaceSnapshot), onPick() {}, onClose() {} }).props.onPick(id); },
    startNoWorkspace() { return sidebarEntry.inject().startSession(); },
    startWorkspace(id) { return sidebarEntry.inject().startSession(id); },
    modeActions() { return registrations.get('conversation.input.mode').options.inject(); },
    composer(id, overrides={}) { return composerEntry.component({sessionId:id,useSessions:select=>select(sessionSnapshot),useWorkspaces:select=>select(workspaceSnapshot),...overrides}); },
    modeLabel(id) { const entry=registrations.get('conversation.input.mode');return renderToStaticMarkup(React.createElement(entry.component, {sessionId:id,useSessions:select=>select(sessionSnapshot),useWorkspaces:select=>select(workspaceSnapshot),...entry.options.inject()})); },
    failNext() { fail=true; },
    update(sessions, workspaces) {
      if (sessions) sessionSnapshot = sessions;
      if (workspaces) workspaceSnapshot = workspaces;
      for (const fn of [...listeners]) fn();
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('new Chat uses parameter-free openChat RPC and does not reuse a Standard blank', async t => {
  const h = harness(t);
  h.update({ current: 'standard-blank', ids: ['standard-blank'], byId: {
    'standard-blank': { blank: true, projectionValues: { agentPreset: 'standard' } },
  } }, null);
  await h.startNoWorkspace();
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [
    { channel: '/no-workspace', endpoint: 'openChat', payload: {} },
  ]);
  assert.deepEqual(h.opened, ['created-chat']);
});

test('concurrent new Chat actions share one in-flight openChat request', async t => {
  const h = harness(t);
  h.update({ current: undefined, ids: [], byId: {} }, null);
  const ids = await Promise.all([
    h.startNoWorkspace(),
    h.startNoWorkspace(),
    h.startNoWorkspace(),
  ]);
  assert.deepEqual(ids, ['created-chat', 'created-chat', 'created-chat']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [
    { channel: '/no-workspace', endpoint: 'openChat', payload: {} },
  ]);
  assert.deepEqual(h.opened, ['created-chat']);
});

test('M1 No Workspace opens Chat without detaching or relabelling the current session', async t => {
  const h = harness(t);
  h.pick('::dsh-no-workspace');
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [
    { channel: '/no-workspace', endpoint: 'openChat', payload: {} },
  ]);
  assert.deepEqual(h.opened, ['created-chat']);
});

test('workspace and Chat gestures are serialized without detaching a Session', async t => {
  const h = harness(t);
  h.update(null, {items:[{workspaceId:'destination-workspace',path:'E:/demo',sessionIds:[]}]});
  h.pick('destination-workspace');
  h.pick('::dsh-no-workspace');
  await tick();
  assert.deepEqual(h.requests.map(r=>r.endpoint), ['session/create','openChat']);
  assert.deepEqual(h.opened, ['created-coding','created-chat']);
});

test('Coding reuses only a blank Standard in the chosen workspace and preserves draft-bearing sessions', async t => {
  const h=harness(t);
  const byId={
    chat:{blank:true,cwd:'E:/demo',projectionValues:{agentPreset:'no-workspace-chat'}},
    history:{blank:false,cwd:'E:/demo',projectionValues:{agentPreset:'standard'}},
    archived:{blank:true,cwd:'E:/demo',projectionValues:{agentPreset:'standard'}},
    other:{blank:true,cwd:'E:/elsewhere',projectionValues:{agentPreset:'standard'}},
    blank:{blank:true,cwd:'E:/demo',projectionValues:{agentPreset:'standard'},draft:'keep this'},
  };
  const original=JSON.stringify(byId);
  h.update({ids:Object.keys(byId),byId,current:'chat'}, {items:[{workspaceId:'w',path:'E:/demo',sessionIds:Object.keys(byId)}],archivedSessionIds:['archived']});
  await h.modeActions().openCoding('w');
  assert.deepEqual(h.opened,['blank']);assert.equal(h.requests.length,0);assert.equal(JSON.stringify(byId),original);
});

test('workspace new explicitly creates Standard and coalesces concurrent clicks', async t => {
  const h=harness(t);h.update(null,{items:[{workspaceId:'w',path:'E:/demo',sessionIds:[]}]});
  await Promise.all([h.startWorkspace('w'),h.startWorkspace('w')]);
  assert.equal(h.requests.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])),{channel:'/api',endpoint:'session/create',payload:{args:{request:{workspaceId:'w',agentPreset:'standard'}}}});
  assert.deepEqual(h.opened,['created-coding']);
});

test('Coding requires an existing workspace and a failed create leaves selection intact', async t => {
  const h=harness(t);
  await assert.rejects(h.modeActions().openCoding('missing'));
  assert.equal(h.requests.length,0);
  h.update(null,{items:[{workspaceId:'w',path:'E:/demo',sessionIds:[]}]});h.failNext();
  await assert.rejects(h.modeActions().openCoding('w'),/creation refused/);
  assert.equal(h.opened.length,0);
  await h.modeActions().openChat();assert.deepEqual(h.opened,['created-chat']);
});

test('labels use the real preset independently of workspace membership; no staged preset picker remains', async t => {
  const h=harness(t);
  h.update({ids:['coding','chat'],byId:{coding:{projectionValues:{agentPreset:'standard'}},chat:{projectionValues:{agentPreset:'no-workspace-chat'}}}}, {items:[{workspaceId:'w',sessionIds:['chat']}]});
  assert.match(h.modeLabel('coding'),/>Coding ▾</);
  assert.match(h.modeLabel('chat'),/>Chat ▾</);
  assert.match(h.modeLabel(undefined),/>Chat ▾</);
  assert.equal(h.registrations.get('conversation.hero.agentPreset').component(),null);
});

test('UI-B context is read-only and derives Workspace membership independently of Chat preset', t => {
  const h=harness(t);
  h.update({ids:['chat'],byId:{chat:{projectionValues:{agentPreset:'no-workspace-chat'}}}},
    {items:[{workspaceId:'w',title:'Research',path:'E:/Research',sessionIds:['chat']}]});
  const tree=h.composer('chat');
  const markup=renderToStaticMarkup(tree);
  assert.match(markup,/Workspace ·/);
  assert.match(markup,/Research/);
  assert.doesNotMatch(markup,/<button/);
  assert.match(h.modeLabel('chat'),/Chat ▾/);
  assert.equal(h.requests.length,0);
});

test('UI-B presentation preserves native Coding controls and reports detached membership accurately', t => {
  const h=harness(t);
  h.update({ids:['coding'],byId:{coding:{projectionValues:{agentPreset:'standard'}}}}, {items:[]});
  const callback=()=>{};
  const attachment={id:'image-1'};
  const tree=h.composer('coding',{disabled:true,onRequestWorkspace:callback,attachments:[attachment]});
  const native=tree.props.children[1];
  assert.equal(native.props.disabled,true);
  assert.equal(native.props.onRequestWorkspace,callback);
  assert.equal(native.props.attachments[0],attachment);
  assert.match(renderToStaticMarkup(tree),/No workspace assigned/);
  assert.match(h.modeLabel('coding'),/Coding ▾/);
  assert.equal(h.requests.length,0);
});

test('UI-B standalone Chat shows one read-only no-workspace status and preserves model/permission guards', t => {
  const h=harness(t);
  h.update({ids:['chat'],byId:{chat:{projectionValues:{agentPreset:'no-workspace-chat'}}}}, {items:[]});
  const blocked={reason:'approval required'};
  const tree=h.composer('chat',{blocked,disabled:true});
  assert.match(renderToStaticMarkup(tree),/No workspace required/);
  assert.equal(tree.props.children[1].props.blocked,blocked);
  assert.equal(tree.props.children[1].props.disabled,true);
  assert.equal(h.requests.length,0);
});
