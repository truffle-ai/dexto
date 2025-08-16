/**
 * Interactive Command Registry
 *
 * This module provides the foundation for organizing CLI commands into a registry structure.
 * This is part of the CLI refactoring plan to improve code organization and maintainability.
 *
 * Future phases will gradually migrate commands from commands.ts into this registry system.
 */

import type { DextoAgent } from '@core/index.js';

/**
 * Base interface for command handlers
 */
export interface CommandHandler {
    (args: string[], agent: DextoAgent): Promise<boolean>;
}

/**
 * Interface for command registration
 */
export interface InteractiveCommand {
    name: string;
    description: string;
    usage: string;
    category: string;
    aliases?: string[];
    handler: CommandHandler;
    subcommands?: InteractiveCommand[];
}

/**
 * Command registry to hold all interactive commands
 */
export class CommandRegistry {
    private commands: Map<string, InteractiveCommand> = new Map();
    private aliases: Map<string, string> = new Map();

    /**
     * Register a command in the registry
     */
    register(command: InteractiveCommand): void {
        this.commands.set(command.name, command);

        // Register aliases
        if (command.aliases) {
            for (const alias of command.aliases) {
                this.aliases.set(alias, command.name);
            }
        }
    }

    /**
     * Get a command by name or alias
     */
    get(nameOrAlias: string): InteractiveCommand | undefined {
        // Check direct name first
        const command = this.commands.get(nameOrAlias);
        if (command) {
            return command;
        }

        // Check aliases
        const mainName = this.aliases.get(nameOrAlias);
        if (mainName) {
            return this.commands.get(mainName);
        }

        return undefined;
    }

    /**
     * Get all registered commands
     */
    getAll(): InteractiveCommand[] {
        return Array.from(this.commands.values());
    }

    /**
     * Get commands by category
     */
    getByCategory(category: string): InteractiveCommand[] {
        return Array.from(this.commands.values()).filter((cmd) => cmd.category === category);
    }

    /**
     * Check if a command exists
     */
    has(nameOrAlias: string): boolean {
        return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
    }

    /**
     * Get all command names and aliases
     */
    getAllNames(): string[] {
        const names = Array.from(this.commands.keys());
        const aliasNames = Array.from(this.aliases.keys());
        return [...names, ...aliasNames];
    }
}

/**
 * Global command registry instance
 */
export const commandRegistry = new CommandRegistry();
