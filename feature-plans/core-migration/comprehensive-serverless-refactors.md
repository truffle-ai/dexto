# Comprehensive Serverless Refactors - Remove Filesystem Dependencies from Core

## Goal
Remove all filesystem dependencies from the core runtime to enable serverless deployment while maintaining developer experience for local/file-based workflows.

## Related Plans

This refactor works in conjunction with:
- **[Prompt System Refactor](./prompt-refactor.md)**: Removes FilePromptProvider's filesystem scanning from core
- **[Project-Based Architecture](./project-based-architecture.md)**: Provides bundling and deployment infrastructure

**Integration Points:**
- Prompt refactor removes filesystem dependency for prompt discovery
- This plan provides ResourceLoader abstraction for loading resources from any source
- ConfigPromptProvider (from prompt refactor) will use ResourceLoader (from this plan) to fetch file-based prompts
- Project bundler will transform local file references to appropriate URIs based on deployment target

## Current State

// TODO/RESOLVED: Added cross-reference to prompt-migration plan

### Filesystem Dependencies in Core
1. **configPath propagation** - Passed through service initializer to multiple services
2. **SystemPromptManager** - Receives configDir but FileContributor doesn't actually use it (bug)
3. **PluginManager** - Uses configDir for validation context only
4. **Template variables** - `${{dexto.agent_dir}}` expanded in agent-management before core sees config
5. **FileContributor** - Reads files directly using `fs.readFile()`
6. **Resource loading** - Each service implements its own file loading

### What's Already Working
- ✅ Template expansion happens in agent-management (`loadAgentConfig`)
- ✅ Core receives absolute paths (not templates)
- ✅ Config loading separated into agent-management package
- ✅ Plugin path validation enforces absolute paths

### What's Broken/Inconsistent
- ❌ FileContributor receives configDir but doesn't use it (always resolves relative to `process.cwd()`)
- ❌ Path validation: Done in schemas for SystemPrompt, done in service code for plugins
- ❌ No support for cloud-based resources (S3, HTTP, etc.)
- ❌ Each service loads files independently (no unified resource loading)

## Problems

### 1. ConfigPath Creates Filesystem Coupling
```typescript
// Current signature
constructor(
    config: AgentConfig,
    private configPath?: string  // ← Implies filesystem location
)
```

**Issues:**
- Assumes config comes from a file
- Doesn't work for configs from S3, HTTP APIs, databases, etc.
- `configPath` used inconsistently (sometimes for directory, sometimes validation context)

### 2. No Multi-Source Resource Support
```yaml
# What if prompts come from different sources?
systemPrompt:
  contributors:
    - type: file
      files:
        - /local/prompt.md                    # Local filesystem
        - s3://bucket/prompt.md               # S3 (needs AWS credentials)
        - https://cdn.example.com/prompt.md   # HTTP (needs auth token?)
```

**Current approach can't handle:**
- Multiple credential sets (different S3 buckets, different AWS accounts)
- Mixed sources (local + cloud)
- Per-resource authentication

### 3. Path Validation Inconsistency
- **SystemPrompt FileContributor**: Validates in Zod schema (`.superRefine()`)
- **Plugin paths**: Validates in service code (`resolvePluginPath()`)
- **Inconsistent error messages and timing**

## Proposed Architecture

// TODO/RESOLVED: Added examples with multiple URI types

### Overview
```
┌─────────────────────────────────────────────────────┐
│ Config File (with templates)                        │
├─────────────────────────────────────────────────────┤
│ dataSources:                                        │
│   company-s3:                                       │
│     type: s3                                        │
│     bucket: acme-prompts                            │
│     region: us-east-1                               │
│   cdn:                                              │
│     type: http                                      │
│     baseUrl: https://cdn.example.com                │
│                                                     │
│ prompts:                                            │
│   - type: file                                      │
│     file: "${{dexto.agent_dir}}/prompts/base.md"   │
│   - type: file                                      │
│     file: "s3://acme-prompts/shared/rules.md"      │
│     dataSource: company-s3                          │
│   - type: file                                      │
│     file: "https://cdn.example.com/prompts/v2.md"  │
│     dataSource: cdn                                 │
└─────────────────────────────────────────────────────┘
                     ↓
         Agent-Management: Load & Expand
                     ↓
┌─────────────────────────────────────────────────────┐
│ Resolved Config (absolute URIs)                     │
├─────────────────────────────────────────────────────┤
│ prompts:                                            │
│   - file: "file:///opt/agents/prompts/base.md"     │
│     dataSource: fs                                  │
│   - file: "s3://acme-prompts/shared/rules.md"      │
│     dataSource: company-s3                          │
│   - file: "https://cdn.example.com/prompts/v2.md"  │
│     dataSource: cdn                                 │
└─────────────────────────────────────────────────────┘
                     ↓
         Core: Uses Injected ResourceLoader
                     ↓
┌─────────────────────────────────────────────────────┐
│ ConfigPromptProvider                                │
│   → resourceLoader.load(                            │
│       "file:///opt/agents/prompts/base.md",         │
│       dataSources["fs"]                             │
│     )                                               │
└─────────────────────────────────────────────────────┘
                     ↓
         Agent-Management: Loads Resource
                     ↓
        ┌────────────────────────────┐
        │ MultiSourceResourceLoader  │
        │  - fs → fs.readFile        │
        │  - s3 → s3.getObject       │
        │  - http → fetch            │
        └────────────────────────────┘
```

### Key Principles

