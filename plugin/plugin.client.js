// dsh-plugin-no-workspace — client half.
//
// Keep DSH's native components mounted. Wrapping the existing slot entries in
// place preserves their children, stores, actions, locale, and directory flow.

const RPC_CHANNEL = '/no-workspace';
const CHAT_PRESET_ID = 'no-workspace-chat';
const NO_WORKSPACE_ID = '::dsh-no-workspace';
const WRAPPED = Symbol.for('dsh-plugin-no-workspace.wrapped');

let _pluginCtx = null;
let _modeTail = Promise.resolve();
const _modeActions = new Map();

const CSS = `
/* M1 presentation only: retain the native width axis, scrollports and font-size preference. */
body:has(.dsh-m11-mode) { font-family:var(--dsw-font-family); }
body:has(.dsh-m11-mode) [data-conversation-workspace-controls] { height:0; min-height:0; margin:0; padding:0; position:relative; }
body:has(.dsh-m11-mode) [data-conversation-workspace-controls] > button { visibility:hidden; position:absolute; pointer-events:none; }
body:has(.dsh-m11-mode) [data-agent-preset="standard"], body:has(.dsh-m11-mode) [data-agent-preset="no-workspace-chat"] { display:none; }
.dsh-m11-composer { min-width:0; width:100%; }
.dsh-m11-context { box-sizing:border-box; width:calc(100% - 64px); max-width:var(--dsh-chat-content-width); margin:0 auto 10px; display:flex; align-items:baseline; gap:6px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh-m11-context span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* The native composer fade may expose transcript text behind this extra status row. */
.dsh-m11-context { background:var(--dsw-alias-bg-base); }
.dsh-m11-context strong { flex:none; font-weight:400; }
.dsh-m11-context [data-workspace-name] { color:var(--dsw-alias-label-secondary); }
.dsh-m11-composer [data-composer-card] { padding-top:14px; border-radius:20px; }
.dsh-m11-mode { flex:none; }
.dsh-m11-mode > button { border:0; border-radius:8px; min-height:32px; padding:6px 10px; background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); font:500 13px/20px var(--dsw-font-family); cursor:pointer; }
.dsh-m11-mode > button:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-m11-mode button:focus-visible, .dsh-m11-dialog select:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:3px; }
.dsh-m11-dialog { box-sizing:border-box; width:min(420px, calc(100vw - 32px)); padding:24px; border:0; box-shadow:var(--dsw-elevation-prominent); border-radius:20px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font:14px/22px var(--dsw-font-family); }
.dsh-m11-dialog::backdrop { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-m11-dialog h2 { margin:0 0 16px; font-size:18px; line-height:26px; font-weight:600; }
.dsh-m11-dialog button, .dsh-m11-dialog select { font:inherit; color:inherit; background:var(--dsw-alias-bg-base); border:.5px solid var(--dsw-alias-border-l2); border-radius:10px; padding:10px 12px; }
.dsh-m11-dialog button { cursor:pointer; }
.dsh-m11-dialog button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-m11-dialog button:disabled { opacity:.5; cursor:default; }
.dsh-m11-dialog select, .dsh-m11-choice { display:block; width:100%; margin:8px 0; }
.dsh-m11-dialog p { font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
.dsh-m11-dialog footer { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.dsh-m11-dialog [role="alert"] { color:var(--dsw-alias-label-primary); border-left:3px solid var(--dsw-alias-state-business-primary); padding-left:8px; }
[data-dsh-m1-chat] button[aria-label^="访问模式"], [data-dsh-m1-chat] button[aria-label^="Access mode"] { display:none; }
:root {
  --dsh-nw-folder-off-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v1z'/%3E%3Cpath d='M3 3l18 18'/%3E%3C/svg%3E");
}
button[data-dsh-nw-chip] > svg:first-of-type { display: none; }
button[data-dsh-nw-chip]::before {
  content: '';
  flex: none;
  width: 16px;
  height: 16px;
  opacity: 0.9;
  background-color: currentColor;
  -webkit-mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
  mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
}

/* DSH's native picker renders every item as a Workspace folder. Restyle only
   the synthetic No Workspace row so it matches the trigger semantics. */
button[data-dsh-nw-picker-item] > span:first-child > svg { display: none; }
button[data-dsh-nw-picker-item] > span:first-child::before {
  content: '';
  display: block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
  mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
}

/* Keep DSH's native browser and session rows, but remove the redundant
   Ungrouped project-row wrapper around standalone conversations. */
[data-dsh-nw-ungrouped] > [role='treeitem'][aria-expanded] { display: none; }

/* With the project row gone, the leading status slot is pure indentation, and
   it lines standalone rows up under the Workspace above them as if they were
   its children. Drop the slot when it is empty, exactly as DSH's own flat list
   does, so the rows sit outside the folder hierarchy. Rows that are running
   keep their slot: the status dots there are content, not indentation. */
[data-dsh-nw-ungrouped] [role='treeitem'][aria-selected] > span:first-child:empty { display: none; }
[data-dsh-nw-ungrouped] [role='treeitem'][aria-selected] > span:first-child:empty + span { margin-left: 0; }

/* DSH pads its "show N more" button to clear the same slot. Pull it back by
   the slot's width plus the title gap so it stays on the rows' new margin. */
[data-dsh-nw-ungrouped] > button[aria-expanded] { padding-left: 8px; }
`;

