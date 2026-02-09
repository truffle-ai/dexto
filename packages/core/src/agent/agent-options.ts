import type { BlobStore } from '../storage/blob/types.js';
import type { Cache } from '../storage/cache/types.js';
import type { Database } from '../storage/database/types.js';
import type { ICompactionStrategy as CompactionStrategy } from '../context/compaction/types.js'; // TODO: temporary glue code to be removed/verified
import type { IDextoLogger } from '../logger/v2/types.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { ValidatedServerConfigs } from '../mcp/schemas.js';
import type { ValidatedMemoriesConfig } from '../memory/schemas.js';
import type { DextoPlugin } from '../plugins/types.js';
import type { ValidatedPromptsConfig } from '../prompts/schemas.js';
import type { ValidatedInternalResourcesConfig } from '../resources/schemas.js';
import type { ValidatedSessionConfig } from '../session/schemas.js';
import type { ValidatedSystemPromptConfig } from '../systemPrompt/schemas.js';
import type { InternalTool as Tool } from '../tools/types.js'; // TODO: temporary glue code to be removed/verified
import type {
    ValidatedElicitationConfig,
    ValidatedToolConfirmationConfig,
} from '../tools/schemas.js';
import type { OtelConfiguration } from '../telemetry/schemas.js';
import type { ValidatedAgentCard } from './schemas.js';

/**
 * Constructor options for {@link DextoAgent}.
 *
 * This is the DI-first surface that replaces passing YAML-derived provider configs into core.
 * Product layers (CLI/server/platform) are responsible for:
 * - parsing/validating YAML into config sections
 * - applying image defaults
 * - resolving tool/storage/plugin/compaction/logger instances via image factories
 *
 * Core receives only validated config sections (LLM/MCP/sessions/etc.) + concrete instances.
 */
export interface DextoAgentOptions {
    /**
     * Unique identifier for this agent instance.
     * Typically set by product-layer enrichment (e.g., filename or `agentCard.name`).
     */
    agentId: string;

    /**
     * Optional agent card configuration for discovery / UI surfaces.
     * When omitted, the agent may still expose a minimal card derived from other fields.
     */
    agentCard?: ValidatedAgentCard | undefined;

    /**
     * Optional greeting text to show when a chat starts (UI consumption).
     */
    greeting?: string | undefined;

    /**
     * Optional image identifier used by product layers for resolution (not used by core).
     * Included for state export/debugging and parity with YAML config.
     */
    image?: string | undefined;

    /**
     * Validated LLM configuration (provider/model/credentials indirection).
     */
    llm: ValidatedLLMConfig;

    /**
     * Validated system prompt configuration (string shorthand or structured contributors).
     */
    systemPrompt: ValidatedSystemPromptConfig;

    /**
     * Validated MCP server configurations used by the agent.
     */
    mcpServers: ValidatedServerConfigs;

    /**
     * Validated session management configuration.
     */
    sessions: ValidatedSessionConfig;

    /**
     * Tool confirmation and approval configuration (manual/auto approve/deny + policies).
     */
    toolConfirmation: ValidatedToolConfirmationConfig;

    /**
     * Elicitation configuration for user input requests (ask_user tool + MCP elicitations).
     */
    elicitation: ValidatedElicitationConfig;

    /**
     * Validated internal resources configuration (filesystem, blob browsing, etc.).
     */
    internalResources: ValidatedInternalResourcesConfig;

    /**
     * Validated prompt catalog (inline prompts and file-backed prompts).
     */
    prompts: ValidatedPromptsConfig;

    /**
     * Optional memory configuration for system prompt inclusion.
     */
    memories?: ValidatedMemoriesConfig | undefined;

    /**
     * Optional OpenTelemetry configuration for tracing/observability.
     */
    telemetry?: OtelConfiguration | undefined;

    /**
     * Concrete storage backends.
     */
    storage: {
        /**
         * Blob store for large binary/unstructured data (files, images, artifacts).
         */
        blob: BlobStore;

        /**
         * Persistent database for agent state (sessions, memories, settings, indexes).
         */
        database: Database;

        /**
         * Cache for fast ephemeral reads (TTL-based, performance-sensitive data).
         */
        cache: Cache;
    };

    /**
     * Concrete tool implementations available to the agent.
     */
    tools: Tool[];

    /**
     * Concrete plugins installed for the agent (hook sites, policy, transformations).
     */
    plugins: DextoPlugin[];

    /**
     * Concrete compaction strategy for context/window management.
     */
    compaction: CompactionStrategy;

    /**
     * Concrete logger implementation scoped to this agent.
     */
    logger: IDextoLogger;
}