1. **Template Variables Add `file://` Prefix**
   ```typescript
   // Input:  "${{dexto.agent_dir}}/prompts/base.md"
   // Output: "file:///opt/agents/prompts/base.md"
   ```
   - Templates only for file-based configs (makes no sense for S3/HTTP configs)
   - Template variable agent dir is primarily a CLI feature which will be local
   - This is currently the only template variable. We can see how to handle other template variables differently if they make sense in the cloud
   - After expansion, everything is a URI (file://, s3://, https://)

2. **All Paths Must Be Absolute**
   - Local files: `file:///absolute/path/to/file.md`
   - S3 objects: `s3://bucket/key/path`
   - HTTP resources: `https://cdn.example.com/path`
   - No relative paths allowed anywhere in core

// TODO/RESOLVED: Replaced envPrefix with explicit credential configuration following AWS best practices

3. **DataSources for Credentials**

   **Important**: We explicitly avoid the `envPrefix` pattern as it goes against AWS standards and breaks tooling compatibility.

   ```yaml
   dataSources:
     fs:
       type: fs  # Renamed from 'local' to clarify filesystem-specific

     company-s3:
       type: s3
       bucket: acme-corp-shared
       region: us-east-1
       credentials:
         # Option 1: Explicit environment variables (standard AWS names)
         accessKeyId: ${AWS_ACCESS_KEY_ID}
         secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
         sessionToken: ${AWS_SESSION_TOKEN}  # Optional for temporary credentials

         # Option 2: Named AWS profile
         profile: company-aws

         # Option 3: Omit credentials - uses default AWS credential chain
         # (IAM roles, instance profiles, env vars in standard locations)

     team-s3:
       type: s3
       bucket: team-engineering
       region: us-west-2
       credentials:
         profile: team-aws  # Different profile for different account

     cdn:
       type: http
       baseUrl: https://cdn.example.com
       headers:
         Authorization: "Bearer ${CDN_TOKEN}"
   ```

4. **Resources Reference DataSources**
   ```yaml
   prompts:
     # Filesystem file (explicit dataSource required in serverless)
     - type: file
       file: "file:///opt/agents/local.md"
       dataSource: fs

     # S3 resource (explicit dataSource required)
     - type: file
       file: "s3://acme-corp-shared/prompts/base.md"
       dataSource: company-s3  # Must reference defined dataSource

     # HTTP resource (explicit dataSource required)
     - type: file
       file: "https://cdn.example.com/prompts/latest.md"
       dataSource: cdn  # Must reference defined dataSource
   ```

5. **Resource Loader Implementation Location**
   - Core defines `ResourceLoader` interface (contracts only)
   - ResourceLoader implementation can be in **either** core or agent-management
   - Decision based on: Does it need to work in all environments (serverless, Node.js, browser)?
   - If yes → stays in core with minimal dependencies
   - If no → moves to agent-management
   - Core maintains zero filesystem/cloud SDK dependencies regardless

## Schema Design

### DataSources Configuration

```typescript
// packages/core/src/agent/schemas.ts

// TODO/RESOLVED: Renamed 'local' to 'fs' and clarified availability constraints
// Note: Validation that 'fs' isn't used in serverless happens in agent-management/deployer
const FileSystemDataSourceSchema = z.object({
    type: z.literal('fs'),
    description: z.string().optional(),
}).describe('Local filesystem data source (only available in Node.js environments, not serverless)');

// TODO/RESOLVED: Replaced envPrefix with explicit credential configuration
const S3CredentialsSchema = z.object({
    accessKeyId: z.string().optional()
        .describe('AWS Access Key ID (supports ${ENV_VAR} expansion). Uses AWS_ACCESS_KEY_ID if not specified.'),
    secretAccessKey: z.string().optional()
        .describe('AWS Secret Access Key (supports ${ENV_VAR} expansion). Uses AWS_SECRET_ACCESS_KEY if not specified.'),
    sessionToken: z.string().optional()
        .describe('AWS Session Token for temporary credentials (supports ${ENV_VAR} expansion)'),
    profile: z.string().optional()
        .describe('Named AWS profile from ~/.aws/credentials'),
}).strict();

const S3DataSourceSchema = z.object({
    type: z.literal('s3'),
    bucket: z.string().describe('S3 bucket name'),
    region: z.string().describe('AWS region'),
    credentials: S3CredentialsSchema.optional()
        .describe('AWS credentials. If omitted, uses default AWS credential chain (IAM roles, instance profiles, standard env vars)'),
    description: z.string().optional(),
}).describe('AWS S3 data source (also compatible with R2, MinIO, and other S3-compatible services)');

const HttpDataSourceSchema = z.object({
    type: z.literal('http'),
    baseUrl: z.string().url()
        .describe('Base URL for HTTP(S) resources'),
    headers: z.record(z.string()).optional()
        .describe('HTTP headers (supports ${ENV_VAR} expansion)'),
    timeout: z.number().optional().default(30000)
        .describe('Request timeout in milliseconds'),
    description: z.string().optional(),
}).describe('HTTP/HTTPS data source');

const DataSourceSchema = z.discriminatedUnion('type', [
    FileSystemDataSourceSchema,
    S3DataSourceSchema,
    HttpDataSourceSchema,
]);

const DataSourcesSchema = z.record(z.string(), DataSourceSchema)
    .default({})  // No default! Force explicit configuration
    .describe('Named data sources for loading external resources');

// Add to AgentConfigSchema
export const AgentConfigSchema = z.object({
    // ... existing fields

    dataSources: DataSourcesSchema,
});
```

### Validation Rules

// TODO/RESOLVED: Created reusable URI validation helpers for consistent enforcement across schemas

1. **All resource URIs must be absolute**

   ```typescript
   // packages/core/src/utils/uri-validation.ts

   export const SUPPORTED_URI_SCHEMES = ['file', 's3', 'http', 'https'] as const;
   export type SupportedScheme = typeof SUPPORTED_URI_SCHEMES[number];

   export interface URIValidationOptions {
     allowedSchemes?: SupportedScheme[];
     fieldName?: string;
   }

   /**
    * Reusable Zod refine function for validating absolute URIs
    */
   export function validateAbsoluteURI(
     uri: string,
     ctx: z.RefinementCtx,
     options: URIValidationOptions = {}
   ): void {
     const {
       allowedSchemes = SUPPORTED_URI_SCHEMES,
       fieldName = 'URI'
     } = options;

     try {
       const url = new URL(uri);
       const scheme = url.protocol.slice(0, -1) as SupportedScheme;

       if (!allowedSchemes.includes(scheme)) {
         ctx.addIssue({
           code: z.ZodIssueCode.custom,
           message: `Invalid ${fieldName} scheme "${scheme}". Must be one of: ${allowedSchemes.join(', ')}`,
         });
       }

       // Additional validation for file:// URIs
       if (scheme === 'file' && !url.pathname.startsWith('/')) {
         ctx.addIssue({
           code: z.ZodIssueCode.custom,
           message: `Invalid file:// URI. Must use absolute path: file:///absolute/path`,
         });
       }
     } catch {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         message: `${fieldName} must be an absolute URI (${allowedSchemes.map(s => `${s}://`).join(', ')}). Use ${{dexto.agent_dir}} template for local files.`,
       });
     }
   }

   /**
    * Creates a Zod string schema with URI validation
    */
   export function absoluteURISchema(options: URIValidationOptions = {}) {
     return z.string().superRefine((uri, ctx) => {
       validateAbsoluteURI(uri, ctx, options);
     });
   }
   ```

   **Apply to all schemas:**

   ```typescript
   // packages/core/src/prompts/schemas.ts
   import { absoluteURISchema } from '../utils/uri-validation.js';

   const FilePromptSchema = z.object({
     type: z.literal('file'),
     file: absoluteURISchema({ fieldName: 'Prompt file' })
       .describe('Absolute URI to markdown file (file://, s3://, https://)'),
     dataSource: z.string().default('fs'),
     showInStarters: z.boolean().optional().default(false),
   }).strict();
   ```

   ```typescript
   // packages/core/src/plugins/schemas.ts
   import { absoluteURISchema } from '../utils/uri-validation.js';

   export const CustomPluginConfigSchema = z.object({
     name: z.string().describe('Unique name for the plugin'),
     module: absoluteURISchema({
       fieldName: 'Plugin module',
       allowedSchemes: ['file', 's3', 'https']
     }).describe('Absolute URI to plugin module'),
     dataSource: z.string().default('fs'),
     enabled: z.boolean().default(true).describe('Whether this plugin is enabled'),
     blocking: z.boolean().describe('If true, plugin errors will halt execution'),
     priority: z.number().int().describe('Execution priority (lower runs first)'),
     config: z.record(z.any()).optional().describe('Plugin-specific configuration'),
   }).strict();
   ```

   ```typescript
   // packages/core/src/systemPrompt/schemas.ts
   import { absoluteURISchema } from '../utils/uri-validation.js';

   const FileContributorSchema = z.object({
     type: z.literal('file'),
     files: z.array(
       absoluteURISchema({ fieldName: 'System prompt file' })
     ).min(1),
     dataSource: z.string().default('fs'),
   }).strict();
   ```

// TODO/RESOLVED: Explained two-phase validation approach for cross-schema dependencies

2. **DataSource must exist for remote URIs**

   **Two-Phase Validation Approach:**

   - **Phase 1**: Individual schema validation (validate structure only)
   - **Phase 2**: Cross-schema validation at AgentConfig level (validate references)

   ```typescript
   // packages/core/src/agent/schemas.ts

   export const AgentConfigSchema = z.object({
     dataSources: DataSourcesSchema,
     prompts: PromptsSchema,
     plugins: PluginsConfigSchema,
     systemPrompt: SystemPromptSchema,
     // ... other fields
   })
   .strict()
   .superRefine((config, ctx) => {
     // Cross-validate all resource references
     validateResourceReferences(config, ctx);
   });

   function validateResourceReferences(config: AgentConfig, ctx: z.RefinementCtx): void {
     const availableDataSources = Object.keys(config.dataSources || {});

     // Validate prompt file references
     config.prompts?.forEach((prompt, idx) => {
       if (prompt.type === 'file') {
         validateDataSourceReference(
           prompt.dataSource,
           prompt.file,
           config.dataSources,
           availableDataSources,
           ['prompts', idx, 'dataSource'],
           ctx
         );
       }
     });

     // Validate plugin module references
     config.plugins?.custom?.forEach((plugin, idx) => {
       validateDataSourceReference(
         plugin.dataSource,
         plugin.module,
         config.dataSources,
         availableDataSources,
         ['plugins', 'custom', idx, 'dataSource'],
         ctx
       );
     });

     // Validate system prompt file references
     config.systemPrompt?.contributors?.forEach((contributor, idx) => {
       if (contributor.type === 'file') {
         contributor.files.forEach((file, fileIdx) => {
           validateDataSourceReference(
             contributor.dataSource,
             file,
             config.dataSources,
             availableDataSources,
             ['systemPrompt', 'contributors', idx, 'files', fileIdx],
             ctx
           );
         });
       }
     });
   }

   function validateDataSourceReference(
     dataSourceName: string,
     uri: string,
     dataSources: Record<string, DataSourceConfig>,
     availableDataSources: string[],
     path: (string | number)[],
     ctx: z.RefinementCtx
   ): void {
     // Check dataSource exists
     if (!availableDataSources.includes(dataSourceName)) {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         message: `Unknown dataSource "${dataSourceName}". Available: ${availableDataSources.join(', ')}`,
         path,
       });
       return;
     }

     // Validate URI scheme matches dataSource type
     const dataSource = dataSources[dataSourceName];
     const url = new URL(uri);
     const scheme = url.protocol.slice(0, -1);

     const expectedScheme: Record<DataSourceType, string[]> = {
       fs: ['file'],
       s3: ['s3'],
       http: ['http', 'https'],
     };

     if (!expectedScheme[dataSource.type]?.includes(scheme)) {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         message: `URI scheme "${scheme}://" doesn't match dataSource type "${dataSource.type}". Expected: ${expectedScheme[dataSource.type]?.join(', ')}`,
         path,
       });
     }
   }
   ```

## Core Interfaces

### ResourceLoader Interface

```typescript
// packages/core/src/resources/loader-interface.ts
// OR packages/agent-management/src/resources/loader-interface.ts
// (Decision TBD based on whether implementation needs to be environment-agnostic)