function getLocale() {
  try {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch (_) {
    return 'en';
  }
}

function sessionListSnapshot() {
  const source = _pluginCtx && _pluginCtx.sessions && _pluginCtx.sessions.list;
  if (!source) return { ids: [], byId: {}, current: undefined };
  if (typeof source.getSnapshot === 'function') return source.getSnapshot();
  return source.snapshot || source;
}

function workspaceListSnapshot() {
  const source = _pluginCtx && _pluginCtx.workspaces && _pluginCtx.workspaces.list;
  if (!source) return { items: [], archivedSessionIds: [] };
  if (typeof source.getSnapshot === 'function') return source.getSnapshot();
  return source.snapshot || source;
}

function openSession(sessionId) {
  if (sessionId && _pluginCtx && _pluginCtx.sessions && typeof _pluginCtx.sessions.open === 'function') {
    _pluginCtx.sessions.open(sessionId);
  }
}

async function rpcCall(endpoint, payload) {
  const rpc = _pluginCtx && _pluginCtx.connection && _pluginCtx.connection.rpc;
  if (!rpc || typeof rpc.call !== 'function') throw new Error('Authenticated Connection RPC is unavailable.');
  const result = await rpc.call(RPC_CHANNEL, endpoint, payload);
  if (!result || result.ok !== true) {
    const failure = result && result.error;
    const error = new Error(failure && failure.message ? failure.message : 'No Workspace RPC failed.');
    if (failure && failure.code) error.code = failure.code;
    throw error;
  }
  return result.value;
}

function navigateMode(key, action) {
  if (_modeActions.has(key)) return _modeActions.get(key);
  const attempt = _modeTail.then(action).finally(function () { _modeActions.delete(key); });
  _modeActions.set(key, attempt);
  // A rejected gesture must not prevent a later explicit gesture.
  _modeTail = attempt.catch(function () {});
  return attempt;
}

function reusableStandaloneBlank() {
  const sessions = sessionListSnapshot();
  const workspaces = workspaceListSnapshot();
  const attached = new Set();
  (workspaces.items || []).forEach(function (workspace) {
    (workspace.sessionIds || []).forEach(function (id) { attached.add(id); });
  });
  const archived = new Set(workspaces.archivedSessionIds || []);
  return (sessions.ids || []).find(function (id) {
    const summary = sessions.byId && sessions.byId[id];
    return summary && summary.blank && !summary.running && summary.origin !== 'subagent'
      && summary.projectionValues && summary.projectionValues.agentPreset === CHAT_PRESET_ID
      && !attached.has(id) && !archived.has(id);
  });
}

function openStandaloneSession() {
  return navigateMode('chat', async function () {
    const reusable = reusableStandaloneBlank();
    if (reusable) { openSession(reusable); return reusable; }
    const result = await rpcCall('openChat', {});
    await _pluginCtx.sessions.refresh();
    openSession(result.sessionId);
    return result.sessionId;
  });
}

function openCodingSession(workspaceId) {
  return navigateMode('coding:' + workspaceId, async function () {
    const workspaces = workspaceListSnapshot();
    const workspace = (workspaces.items || []).find(w => w.workspaceId === workspaceId);
    if (!workspace) throw new Error(uiText('missingWorkspace'));
    const sessions = sessionListSnapshot();
    const archived = new Set(workspaces.archivedSessionIds || []);
    const reusable = (sessions.ids || []).find(function (id) {
      const summary = sessions.byId && sessions.byId[id];
      return summary && summary.blank && !summary.running && summary.origin !== 'subagent'
        && summary.projectionValues && summary.projectionValues.agentPreset === 'standard'
        && summary.cwd === workspace.path && (workspace.sessionIds || []).includes(id)
        && !archived.has(id);
    });
    if (reusable) { openSession(reusable); return reusable; }
    const result = await _pluginCtx.connection.rpc.call('/api', 'session/create', {
      args: { request: { workspaceId: workspaceId, agentPreset: 'standard' } },
    });
    if (!result || !result.ok) throw new Error(result && result.error ? result.error.message : uiText('createFailed'));
    await _pluginCtx.sessions.refresh();
    openSession(result.value.sessionId);
    return result.value.sessionId;
  });
}

async function selectNoWorkspace(props) {
  if (props.onClose) props.onClose();
  await openStandaloneSession();
}

const syntheticSnapshots = new WeakMap();
function syntheticWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const cached = syntheticSnapshots.get(snapshot);
  if (cached) return cached;
  const synthetic = {
    workspaceId: NO_WORKSPACE_ID,
    title: getLocale() === 'zh' ? '\u65e0\u5de5\u4f5c\u533a' : 'No Workspace',
    path: '',
    sessionIds: [],
  };
  const transformed = Object.assign({}, snapshot, {
    items: [synthetic].concat((snapshot.items || []).filter(function (item) {
      return item && item.workspaceId !== NO_WORKSPACE_ID;
    })),
  });
  syntheticSnapshots.set(snapshot, transformed);
  return transformed;
}

