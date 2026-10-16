import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Driver } from './driver.mjs';
import { DSH_HOME, readWorkspaceStore, restoreDshHome, snapshotDshHome, startDsh, startEdge } from './env.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const scratch = path.join(root, 'scratch', 'e2e-current');
const workspacePath = path.join(scratch, 'workspace');
const workspaceStorePath = path.join(DSH_HOME, 'storages', 'workspace.json');
const sessionsRoot = path.join(DSH_HOME, 'sessions');
const workspaceId = 'dsh-no-workspace-e2e';
const workspaceTitle = 'DSH No Workspace E2E';

function sessionDirectoryCount() {
  if (!fs.existsSync(sessionsRoot)) return 0;
  let count = 0;
  for (const bucket of fs.readdirSync(sessionsRoot)) {
    const bucketPath = path.join(sessionsRoot, bucket);
    if (!fs.statSync(bucketPath).isDirectory()) continue;
    count += fs.readdirSync(bucketPath).filter((name) => fs.statSync(path.join(bucketPath, name)).isDirectory()).length;
  }
  return count;
}

function seedWorkspace() {
  fs.mkdirSync(workspacePath, { recursive: true });
  const next = structuredClone(readWorkspaceStore());
  const now = new Date().toISOString();
  next.global.workspaceIds = [workspaceId, ...next.global.workspaceIds.filter((id) => id !== workspaceId)];
  next.tables.workspaces[workspaceId] = {
    path: workspacePath,
    title: workspaceTitle,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(workspaceStorePath, JSON.stringify(next, null, 2) + '\n');
}

function workspaceRecord() {
  return readWorkspaceStore().tables.workspaces[workspaceId];
}

async function exactButtonVisible(driver, text) {
  return driver.eval(`[...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && (b.innerText || '').trim() === ${JSON.stringify(text)})`);
}

async function noWorkspaceLabel(driver) {
  return await exactButtonVisible(driver, '无工作区') ? '无工作区' : 'No Workspace';
}

const snapshot = snapshotDshHome();
let server;
let edge;
let driver;

try {
  seedWorkspace();
  server = await startDsh({ port: 5611, profile: 'desktop', logDir: path.join(scratch, 'logs') });
  edge = await startEdge({ debugPort: 9223, profileDir: path.join(scratch, 'edge-profile'), appOrigin: server.url });
  driver = await Driver.attach({ debugPort: 9223, appOrigin: server.url, shotDir: path.join(scratch, 'shots') });
  await driver.reload({ settleMs: 7000 });
  if (await exactButtonVisible(driver, 'Continue')) await driver.clickText('button', 'Continue');
  else if (await exactButtonVisible(driver, '继续')) await driver.clickText('button', '继续');

  await driver.waitFor(`document.querySelector('[data-composer-input]') && [...document.querySelectorAll('button')].some((b) => /新会话|New Session/.test(b.innerText || ''))`, { timeoutMs: 30000, label: 'app shell' });
  assert.equal(await driver.eval(`document.querySelector('.dsh-nw-root') === null`), true, 'native sidebar remains mounted');

  const newSession = await driver.boxWithText('button', '新会话') || await driver.boxWithText('button', 'New Session');
  assert.ok(newSession, 'native New Session button is visible');
  await driver.clickAt(newSession.x, newSession.y);
  await driver.waitFor(`(() => {
    const textarea = document.querySelector('[data-composer-input]');
    return Boolean(textarea && textarea.isContentEditable && document.querySelector('button[data-dsh-nw-chip]'));
  })()`, { timeoutMs: 30000, label: 'standalone composer unlocked' });

  const composer = await driver.eval(`(() => {
    const textarea = document.querySelector('[data-composer-input]');
    const model = [...document.querySelectorAll('button')].find((b) => /选择模型|Select model/.test(b.innerText || ''));
    return {
      readOnly: !textarea.isContentEditable,
      disabled: textarea.getAttribute('aria-disabled') === 'true',
      placeholder: textarea.getAttribute('data-placeholder'),
      modelDisabled: model ? model.disabled : null,
    };
  })()`);
  assert.equal(composer.readOnly, false);
  assert.equal(composer.disabled, false);
  assert.equal(/workspace|工作区/i.test(composer.placeholder), false);
  assert.notEqual(composer.modelDisabled, true, 'model selector is unlocked');

  const chipLayout = await driver.eval(`(() => {
    const chip = document.querySelector('button[data-dsh-nw-chip]');
    const label = chip && chip.querySelector(':scope > span');
    const glyphs = chip ? [...chip.querySelectorAll(':scope > svg')].filter((svg) => getComputedStyle(svg).display !== 'none') : [];
    const chevron = glyphs[glyphs.length - 1];
    return {
      label: label ? (label.innerText || label.textContent || '').trim() : '',
      labelVisible: Boolean(label && getComputedStyle(label).display !== 'none'),
      labelLeft: label ? label.getBoundingClientRect().left : null,
      chevronLeft: chevron ? chevron.getBoundingClientRect().left : null,
    };
  })()`);
  assert.match(chipLayout.label, /无工作区|No Workspace/);
  assert.equal(chipLayout.labelVisible, true, 'native workspace label remains visible');
  assert.ok(chipLayout.chevronLeft > chipLayout.labelLeft, 'chevron follows the label');

  await driver.typeInto('[data-composer-input]', 'E2E-DRAFT');
  assert.equal(await driver.eval(`document.querySelector('[data-composer-input]').innerText.trim()`), 'E2E-DRAFT');

  await driver.click('button[data-dsh-nw-chip]');
  await driver.waitFor(`Boolean(document.querySelector('button[data-dsh-nw-picker-item]'))`, { label: 'native picker extension' });
  const pickerIcon = await driver.eval(`(() => {
    const item = document.querySelector('button[data-dsh-nw-picker-item]');
    const iconSeat = item && item.querySelector(':scope > span:first-child');
    const nativeIcon = iconSeat && iconSeat.querySelector('svg');
    return {
      nativeIconHidden: Boolean(nativeIcon && getComputedStyle(nativeIcon).display === 'none'),
      replacementMask: iconSeat ? getComputedStyle(iconSeat, '::before').webkitMaskImage : '',
    };
  })()`);
  assert.equal(pickerIcon.nativeIconHidden, true, 'picker native folder icon is hidden');
  assert.match(pickerIcon.replacementMask, /svg|data:image/, 'picker uses the folder-off mask');
  const pickerText = await driver.eval(`document.body.innerText`);
  assert.match(pickerText, /无工作区|No Workspace/);
  assert.match(pickerText, /添加工作区|Add Workspace/);
  assert.match(pickerText, new RegExp(workspaceTitle));

  await driver.pressKey('Escape');
  await driver.waitFor(`![...document.querySelectorAll('button:not([data-dsh-nw-chip])')].some((b) => b.offsetParent !== null && ['无工作区', 'No Workspace'].includes((b.innerText || '').trim()))`, { label: 'Escape dismissal' });
  await driver.click('button[data-dsh-nw-chip]');
  await driver.waitFor(`[...document.querySelectorAll('button')].some((b) => ['无工作区', 'No Workspace'].includes((b.innerText || '').trim()))`);
  await driver.clickAt(1200, 120);
  await driver.waitFor(`![...document.querySelectorAll('button:not([data-dsh-nw-chip])')].some((b) => b.offsetParent !== null && ['无工作区', 'No Workspace'].includes((b.innerText || '').trim()))`, { label: 'outside-click dismissal' });

  const beforeCheckedPick = sessionDirectoryCount();
  await driver.click('button[data-dsh-nw-chip]');
  await driver.clickText('button', await noWorkspaceLabel(driver));
  await driver.sleep(1200);
  assert.equal(sessionDirectoryCount(), beforeCheckedPick, 'checked No Workspace does not leak a session');

  await driver.click('button[data-dsh-nw-chip]');
  await driver.clickText('button', workspaceTitle);
  await driver.waitFor(`(() => {
    const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => (b.innerText || '').includes(${JSON.stringify(workspaceTitle)}));
    return chip && !chip.hasAttribute('data-dsh-nw-chip');
  })()`, { timeoutMs: 30000, label: 'workspace selection' });
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.trim() === 'E2E-DRAFT'`, { label: 'draft transfer' });
  assert.equal(workspaceRecord().sessionIds.length, 1, 'workspace owns connected session');

  const realChip = await driver.boxWithText('button[aria-haspopup="menu"]', workspaceTitle);
  assert.ok(realChip);
  await driver.clickAt(realChip.x, realChip.y);
  await driver.clickText('button', await noWorkspaceLabel(driver));
  await driver.waitFor(`Boolean(document.querySelector('button[data-dsh-nw-chip]') && document.querySelector('[data-composer-input]').isContentEditable)`, { timeoutMs: 30000, label: 'detach' });
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.trim() === 'E2E-DRAFT'`, { label: 'draft retained after detach' });
  assert.equal(workspaceRecord().sessionIds.length, 0, 'detached session leaves workspace index');

  const nativeChrome = await driver.eval(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const has = (pattern) => buttons.some((b) => pattern.test([b.innerText, b.title, b.getAttribute('aria-label')].filter(Boolean).join(' ')));
    return {
      viewOptions: has(/视图选项|View options/),
      addWorkspace: has(/添加工作区|Add Workspace/),
      customMenus: document.querySelectorAll('.dsh-nw-menu').length,
    };
  })()`);
  assert.equal(nativeChrome.viewOptions, true, 'native View Options remains available');
  assert.equal(nativeChrome.addWorkspace, true, 'native Add Workspace remains available');
  assert.equal(nativeChrome.customMenus, 0, 'no custom menu reimplementation is mounted');
  const standaloneSidebar = await driver.eval(`(() => {
    const section = document.querySelector('[data-dsh-nw-ungrouped]');
    const header = section && section.querySelector(':scope > [role="treeitem"][aria-expanded]');
    const sessions = section ? [...section.querySelectorAll('[role="treeitem"][aria-selected]')] : [];
    return {
      bucketPresent: Boolean(section),
      bucketHidden: Boolean(header && getComputedStyle(header).display === 'none'),
      visibleSessions: sessions.filter((row) => row.offsetParent !== null).length,
    };
  })()`);
  assert.equal(standaloneSidebar.bucketPresent, true, 'native ungrouped account remains structurally available');
  assert.equal(standaloneSidebar.bucketHidden, true, 'Ungrouped folder row is hidden');
  assert.ok(standaloneSidebar.visibleSessions > 0, 'standalone sessions render directly');

  await driver.sleep(5000);
  assert.deepEqual(driver.appErrors(), [], 'no application or slot errors');
  const screenshot = await driver.shot('verified');
  console.log(JSON.stringify({ ok: true, composer, chipLayout, pickerIcon, nativeChrome, standaloneSidebar, screenshot }, null, 2));
} finally {
  if (driver) driver.close();
  if (edge) edge.stop();
  if (server) server.stop();
  restoreDshHome(snapshot);
}
