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
    type: 'handled' | 'prompt' | 'output' | 'styled';
    output?: string;
    styled?: StyledOutput;
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

        // If result is empty string, it means a prompt was executed via agent.generate()
        if (typeof result === 'string' && result === '') {
            return { type: 'prompt' };
        }

        // If result is a non-empty string, it's output for display
        if (typeof result === 'string' && result.length > 0) {
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
