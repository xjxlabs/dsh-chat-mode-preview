import { fileURLToPath } from 'node:url';

export const CHAT_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url));
export const CHAT_PRESET_PATH = fileURLToPath(
  new URL('../presets/no-workspace-chat/agent.cordis.yml', import.meta.url),
);

export const name = 'no-workspace-preset-root';

export function apply(ctx) {
  ctx.provide('noWorkspacePresetRoot', Object.freeze({
    path: CHAT_PRESET_ROOT,
    chatPresetPath: CHAT_PRESET_PATH,
  }));
}
