export { startInkCliRefactored, type InkCLIOptions, InkCLIRefactored } from './InkCLIRefactored.js';
export {
    type TuiAgentBackend,
    type TuiAgentCapabilities,
    getTuiCapabilities,
    isCommandSupported,
    isCommandDefinitionSupported,
} from './agent-backend.js';

export { setTuiRuntimeServices, type TuiChatSync, type TuiRuntimeServices } from './host/index.js';