function wrapComposerEntry(entry) {
  if (!entry || entry[WRAPPED]) return function () {};
  const NativeComposer = entry.component;
  function StandaloneComposer(props) {
    const sessions = props.useSessions(s => s);
    const workspaces = props.useWorkspaces(s => s);
    const summary = sessions.byId && sessions.byId[props.sessionId];
    const preset = summary && summary.projectionValues && summary.projectionValues.agentPreset;
    const chat = preset === CHAT_PRESET_ID;
    const nativeProps = chat && !props.blocked ? Object.assign({}, props, {
      // Only the known Chat preset bypasses the workspace prerequisite.
      // InputBar still owns model, connection, removed-session and approval guards.
      disabled: false, workspacePickerOpen: false, onRequestWorkspace: undefined,
      placeholder: uiText('placeholder'),
    }) : !props.sessionId ? Object.assign({}, props, { placeholder:uiText('startHint') }) : props;
    const workspace = (workspaces.items || []).find(w => (w.sessionIds || []).includes(props.sessionId));
    const context = workspace ? workspace.title || workspace.path.split(/[\\/]/).filter(Boolean).pop()
      : chat || !props.sessionId ? uiText('noWorkspaceNeeded') : uiText('unassigned');
    return React.createElement('div', { className:'dsh-m11-composer', 'data-dsh-m1-chat': chat ? '' : undefined },
      React.createElement('div', { className:'dsh-m11-context', 'data-testid':'m11-context' },
        workspace ? React.createElement('strong', null, uiText('belongsTo')) : null,
        React.createElement('span', { title:context, 'data-workspace-name':workspace ? '' : undefined }, context)),
      React.createElement(NativeComposer, nativeProps));
  }
  StandaloneComposer.displayName = 'NoWorkspaceComposer(' + (NativeComposer.displayName || NativeComposer.name || 'Native') + ')';
  entry.component = StandaloneComposer;
  entry[WRAPPED] = { kind: 'composer', original: NativeComposer };
  return function () {
    if (entry.component === StandaloneComposer) entry.component = NativeComposer;
    delete entry[WRAPPED];
  };
}

