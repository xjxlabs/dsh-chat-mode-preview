import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindChatTools, CHAT_ALLOWED_TOOLS } from '../lib/chat-tools-policy.js';

test('Chat passes the exact runtime registration to one shared policy', () => {
  const registration = () => {};
  const dispose = () => {};
  const calls = [];
  const ctx = { tools: { constrain(value) { calls.push(value); return dispose; } } };
  assert.equal(bindChatTools(ctx, registration), dispose);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], registration);
  assert.deepEqual(CHAT_ALLOWED_TOOLS, ['web_search']);
});
