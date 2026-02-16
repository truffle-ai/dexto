export type {
    BlobStoreFactory,
    CacheFactory,
    CompactionFactory,
    DatabaseFactory,
    DextoImageModule,
    ImageDefaults,
    LoggerFactory,
    HookFactory,
    ToolFactory,
} from './image/types.js';

export {
    AgentConfigSchema,
    createAgentConfigSchema,
    ToolFactoryEntrySchema,
} from './schemas/agent-config.js';

export type {
    AgentConfig,
    ValidatedAgentConfig,
    ToolFactoryEntry,
} from './schemas/agent-config.js';

export type { HooksConfig, ValidatedHooksConfig, HookFactoryEntry } from './schemas/hooks.js';

export { HookFactoryEntrySchema, HooksConfigSchema } from './schemas/hooks.js';

export {
    CompactionConfigSchema,
    DEFAULT_COMPACTION_CONFIG,
    ReactiveOverflowCompactionConfigSchema,
    NoOpCompactionConfigSchema,
} from './schemas/compaction.js';

export type {
    CompactionConfig,
    ValidatedCompactionConfig,
    ReactiveOverflowCompactionConfig,
    NoOpCompactionConfig,
} from './schemas/compaction.js';

export { applyImageDefaults } from './resolver/apply-image-defaults.js';
export { loadImage, setImageImporter } from './resolver/load-image.js';
export type { ImageImporter } from './resolver/load-image.js';
export { resolveServicesFromConfig } from './resolver/resolve-services-from-config.js';
export { toDextoAgentOptions } from './resolver/to-dexto-agent-options.js';

export type { ResolvedServices } from './resolver/types.js';

export { cleanNullValues } from './utils/clean-null-values.js';