const MODE_COPY = {
  zh: {
    entry: '会话模式', title: '选择会话模式', chat: '打开 Chat 会话', coding: '打开 Coding 会话…',
    chatHint: '普通对话与 Web Search，无需工作区。',
    switchHint: '打开新的或已有空白会话；当前会话、历史和草稿保持不变。',
    workspace: '选择 Coding 工作区', choose: '请选择工作区', open: '打开 Coding', cancel: '取消', back: '返回',
    noWorkspace: '暂无工作区，请使用侧边栏的“添加工作区”。',
    missingWorkspace: '工作区已不可用，请重新选择。', createFailed: '创建会话失败。',
    other: '其他模式', loading: '加载中', placeholder: '发消息，开始聊天…',
    belongsTo:'工作区 ·', noWorkspaceNeeded:'无需工作区', unassigned:'未关联工作区',
    startHint:'通过左下角 Chat / Coding 入口开始新会话',
  },
  en: {
    entry: 'Session mode', title: 'Choose session mode', chat: 'Open Chat session', coding: 'Open Coding session…',
    chatHint: 'Conversation and Web Search. No workspace required.',
    switchHint: 'Open a new or existing blank session. Keep the current session, history and draft unchanged.',
    workspace: 'Choose Coding workspace', choose: 'Choose workspace', open: 'Open Coding', cancel: 'Cancel', back: 'Back',
    noWorkspace: 'No workspaces. Use Add workspace in the sidebar.',
    missingWorkspace: 'Workspace is unavailable. Choose another workspace.', createFailed: 'Session creation failed.',
    other: 'Other mode', loading: 'Loading', placeholder: 'Send a message to start chatting…',
    belongsTo:'Workspace ·', noWorkspaceNeeded:'No workspace required', unassigned:'No workspace assigned',
    startHint:'Start a session from Chat / Coding below',
  },
};
function uiText(key) { return MODE_COPY[getLocale()][key]; }

function SessionModeControl(props) {
  const sessions = props.useSessions(s => s);
  const workspaces = props.useWorkspaces(s => s);
  const summary = sessions.byId && sessions.byId[props.sessionId];
  const preset = summary && summary.projectionValues && summary.projectionValues.agentPreset;
  const label = !props.sessionId || preset === CHAT_PRESET_ID ? 'Chat'
    : preset === 'standard' ? 'Coding' : preset ? uiText('other') : uiText('loading');
  const dialog = React.useRef(null);
  const [step, setStep] = React.useState('mode');
  const [workspaceId, setWorkspaceId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const items = workspaces.items || [];
  const selected = items.find(w => w.workspaceId === workspaceId);
  async function perform(action) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); if (dialog.current && dialog.current.open) dialog.current.close(); }
    catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(false); }
  }
  function open() {
    setStep('mode'); setWorkspaceId(''); setError('');
    dialog.current.showModal();
  }
  return React.createElement('div', { className: 'dsh-m11-mode', onClick: event => event.stopPropagation() },
    React.createElement('button', { type: 'button', 'aria-label': uiText('entry'), 'aria-haspopup': 'dialog',
      'data-testid': 'm11-mode', 'data-session-id': props.sessionId || '', 'data-preset': preset || '',
      onClick: open }, label + ' ▾'),
    React.createElement('dialog', { ref: dialog, className: 'dsh-m11-dialog', 'aria-label': uiText('title'),
      onCancel: event => { if (busy) event.preventDefault(); } },
      React.createElement('h2', null, uiText(step === 'mode' ? 'title' : 'workspace')),
      React.createElement('p', null, uiText('switchHint')),
      step === 'mode' ? React.createElement(React.Fragment, null,
        React.createElement('button', { type: 'button', className: 'dsh-m11-choice', disabled: busy,
          onClick: () => perform(props.openChat) }, uiText('chat')),
        React.createElement('p', null, uiText('chatHint')),
        React.createElement('button', { type: 'button', className: 'dsh-m11-choice', disabled: busy,
          onClick: () => setStep('workspace') }, uiText('coding')))
        : React.createElement(React.Fragment, null,
          React.createElement('select', { 'aria-label': uiText('workspace'), value: workspaceId, disabled: busy,
            onChange: event => { setWorkspaceId(event.target.value); setError(''); } },
            React.createElement('option', { value: '' }, uiText('choose')),
            items.map(w => React.createElement('option', { key: w.workspaceId, value: w.workspaceId }, w.title))),
          selected ? React.createElement('p', null, selected.path) : null,
          items.length === 0 ? React.createElement('p', null, uiText('noWorkspace')) : null),
      error ? React.createElement('p', { role: 'alert' }, error) : null,
      React.createElement('footer', null,
        step === 'workspace' ? React.createElement('button', { type: 'button', disabled: busy,
          onClick: () => { setStep('mode'); setError(''); } }, uiText('back')) : null,
        React.createElement('button', { type: 'button', disabled: busy, onClick: () => dialog.current.close() }, uiText('cancel')),
        step === 'workspace' ? React.createElement('button', { type: 'button', disabled: busy || !selected,
          onClick: () => perform(() => props.openCoding(workspaceId)) }, uiText('open')) : null)));
}

