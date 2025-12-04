import { ToolExecutionContext, ToolSet, InternalTool } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { ToolError } from '../errors.js';
import { convertZodSchemaToJsonSchema } from '../../utils/schema.js';
import { InternalToolsServices, getInternalToolInfo, type AgentFeature } from './registry.js';
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
    private config: InternalToolsConfig;
    private logger: IDextoLogger;

    constructor(
        services: InternalToolsServices,
        config: InternalToolsConfig = [],
        logger: IDextoLogger
    ) {
        this.services = services;
        this.config = config;
        this.logger = logger;
        this.logger.debug('InternalToolsProvider initialized with config:', { config });
    }

    /**
     * Initialize the internal tools provider by registering all available internal tools
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing InternalToolsProvider...');

        try {
            // Check if any internal tools are enabled
            if (this.config.length === 0) {
                this.logger.info('No internal tools enabled by configuration');
                return;
            }

            this.registerInternalTools();

            const toolCount = this.tools.size;
            this.logger.info(`InternalToolsProvider initialized with ${toolCount} internal tools`);
        } catch (error) {
            this.logger.error(
                `Failed to initialize InternalToolsProvider: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Register all available internal tools based on available services and configuration
     */
    private registerInternalTools(): void {
        // Build feature flags from services
        const featureFlags: Record<AgentFeature, boolean> = {
            elicitation: this.services.approvalManager?.getConfig().elicitation.enabled ?? false,
        };

        for (const toolName of this.config) {
            const toolInfo = getInternalToolInfo(toolName);

            // Check if all required services are available
            const missingServices = toolInfo.requiredServices.filter(
                (serviceKey) => !this.services[serviceKey]
            );

            if (missingServices.length > 0) {
                this.logger.debug(
                    `Skipping ${toolName} internal tool - missing services: ${missingServices.join(', ')}`
                );
                continue;
            }

            // Check if all required features are enabled - fail hard if not
            const missingFeatures = (toolInfo.requiredFeatures ?? []).filter(
                (feature) => !featureFlags[feature]
            );

            if (missingFeatures.length > 0) {
                throw ToolError.featureDisabled(
                    toolName,
                    missingFeatures,
                    `Tool '${toolName}' requires features which are currently disabled: ${missingFeatures.join(', ')}. ` +
                        `Either remove '${toolName}' from internalTools, or enable: ${missingFeatures.map((f) => `${f}.enabled: true`).join(', ')}`
                );
            }

            try {
                // Create the tool using its factory and store directly
                const tool = toolInfo.factory(this.services);
                this.tools.set(toolName, tool); // ← Store original InternalTool directly
                this.logger.debug(`Registered ${toolName} internal tool`);
            } catch (error) {
                this.logger.error(
                    `Failed to register ${toolName} internal tool: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
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
            this.logger.error(`❌ No internal tool found: ${toolName}`);
            this.logger.debug(
                `Available internal tools: ${Array.from(this.tools.keys()).join(', ')}`
            );
            throw ToolError.notFound(toolName);
        }

        // Validate input against tool's Zod schema
        const validationResult = tool.inputSchema.safeParse(args);
        if (!validationResult.success) {
            this.logger.error(
                `❌ Invalid arguments for tool ${toolName}: ${validationResult.error.message}`
            );
            throw ToolError.invalidName(
                toolName,
                `Invalid arguments: ${validationResult.error.message}`
            );
        }

        try {
            const context: ToolExecutionContext = { sessionId };
            const result = await tool.execute(validationResult.data, context);
            return result;
        } catch (error) {
            this.logger.error(`❌ Internal tool execution failed: ${toolName}`, {
                error: error instanceof Error ? error.message : String(error),
            });
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
                parameters: convertZodSchemaToJsonSchema(tool.inputSchema, this.logger), // ← Convert on-demand
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