/**
 * Core interface for loading resources from various sources
 * Implementation provided by agent-management or deployer packages
 */
export interface ResourceLoader {
    /**
     * Load a resource from any supported URI
     * @param uri - Absolute URI (file://, s3://, https://)
     * @param dataSource - Data source configuration
     * @returns Resource content as string
     */
    load(uri: string, dataSource: DataSourceConfig): Promise<string>;

    /**
     * Check if a URI + dataSource combination is supported
     */
    supports(uri: string, dataSource: DataSourceConfig): boolean;
}

// Re-export dataSource types from agent schemas
export type DataSourceConfig =
    | FileSystemDataSource
    | S3DataSource
    | HttpDataSource;
```

### Error Types

```typescript
// packages/core/src/resources/errors.ts

export enum ResourceErrorCode {
    UNSUPPORTED_SCHEME = 'resource_unsupported_scheme',
    UNKNOWN_DATA_SOURCE = 'resource_unknown_data_source',
    LOAD_FAILED = 'resource_load_failed',
    SCHEME_MISMATCH = 'resource_scheme_mismatch',
    UNSUPPORTED_ENVIRONMENT = 'resource_unsupported_environment',
}

export class ResourceError extends DextoRuntimeError {
    static unsupportedScheme(uri: string, supportedSchemes: string[]) {
        return new ResourceError(
            ResourceErrorCode.UNSUPPORTED_SCHEME,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            `Unsupported URI scheme: ${uri}. Supported: ${supportedSchemes.join(', ')}`,
            { uri, supportedSchemes }
        );
    }

