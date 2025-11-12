/**
 * Utils module exports
 */

// Input parsing
export {
    type AutocompleteType,
    type InteractiveSelectorType,
    detectAutocompleteType,
    detectInteractiveSelector,
    extractSlashQuery,
    extractResourceQuery,
    findActiveAtIndex,
} from './inputParsing.js';

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
