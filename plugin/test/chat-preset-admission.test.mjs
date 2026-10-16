import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHAT_PRESET_ID } from '../lib/chat-runtime.js';
import {
  CHAT_PRESET_DENIAL,
  admitChatPreset,
  apply,
} from '../lib/chat-preset-admission.js';

const admission = ({ currentPreset, headerPreset, targetPreset }) => ({
  operation: 'recompose',
  agent: {},
  session: { header: headerPreset === undefined ? {} : { agentPreset: headerPreset } },
  currentPreset,
  targetPreset,
});

describe('Chat preset admission', () => {
  it('locks both the live Chat composition and durable Chat header', () => {
    assert.equal(admitChatPreset(admission({
      currentPreset: CHAT_PRESET_ID,
      headerPreset: 'standard',
      targetPreset: 'standard',
    })), CHAT_PRESET_DENIAL);
    assert.equal(admitChatPreset(admission({
      headerPreset: CHAT_PRESET_ID,
      targetPreset: 'standard',
    })), CHAT_PRESET_DENIAL);
  });

  it('allows Chat to remain Chat and does not constrain Standard Sessions', () => {
    assert.equal(admitChatPreset(admission({
      currentPreset: CHAT_PRESET_ID,
      headerPreset: CHAT_PRESET_ID,
      targetPreset: CHAT_PRESET_ID,
    })), undefined);
    assert.equal(admitChatPreset(admission({
      currentPreset: 'standard',
      headerPreset: 'standard',
      targetPreset: 'minimal',
    })), undefined);
  });

  it('registers through the public AgentPresets guard', () => {
    let registered;
    apply({ agentPresets: { guard(guard) { registered = guard; } } });
    assert.equal(registered, admitChatPreset);
  });
});