    static unknownDataSource(name: string, availableSources: string[]) {
        return new ResourceError(
            ResourceErrorCode.UNKNOWN_DATA_SOURCE,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            `Unknown dataSource "${name}". Available: ${availableSources.join(', ')}`,
            { name, availableSources }
        );
    }

    static loadFailed(uri: string, dataSourceName: string, cause: string) {
        return new ResourceError(
            ResourceErrorCode.LOAD_FAILED,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `Failed to load resource from "${uri}" using dataSource "${dataSourceName}": ${cause}`,
            { uri, dataSourceName, cause }
        );
    }

    static unsupportedEnvironment(dataSourceName: string, type: string, environment: string) {
        return new ResourceError(
            ResourceErrorCode.UNSUPPORTED_ENVIRONMENT,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            `DataSource "${dataSourceName}" uses type "${type}" which is not available in ${environment} environments. Use S3 or HTTP instead.`,
            { dataSourceName, type, environment }
        );
    }
}
```

## Implementation Plan

// TODO/RESOLVED: Reordered phases to do cleanup first before adding new features

### Phase 0: Foundation Cleanup (No New Features) ⭐ **DO THIS FIRST**

**Goal**: Remove existing filesystem dependencies without adding new features

1. **Remove configDir propagation**
   - Remove `configDir` parameter from service initializer
   - Remove `configDir` from SystemPromptManager
   - Remove `configDir` from PluginManager options

2. **Implement prompt refactor**
   - Remove FilePromptProvider filesystem scanning
   - Consolidate starter prompts and file prompts
   - Migrate to ConfigPromptProvider (per prompt-refactor.md)
   - Update all yml files in repo to match this new format

// TODO/RESOLVED: Injection pattern is better than dynamic imports for architecture purity and testability

3. **Move FileContributor to use function injection**
   - Accept file reader function instead of reading directly
   - Agent-management provides the reader function

   **Why injection over dynamic imports:**
   - **Separation of concerns**: Core defines contracts, agent-management provides implementations
   - **Testability**: Easy to inject mocks for testing
   - **Bundle size control**: Core bundle doesn't include fs/AWS SDK/fetch implementations
   - **True serverless compatibility**: Core literally has zero env-specific code
   - **Flexibility**: Different environments can provide optimized implementations without core changes

   **Optional convenience factory** (can be added later):
   ```typescript
   // packages/core/src/resources/default-loader.ts
   export async function createDefaultResourceLoader(): Promise<ResourceLoader> {
     if (typeof process !== 'undefined' && process.versions?.node) {
       const { NodeResourceLoader } = await import('@dexto/agent-management');
       return new NodeResourceLoader();
     } else if (typeof Deno !== 'undefined') {
       const { DenoResourceLoader } = await import('@dexto/agent-management');
       return new DenoResourceLoader();
     } else {
       const { FetchResourceLoader } = await import('@dexto/agent-management');
       return new FetchResourceLoader();
     }
   }
   ```

4. **Consolidate path validation**
   - Move plugin path validation from service code to schema
   - Ensure consistent validation across all schemas

**Deliverables:**
- All filesystem operations moved to agent-management
- Core services no longer depend on filesystem
- Tests still pass

### Phase 1: ResourceLoader Abstraction (Minimal)

**Goal**: Add abstraction layer without multi-source support yet

1. **Create ResourceLoader interface** (location TBD based on requirements)
   - Define interface for resource loading
   - Define error types

2. **Implement filesystem-only ResourceLoader**
   - Simple wrapper around `fs.readFile()`
   - Implemented in agent-management

3. **Inject ResourceLoader into services**
   - Update SystemPromptManager to use ResourceLoader
   - Update PluginManager to use ResourceLoader
   - Update ConfigPromptProvider to use ResourceLoader

4. **Update template expansion**
   - Add `file://` prefix to template expansion
   - Ensure all paths become absolute URIs

**Deliverables:**
- Abstraction layer in place
- No S3/HTTP support yet
- All existing functionality works

### Phase 2: DataSources Schema & Multi-Source Support

**Goal**: Add support for S3 and HTTP resources

1. **Add dataSources schema**
   - FileSystemDataSourceSchema, S3DataSourceSchema, HttpDataSourceSchema
   - Add to AgentConfigSchema
   - Implement cross-schema validation

2. **Create URI validation helpers**
   - `validateAbsoluteURI()` function
   - `absoluteURISchema()` helper
   - Apply to all resource schemas (prompts, plugins, systemPrompt)

3. **Implement credential resolution**
   - AWS credential chain support (explicit, profile, default)
   - HTTP header expansion (env vars)
   - Document credential best practices

4. **Implement MultiSourceResourceLoader**
   - Filesystem: `fs.readFile()`
   - S3: AWS SDK with credential chain
   - HTTP: `fetch()` with custom headers

5. **Update all schemas to reference dataSources**
   - Add `dataSource` field to FilePromptSchema
   - Add `dataSource` field to CustomPluginConfigSchema
   - Add `dataSource` field to FileContributorSchema

**Deliverables:**
- Full multi-source support
- S3 and HTTP resources work
- Comprehensive credential handling

### Phase 3: DextoAgent ConfigSource Abstraction

// TODO/RESOLVED: Added ConfigSource abstraction to replace filesystem-specific configPath

**Goal**: Generalize config source to support any origin

