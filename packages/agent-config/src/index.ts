export type {
    BlobStoreFactory,
    CacheFactory,
    CompactionFactory,
    DatabaseFactory,
    DextoImageModule,
    ImageConstraint,
    ImageDefaults,
    ImageTarget,
    LoggerFactory,
    PluginFactory,
    ToolFactory,
} from './image/types.js';

export {
    AgentConfigSchema,
    AgentConfigSchemaRelaxed,
    createAgentConfigSchema,
    ToolFactoryEntrySchema,
} from './schemas/agent-config.js';

export type {
    AgentConfig,
    ValidatedAgentConfig,
    ToolFactoryEntry,
} from './schemas/agent-config.js';

export { applyImageDefaults } from './resolver/apply-image-defaults.js';
export { resolveServicesFromConfig } from './resolver/resolve-services-from-config.js';
export { toDextoAgentOptions } from './resolver/to-dexto-agent-options.js';

export type { ResolvedServices } from './resolver/types.js';