function wrapWorkspacePickerEntry(entry) {
  if (!entry || entry[WRAPPED]) return function () {};
  const NativePicker = entry.component;
  function NoWorkspacePicker(props) {
    const nativeUseWorkspaces = props.useWorkspaces;
    function useWorkspaces(selector, equality) {
      return nativeUseWorkspaces(function (snapshot) {
        return selector(syntheticWorkspaceSnapshot(snapshot));
      }, equality);
    }
    return React.createElement(NativePicker, Object.assign({}, props, {
      useWorkspaces: useWorkspaces,
      selectedId: props.selectedId || NO_WORKSPACE_ID,
      onPick: function (workspaceId) {
        if (workspaceId === NO_WORKSPACE_ID) {
          selectNoWorkspace(props).catch(function (error) {
            console.error('no-workspace selection failed:', error);
          });
          return;
        }
        if (props.onClose) props.onClose();
        openCodingSession(workspaceId).catch(function (error) { console.error('coding selection failed:', error); });
      },
    }));
  }
  NoWorkspacePicker.displayName = 'NoWorkspacePicker(' + (NativePicker.displayName || NativePicker.name || 'Native') + ')';
  entry.component = NoWorkspacePicker;
  entry[WRAPPED] = { kind: 'picker', original: NativePicker };
  return function () {
    if (entry.component === NoWorkspacePicker) entry.component = NativePicker;
    delete entry[WRAPPED];
  };
}

function wrapSidebarEntry(entry) {
  if (!entry || entry[WRAPPED]) return function () {};
  const nativeInject = entry.inject;
  if (typeof nativeInject !== 'function') return function () {};
  function standaloneInject() {
    const injected = nativeInject.apply(this, arguments);
    return Object.assign({}, injected, {
      startSession: function (workspaceId) {
        const action = workspaceId === undefined ? openStandaloneSession() : openCodingSession(workspaceId);
        return action.catch(function (error) {
          console.error('standalone session creation failed:', error);
        });
      },
    });
  }
  entry.inject = standaloneInject;
  entry[WRAPPED] = { kind: 'sidebar', original: nativeInject };
  return function () {
    if (entry.inject === standaloneInject) entry.inject = nativeInject;
    delete entry[WRAPPED];
  };
}

function patchNativeEntry(ctx, slotName, patch) {
  const restorers = new Map();
  function reconcile() {
    const entries = ctx.slots.entries(slotName) || [];
    entries.forEach(function (entry) {
      if ((entry.options.priority || 0) !== 0 || restorers.has(entry)) return;
      restorers.set(entry, patch(entry));
    });
  }
  reconcile();
  const unsubscribe = ctx.slots.subscribe(slotName, reconcile);
  return function () {
    if (typeof unsubscribe === 'function') unsubscribe();
    restorers.forEach(function (restore) { restore(); });
    restorers.clear();
  };
}