```typescript
// packages/core/src/agent/config-source.ts

export type ConfigSource =
  | { type: 'file'; path: string }
  | { type: 's3'; bucket: string; key: string; region: string }
  | { type: 'http'; url: string }
  | { type: 'memory'; id: string };  // For programmatic configs

export interface DextoAgentOptions {
  config: AgentConfig;
  configSource?: ConfigSource;  // Optional, for reload() functionality
}
```

**Updates to DextoAgent:**

```typescript
export class DextoAgent {
  private config: ValidatedAgentConfig;
  private configSource?: ConfigSource;

  constructor(config: AgentConfig, options?: { configSource?: ConfigSource }) {
    this.config = AgentConfigSchema.parse(config);
    this.configSource = options?.configSource;
  }

  /**
   * Get the source where this agent's config is stored
   * @returns ConfigSource or null if config was provided programmatically
   */
  public getConfigSource(): ConfigSource | null {
    return this.configSource ?? null;
  }

  /**
   * Reload agent configuration from its source
   * @param newConfig Optional new config. If not provided, reloads from configSource
   */
  public async reload(newConfig?: AgentConfig): Promise<{
    restarted: boolean;
    changesApplied: string[];
  }> {
    if (!newConfig && !this.configSource) {
      throw new DextoRuntimeError(
        'AGENT_NO_CONFIG_SOURCE',
        ErrorScope.AGENT,
        ErrorType.USER,
        'Cannot reload: agent has no config source. Either provide a new config or initialize agent with configSource option.'
      );
    }

    const configToLoad = newConfig ?? await this.loadFromSource(this.configSource!);

    const oldConfig = this.config;
    const validated = AgentConfigSchema.parse(configToLoad);
    const changesApplied = this.detectConfigChanges(oldConfig, validated);
    this.config = validated;

    let restarted = false;
    if (changesApplied.length > 0) {
      this.logger.info(
        `Configuration changed. Restarting agent to apply: ${changesApplied.join(', ')}`
      );
      await this.restart();
      restarted = true;
      this.logger.info('Agent restarted successfully with new configuration');
    }

    return { restarted, changesApplied };
  }

  private async loadFromSource(source: ConfigSource): Promise<AgentConfig> {
    switch (source.type) {
      case 'file':
        // Import from agent-management
        const { loadAgentConfig } = await import('@dexto/agent-management');
        return await loadAgentConfig(source.path);
      case 's3':
        // Future: Load from S3
        throw new Error('S3 config source not yet implemented');
      case 'http':
        // Future: Load from HTTP
        throw new Error('HTTP config source not yet implemented');
      case 'memory':
        throw new Error('Cannot reload memory-based config');
    }
  }
}
```

**Deliverables:**
- Generic ConfigSource abstraction
- Backward compatible (configSource is optional)
- Foundation for loading configs from any source

## Configuration Examples

### Simple Local Development
```yaml
# Minimal config - filesystem only
dataSources:
  fs:
    type: fs

prompts:
  - type: file
    file: "${{dexto.agent_dir}}/prompts/base.md"
    dataSource: fs
```

After template expansion:
```yaml
prompts:
  - type: file
    file: "file:///opt/agents/prompts/base.md"
    dataSource: fs
```

### Production with S3
```yaml
dataSources:
  company-prompts:
    type: s3
    bucket: acme-corp-prompts
    region: us-east-1
    # Uses default AWS credential chain (IAM role in production)

prompts:
  - type: file
    file: "s3://acme-corp-prompts/shared/base-instructions.md"
    dataSource: company-prompts
    showInStarters: true
```

### Multi-Source Configuration
```yaml
dataSources:
  fs:
    type: fs

  shared-s3:
    type: s3
    bucket: shared-assets
    region: us-east-1
    credentials:
      profile: company-aws

  team-s3:
    type: s3
    bucket: team-engineering
    region: us-west-2
    credentials:
      accessKeyId: ${TEAM_AWS_ACCESS_KEY_ID}
      secretAccessKey: ${TEAM_AWS_SECRET_ACCESS_KEY}

  cdn:
    type: http
    baseUrl: https://cdn.example.com
    headers:
      Authorization: "Bearer ${CDN_TOKEN}"

prompts:
  # Local custom prompt
  - type: file
    file: "${{dexto.agent_dir}}/custom.md"
    dataSource: fs

  # Company-wide shared prompt (S3 with profile)
  - type: file
    file: "s3://shared-assets/prompts/company-wide.md"
    dataSource: shared-s3

  # Team-specific prompt (S3 with explicit credentials)
  - type: file
    file: "s3://team-engineering/prompts/team-rules.md"
    dataSource: team-s3

  # CDN-hosted prompt
  - type: file
    file: "https://cdn.example.com/prompts/latest-guidelines.md"
    dataSource: cdn

plugins:
  custom:
    # Same pattern for plugins
    - name: custom-plugin
      module: "s3://shared-assets/plugins/analytics.js"
      dataSource: shared-s3
      enabled: true
      blocking: false
      priority: 100
```

## Deployment Platform Analysis

### Platform Comparison Matrix

| Platform | Type | Compute | Storage | Filesystem | Pricing Model | Best For |
|----------|------|---------|---------|------------|---------------|----------|
| **CloudFlare Workers + Durable Objects** | Serverless edge | V8 isolates | R2, KV, DO SQLite | Ephemeral /tmp only | $5/mo base + usage | Global edge, real-time, WebSockets |
| **AWS Lambda** | Serverless functions | Node.js containers | S3, EFS (optional) | Ephemeral /tmp (10GB max) | Pay per request + duration | Event-driven, AWS integration |
| **Vercel** | Serverless functions + hosting | Node.js (edge or Node.js runtime) | Vercel Blob, Vercel KV | None (ephemeral) | Free tier + per-function pricing | Next.js, frontend-focused |
| **Railway** | PaaS (always-on) | Containers | Volumes (persistent) | Yes (persistent volumes) | $5/mo + usage ($0.000231/GB-minute) | Traditional apps, databases, persistent workloads |
| **Convex** | Backend platform | V8 + Node.js actions | Built-in DB + files | None | Free tier + usage | Real-time apps, TypeScript-first |
| **Supabase** | BaaS | Deno Edge Functions | Postgres + S3 storage | Ephemeral /tmp only | Free tier + compute hours | Full-stack apps, Firebase alternative |
| **Neon DB** | Serverless Postgres | None (DB only) | Postgres | N/A | Free tier + compute/storage | Postgres with branching, pairs with other platforms |

