// Minimal CDP driver for end-to-end runs against a live DSH instance.
//
// Owns one websocket for the whole run so console output, request interception
// and input all share a session. Everything is polling-based with explicit
// deadlines: DSH renders asynchronously and fixed sleeps make the suite flaky.

import fs from 'node:fs';
import path from 'node:path';

export class Driver {
  constructor({ debugPort, appOrigin, shotDir }) {
    this.debugPort = debugPort;
    this.appOrigin = appOrigin;
    this.shotDir = shotDir;
    this.logs = [];
    this._id = 0;
    this._pending = new Map();
    this._listeners = [];
  }

  static async attach(options) {
    const driver = new Driver(options);
    await driver._connect();
    return driver;
  }

  async _connect() {
    const targets = await (await fetch(`http://127.0.0.1:${this.debugPort}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page' && t.url.includes(this.appOrigin.replace(/^https?:\/\//, '')))
      ?? targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    if (!page) throw new Error('no attachable page target');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this._pending.has(message.id)) {
        const settle = this._pending.get(message.id);
        this._pending.delete(message.id);
        settle(message);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        this.logs.push(`[${message.params.type}] ${message.params.args.map((a) => String(a.value ?? a.description ?? '')).join(' ').slice(0, 400)}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.logs.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      }
      for (const listener of this._listeners) listener(message);
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onMessage(listener) { this._listeners.push(listener); }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  async reload({ settleMs = 6000 } = {}) {
    await this.send('Page.navigate', { url: this.appOrigin });
    await this.waitFor('document.readyState === "complete"', { timeoutMs: 20000 });
    await this.sleep(settleMs);
  }

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /** Poll `expression` until it evaluates truthy. Returns the truthy value. */
  async waitFor(expression, { timeoutMs = 15000, intervalMs = 250, label } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(`(() => { try { return (${expression}); } catch (e) { return undefined; } })()`);
        if (last) return last;
      } catch { /* transient navigation errors are expected while DSH re-renders */ }
      await this.sleep(intervalMs);
    }
    throw new Error(`waitFor timed out${label ? ` (${label})` : ''}: ${expression} — last value ${JSON.stringify(last)}`);
  }

  /** Bounding box of the first element matching `selector`, or null when absent/hidden. */
  box(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      let r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        r = el.getBoundingClientRect();
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, text: (el.innerText || '').trim().slice(0, 80) };
    })()`);
  }

  /** Bounding box of the first element matching `selector` whose text contains `text`. */
  boxWithText(selector, text) {
    return this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find((e) => (e.innerText || '').includes(${JSON.stringify(text)}));
      if (!el) return null;
      let r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        r = el.getBoundingClientRect();
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, text: (el.innerText || '').trim().slice(0, 80) };
    })()`);
  }

  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  async click(selector, { timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let target = null;
    while (Date.now() < deadline && !target) {
      target = await this.box(selector);
      if (!target) await this.sleep(200);
    }
    if (!target) throw new Error(`click: no visible element for ${selector}`);
    await this.clickAt(target.x, target.y);
    return target;
  }

  async clickText(selector, text, { timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let target = null;
    while (Date.now() < deadline && !target) {
      target = await this.boxWithText(selector, text);
      if (!target) await this.sleep(200);
    }
    if (!target) throw new Error(`clickText: no visible element for ${selector} containing ${JSON.stringify(text)}`);
    await this.clickAt(target.x, target.y);
    return target;
  }

  /** Hover a row first so its hover-only action buttons mount, then click one. */
  async hoverThenClick(hoverSelector, clickSelector) {
    const hover = await this.box(hoverSelector);
    if (!hover) throw new Error(`hoverThenClick: no element for ${hoverSelector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y });
    await this.sleep(400);
    return this.click(clickSelector);
  }

  async typeInto(selector, text) {
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await this.send('Input.insertText', { text });
  }

  async pressKey(key) {
    const keys = {
      Enter: { windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
      Escape: { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
    };
    const spec = keys[key];
    if (!spec) throw new Error(`pressKey: unsupported key ${key}`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
  }

  async shot(name) {
    fs.mkdirSync(this.shotDir, { recursive: true });
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(this.shotDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  /** Console errors that are ours, not the browser profile's extensions. */
  appErrors() {
    return this.logs.filter((line) => line.startsWith('[error]') || line.startsWith('[exception]'))
      .filter((line) => !/chrome-extension|grm ERROR|Iterable|DEFAULT root logger/.test(line));
  }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
