import { ToolExecutionContext, ToolSet, InternalTool } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { ToolError } from '../errors.js';
import { convertZodSchemaToJsonSchema } from '../../utils/schema.js';
import { InternalToolsServices, getInternalToolInfo } from './registry.js';
import type { InternalToolsConfig } from '../schemas.js';
import type { ApprovalManager } from '../../approval/manager.js';
import type { SessionManager } from '../../session/index.js';

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
    private approvalManager: ApprovalManager;
    private config: InternalToolsConfig;
    private logger: IDextoLogger;

    constructor(
        services: InternalToolsServices,
        approvalManager: ApprovalManager,
        config: InternalToolsConfig = [],
        logger: IDextoLogger
    ) {
        this.services = services;
        this.approvalManager = approvalManager;
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
     * Register a single internal tool
     */
    private registerTool(toolName: (typeof this.config)[number]): void {
        const toolInfo = getInternalToolInfo(toolName);

        // Augment services with approvalManager
        const servicesWithApproval = {
            ...this.services,
            approvalManager: this.approvalManager,
        };

        // Check if all required services are available
        const missingServices = toolInfo.requiredServices.filter(
            (serviceKey) => !servicesWithApproval[serviceKey]
        );

        if (missingServices.length > 0) {
            this.logger.debug(
                `Skipping ${toolName} internal tool - missing services: ${missingServices.join(', ')}`
            );
            return;
        }

        try {
            // Create the tool using its factory and store directly
            const tool = toolInfo.factory(servicesWithApproval);
            this.tools.set(toolName, tool); // ← Store original InternalTool directly
            this.logger.debug(`Registered ${toolName} internal tool`);
        } catch (error) {
            this.logger.error(
                `Failed to register ${toolName} internal tool: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Register all available internal tools based on available services and configuration
     */
    private registerInternalTools(): void {
        for (const toolName of this.config) {
            this.registerTool(toolName);
        }
    }

    /**
     * Set session manager for tools that need it (called after SessionManager is created)
     */
    setSessionManager(sessionManager: SessionManager): void {
        this.services.sessionManager = sessionManager;
        this.logger.debug('SessionManager configured for internal tools');
    }

    /**
     * Set agent for tools that need it (called after DextoAgent is initialized)
     */
    setAgent(agent: import('../../agent/DextoAgent.js').DextoAgent): void {
        this.services.agent = agent;

        // Re-register tools that depend on agent
        if (this.config.includes('spawn_agent')) {
            this.registerTool('spawn_agent');
        }

        this.logger.debug('Agent configured for internal tools');
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

    getServices(): InternalToolsServices {
        return this.services;
    }

    dispose(): void {
        this.tools.clear();
        this.logger.debug('InternalToolsProvider disposed');
    }
}
