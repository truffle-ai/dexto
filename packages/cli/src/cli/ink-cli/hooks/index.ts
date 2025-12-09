/**
 * Custom hooks module exports
 */

export { useAgentEvents } from './useAgentEvents.js';
export { useKeyboardShortcuts } from './useKeyboardShortcuts.js';
export {
    useInputOrchestrator,
    createApprovalInputHandler,
    createSelectorInputHandler,
    createAutocompleteInputHandler,
    createMainInputHandler,
    type InputHandler,
    type InputHandlers,
    type UseInputOrchestratorProps,
    type ApprovalHandlerProps,
    type SelectorHandlerProps,
    type AutocompleteHandlerProps,
    type MainInputHandlerProps,
} from './useInputOrchestrator.js';
export { useMouseScroll, type UseMouseScrollOptions } from './useMouseScroll.js';
// useInputHistory removed - history navigation now handled by MultiLineTextInput
// useOverlayManager removed - overlay management now done via dispatch directly
// useSessionSync removed - sessionId now managed in state directly
