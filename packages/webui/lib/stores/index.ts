/**
 * Store Exports
 *
 * Central export point for all Zustand stores.
 * Import stores from here rather than individual files.
 */

// Chat store - per-session message state
export { useChatStore, generateMessageId } from './chatStore.js';
export type { Message, ErrorMessage, SessionChatState } from './chatStore.js';

// Session store - current session navigation state
export { useSessionStore } from './sessionStore.js';
export type { SessionState } from './sessionStore.js';

// Agent store - agent status and connection state
export { useAgentStore } from './agentStore.js';
export type { AgentStatus, ConnectionStatus, AgentState } from './agentStore.js';

// Notification store - toast notifications
export { useNotificationStore } from './notificationStore.js';
export type { Toast, ToastIntent } from './notificationStore.js';

// Event log store - activity logging for debugging
export { useEventLogStore } from './eventLogStore.js';
export type { ActivityEvent, EventCategory } from './eventLogStore.js';

// Approval store - approval request queue management
export { useApprovalStore } from './approvalStore.js';
export type { PendingApproval } from './approvalStore.js';

// Preference store - user preferences with localStorage persistence
export { usePreferenceStore } from './preferenceStore.js';
export type { PreferenceState } from './preferenceStore.js';

// Todo store - agent task tracking
export { useTodoStore } from './todoStore.js';
export type { Todo, TodoStatus } from './todoStore.js';

// Selectors - shared selector hooks for common patterns
export {
    // Constants
    EMPTY_MESSAGES,
    // Session selectors
    useCurrentSessionId,
    useIsWelcomeState,
    useIsSessionOperationPending,
    useIsReplayingHistory,
    // Chat selectors
    useSessionMessages,
    useStreamingMessage,
    useAllMessages,
    useSessionProcessing,
    useSessionError,
    useSessionLoadingHistory,
    // Agent selectors
    useCurrentToolName,
    useAgentStatus,
    useConnectionStatus,
    useIsAgentBusy,
    useIsAgentConnected,
    useAgentActiveSession,
    // Combined selectors
    useSessionChatState,
    useAgentState,
} from './selectors.js';
