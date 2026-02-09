import type { BlobStore } from '../storage/blob/types.js';
import type { Cache } from '../storage/cache/types.js';
import type { Database } from '../storage/database/types.js';
import type { ICompactionStrategy as CompactionStrategy } from '../context/compaction/types.js'; // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
import type { IDextoLogger } from '../logger/v2/types.js';
import type { DextoPlugin } from '../plugins/types.js';
import type { InternalTool as Tool } from '../tools/types.js'; // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
import type { InitializeServicesOptions } from '../utils/service-initializer.js';
import type { ValidatedAgentConfig } from './schemas.js';

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
     * Validated and enriched configuration for the agent.
     *
     * NOTE: This is still the source of truth for runtime config surfaces (export, reload, etc.)
     * during the refactor. DI-first resolution moves to `@dexto/agent-config` in later phases.
     */
    config: ValidatedAgentConfig;

    /**
     * Optional file path of the agent config currently in use (for save/reload UX).
     * Product layers may omit this when the agent is created from an in-memory config.
     */
    configPath?: string | undefined;

    /**
     * Optional service overrides for host environments (e.g. tests, servers).
     * This preserves the existing override pattern while we migrate to a DI-first resolver.
     *
     * TODO: temporary glue code to be removed/verified (remove-by: 5.1)
     */
    overrides?: InitializeServicesOptions | undefined;

    /**
     * Logger instance scoped to this agent.
     *
     * Product layers should typically create this from `config.logger` via `createLogger()`,
     * but may supply a custom implementation.
     */
    logger: IDextoLogger;

    /**
     * Concrete storage backends (DI-first, optional during transition).
     *
     * TODO: temporary glue code to be removed/verified (remove-by: 4.1)
     */
    storage?: { blob: BlobStore; database: Database; cache: Cache } | undefined;

    /**
     * Concrete tool implementations (DI-first, optional during transition).
     *
     * TODO: temporary glue code to be removed/verified (remove-by: 4.1)
     */
    tools?: Tool[] | undefined;

    /**
     * Concrete plugins installed for the agent (DI-first, optional during transition).
     *
     * TODO: temporary glue code to be removed/verified (remove-by: 4.1)
     */
    plugins?: DextoPlugin[] | undefined;

    /**
     * Concrete compaction strategy (DI-first, optional during transition).
     *
     * TODO: temporary glue code to be removed/verified (remove-by: 4.1)
     */
    compaction?: CompactionStrategy | undefined;
}
