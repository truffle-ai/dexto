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
export { useKeypress } from './useKeypress.js';
export { useTerminalSize, type TerminalSize } from './useTerminalSize.js';
export { useGitBranch } from './useGitBranch.js';
export {
    useCLIState,
    type UseCLIStateProps,
    type CLIStateReturn,
    type UIState,
    type InputState,
    type SessionState,
} from './useCLIState.js';
export type { Key } from './useInputOrchestrator.js';
// useMouseScroll removed - mouse events now handled by MouseProvider/ScrollProvider
// useInputHistory removed - history navigation now handled by TextBufferInput
// useOverlayManager removed - overlay management now done via dispatch directly
// useSessionSync removed - sessionId now managed in state directly
