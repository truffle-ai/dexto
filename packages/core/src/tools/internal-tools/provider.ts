import { ToolExecutionContext, ToolSet, InternalTool } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { ToolError } from '../errors.js';
import { convertZodSchemaToJsonSchema } from '../../utils/schema.js';
import { InternalToolsServices, getInternalToolInfo, type AgentFeature } from './registry.js';
import type { PromptManager } from '../../prompts/prompt-manager.js';
import type { InternalToolsConfig } from '../schemas.js';

/**
 * Provider for built-in internal tools
 *
 * This provider manages:
 * 1. Built-in internal tools that are shipped with the core system
 *
 * Benefits:
 * - Clean separation: ToolManager doesn't need to know about specific services
 * - Easy to extend: Just add new tools and services as needed
 * - Lightweight: Direct tool management without complex infrastructure
 * - No unnecessary ProcessedInternalTool wrapper - uses InternalTool directly
 */
type ToolServices = InternalToolsServices & Record<string, unknown>;

export class InternalToolsProvider {
    private services: ToolServices;
    private internalTools: Map<string, InternalTool> = new Map(); // Built-in internal tools
    private config: InternalToolsConfig;
    private logger: IDextoLogger;

    constructor(services: ToolServices, config: InternalToolsConfig = [], logger: IDextoLogger) {
        this.services = services;
        this.config = config;
        this.logger = logger;
        this.logger.debug('InternalToolsProvider initialized with config:', {
            config,
        });
    }

    /**
     * Set prompt manager after construction (avoids circular dependency)
     * Must be called before initialize() if invoke_skill tool is enabled
     */
    setPromptManager(promptManager: PromptManager): void {
        this.services.promptManager = promptManager;
    }

    /**
     * Set task forker for context:fork skill execution (late-binding)
     * Called by agent-spawner custom tool provider after RuntimeService is created.
     * This enables invoke_skill to fork execution to an isolated subagent.
     */
    setTaskForker(taskForker: import('./registry.js').TaskForker): void {
        this.services.taskForker = taskForker;
    }

    /**
     * Initialize the internal tools provider by registering all available internal tools
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing InternalToolsProvider...');

        try {
            // Register built-in internal tools
            if (this.config.length > 0) {
                this.registerInternalTools();
            } else {
                this.logger.info('No internal tools enabled by configuration');
            }

            const internalCount = this.internalTools.size;
            this.logger.info(
                `InternalToolsProvider initialized with ${internalCount} internal tool(s)`
            );
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
                this.internalTools.set(toolName, tool); // Store in internal tools map
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
        return this.internalTools.has(toolName);
    }

    /**
     * Check if an internal tool exists
     */
    hasInternalTool(toolName: string): boolean {
        return this.internalTools.has(toolName);
    }

    /**
     * Get an internal tool by name
     * Returns undefined if tool doesn't exist
     */
    getTool(toolName: string): InternalTool | undefined {
        return this.internalTools.get(toolName);
    }

    /**
     * Execute an internal tool - confirmation is handled by ToolManager
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string,
        abortSignal?: AbortSignal,
        toolCallId?: string
    ): Promise<unknown> {
        const tool = this.internalTools.get(toolName);
        if (!tool) {
            this.logger.error(`❌ No tool found: ${toolName}`);
            this.logger.debug(
                `Available internal tools: ${Array.from(this.internalTools.keys()).join(', ')}`
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
            const context: ToolExecutionContext = {
                sessionId,
                abortSignal,
                toolCallId,
            };
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
     * Get internal tools in ToolSet format
     */
    getInternalTools(): ToolSet {
        const toolSet: ToolSet = {};

        for (const [name, tool] of this.internalTools) {
            toolSet[name] = {
                name: tool.id,
                description: tool.description,
                parameters: convertZodSchemaToJsonSchema(tool.inputSchema, this.logger),
            };
        }

        return toolSet;
    }

    /**
     * Get internal tool names
     */
    getInternalToolNames(): string[] {
        return Array.from(this.internalTools.keys());
    }

    /**
     * Get all tool names
     */
    getToolNames(): string[] {
        return [...this.internalTools.keys()];
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        return this.internalTools.size;
    }

    /**
     * Get internal tool count
     */
    getInternalToolCount(): number {
        return this.internalTools.size;
    }
}