### CloudFlare Workers + Durable Objects (Recommended)

**Why Good for Dexto:**
- ✅ Node.js compatibility improved (2025) - can run Express/Koa/Hono
- ✅ Durable Objects perfect for agent session state
- ✅ R2 is S3-compatible (our dataSources plan already supports it)
- ✅ Global edge deployment (low latency worldwide)
- ✅ WebSocket support for real-time agent communication
- ✅ Cost-effective at scale

**Challenges:**
- ⚠️ Bundle size limits (10 MB paid) - may need to externalize plugins to R2
- ⚠️ Memory limits (128 MB) - need to stream large responses
- ⚠️ CPU time limits (5 min max) - long agent runs may need chunking

**Architecture for Dexto:**
```
CloudFlare Worker (Hono server)
  ↓ routes to
Durable Object per Agent Session
  - DextoAgent instance
  - Conversation state in SQLite
  - WebSocket connections
  ↓ loads from
R2 Storage
  - Agent configs (YAML)
  - Prompt files
  - Plugin code
  - User uploads
```

**Pricing:**
- Workers Paid: $5/mo includes 10M requests, 30M CPU-ms
- Durable Objects: $0.15/million requests + duration charges
- R2 Storage: ~$0.015/GB-month (no egress fees!)

### Railway (Good Alternative)

**Why Good for Dexto:**
- ✅ Traditional persistent filesystem (no refactoring needed)
- ✅ Always-on services (not cold starts)
- ✅ Native database support (Postgres, Redis, MySQL)
- ✅ Docker deployment (full control)
- ✅ WebSocket support
- ✅ Simple pricing model

**Architecture:**
- Deploy as standard Node.js container
- Persistent volumes for configs/files
- Railway-managed Postgres for state
- Can use existing Hono server as-is

// TODO/RESOLVED: Railway pricing analysis for multi-agent scenarios

**Pricing (November 2025):**
- **Base**: $5/month subscription
- **Compute**: $0.000231 per GB-minute
  - Example: 1 GB RAM continuously = ~$10/month
  - Example: 2 GB RAM continuously = ~$20/month
- **Egress**: First 100 GB free, then $0.10/GB
- **Free tier**: $5 credit (500GB-minutes) + 100GB egress

**Cost Predictability:**
- Flat pricing (no surprise charges)
- Simple formula: Base + (RAM × uptime × rate) + egress
- Example: Small agent (512MB): $5 + ~$5/mo = $10/mo total

**Comparison:**
- Railway: Always-on, traditional deployment, persistent storage
- CloudFlare: Serverless, edge deployment, scale-to-zero, global
- Railway is **easier** (less refactoring), CloudFlare is **cheaper at scale**

**Multi-Agent Pricing Scenarios:**

**Scenario 1: 10 agents in shared container**
```
1 Railway Service:
├─ 2 GB RAM container (handles all 10 agents)
└─ Cost: $5 (base) + $10 (RAM) = $15/month

Traffic impact:
- Low (1K req/day): $15/mo total
- High (100K req/day): $15 (RAM) + $3 (CPU) + $20 (egress) = $38/mo
```

**Scenario 2: 10 agents as separate services**
```
10 Railway Services:
├─ 10 × 512MB containers = 5 GB total RAM
└─ Cost: $5 (base) + $25 (RAM) = $30/month

Traffic impact:
- Scales similarly but with more overhead
```

**Recommended Dexto Cloud pricing strategy:**
- **Free tier**: 1 agent, shared infrastructure
- **Starter ($10/mo)**: Up to 3 agents, 10K requests/mo
- **Pro ($30/mo)**: Up to 10 agents, 100K requests/mo
- **Enterprise ($100+/mo)**: Unlimited agents, isolated infrastructure

**Key insight**: Railway RAM cost is fixed (always-on), CPU and egress scale with traffic. For multi-tenant SaaS, use shared infrastructure per user or pricing tier to optimize costs.

// TODO/RESOLVED: Vercel requires WebSocket → SSE migration (see ./websocket-to-sse-migration.md)

### Vercel

**Limited fit for Dexto backend:**
- ⚠️ Optimized for Next.js frontends, not standalone backends
- ⚠️ Function timeout limits (10s Hobby, 60s Pro, 900s Enterprise)
- ⚠️ **No WebSocket support** - requires migration to REST + SSE architecture
- ⚠️ No persistent filesystem
- ✅ Could host WebUI while backend runs elsewhere

**WebSocket Migration Required:**
For Vercel deployment, see [WebSocket to SSE Migration Plan](./websocket-to-sse-migration.md) for detailed architecture changes needed to replace WebSocket with Server-Sent Events (SSE) for real-time communication.

**Best use:** Deploy WebUI on Vercel, backend on CloudFlare/Railway

**Pricing:**
- Hobby: Free (10s function timeout)
- Pro: $20/month per user (60s timeout)
- Enterprise: Custom (900s timeout)

### AWS Lambda

**Moderate fit:**
- ✅ Full Node.js support
- ✅ EFS for persistent filesystem (optional)
- ✅ Native S3 integration
- ⚠️ Cold starts (less than CloudFlare)
- ⚠️ More complex pricing model

**Best use:** When already in AWS ecosystem

// TODO/WIP: Code-configurable storage providers (like plugins) - still evaluating this approach

### Storage Layer Integration (Work in Progress)

**Vision:** Make storage providers code-configurable like plugins, enabling custom integrations with Neon, Convex, Supabase, etc.

**Current Status:** Evaluating feasibility and design. The approach below is proposed but not finalized.

#### Proposed: Code-Configurable Storage Providers

**Config example:**
```yaml
storage:
  provider: custom
  module: "file://./storage/neon-adapter.ts"  # or s3://bucket/adapters/convex.js
  dataSource: fs
  config:
    connectionString: ${DATABASE_URL}
```

