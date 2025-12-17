/**
 * Command execution service
 * Handles command parsing and execution
 */

import type { DextoAgent } from '@dexto/core';
import { parseInput } from '../utils/inputParsing.js';
import { executeCommand } from '../../commands/interactive-commands/commands.js';
import type { CommandResult } from '../../commands/interactive-commands/command-parser.js';
import type { StyledMessageType, StyledData } from '../state/types.js';

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
}

/**
 * Create a send message marker (used by prompt commands)
 */
export function createSendMessageMarker(text: string): SendMessageMarker {
    return { __sendMessage: true, text };
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
        agent: DextoAgent,
        sessionId?: string
    ): Promise<CommandExecutionResult> {
        const result = await executeCommand(command, args, agent, sessionId);

        // If result is a send message marker, return the text to send through normal flow
        if (isSendMessageMarker(result)) {
            return { type: 'sendMessage' as const, messageToSend: result.text };
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
