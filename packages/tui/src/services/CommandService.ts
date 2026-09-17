/**
 * Command execution service
 * Handles command parsing and execution
 */

import { parseInput } from '../utils/inputParsing.js';
import { executeCommand } from '../interactive-commands/commands.js';
import type { CommandResult } from '../interactive-commands/command-parser.js';
import type { StyledMessageType, StyledData } from '../state/types.js';
import type { TuiAgentBackend } from '../agent-backend.js';
import type { ContentPart } from '@dexto/core';

/**
 * Styled output for command execution
 */
export interface StyledOutput {
    styledType: StyledMessageType;
    styledData: StyledData;
    fallbackText: string; // Plain text fallback for logging/history
}

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
    type: 'handled' | 'output' | 'styled' | 'sendMessage';
    output?: string;
    styled?: StyledOutput;
    /** Message text to send through normal streaming flow (for prompt commands) */
    messageToSend?: string;
    /** Structured content to send instead of messageToSend when the command carries attachments */
    contentToSend?: ContentPart[];
}

/**
 * Check if a result is a styled output
 */
export function isStyledOutput(result: unknown): result is StyledOutput {
    return (
        typeof result === 'object' &&
        result !== null &&
        'styledType' in result &&
        'styledData' in result &&
        'fallbackText' in result
    );
}

/**
 * Marker object for commands that want to send a message through the normal stream flow
 */
export interface SendMessageMarker {
    __sendMessage: true;
    text: string;
    /** Structured content that takes precedence over text when present (keeps images/files) */
    content?: ContentPart[];
}

/**
 * Create a send message marker (used by prompt commands)
 */
export function createSendMessageMarker(text: string): SendMessageMarker {
    return { __sendMessage: true, text };
}

/**
 * Create a send message marker carrying structured content (used when resuming queued input).
 * The text is a plain preview of the content for logging and fallback display.
 */
export function createSendContentMarker(content: ContentPart[]): SendMessageMarker {
    const text = content
        .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
    return { __sendMessage: true, text, content };
}

/**
 * Check if a result is a send message marker
 */
export function isSendMessageMarker(result: unknown): result is SendMessageMarker {
    return (
        typeof result === 'object' &&
        result !== null &&
        '__sendMessage' in result &&
        (result as SendMessageMarker).__sendMessage === true &&
        'text' in result &&
        typeof (result as SendMessageMarker).text === 'string'
    );
}

/**
 * Service for executing commands
 */
export class CommandService {
    /**
     * Parses input and determines if it's a command or prompt
     */
    parseInput(input: string): CommandResult {
        return parseInput(input);
    }

    /**
     * Executes a command and returns the result
     */
    async executeCommand(
        command: string,
        args: string[],
        agent: TuiAgentBackend,
        sessionId?: string,
        configFilePath?: string | null
    ): Promise<CommandExecutionResult> {
        const result = await executeCommand(command, args, agent, sessionId, configFilePath);

        // If result is a send message marker, return the text to send through normal flow
        if (isSendMessageMarker(result)) {
            return {
                type: 'sendMessage' as const,
                messageToSend: result.text,
                ...(result.content !== undefined && { contentToSend: result.content }),
            };
        }

        // If result is a string, it's output for display
        if (typeof result === 'string') {
            return { type: 'output', output: result };
        }

        // If result is a styled output object
        if (isStyledOutput(result)) {
            return { type: 'styled', styled: result };
        }

        // If result is boolean, command was handled
        return { type: 'handled' };
    }
}
