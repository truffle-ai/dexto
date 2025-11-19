/**
 * WebUI Approval Types
 *
 * These types represent approval events as they come over SSE.
 * They are derived from but separate from the core approval types,
 * as they represent the serialized payload format.
 *
 * TODO: Consolidate these types from core/typed payloads later
 */

import type { JSONSchema7 } from 'json-schema';

/**
 * Base approval event that all approval events extend
 */
type ApprovalEventBase = {
    approvalId: string;
    timestamp: string; // ISO 8601 format from SSE
    sessionId?: string;
    metadata: Record<string, unknown>;
};

/**
 * Tool confirmation approval event
 */
export type ToolConfirmationEvent = ApprovalEventBase & {
    type: 'tool_confirmation';
    toolName: string;
    args: Record<string, unknown>;
    description?: string;
};

/**
 * Command confirmation approval event
 * For approving dangerous commands within an already-approved tool
 */
export type CommandConfirmationEvent = ApprovalEventBase & {
    type: 'command_confirmation';
    toolName: string;
    command: string;
    originalCommand?: string;
};

/**
 * Elicitation approval event (form-based input request)
 */
export type ElicitationEvent = ApprovalEventBase & {
    type: 'elicitation';
};

/**
 * Union of all approval event types with proper discriminated union
 */
export type ApprovalEvent = ToolConfirmationEvent | CommandConfirmationEvent | ElicitationEvent;

/**
 * Elicitation metadata from approval event
 * Used when approval.type === 'elicitation'
 */
export interface ElicitationMetadata {
    schema: JSONSchema7;
    prompt: string;
    serverName: string;
    context?: Record<string, unknown>;
}

/**
 * Type guard to check if event is a tool confirmation
 */
export function isToolConfirmationEvent(event: ApprovalEvent): event is ToolConfirmationEvent {
    return event.type === 'tool_confirmation';
}

/**
 * Type guard to check if event is a command confirmation
 */
export function isCommandConfirmationEvent(
    event: ApprovalEvent
): event is CommandConfirmationEvent {
    return event.type === 'command_confirmation';
}

/**
 * Type guard to check if event is an elicitation
 */
export function isElicitationEvent(event: ApprovalEvent): event is ElicitationEvent {
    return event.type === 'elicitation';
}

/**
 * Get elicitation metadata from approval event
 * Safely extracts and validates elicitation metadata
 */
export function getElicitationMetadata(event: ElicitationEvent): ElicitationMetadata | null {
    if (!event.metadata || typeof event.metadata !== 'object') {
        return null;
    }

    const metadata = event.metadata as Partial<ElicitationMetadata>;

    if (!metadata.schema || !metadata.prompt || !metadata.serverName) {
        return null;
    }

    return metadata as ElicitationMetadata;
}
