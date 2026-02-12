import type { BlobStore } from '../storage/blob/types.js';
import type { Cache } from '../storage/cache/types.js';
import type { Database } from '../storage/database/types.js';
import type { ICompactionStrategy } from '../context/compaction/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { DextoPlugin } from '../plugins/types.js';
import type { Tool } from '../tools/types.js';
import type { InitializeServicesOptions } from '../utils/service-initializer.js';
import type { AgentRuntimeSettings } from './runtime-config.js';

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
    // Runtime settings (config-derived, validated + defaulted) — flat, no `config` wrapper.
    // Core only consumes the fields it needs at runtime.
    // Host layers own YAML parsing, image selection, defaults merging, and DI resolution.
    // See `AgentRuntimeSettings` for the list of supported fields.
    //
    // NOTE: This interface is intentionally "flat" for ergonomics and to keep core DI-friendly.
    // (No `options.config` indirection.)
    //
    // All runtime settings fields are spread into this interface via extension below.

    /**
     * Optional service overrides for host environments (e.g. tests, servers).
     * This preserves the existing override pattern while we migrate to a DI-first resolver.
     */
    overrides?: InitializeServicesOptions | undefined;

    /**
     * Logger instance scoped to this agent.
     *
     * Product layers should typically create this from `config.logger` via `createLogger()`,
     * but may supply a custom implementation.
     */
    logger: IDextoLogger;

    /** Concrete storage backends (DI-first). */
    storage: { blob: BlobStore; database: Database; cache: Cache };

    /** Concrete tool implementations (DI-first). */
    tools: Tool[];

    /** Concrete plugins installed for the agent (DI-first). */
    plugins: DextoPlugin[];

    /**
     * Context compaction controller (DI-first).
     *
     * If omitted/null, automatic compaction is disabled.
     */
    compaction?: ICompactionStrategy | null | undefined;
}

export interface DextoAgentOptions extends AgentRuntimeSettings {}
