// packages/analytics/src/index.ts
// Shared analytics utilities for Dexto CLI and WebUI

export {
    DEFAULT_POSTHOG_KEY,
    DEFAULT_POSTHOG_HOST,
    COMMAND_TIMEOUT_MS,
    isAnalyticsDisabled,
} from './constants.js';
export { loadState, saveState } from './state.js';
export type { AnalyticsState } from './state.js';
export * from './events.js';
