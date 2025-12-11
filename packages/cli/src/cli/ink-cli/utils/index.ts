/**
 * Utils module exports
 */

// Input parsing
export {
    type AutocompleteType,
    detectAutocompleteType,
    extractSlashQuery,
    extractResourceQuery,
    findActiveAtIndex,
} from './inputParsing.js';

// Command overlays (central registry)
export {
    getCommandOverlay,
    getCommandOverlayForSelect,
    getAutoDetectOverlay,
    getProtectedOverlays,
    isInteractiveCommand,
} from './commandOverlays.js';

// Message formatting
export {
    createUserMessage,
    createSystemMessage,
    createErrorMessage,
    createToolMessage,
    createStreamingMessage,
    convertHistoryToUIMessages,
    getStartupInfo,
} from './messageFormatting.js';

// ID generation
export { generateMessageId } from './idGenerator.js';
