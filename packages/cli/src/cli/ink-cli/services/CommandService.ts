/**
 * Command execution service
 * Handles command parsing and execution
 */

import type { DextoAgent } from '@dexto/core';
import { parseInput } from '../utils/inputParsing.js';
import { executeCommand } from '../../commands/interactive-commands/commands.js';
import type { CommandResult } from '../../commands/interactive-commands/command-parser.js';

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
    type: 'handled' | 'prompt' | 'output';
    output?: string;
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
        agent: DextoAgent
    ): Promise<CommandExecutionResult> {
        const result = await executeCommand(command, args, agent);

        // If result is empty string, it means a prompt was executed via agent.run()
        if (typeof result === 'string' && result === '') {
            return { type: 'prompt' };
        }

        // If result is a non-empty string, it's output for display
        if (typeof result === 'string' && result.length > 0) {
            return { type: 'output', output: result };
        }

        // If result is boolean, command was handled
        return { type: 'handled' };
    }
}
