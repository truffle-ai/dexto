import { ToolExecutionContext, ToolSet, InternalTool } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import type { DextoAgent } from '../../agent/DextoAgent.js';
import { ToolError } from '../errors.js';
import { convertZodSchemaToJsonSchema } from '../../utils/schema.js';
import { InternalToolsServices, getInternalToolInfo, type AgentFeature } from './registry.js';
import type { PromptManager } from '../../prompts/prompt-manager.js';
import type { InternalToolsConfig, CustomToolsConfig } from '../schemas.js';
import { customToolRegistry, type ToolCreationContext } from '../custom-tool-registry.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ToolErrorCode } from '../error-codes.js';

/**
 * Provider for built-in internal tools and custom tool providers
 *
 * This provider manages:
 * 1. Built-in internal tools that are shipped with the core system
 * 2. Custom tools registered via the customToolRegistry
 *
 * Benefits:
 * - Clean separation: ToolManager doesn't need to know about specific services
 * - Easy to extend: Just add new tools and services as needed
 * - Lightweight: Direct tool management without complex infrastructure
 * - No unnecessary ProcessedInternalTool wrapper - uses InternalTool directly
 * - Custom tools follow the same provider pattern as blob storage
 */
type ToolServices = InternalToolsServices & Record<string, unknown>;

export class InternalToolsProvider {
    private services: ToolServices;
    private internalTools: Map<string, InternalTool> = new Map(); // Built-in internal tools
    private customTools: Map<string, InternalTool> = new Map(); // Custom tool provider tools
    private config: InternalToolsConfig;
    private customToolConfigs: CustomToolsConfig;
    private logger: IDextoLogger;
    private agent?: DextoAgent; // Set after construction to avoid circular dependency

    constructor(
        services: ToolServices,
        config: InternalToolsConfig = [],
        customToolConfigs: CustomToolsConfig = [],
        logger: IDextoLogger
    ) {
        this.services = services;
        this.config = config;
        this.customToolConfigs = customToolConfigs;
        this.logger = logger;
        this.logger.debug('InternalToolsProvider initialized with config:', {
            config,
            customToolConfigs,
        });
    }

    /**
     * Set agent reference after construction (avoids circular dependency)
     * Must be called before initialize() if custom tools need agent access
     */
    setAgent(agent: DextoAgent): void {
        this.agent = agent;
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
     * and custom tools from the registry
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

            // Register custom tools from registry
            if (this.customToolConfigs.length > 0) {
                this.registerCustomTools();
            } else {
                this.logger.debug('No custom tool providers configured');
            }

            const internalCount = this.internalTools.size;
            const customCount = this.customTools.size;
            this.logger.info(
                `InternalToolsProvider initialized with ${internalCount + customCount} tools (${internalCount} internal, ${customCount} custom)`
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
     * Register custom tools from the custom tool registry.
     * Tools are stored by their original ID - prefixing is handled by ToolManager.
     */
    private registerCustomTools(): void {
        if (!this.agent) {
            throw ToolError.configInvalid(
                'Agent reference not set. Call setAgent() before initialize() when using custom tools.'
            );
        }

        const context: ToolCreationContext = {
            logger: this.logger,
            agent: this.agent,
            services: {
                ...this.services,
                // Include storageManager from agent services for custom tools that need persistence
                storageManager: this.agent.services?.storageManager,
            },
        };

        for (const toolConfig of this.customToolConfigs) {
            try {
                // Validate config against provider schema
                const validatedConfig = customToolRegistry.validateConfig(toolConfig);
                const provider = customToolRegistry.get(validatedConfig.type);

                if (!provider) {
                    const availableTypes = customToolRegistry.getTypes();
                    throw ToolError.unknownCustomToolProvider(validatedConfig.type, availableTypes);
                }

                // Create tools from provider
                const tools = provider.create(validatedConfig, context);

                // Register each tool by its ID (no prefix - ToolManager handles prefixing)
                for (const tool of tools) {
                    // Check for conflicts with other custom tools
                    if (this.customTools.has(tool.id)) {
                        this.logger.warn(
                            `Custom tool '${tool.id}' conflicts with existing custom tool. Skipping.`
                        );
                        continue;
                    }

                    this.customTools.set(tool.id, tool);
                    this.logger.debug(
                        `Registered custom tool: ${tool.id} from provider '${provider.metadata?.displayName || validatedConfig.type}'`
                    );
                }
            } catch (error) {
                // Re-throw validation errors (unknown provider, invalid config)
                // These are user errors that should fail fast
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === ToolErrorCode.CUSTOM_TOOL_PROVIDER_UNKNOWN
                ) {
                    throw error;
                }

                // Log and continue for other errors (e.g., provider initialization failures)
                this.logger.error(
                    `Failed to register custom tool provider: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    /**
     * Check if a tool exists (checks both internal and custom tools)
     */
    hasTool(toolName: string): boolean {
        return this.internalTools.has(toolName) || this.customTools.has(toolName);
    }

    /**
     * Check if an internal tool exists
     */
    hasInternalTool(toolName: string): boolean {
        return this.internalTools.has(toolName);
    }

    /**
     * Check if a custom tool exists
     */
    hasCustomTool(toolName: string): boolean {
        return this.customTools.has(toolName);
    }

    /**
     * Get an internal tool by name
     * Returns undefined if tool doesn't exist
     */
    getTool(toolName: string): InternalTool | undefined {
        return this.internalTools.get(toolName) || this.customTools.get(toolName);
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
        // Check internal tools first, then custom tools
        const tool = this.internalTools.get(toolName) || this.customTools.get(toolName);
        if (!tool) {
            this.logger.error(`❌ No tool found: ${toolName}`);
            this.logger.debug(
                `Available internal tools: ${Array.from(this.internalTools.keys()).join(', ')}`
            );
            this.logger.debug(
                `Available custom tools: ${Array.from(this.customTools.keys()).join(', ')}`
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
     * Get internal tools in ToolSet format (excludes custom tools)
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
     * Get custom tools in ToolSet format (excludes internal tools)
     */
    getCustomTools(): ToolSet {
        const toolSet: ToolSet = {};

        for (const [name, tool] of this.customTools) {
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
     * Get custom tool names
     */
    getCustomToolNames(): string[] {
        return Array.from(this.customTools.keys());
    }

    /**
     * Get all tool names (internal + custom)
     */
    getToolNames(): string[] {
        return [...this.internalTools.keys(), ...this.customTools.keys()];
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        return this.internalTools.size + this.customTools.size;
    }

    /**
     * Get internal tool count
     */
    getInternalToolCount(): number {
        return this.internalTools.size;
    }

    /**
     * Get custom tool count
     */
    getCustomToolCount(): number {
        return this.customTools.size;
    }
}
