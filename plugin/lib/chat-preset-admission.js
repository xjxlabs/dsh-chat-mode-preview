import { assertControlledChatDirectory, CHAT_PRESET_ID } from './chat-runtime.js';

export const name = 'no-workspace-chat-preset-admission';
export const inject = ['agentPresets'];

export const CHAT_PRESET_DENIAL = 'Chat Sessions cannot change agent preset.';

/** Keep a Session that is already Chat on the trusted Chat composition. */
export function admitChatPreset(admission) {
  const isChat = admission.currentPreset === CHAT_PRESET_ID
    || admission.session.header.agentPreset === CHAT_PRESET_ID;
  return isChat && admission.targetPreset !== CHAT_PRESET_ID
    ? CHAT_PRESET_DENIAL
    : undefined;
}

export function apply(ctx) {
  ctx.agentPresets.guard(admitChatPreset);
}

/** Refuse Chat composition when its durable cwd is not the controlled directory. */
export function applyChatCwdAdmission(ctx, policy) {
  ctx.agentPresets.guard((admission) => {
    if (admission.targetPreset !== CHAT_PRESET_ID) return undefined;
    try {
      assertControlledChatDirectory(ctx, policy, admission.session);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}