function markNoWorkspaceUi() {
  if (typeof document === 'undefined') return function () {};
  let queued = false;
  function update() {
    queued = false;
    document.querySelectorAll('button[aria-haspopup="menu"]').forEach(function (button) {
      const label = button.querySelector('span');
      const text = label ? (label.textContent || '').trim() : '';
      const placeholder = text === '\u9009\u62e9\u5de5\u4f5c\u533a' || text === 'Choose workspace'
        || text === '\u65e0\u5de5\u4f5c\u533a' || text === 'No Workspace';
      if (placeholder) {
        const wanted = getLocale() === 'zh' ? '\u65e0\u5de5\u4f5c\u533a' : 'No Workspace';
        // Updating the text node is safe; unlike replacing the glyph element,
        // it does not restructure React's child tree. Keeping this native span
        // also preserves DSH's icon -> label -> chevron flex order.
        if (label.textContent !== wanted) label.textContent = wanted;
        if (!button.hasAttribute('data-dsh-nw-chip')) button.setAttribute('data-dsh-nw-chip', '');
        button.setAttribute('aria-label', wanted);
      } else if (button.hasAttribute('data-dsh-nw-chip')) {
        button.removeAttribute('data-dsh-nw-chip');
      }
    });

    // The picker does not expose item ids in its DOM. Mark the one row with our
    // exact localized label; attributes and CSS avoid replacing React nodes.
    document.querySelectorAll('button[role="menuitem"]').forEach(function (button) {
      const text = (button.innerText || button.textContent || '').trim();
      const noWorkspace = text === '\u65e0\u5de5\u4f5c\u533a' || text === 'No Workspace';
      if (noWorkspace) button.setAttribute('data-dsh-nw-picker-item', '');
      else if (button.hasAttribute('data-dsh-nw-picker-item')) button.removeAttribute('data-dsh-nw-picker-item');
    });

    // Ungrouped is an implementation bucket, not a user-facing Workspace.
    // Keep it expanded so its native SessionNodeItems remain mounted, then hide
    // only the project header through CSS. Real Workspace groups are untouched.
    document.querySelectorAll('[role="treeitem"][aria-expanded]').forEach(function (row) {
      const text = (row.innerText || row.textContent || '').trim();
      const ungrouped = text === '\u672a\u5206\u7ec4' || text === 'Ungrouped';
      const section = row.parentElement;
      if (!section) return;
      if (ungrouped) {
        section.setAttribute('data-dsh-nw-ungrouped', '');
        if (row.getAttribute('aria-expanded') === 'false' && !row.hasAttribute('data-dsh-nw-expanding')) {
          row.setAttribute('data-dsh-nw-expanding', '');
          row.click();
        }
      } else if (section.hasAttribute('data-dsh-nw-ungrouped')) {
        section.removeAttribute('data-dsh-nw-ungrouped');
      }
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  update();
  return function () { observer.disconnect(); };
}

return {
  inject: ['slots', 'sessions', 'workspaces', 'connection'],
  apply: function (ctx) {
    _pluginCtx = ctx;
    const disposers = [styles.insert(CSS), markNoWorkspaceUi()];

    disposers.push(ctx.slots.inject('conversation.input.mode', function () {
      return ctx.slots.register({ name: 'conversation.input.mode',
        inject: function () { return { openChat: openStandaloneSession, openCoding: openCodingSession }; },
      }, SessionModeControl);
    }));
    // M1 modes navigate to another Session; the native preset picker would mutate a blank Session.
    disposers.push(ctx.slots.inject('conversation.hero.agentPreset', function () {
      return ctx.slots.register({ name: 'conversation.hero.agentPreset', priority: -10 }, function () { return null; });
    }));

    ctx.slots.inject('sidebar', function () {
      const dispose = patchNativeEntry(ctx, 'sidebar', wrapSidebarEntry);
      disposers.push(dispose);
      return dispose;
    });
    ctx.slots.inject('conversation.composer.bar', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.composer.bar', wrapComposerEntry);
      disposers.push(dispose);
      return dispose;
    });
    ctx.slots.inject('conversation.hero.workspace', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.hero.workspace', wrapWorkspacePickerEntry);
      disposers.push(dispose);
      return dispose;
    });

    return function () {
      disposers.splice(0).reverse().forEach(function (dispose) {
        if (typeof dispose === 'function') dispose();
      });
      if (_pluginCtx === ctx) _pluginCtx = null;
    };
  },
};
