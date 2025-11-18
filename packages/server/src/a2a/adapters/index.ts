/**
 * A2A Protocol Adapters
 *
 * Server-layer adapters for converting between A2A protocol format
 * and Dexto's internal representation.
 */

export { TaskView, createTaskView } from './task-view.js';
export { a2aToInternalMessage, internalToA2AMessage, internalMessagesToA2A } from './message.js';
export { deriveTaskState, deriveTaskStateFromA2A } from './state.js';
