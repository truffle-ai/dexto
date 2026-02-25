export const ANTHROPIC_BETA_HEADER = 'anthropic-beta';

// Enables Claude 4 "interleaved thinking" where the model can emit thinking blocks
// between tool calls and after tool results (when thinking is enabled).
//
// This is used by reference implementations (pi-mono / opencode) as a default opt-in.
export const ANTHROPIC_INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
