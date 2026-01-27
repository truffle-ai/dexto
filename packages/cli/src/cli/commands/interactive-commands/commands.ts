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
 * - Plugin Commands: Claude Code plugin management
 * - System Commands: Configuration, logging, and statistics
 * - Tool Commands: Tool listing and management
 * - Prompt Commands: System prompt management
 * - Documentation Commands: Help and documentation access
 *
 * This file serves as the integration layer that combines all modular commands
 * into a single CLI_COMMANDS array for the command execution system.
 */

import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult } from './command-parser.js';
import { isDextoAuthEnabled } from '@dexto/agent-management';

// Import modular command definitions
import { generalCommands, createHelpCommand } from './general-commands.js';
import { searchCommand, resumeCommand, renameCommand } from './session/index.js';
import { exportCommand } from './export/index.js';
import { modelCommands } from './model/index.js';
import { mcpCommands } from './mcp/index.js';
import { pluginCommands } from './plugin/index.js';
import { systemCommands } from './system/index.js';
import { toolCommands } from './tool-commands.js';
import { promptCommands } from './prompt-commands.js';
import { documentationCommands } from './documentation-commands.js';
import { loginCommand } from './auth/index.js';

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
// All commands here use interactive overlays - no text-based subcommands
const baseCommands: CommandDefinition[] = [
    // General commands (without help)
    ...generalCommands,

    // Session management
    searchCommand, // /search - opens search overlay
    resumeCommand, // /resume - opens session selector overlay
    renameCommand, // /rename <title> - rename current session
    exportCommand, // /export - opens export wizard overlay

    // Model management
    modelCommands, // /model - opens model selector overlay

    // MCP server management
    mcpCommands, // /mcp - opens MCP server list overlay

    // Plugin management
    pluginCommands, // /plugin - manage Claude Code compatible plugins

    // Tool management commands
    ...toolCommands,

    // Prompt management commands
    ...promptCommands,

    // System commands
    ...systemCommands,

    // Documentation commands
    ...documentationCommands,

    // Auth commands (feature-flagged)
    ...(isDextoAuthEnabled() ? [loginCommand] : []),
];

// Add help command that can see all commands
CLI_COMMANDS.push(createHelpCommand(() => CLI_COMMANDS));

// Add all other commands
CLI_COMMANDS.push(...baseCommands);

/**
 * Execute a slash command
 *
 * @param sessionId - Session ID to use for agent.run() calls
 * @returns CommandHandlerResult - boolean, string, or StyledOutput
 */
export async function executeCommand(
    command: string,
    args: string[],
    agent: DextoAgent,
    sessionId?: string
): Promise<CommandHandlerResult> {
    // Create command context with sessionId
    const ctx = { sessionId: sessionId ?? null };

    // Find the command (including aliases)
    const cmd = CLI_COMMANDS.find(
        (c) => c.name === command || (c.aliases && c.aliases.includes(command))
    );

    if (cmd) {
        try {
            // Execute the handler with context
            const result = await cmd.handler(args, agent, ctx);
            // If handler returns a string, it's formatted output for ink-cli
            // If it returns boolean, it's the old behavior (handled or not)
            return result;
        } catch (error) {
            const errorMsg = `❌ Error executing command /${command}:\n${error instanceof Error ? error.message : String(error)}`;
            agent.logger.error(
                `Error executing command /${command}: ${error instanceof Error ? error.message : String(error)}`
            );
            return errorMsg; // Return for ink-cli
        }
    }

    // Command not found in static commands - check if it's a dynamic prompt command
    // Dynamic commands use displayName (e.g., "quick-start" instead of "config:quick-start")
    try {
        // Import prompt command creation dynamically to avoid circular dependencies
        const { getDynamicPromptCommands } = await import('./prompt-commands.js');
        const dynamicCommands = await getDynamicPromptCommands(agent);
        // Commands are registered by displayName, so search by command name directly
        const promptCmd = dynamicCommands.find((c) => c.name === command);

        if (promptCmd) {
            try {
                const result = await promptCmd.handler(args, agent, ctx);
                // Return the result directly - can be string, boolean, StyledOutput, or SendMessageMarker
                return result;
            } catch (error) {
                const errorMsg = `❌ Error executing prompt /${command}:\n${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(
                    `Error executing prompt /${command}: ${error instanceof Error ? error.message : String(error)}`
                );
                return errorMsg;
            }
        }
    } catch (error) {
        // If loading dynamic commands fails, continue to unknown command error
        agent.logger.debug(
            `Failed to check dynamic commands for ${command}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Command not found and not a prompt
    const errorMsg = `❌ Unknown command: /${command}\nType / to see available commands, /prompts to add new ones`;
    return errorMsg; // Return for ink-cli
}

/**
 * Get all available command definitions
 * This is used by external systems that need to inspect available commands
 */
export function getAllCommands(): CommandDefinition[] {
    return CLI_COMMANDS;
}