**Storage Provider Interface:**
```typescript
export interface StorageProvider {
  // Session management
  saveSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  listSessions(): Promise<SessionMetadata[]>;
  deleteSession(sessionId: string): Promise<void>;

  // Message history
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  getMessages(sessionId: string, options?: PaginationOptions): Promise<Message[]>;

  // Search
  searchMessages(query: SearchQuery): Promise<SearchResult[]>;
  searchSessions(query: SearchQuery): Promise<SearchResult[]>;

  // Initialization & cleanup
  initialize(config: Record<string, any>): Promise<void>;
  close(): Promise<void>;
}
```

#### Example Adapters

**Neon DB Adapter:**
```typescript
export class NeonStorageProvider implements StorageProvider {
  private sql: ReturnType<typeof neon>;

  async initialize(config: { connectionString: string }) {
    this.sql = neon(config.connectionString);
    // Create tables, indexes, etc.
  }

  async saveSession(session: Session): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, created_at, last_activity, ...)
      VALUES (${session.id}, ${session.createdAt}, ...)
      ON CONFLICT (id) DO UPDATE SET ...
    `;
  }
  // ... other methods
}
```

**Convex Adapter:**
```typescript
export class ConvexStorageProvider implements StorageProvider {
  private client: ConvexClient;

  async initialize(config: { deploymentUrl: string }) {
    this.client = new ConvexClient(config.deploymentUrl);
  }

  async saveSession(session: Session): Promise<void> {
    await this.client.mutation('sessions:upsert', session);
  }
  // ... other methods
}
```

**Supabase Adapter:**
```typescript
export class SupabaseStorageProvider implements StorageProvider {
  private client: SupabaseClient;

  async initialize(config: { url: string; anonKey: string }) {
    this.client = createClient(config.url, config.anonKey);
  }

  async saveSession(session: Session): Promise<void> {
    await this.client.from('sessions').upsert(session);
  }
  // ... other methods
}
```

#### Benefits of Code-Configurable Storage

**✅ Flexibility:**
- Users can integrate any database without modifying core
- Platform-specific optimizations (Neon branches, Convex real-time, Supabase RLS)

**✅ Multi-tenancy patterns:**
- Per-tenant databases (Neon branching)
- Shared database with row-level security (Supabase RLS)
- Real-time collaboration (Convex subscriptions)

**✅ Serverless-compatible:**
- Adapters loaded from S3/HTTP like plugins
- No filesystem dependency

**⚠️ Open Questions:**
- Should storage be code-configurable or keep config-only?
- How to ensure adapter quality/security?
- Should we provide official adapters as separate packages?
- Migration path for existing storage configurations?

**Next Steps:**
- Validate approach with prototype
- Define StorageProvider interface thoroughly
- Create reference implementations
- Document adapter development guide

---

### Platform-Specific Storage Notes

**Neon DB:**
- **Role:** Serverless Postgres for any compute platform
- **Best for:** Multi-tenant SaaS (instant database branches per tenant)
- **Integration:** Direct SQL or via custom adapter

**Convex:**
- **Role:** Full backend platform with built-in storage
- **Best for:** Real-time collaborative features
- **Integration:** Requires custom adapter wrapping Convex client

**Supabase:**
- **Role:** Backend-as-a-Service with Postgres + storage
- **Best for:** Full-stack apps needing auth + database
- **Integration:** Custom adapter using Supabase client, leverage RLS for multi-tenancy

## Deployment Integration with Project-Based Architecture

### Target-Specific Bundling

The project bundler (from project-based-architecture.md) will need to support multiple deployment targets:

```bash
# Bundle for different platforms
dexto build --target nodejs       # Traditional Node.js (Railway)
dexto build --target cloudflare   # CloudFlare Workers
dexto build --target lambda       # AWS Lambda
dexto build --target vercel       # Vercel Functions
```

### What Changes Per Target

| Aspect | Node.js (Railway) | CloudFlare | Lambda | Vercel |
|--------|-------------------|------------|--------|---------|
| **Config files** | Filesystem | R2 (S3-compat) | S3 or EFS | S3 or bundled |
| **Plugins** | Filesystem or bundled | Must bundle or R2 | Bundled or S3 | Must bundle |
| **Prompts** | Filesystem | R2 | S3 | Bundled or S3 |
| **Runtime** | Node.js | V8 isolate | Node.js | Node.js |
| **Entry point** | `index.mjs` | Worker export | Lambda handler | Vercel function |

### Bundler Transformation Example

**Local development config:**
```yaml
dataSources:
  fs:
    type: fs

prompts:
  - type: file
    file: "${{dexto.agent_dir}}/prompts/base.md"
    dataSource: fs
```

**After `dexto build --target cloudflare`:**

1. Upload files to R2: `prompts/base.md` → `s3://dexto-prod-configs/prompts/base.md`
2. Transform config:
```yaml
dataSources:
  r2-storage:
    type: s3
    bucket: dexto-prod-configs
    region: auto
    # Uses IAM roles in production

prompts:
  - type: file
    file: "s3://dexto-prod-configs/prompts/base.md"
    dataSource: r2-storage
```
3. Generate Worker entry point (not Node.js server)
4. Generate `wrangler.toml` with R2 bindings

### Deployment Config Concept

```yaml
# dexto.config.ts or deployment.yml
deployments:
  - name: production-cloudflare
    target: cloudflare
    env: production
    config:
      bucket: dexto-prod-configs
      accountId: ${CLOUDFLARE_ACCOUNT_ID}

  - name: production-railway
    target: nodejs
    env: production
    config:
      volumePath: /data

  - name: dev-local
    target: nodejs
    env: development
```

```bash
# Build and deploy
dexto deploy production-cloudflare  # Uploads to R2, deploys Worker
dexto deploy production-railway      # Pushes Docker image to Railway
```


// TODO/RESOLVED: Added Vercel-style GitHub integration deployment UX

### Deployment UX Approaches

#### Approach 1: Vercel-Style GitHub Integration (Recommended for Dexto Cloud)

**Vision:** Ultimate developer experience - link GitHub repo, automatic deployments on every push.

**User Flow:**
1. User pushes Dexto project to GitHub
2. User links repo in Dexto Cloud dashboard (OAuth)
3. Dexto Cloud automatically:
   - Detects `dexto.config.ts`
   - Runs `dexto build --target cloudflare` (or configured target)
   - Uploads resources to R2/storage
   - Deploys to CloudFlare Workers / Railway / Lambda
   - Provides live URL: `https://my-agent.dexto.app`
