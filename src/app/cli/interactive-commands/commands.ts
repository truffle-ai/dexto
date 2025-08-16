/**
 * CLI Commands Module (Modular Version)
 *
 * This module aggregates all CLI commands from extracted modular components.
 * It maintains the same external interface as the original monolithic commands.ts
 * while using the new modular structure internally.
 *
 * The commands are organized into logical modules:
 * - General Commands: Basic CLI functionality (help, exit, clear)
 * - Conversation Commands: Session management, history, and search
 * - Model Commands: Model switching and configuration
 * - MCP Commands: MCP server management
 * - System Commands: Configuration, logging, and statistics
 * - Tool Commands: Tool listing and management
 * - Prompt Commands: System prompt management
 * - Documentation Commands: Help and documentation access
 *
 * This file serves as the integration layer that combines all modular commands
 * into a single CLI_COMMANDS array for the command execution system.
 */

import type { DextoAgent } from '@core/index.js';
import type { CommandDefinition } from './command-parser.js';

// Import modular command definitions
import { generalCommands, createHelpCommand } from './general-commands.js';
import { sessionCommands } from './session/index.js';
import { modelCommands } from './model/index.js';
import { mcpCommands } from './mcp/index.js';
import { systemCommands } from './system/index.js';
import { toolCommands } from './tool-commands.js';
import { promptCommands } from './prompt-commands.js';
import { documentationCommands } from './documentation-commands.js';

/**
 * Complete list of all available CLI commands.
 * This array combines commands from all extracted modules to maintain
 * the same interface as the original monolithic implementation.
 *
 * Commands are organized by category:
 * - General: help, exit, clear
 * - Session Management: session, history, search
 * - Model Management: model
 * - MCP Management: mcp
 * - Tool Management: tools
 * - Prompt Management: prompt
 * - System: log, config, stats
 * - Documentation: docs
 */
export const CLI_COMMANDS: CommandDefinition[] = [];

// Build the commands array with proper help command that can access all commands
const baseCommands: CommandDefinition[] = [
    // General commands (without help)
    ...generalCommands,

    // Session management commands
    ...sessionCommands,

    // Model management commands
    modelCommands,

    // MCP server management commands
    mcpCommands,

    // Tool management commands
    ...toolCommands,

    // Prompt management commands
    ...promptCommands,

    // System commands
    ...systemCommands,

    // Documentation commands
    ...documentationCommands,
];

// Add help command that can see all commands
CLI_COMMANDS.push(createHelpCommand(() => CLI_COMMANDS));

// Add all other commands
CLI_COMMANDS.push(...baseCommands);

/**
 * Execute a slash command
 *
 * This function maintains the exact same interface and behavior as the original
 * executeCommand function, providing backward compatibility while using the
 * new modular command structure.
 */
export async function executeCommand(
    command: string,
    args: string[],
    agent: DextoAgent
): Promise<boolean> {
    // Find the command (including aliases)
    const cmd = CLI_COMMANDS.find(
        (c) => c.name === command || (c.aliases && c.aliases.includes(command))
    );

    if (!cmd) {
        console.log(`❌ Unknown command: /${command}`);
        console.log('Type /help to see available commands');
        return true;
    }

    try {
        // Execute the handler with error handling
        return await cmd.handler(args, agent);
    } catch (error) {
        console.error(`❌ Error executing command /${command}:`);
        console.error(error instanceof Error ? error.message : String(error));
        return true;
    }
}

/**
 * Get all available command definitions
 * This is used by external systems that need to inspect available commands
 */
export function getAllCommands(): CommandDefinition[] {
    return CLI_COMMANDS;
}
