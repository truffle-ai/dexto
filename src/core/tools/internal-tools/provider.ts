import { ToolExecutionContext, ToolSet, InternalTool } from '../types.js';
import { ToolConfirmationProvider } from '../confirmation/types.js';
import { logger } from '../../logger/index.js';
import { ToolError } from '../errors.js';
import { convertZodSchemaToJsonSchema } from '../../utils/schema.js';
import { InternalToolsServices, KnownInternalTool, getInternalToolInfo } from './registry.js';
import type { InternalToolsConfig } from '../schemas.js';

/**
 * Provider for built-in internal tools that are part of the core system
 *
 * This provider manages internal tools that are shipped with the core system
 * and need access to core services like SearchService, SessionManager, etc.
 *
 * Benefits:
 * - Clean separation: ToolManager doesn't need to know about specific services
 * - Easy to extend: Just add new tools and services as needed
 * - Lightweight: Direct tool management without complex infrastructure
 * - No unnecessary ProcessedInternalTool wrapper - uses InternalTool directly
 */
export class InternalToolsProvider {
    private services: InternalToolsServices;
    private tools: Map<string, InternalTool> = new Map(); // ← Store original InternalTool
    private confirmationProvider: ToolConfirmationProvider;
    private config: InternalToolsConfig;

    constructor(
        services: InternalToolsServices,
        confirmationProvider: ToolConfirmationProvider,
        config: InternalToolsConfig = []
    ) {
        this.services = services;
        this.confirmationProvider = confirmationProvider;
        this.config = config;
        logger.debug('InternalToolsProvider initialized with config:', config);
    }

    /**
     * Initialize the internal tools provider by registering all available internal tools
     */
    async initialize(): Promise<void> {
        logger.info('Initializing InternalToolsProvider...');

        try {
            // Check if any internal tools are enabled
            if (this.config.length === 0) {
                logger.info('No internal tools enabled by configuration');
                return;
            }

            this.registerInternalTools();

            const toolCount = this.tools.size;
            logger.info(`InternalToolsProvider initialized with ${toolCount} internal tools`);
        } catch (error) {
            logger.error(
                `Failed to initialize InternalToolsProvider: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Register all available internal tools based on available services and configuration
     */
    private registerInternalTools(): void {
        for (const toolName of this.config) {
            const toolInfo = getInternalToolInfo(toolName);

            // Check if all required services are available
            const missingServices = toolInfo.requiredServices.filter(
                (serviceKey) => !this.services[serviceKey]
            );

            if (missingServices.length > 0) {
                logger.debug(
                    `Skipping ${toolName} internal tool - missing services: ${missingServices.join(', ')}`
                );
                continue;
            }

            try {
                // Create the tool using its factory and store directly
                const tool = toolInfo.factory(this.services);
                this.tools.set(toolName, tool); // ← Store original InternalTool directly
                logger.debug(`Registered ${toolName} internal tool`);
            } catch (error) {
                logger.error(
                    `Failed to register ${toolName} internal tool: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    /**
     * Check if a specific tool is enabled by configuration
     */
    private isToolEnabled(toolName: KnownInternalTool): boolean {
        return this.config.includes(toolName);
    }

    /**
     * Check if a tool exists
     */
    hasTool(toolName: string): boolean {
        return this.tools.has(toolName);
    }

    /**
     * Execute an internal tool - confirmation is handled by ToolManager
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<unknown> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            logger.error(`❌ No internal tool found: ${toolName}`);
            logger.debug(`Available internal tools: ${Array.from(this.tools.keys()).join(', ')}`);
            throw ToolError.notFound(toolName);
        }

        try {
            const context: ToolExecutionContext = { sessionId };
            const result = await tool.execute(args, context);
            return result;
        } catch (error) {
            logger.error(`❌ Internal tool execution failed: ${toolName}`, error);
            throw error;
        }
    }

    /**
     * Get all tools in ToolSet format with on-demand JSON Schema conversion
     */
    getAllTools(): ToolSet {
        const toolSet: ToolSet = {};

        for (const [name, tool] of this.tools) {
            toolSet[name] = {
                name: tool.id,
                description: tool.description,
                parameters: convertZodSchemaToJsonSchema(tool.inputSchema), // ← Convert on-demand
            };
        }

        return toolSet;
    }

    /**
     * Get tool names
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        return this.tools.size;
    }
}