4. Every push triggers new deployment
5. Branch deployments create preview URLs

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│ User's GitHub Repo                              │
│  ├── dexto.config.ts                            │
│  ├── agents/                                    │
│  ├── plugins/                                   │
│  └── prompts/                                   │
└──────────────────┬──────────────────────────────┘
                   ↓ (GitHub webhook on push)
┌─────────────────────────────────────────────────┐
│ Dexto Cloud Build Service                       │
│  1. Clone repo from GitHub                      │
│  2. Detect dexto.config.ts                      │
│  3. Run `dexto build --target [platform]`       │
│  4. Upload assets to R2/S3                      │
│  5. Deploy to target platform                   │
│  6. Update DNS/routing                          │
│  7. Send deployment notification                │
└──────────────────┬──────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│ Live Deployment                                 │
│  https://my-agent-abc123.dexto.app              │
│  ├── CloudFlare Worker (Hono server)            │
│  ├── Durable Objects (agent sessions)           │
│  └── R2 Storage (configs, prompts, plugins)     │
└─────────────────────────────────────────────────┘
```

**Implementation Requirements:**
1. **GitHub App** - OAuth integration for repo access
2. **Webhook Listener** - Receive push/PR events from GitHub
3. **Build Queue** - Process deployments with retries/logs
4. **Platform APIs** - CloudFlare API for Workers/R2, Railway API, etc.
5. **DNS Management** - Custom domains and automatic SSL
6. **Preview Deployments** - Unique URLs per branch/PR
7. **Deployment Dashboard** - View logs, rollback, environment variables

**User Benefits:**
- Zero configuration deploys (just link repo)
- Automatic branch previews for testing
- One-click rollbacks
- Built-in CI/CD
- No YAML files, no workflows to manage

---

#### Approach 2: GitHub Actions (OIDC)

**For users who want more control:**
```yaml
name: Deploy to CloudFlare

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and Deploy
        run: npx dexto deploy production-cloudflare
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

---

#### Approach 3: Infrastructure-as-Code (Terraform/Pulumi)

**For enterprise users needing infrastructure management:**

```typescript
// infrastructure/cloudflare.ts (using Pulumi)
import * as cloudflare from "@pulumi/cloudflare";

const configBucket = new cloudflare.R2Bucket("dexto-configs", {
  accountId: cloudflareAccountId,
  name: "dexto-configs-prod",
});

const worker = new cloudflare.WorkerScript("dexto-agent", {
  accountId: cloudflareAccountId,
  name: "dexto-agent-prod",
  content: fs.readFileSync(".dexto/output/cloudflare/index.mjs", "utf8"),
  r2BucketBindings: [{
    name: "CONFIGS",
    bucketName: configBucket.name,
  }],
});
```

**Use cases for IaC:**
- Managing multiple environments (dev/staging/prod)
- Complex infrastructure with networking, security policies
- Audit trails and compliance requirements
- Spinning up isolated infrastructure per deployment
- Team-wide infrastructure versioning

**Note:** For Dexto Cloud platform, this would be used internally to provision infrastructure when deploying user projects, not exposed to end users.

## Benefits

### For Serverless Deployment
- ✅ Core has zero filesystem dependencies
- ✅ Core has zero cloud SDK dependencies
- ✅ Works in Lambda, CloudFlare Workers, Cloud Run, Vercel
- ✅ No concept of "working directory" in core

### For Multi-Tenant SaaS
- ✅ Each tenant can have different data sources
- ✅ Per-tenant S3 buckets with separate credentials
- ✅ Centralized credential management
- ✅ Easy to add new storage backends

### For Enterprise Users
- ✅ Clear separation of credential scopes
- ✅ Audit trail of data source access
- ✅ Support for multiple AWS accounts
- ✅ Support for internal CDNs/APIs

### For Developer Experience
- ✅ Simple local development (templates + fs dataSource)
- ✅ Clear errors when dataSource is missing
- ✅ Explicit configuration (no magic)
- ✅ Standard AWS credential practices

## Migration Path

### For Internal Configs
- Template expansion already works
- Just adds `file://` prefix (non-breaking)
- Rename `local` → `fs` dataSource (clarifies intent)
- No action needed for most users

### For Advanced Users (S3/HTTP)
- New feature, opt-in
- Document in examples
- We don't need backward compatibility (small user base)

## Risks & Mitigation

**Risk**: Credential management complexity
**Mitigation**: Follow AWS standard practices (no envPrefix), use default credential chain, comprehensive documentation

**Risk**: URI validation bugs
**Mitigation**: Comprehensive schema validation with clear error messages, reusable validation helpers

**Risk**: Breaking changes for configPath usage
**Mitigation**: Introduce ConfigSource abstraction, keep backward compatibility

**Risk**: Environment detection complexity
**Mitigation**: Let agent-management/deployer handle environment checks, not core

## Future Extensions

Once this is complete:
- Easy to add `type: 'gcs'` (Google Cloud Storage)
- Easy to add `type: 'azure'` (Azure Blob Storage)
- Easy to add `type: 'postgres'` (load from database)
- Plugin bundling can reference remote plugins
- Config itself can be loaded from any source via ConfigSource

## Testing Strategy

1. **Schema validation tests**
   - Valid dataSources configurations
   - Invalid URI schemes rejected
   - Unknown dataSources rejected
   - Scheme/dataSource type mismatches caught
   - Cross-schema validation works

2. **URI validation helper tests**
   - absoluteURISchema rejects relative paths
   - absoluteURISchema accepts valid URIs
   - Consistent error messages across schemas

3. **Resource loader tests**
   - Mock S3 client, verify correct bucket/key
   - Mock fetch, verify headers
   - Credential chain behavior (explicit, profile, default)

4. **Integration tests**
   - Load prompts from local files
   - Load prompts from S3 (mocked)
   - Mixed sources in same config
   - Credential resolution works correctly

5. **Template expansion tests**
   - Verify `file://` prefix added
   - Security: path traversal still blocked

6. **Deployment target tests**
   - Bundler transforms configs correctly for each target
   - CloudFlare target uploads to R2 and generates Worker
   - Railway target preserves filesystem references
