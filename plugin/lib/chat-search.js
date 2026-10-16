import {
  applyWebSearchTool,
  Config,
} from '@deepseek-ai/dsh-tool-web';
import { bindChatTools } from './chat-tools-policy.js';

export const name = 'no-workspace-chat-search';
export const inject = ['tools', 'web', 'systemPrompt', 'llm', 'agents'];
export { Config };

export function apply(ctx, config) {
  for (const key of ['searchMaxResults', 'searchMaxQueries', 'searchTimeoutMs']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) {
      throw new Error(`Chat search: ${key} must be a positive integer`);
    }
  }
  const registration = applyWebSearchTool(
    ctx, config.searchMaxResults, config.searchMaxQueries,
    config.searchTimeoutMs, false,
  );
  bindChatTools(ctx, registration);
}
