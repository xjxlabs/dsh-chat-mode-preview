export const CHAT_ALLOWED_TOOLS = Object.freeze(['web_search']);

// One runtime-issued registration controls both model schemas and execution.
// This helper never resolves a tool by name and never installs a waterfall.
export function bindChatTools(ctx, registration) {
  return ctx.tools.constrain([registration]);
}
