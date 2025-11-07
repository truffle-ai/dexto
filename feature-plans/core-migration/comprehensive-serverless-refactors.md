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
- ✅ No egress fees (unlike AWS)

**Challenges:**
- ⚠️ Bundle size limits (10 MB paid) - may need to externalize plugins to R2
- ⚠️ Memory limits (128 MB per DO) - need to stream large responses
- ⚠️ CPU time limits (5 min max) - long agent runs may need chunking
- ⚠️ Storage limit (10 GB per DO) - need to archive old sessions to R2

#### Durable Objects Architecture

**What are Durable Objects?**
- Hybrid compute + storage model: "special kind of Cloudflare Worker" with persistent state
- **Globally unique ID**: Only ONE instance of a given DO ID exists worldwide
- **Strong consistency**: SQLite storage with transactional guarantees (not eventually consistent)
- **Zero-latency storage**: SQLite runs in same thread as compute (queries complete in microseconds)
- **Geographic placement**: Auto-provisioned near first request location
- **Single-threaded**: No race conditions, simplified coordination logic
- **Scales horizontally**: Create millions of instances on-demand

**How Durable Objects Fit into Dexto:**

1. **Session Management** (One DO per agent session):
   ```typescript
   // Each Dexto session gets its own Durable Object
   export class DextoSessionDO {
     private agent: DextoAgent;
     private sql: SqlStorage; // SQLite with 10GB limit

     constructor(state: DurableObjectState, env: Env) {
       this.sql = state.storage.sql;
       // Initialize DextoAgent with session-specific state
       this.agent = await createDextoAgent({
         sessionId: state.id.toString(),
         storageProvider: new DurableObjectStorageProvider(this.sql),
         resourceLoader: new R2ResourceLoader(env.R2_BUCKET)
       });
     }

     async fetch(request: Request) {
       // Handle WebSocket connections
       if (request.headers.get('Upgrade') === 'websocket') {
         const { websocket, response } = new WebSocketPair();
         this.state.acceptWebSocket(websocket);
         return response;
       }

       // Handle HTTP requests to agent
       return this.agent.handleRequest(request);
     }

     async webSocketMessage(ws: WebSocket, message: string) {
       // Stream agent responses via WebSocket
       const userMessage = JSON.parse(message);
       await this.agent.run(userMessage.content, {
         onChunk: (chunk) => ws.send(JSON.stringify({ type: 'chunk', data: chunk })),
         onToolCall: (tool) => ws.send(JSON.stringify({ type: 'tool', data: tool }))
       });
     }
   }
   ```

2. **Conversation Storage** (SQLite in DO):
   ```typescript
   // Store messages in DO's SQLite database
   async saveMessage(sessionId: string, message: Message) {
     await this.sql.exec(
       `INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)`,
       [message.id, sessionId, message.role, message.content, Date.now()]
     );
   }

   async getMessages(sessionId: string, limit = 50) {
     return this.sql.exec(
       `SELECT * FROM messages WHERE session_id = ?
        ORDER BY created_at DESC LIMIT ?`,
       [sessionId, limit]
     ).toArray();
   }
   ```

3. **WebSocket Hibernation** (Cost optimization):
   ```typescript
   // Reduce duration charges with WebSocket Hibernation API
   this.state.setWebSocketAutoResponse(
     new WebSocketRequestResponsePair(
       JSON.stringify({ type: 'ping' }),
       JSON.stringify({ type: 'pong' })
     )
   );
   // Auto-responses incur NO duration charges!
   ```

4. **Multi-Tier Storage Strategy**:
   ```
   Active Session (< 1 hour old):
   └─ Durable Object SQLite (last 100 messages, fast access)

   Recent Session (< 7 days old):
   └─ Durable Object SQLite (full history, up to 10GB)

   Archived Session (> 7 days old):
   ├─ Summary in DO SQLite (metadata, last 10 messages)
   └─ Full history in R2 (compressed JSON, cheap storage)
   ```

5. **Coordination Patterns**:
   ```typescript
   // Multi-agent conversations: All agents connect to same DO
   export class ConversationDO {
     private agents: Map<string, DextoAgent> = new Map();
     private connections: Set<WebSocket> = new Set();

     async addAgent(agentId: string, config: AgentConfig) {
       const agent = await createDextoAgent(config);
       this.agents.set(agentId, agent);

       // Broadcast to all connected clients
       this.broadcast({ type: 'agent_joined', agentId });
     }

     async handleMessage(agentId: string, message: string) {
       const agent = this.agents.get(agentId);
       const response = await agent.run(message);

       // Store in shared SQLite DB (strong consistency)
       await this.sql.exec(
         `INSERT INTO conversation_log (agent_id, message, timestamp)
          VALUES (?, ?, ?)`,
         [agentId, message, Date.now()]
       );

       // Broadcast to all connected clients in real-time
       this.broadcast({ type: 'message', agentId, response });
     }
   }
   ```

**Architecture Diagram:**
```
┌─────────────────────────────────────────────────────────────┐
│                    CloudFlare Edge Network                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CloudFlare Worker (Hono API Server)                        │
│    ├─ Routes HTTP requests                                  │
│    ├─ Authenticates users                                   │
│    └─ Creates/routes to Durable Objects                     │
│                      ↓                                       │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Durable Object: Session ID abc123                 │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │  DextoAgent Instance                         │  │    │
│  │  │  - Current conversation state                │  │    │
│  │  │  - LLM streaming                             │  │    │
│  │  │  - WebSocket connections (up to 1000s)       │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │  SQLite Storage (up to 10 GB)                │  │    │
│  │  │  - messages table (last N messages)          │  │    │
│  │  │  - session_metadata                          │  │    │
│  │  │  - tool_call_history                         │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
│                      ↓                                       │
│  R2 Object Storage (S3-compatible)                          │
│    ├─ agent.yml configs                                     │
│    ├─ Prompt files (.md)                                    │
│    ├─ Plugin code (.js bundles)                             │
│    ├─ User uploads (files, images)                          │
│    └─ Archived sessions (> 7 days old, compressed)          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Comprehensive Pricing Analysis

**Workers Paid Plan: $5/month base includes:**
- 10 million Worker requests/month
- 30 million CPU-ms/month
- Unlimited domains
- No egress fees (!!!)

**Durable Objects Pricing:**

**Free Plan (Developer tier):**
```
Requests: 100,000/day
Duration: 13,000 GB-seconds/day
Storage: SQLite only (storage billing not yet enabled)
```

**Paid Plan (Workers Paid $5/mo):**
```
Included:
├─ 1 million DO requests/month
├─ 400,000 GB-seconds/month
└─ Then pay-as-you-go:
   ├─ $0.15 per million requests
   └─ $12.50 per million GB-seconds

Duration billing notes:
- Charged for 128 MB allocated (not actual usage)
- WebSocket Hibernation dramatically reduces duration costs
- Auto-response messages = 0 duration charges

Storage (SQLite-backed - billing not yet active):
When enabled, will match D1 pricing:
├─ Rows read: 5 million/day free, then $0.001/million rows
├─ Rows written: 100,000/day free, then $1.00/million rows
└─ Stored data: 5 GB free, then $0.20/GB-month

Storage (Key-Value backed - available now):
├─ Included: 1 GB storage + 1M read/write/delete units
├─ Storage: $0.20/GB-month
├─ Read units: $0.20/million (1 unit = 4 KB)
├─ Write units: $1.00/million (1 unit = 4 KB)
└─ Delete units: $1.00/million
```

**R2 Object Storage:**
```
Free tier:
├─ 10 GB storage/month
├─ 1 million Class A operations (list, write)
└─ 10 million Class B operations (read)

Paid:
├─ Storage: $0.015/GB-month (50% cheaper than S3)
├─ Class A: $4.50/million operations
├─ Class B: $0.36/million operations
└─ NO egress fees! (Huge savings vs AWS S3)
```

**WebSocket Message Billing:**
- Incoming messages: 20:1 ratio (20 messages = 1 request)
- Outgoing messages: Count toward duration (unless auto-response)
- Example: 1 million incoming WS messages = 50,000 billable requests = $0.0075

#### Cost Examples for Dexto Deployment

**Scenario 1: Low-Traffic Agent (Personal use)**
```yaml
Usage:
  - 1 active session
  - 100 messages/day (3K/month)
  - 10 min conversation/day
  - 1 GB agent config + prompts in R2

Costs:
├─ Workers Paid base: $5.00/month
├─ DO requests: 3K msgs × 20:1 = 150 requests (within free tier)
├─ DO duration: ~300 min/mo × 60s × 128MB = 2.3M GB-s (within free tier)
├─ R2 storage: 1 GB = $0.015
└─ Total: ~$5.02/month
```

**Scenario 2: Medium-Traffic SaaS (10 agents, moderate use)**
```yaml
Usage:
  - 10 concurrent sessions
  - 1,000 messages/day per agent (300K/month total)
  - Average 5 min conversation per message
  - 50 GB storage (configs + archived sessions)

Costs:
├─ Workers Paid base: $5.00/month
├─ DO requests: 300K msgs × 20:1 = 15K requests (within 1M free)
├─ DO duration:
│   ├─ 300K msgs × 5 min × 60s × 128MB = 11.52M GB-s
│   ├─ Minus 400K free = 11.12M GB-s
│   └─ 11.12 × $12.50 = $139.00
├─ R2 storage: 50 GB × $0.015 = $0.75
├─ R2 operations: ~1M reads/month (within free tier)
└─ Total: ~$145/month
```

**Scenario 3: High-Traffic SaaS (100 agents, heavy use)**
```yaml
Usage:
  - 100 concurrent sessions
  - 10,000 messages/day total (3M/month)
  - Average 3 min per message (WebSocket Hibernation enabled)
  - 200 GB storage in R2

Costs:
├─ Workers Paid base: $5.00/month
├─ DO requests:
│   ├─ 3M msgs × 20:1 = 150K requests
│   ├─ Minus 1M free = 0 (within free tier)
│   └─ $0.00
├─ DO duration (with Hibernation optimization):
│   ├─ 3M msgs × 3 min × 60s × 128MB = 69.12M GB-s
│   ├─ Minus 400K free = 68.72M GB-s
│   └─ 68.72 × $12.50 = $859.00
├─ R2 storage: 200 GB × $0.015 = $3.00
├─ R2 operations: 10M reads × $0.36 = $3.60
└─ Total: ~$871/month
```

**Cost Optimization Strategies:**

1. **WebSocket Hibernation**: Reduces duration by 10-50x for long-lived connections
2. **Archive old sessions**: Move sessions > 7 days to R2 (10x cheaper storage)
3. **Batch operations**: Combine multiple SQLite queries into transactions
4. **Smart routing**: Keep active sessions in DOs, archived in R2
5. **Auto-scaling**: DOs scale to zero when inactive (no cost!)

**Cost Comparison (100 active agents):**

| Platform | Monthly Cost | Notes |
|----------|--------------|-------|
| **CloudFlare DO** | ~$871 | With Hibernation optimization |
| **Railway** | ~$215 | 2GB container, always-on |
| **AWS Lambda + RDS** | ~$1,200 | Lambda + RDS t3.medium + egress fees |
| **Vercel** | Not viable | No WebSocket support |

**Recommendation for Dexto:**
- **Development**: CloudFlare Free tier (100K req/day is generous)
- **Small SaaS**: CloudFlare Paid ($5-150/mo for 10-50 agents)
- **Large SaaS**: CloudFlare Paid + aggressive archiving ($500-1000/mo for 100s of agents)
- **Alternative**: Railway for simpler deployment if cost < $200/mo and prefer traditional architecture

### Railway (Good Alternative)

**Why Good for Dexto:**
- ✅ Traditional persistent filesystem (no refactoring needed)
- ✅ Scale to Zero support (no compute charges when sleeping)
- ✅ Native database support (Postgres, Redis, MySQL)
- ✅ Docker deployment (full control)
- ✅ WebSocket support
- ✅ Simple pricing model
- ✅ $5/month base per ACCOUNT (not per service!)

**Challenges:**
- ⚠️ Scale to Zero requires no outbound packets for 10+ minutes
- ⚠️ WebSocket heartbeats prevent sleep (agents stay awake 24/7)
- ⚠️ Requires architecture change (REST API only) to utilize Scale to Zero
- ⚠️ Cold starts when waking from sleep

**Architecture:**
- Deploy as standard Node.js container
- Persistent volumes for configs/files
- Railway-managed Postgres for state
- Can use existing Hono server as-is

#### Scale to Zero Feature

**How it works:**
- Service sleeps after **10 minutes** of no outbound packets
- **Wakes automatically** on incoming request (cold start)
- **Zero compute charges** while sleeping (only storage)
- Inactivity detection includes: network requests, DB connections, framework telemetry, NTP requests

**Critical Issue for Dexto:**
```
Persistent WebSocket connections send periodic heartbeats (ping/pong)
→ Services NEVER scale to zero (always sending outbound packets)
→ Pay for 24/7 uptime even when agents are idle
```

**Solutions:**
1. **Shared container**: All agents in one always-on service (most cost-effective)
2. **REST API only**: Remove WebSocket, use REST + SSE (enables Scale to Zero)
3. **Accept 24/7 costs**: Keep WebSocket, pay for always-on containers

#### Comprehensive Pricing Analysis

**Pricing (November 2025):**
- **Base**: $5/month subscription (per account, NOT per service!)
- **Compute**: $0.000231 per GB-minute
  - Example: 1 GB RAM continuously = 730 hours × 60 min = 43,800 GB-min = $10.12/month
  - Example: 2 GB RAM continuously = 87,600 GB-min = $20.24/month
  - Example: 0.5 GB RAM continuously = 21,900 GB-min = $5.06/month
- **Storage**: $0.25/GB-month (persistent volumes)
- **Egress**: First 100 GB free, then $0.10/GB
- **Free tier**: $5 credit (included in subscription)

**Minimum Container Size:**
- 0.5 GB RAM / 1 vCPU per service (smallest allocation)
- Can create unlimited services per account (pay for resources used)

#### Multi-Agent Pricing Scenarios

**Scenario 1: Shared container (all agents in one service) - RECOMMENDED**
```yaml
100 users, shared 2GB container:
├─ Base subscription: $5/month
├─ Compute (24/7 always-on):
│   ├─ 2 GB × 730 hours × 60 min = 87,600 GB-minutes
│   └─ 87,600 × $0.000231 = $20.24/month
├─ Storage: 10 GB × $0.25 = $2.50/month
└─ Total: ~$28/month for 100 users

Architecture:
- One Node.js process with Hono server
- Multiple DextoAgent instances (one per user)
- Shared Postgres database for all sessions
- WebSocket connections maintained in single process
```

**Scenario 2: Separate containers with WebSocket (can't scale to zero)**
```yaml
100 users, separate 0.5GB containers:
├─ Base subscription: $5/month
├─ Compute (24/7, WebSocket keeps containers awake):
│   ├─ 100 services × 0.5 GB × 730 hours × 60 min = 2,190,000 GB-minutes
│   └─ 2,190,000 × $0.000231 = $506/month
├─ Storage: 100 × 0.1 GB = $2.50/month
└─ Total: ~$513/month for 100 users

Why expensive:
- WebSocket heartbeats prevent Scale to Zero
- Pay for idle RAM consumption 24/7
- Even lightweight agents (50-100MB active) charged for full 512MB allocation
```

**Scenario 3: Separate containers with Scale to Zero (REST API only)**
```yaml
100 users, separate 0.5GB containers, Scale to Zero enabled:
├─ Base subscription: $5/month
├─ Compute (only when active):
│   ├─ Average user: 30 messages/month, 3 min per message = 90 min/month active
│   ├─ 100 users × 90 min × 0.5 GB = 4,500 GB-minutes
│   └─ 4,500 × $0.000231 = $1.04/month
├─ Storage: 100 × 0.1 GB = $2.50/month
└─ Total: ~$8.54/month for 100 users (incredibly cheap!)

Requirements:
- Migrate from WebSocket to REST API + SSE
- Accept cold start delays (first request wakes service)
- Users close connections between conversations
```

**Scenario 4: Hybrid approach**
```yaml
10 shared containers (10 users each):
├─ Base subscription: $5/month
├─ Compute:
│   ├─ 10 services × 0.5 GB × 730 hours × 60 min = 219,000 GB-minutes
│   └─ 219,000 × $0.000231 = $50.59/month
├─ Storage: $2.50/month
└─ Total: ~$58/month for 100 users

Benefits:
- Better isolation than single shared container
- Cheaper than 100 separate containers
- Can isolate by tier (free users together, paid users separate)
```

#### Cost Comparison (100 active agents/users)

| Deployment Strategy | Monthly Cost | Architecture | Pros/Cons |
|---------------------|--------------|--------------|-----------|
| **Railway (shared container)** | ~$28 | All agents in 2GB service | ✅ Cheapest, ✅ Simple, ❌ No isolation |
| **Railway (Scale to Zero)** | ~$9 | 100 × 0.5GB, REST only | ✅ Ultra cheap, ❌ Cold starts, ❌ No WebSocket |
| **Railway (separate + WS)** | ~$513 | 100 × 0.5GB, always-on | ❌ Expensive, ✅ Full isolation, ✅ WebSocket |
| **Railway (hybrid)** | ~$58 | 10 × 0.5GB shared | ✅ Balanced, ✅ Some isolation |
| **CloudFlare DO** | ~$871 | One DO per session | ✅ True serverless, ✅ WebSocket Hibernation |

#### Recommendation for Railway Deployment

**For cost-conscious SaaS (< 100 users):**
- ✅ **Shared container** (~$28/mo) - Best balance of cost and simplicity
- Use multi-tenancy in single Node.js process
- Implement usage limits per user to prevent abuse

**For enterprise/isolation requirements:**
- ✅ **Hybrid approach** (~$58/mo) - Group users by tier/organization
- Free tier users: Shared containers
- Paid users: Dedicated or semi-dedicated containers

**For maximum cost optimization:**
- ✅ **Migrate to REST + SSE** (~$9/mo) - Remove WebSocket dependency
- Enable Scale to Zero for all services
- Accept cold start tradeoffs (typically < 1 second)

**Comparison to CloudFlare:**
- Railway: Cheaper for sustained moderate traffic, traditional architecture
- CloudFlare: Better for high-burst workloads, global edge, true pay-per-use

**Key insight**: Railway RAM cost is fixed (always-on), CPU and egress scale with traffic. For multi-tenant SaaS, use shared infrastructure per user or pricing tier to optimize costs.

### Render

**Why Good for Dexto:**
- ✅ Traditional persistent filesystem (no refactoring needed)
- ✅ Docker deployment with full control
- ✅ WebSocket support with sticky sessions
- ✅ Managed Postgres, Redis databases
- ✅ Generous free tier for testing
- ✅ Simple, predictable pricing

**Challenges:**
- ⚠️ **NO Scale to Zero for paid services** (critical limitation!)
- ⚠️ Free tier services stop after 15 minutes inactivity (not viable for production)
- ⚠️ Free tier databases deleted after 90 days
- ⚠️ Always-on paid services = paying for idle time
- ⚠️ More expensive than Railway for always-on workloads

**Architecture:**
- Deploy as standard Node.js container
- Persistent disk storage ($0.25/GB-month)
- Render-managed Postgres
- Can use existing Hono server as-is

#### Pricing Analysis (November 2025)

**Container Tiers:**
```yaml
Free:
├─ RAM: 512 MB
├─ CPU: 0.1 shared
├─ Cost: $0/month
├─ Limits: Stops after 15 min inactivity
└─ Bandwidth: 100 GB included

Starter:
├─ RAM: 512 MB
├─ CPU: 0.5 shared
├─ Cost: $9/month (always-on, no scale-to-zero!)
└─ Bandwidth: 100 GB included

Standard:
├─ RAM: 2 GB
├─ CPU: 1 dedicated
├─ Cost: $25/month (always-on)
└─ Bandwidth: 100 GB included

Pro:
├─ RAM: 4 GB
├─ CPU: 2 dedicated
├─ Cost: $85/month (always-on)
└─ Bandwidth: 500 GB included

Pro Plus:
├─ RAM: 8 GB
├─ CPU: 4 dedicated
├─ Cost: $175/month (always-on)
└─ Bandwidth: 500 GB included
```

**Additional Costs:**
- Persistent disk: $0.25/GB-month
- Bandwidth overage: Varies by plan tier
- Build minutes: Prorated by second

#### Multi-Agent Cost Scenarios

**Scenario 1: Shared container (100 users)**
```yaml
1 Standard instance (2GB):
├─ Base cost: $25/month (always-on, no scale-to-zero)
├─ Storage: 10 GB × $0.25 = $2.50/month
└─ Total: ~$27.50/month for 100 users

Note: Similar cost to Railway but NO scale-to-zero option
```

**Scenario 2: Separate containers (100 users)**
```yaml
100 Starter instances (512MB each):
├─ Base cost: 100 × $9 = $900/month (always-on!)
├─ Storage: 100 × $0.25 = $2.50/month
└─ Total: ~$902.50/month for 100 users

Why expensive:
- No scale-to-zero for paid services
- Even idle agents cost $9/month each
- Cheapest paid tier is $9 (vs Railway's usage-based)
```

#### Critical Limitation: No Scale-to-Zero for Paid Services

```
Free tier: Scale-to-zero (stops after 15 min) ← Not viable for production
Paid tiers: ALWAYS-ON (no scale-to-zero option) ← Pay for idle time

This is a fundamental limitation compared to Railway, Fly.io, and Heroku Eco.
```

#### Cost Comparison

| Deployment | Render | Railway | Notes |
|-----------|--------|---------|-------|
| **Single 2GB container** | $25/mo | $28/mo | Render slightly cheaper but no flexibility |
| **100 × 512MB separate** | $900/mo | $513/mo (always-on) or $9/mo (scale-to-zero) | Render 75% more expensive |
| **Scale-to-zero support** | ❌ NO (paid tiers) | ✅ YES | Critical difference |

**Recommendation:**
- ❌ **Not recommended** for multi-tenant SaaS requiring per-user isolation
- ✅ **Good for**: Single shared container with always-on workload
- ✅ **Good for**: Prototyping on free tier (15 min timeout acceptable)

### Fly.io

**Why Good for Dexto:**
- ✅ True pay-as-you-go pricing (per second billing)
- ✅ **Scale to Zero supported** (`auto_stop_machines = true`)
- ✅ Global edge deployment (similar to CloudFlare)
- ✅ WebSocket support with auto-scaling
- ✅ Persistent volumes
- ✅ Smallest machine size: 256MB (vs Railway's 512MB)
- ✅ No base subscription fee (pure usage-based)

**Challenges:**
- ⚠️ Complex pricing (many variables, can be unpredictable)
- ⚠️ Egress costs vary by region ($0.02-$0.12/GB)
- ⚠️ Minimum stopped machine cost: $0.15/GB-month (root filesystem storage)
- ⚠️ Paid support required ($29/mo) for production use
- ⚠️ Cold start delays when waking from scale-to-zero

**Architecture:**
- Deploy as micro VMs
- Persistent volumes ($0.15/GB-month)
- Can run Postgres as Fly machines
- Supports multi-region deployment

#### Pricing Analysis (November 2025)

**Machine Types:**
```yaml
Shared CPU (shared-cpu-1x):
├─ 256 MB RAM: $0.0028/hour = $2.02/month (if always-on)
├─ 512 MB RAM: ~$4/month
├─ 1 GB RAM: ~$7/month
├─ 2 GB RAM: ~$12/month
└─ Scale-to-zero: $0.15/GB-month (stopped machine storage)

Performance CPU (performance-1x):
├─ 2 GB RAM: $0.0447/hour = $32.19/month (if always-on)
├─ 4 GB RAM: ~$64/month
└─ Dedicated CPU resources (consistent performance)
```

**Additional Costs:**
- **Storage**: $0.15/GB-month (volumes and stopped machines)
- **Egress**:
  - North America/Europe: $0.02/GB
  - Asia Pacific: $0.04/GB
  - Africa/India: $0.12/GB
- **IPv4**: $2/month (per IP)
- **Support**: $29/month (Standard) for production use

**Machine Reservations (40% discount):**
- Prepay annually for committed compute
- Shared: $36/year = $3/month effective
- Performance: $144/year = $12/month effective

#### Multi-Agent Cost Scenarios

**Scenario 1: Shared container (100 users, always-on)**
```yaml
1 shared-cpu-1x with 2GB:
├─ Compute: $12/month (always-on)
├─ Storage: 10 GB × $0.15 = $1.50/month
├─ Egress: 100 GB × $0.02 = $2.00/month
├─ Support: $29/month (required for production)
└─ Total: ~$44.50/month for 100 users

Note: More expensive than Railway ($28) due to $29 support fee
```

**Scenario 2: Separate machines with scale-to-zero (100 users)**
```yaml
100 shared-cpu-1x with 256MB each:
├─ Compute (only when active):
│   ├─ Average: 30 msgs/month, 3 min per msg = 90 min/month active
│   ├─ 100 users × 90 min × (1/60) hours × $0.0028 = $0.42/month
├─ Stopped machine storage:
│   ├─ 100 × 0.256 GB × $0.15 = $3.84/month
├─ Egress: 100 GB × $0.02 = $2.00/month
├─ Support: $29/month
└─ Total: ~$35.26/month for 100 users

Why cheaper than Railway Scale-to-Zero:
- Smaller minimum size (256MB vs 512MB)
- Per-second billing
- But: $29 support fee adds significant base cost
```

**Scenario 3: Always-on separate machines (100 users, no scale-to-zero)**
```yaml
100 shared-cpu-1x with 256MB each:
├─ Compute: 100 × $2.02 = $202/month (always-on)
├─ Storage: $3.84/month
├─ Egress: $2.00/month
├─ Support: $29/month
└─ Total: ~$236.84/month for 100 users

Note: Cheaper than Railway always-on ($513) but more expensive than Railway scale-to-zero ($9)
```

#### Cost Comparison

| Deployment Strategy | Fly.io | Railway | Winner |
|---------------------|--------|---------|--------|
| **Shared container (always-on)** | $44.50 | $28 | Railway (no support fee) |
| **Scale-to-zero (100 × 256MB)** | $35.26 | $9 | Railway (no stopped machine storage) |
| **Always-on (100 × 256MB)** | $237 | $513 | Fly.io (smaller machines) |

**Key Insight:**
- Fly.io's **$29/month support fee** makes it uncompetitive for small deployments
- Fly.io's **stopped machine storage** ($0.15/GB-month) adds cost to scale-to-zero
- Railway's **true zero cost** when scaled to zero beats Fly.io for sporadic usage
- Fly.io wins for **always-on separate containers** due to smaller machine sizes (256MB)

**Recommendation:**
- ❌ **Not recommended** for cost-conscious SaaS (< 100 users)
- ✅ **Good for**: Global edge deployment with multi-region requirements
- ✅ **Good for**: Workloads needing 256MB machines (smaller than Railway's 512MB)
- ✅ **Good for**: Apps with committed usage (use 40% discount reservations)

### Heroku

**Why Good for Dexto:**
- ✅ Most mature PaaS (industry standard)
- ✅ **Eco dynos with scale-to-zero** ($5/mo for 1000 hours)
- ✅ Simple, predictable pricing
- ✅ WebSocket support (Router 2.0)
- ✅ Massive add-on ecosystem (Redis, Postgres, monitoring, etc.)
- ✅ Zero-config CI/CD from Git

**Challenges:**
- ⚠️ Most expensive option for production workloads
- ⚠️ Eco dynos: Only 2 concurrent dynos max (1 web + 1 worker)
- ⚠️ Basic dynos: No horizontal scaling (1 dyno per process type)
- ⚠️ Eco/Basic: Shared CPU (inconsistent performance)
- ⚠️ Production-grade Standard dynos: $25/month minimum

**Architecture:**
- Deploy via Git push or GitHub integration
- Heroku-managed Postgres ($9/mo mini tier)
- Process-based scaling (web, worker, etc.)
- Add-ons for Redis, monitoring, logging

#### Pricing Analysis (November 2025)

**Dyno Tiers:**
```yaml
Eco Dynos:
├─ RAM: 512 MB
├─ CPU: Shared (burstable)
├─ Cost: $5/month for 1000 hours (shared across all Eco dynos)
├─ Scale-to-zero: Yes (sleeps after 30 min inactivity)
├─ Limits: Max 2 concurrent dynos (e.g., 1 web + 1 worker)
└─ Hours consumed: Only when awake

Basic Dynos:
├─ RAM: 512 MB
├─ CPU: Shared (burstable)
├─ Cost: $7/month per dyno (always-on, no scale-to-zero)
├─ Limits: 1 dyno per process type, no horizontal scaling
└─ WebSocket: Supported (Router 2.0)

Standard-1X (Production):
├─ RAM: 512 MB
├─ CPU: Dedicated 1X
├─ Cost: $25/month per dyno (always-on)
├─ Scaling: Unlimited horizontal scaling
└─ Performance: Consistent, not shared
```

**Database:**
- Mini Postgres: $9/month (10K rows, 1GB storage)
- Basic Postgres: $50/month (10M rows, 64GB storage)

#### Multi-Agent Cost Scenarios

**Scenario 1: Shared Eco dyno (100 users)**
```yaml
1 Eco dyno (scale-to-zero enabled):
├─ Dyno: $5/month for 1000 hours
├─ Actual usage: ~200 hours/month (mostly sleeping)
├─ Postgres Mini: $9/month
└─ Total: ~$14/month for 100 users

Extremely cost-effective for low-traffic shared workload!
```

**Scenario 2: Multiple Eco dynos (can't exceed 2 concurrent)**
```yaml
2 Eco dynos (1 web + 1 worker):
├─ Dyno: $5/month for 1000 hours (shared pool)
├─ Actual usage: ~400 hours/month total
├─ Postgres Mini: $9/month
└─ Total: ~$14/month

Note: Can't deploy 100 separate Eco dynos (max 2 concurrent)
```

**Scenario 3: Separate Basic dynos (always-on, 100 users)**
```yaml
100 Basic dynos (512MB each):
├─ Dynos: 100 × $7 = $700/month (always-on)
├─ Postgres: $50/month (need larger DB)
└─ Total: ~$750/month for 100 users

Note: No horizontal scaling within Basic tier (1 dyno per process type)
This architecture is not supported - Basic dynos can't scale horizontally
```

**Scenario 4: Production with Standard dynos (shared container)**
```yaml
1 Standard-1X dyno (2GB needed):
├─ Dyno: $50/month (2× Standard-1X for 1GB each stacked)
├─ Postgres Mini: $9/month
└─ Total: ~$59/month for 100 users

Note: Need to stack multiple Standard-1X to get 2GB
```

#### Critical Limitation: Eco Dyno Constraints

```
Eco dynos are designed for low-traffic apps:
├─ Max 2 concurrent dynos per account
├─ Sleep after 30 min inactivity
├─ Shared 1000 hours/month pool
└─ Can't deploy 100 separate user agents on Eco tier

Viable strategies:
1. Shared Eco dyno (all users in one process) ← Only realistic option
2. Upgrade to Basic ($700/mo for 100 always-on) ← Too expensive
3. Upgrade to Standard ($2,500+/mo for 100 scaled) ← Way too expensive
```

#### Cost Comparison

| Deployment Strategy | Heroku | Railway | Render | Fly.io |
|---------------------|--------|---------|--------|--------|
| **Shared container** | $14 (Eco) | $28 | $27.50 | $44.50 |
| **100 separate (scale-to-zero)** | ❌ Not possible (Eco limit) | $9 | ❌ Not supported | $35.26 |
| **100 separate (always-on)** | ❌ $750 (Basic) | $513 | $900 | $237 |

**Key Insights:**
- **Heroku Eco = Best for shared container** ($14/mo including DB!)
- **Heroku fails for multi-tenant isolation** (Eco limit: 2 dynos max)
- **Heroku Basic/Standard = Most expensive** for production multi-tenant

**Recommendation:**
- ✅ **BEST for**: Single shared container, low-traffic SaaS ($14/mo unbeatable)
- ❌ **Not viable**: Per-user isolated containers (Eco limit blocks this)
- ❌ **Not recommended**: Production multi-tenant (too expensive at scale)
- ✅ **Good for**: Prototyping, MVPs, developer experience

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

## Comprehensive Platform Comparison

### Cost Summary (100 Users, Multiple Deployment Strategies)

| Platform | Shared Container | 100 Separate (Scale-to-Zero) | 100 Separate (Always-On) | Winner For |
|----------|------------------|------------------------------|---------------------------|------------|
| **Heroku Eco** | **$14/mo** (incl. DB) | ❌ Not possible (2 dyno limit) | $750/mo (Basic) | 🏆 **Best: Shared low-traffic** |
| **Railway** | $28/mo | **$9/mo** | $513/mo | 🏆 **Best: Multi-tenant scale-to-zero** |
| **Render** | $27.50/mo | ❌ Not supported (no scale-to-zero) | $900/mo | ⚠️ Limited use cases |
| **Fly.io** | $44.50/mo (incl. $29 support) | $35.26/mo | **$237/mo** | 🏆 **Best: Always-on isolation** |
| **CloudFlare DO** | $28/mo (1 DO, minimal activity) | N/A (pay-per-use model) | **$871/mo** (high activity) | 🏆 **Best: Global edge, burst traffic** |

### Feature Comparison Matrix

| Feature | Railway | Render | Fly.io | Heroku | CloudFlare DO |
|---------|---------|--------|--------|--------|---------------|
| **Scale to Zero** | ✅ Yes (true $0) | ❌ No (paid tiers) | ✅ Yes ($0.15/GB storage) | ✅ Yes (Eco only) | ✅ Yes (true $0) |
| **WebSocket Support** | ✅ Yes | ✅ Yes (sticky sessions) | ✅ Yes | ✅ Yes (Router 2.0) | ✅ Yes (Hibernation) |
| **Minimum Container** | 512 MB | 512 MB | **256 MB** | 512 MB | 128 MB (DO) |
| **Base Subscription** | $5/mo (account) | None | None | $5/mo (1000 hrs) | $5/mo (Workers Paid) |
| **Support Fee** | None | None | **$29/mo** (production) | None | None |
| **Persistent Filesystem** | ✅ Yes | ✅ Yes | ✅ Yes (volumes) | ✅ Yes (ephemeral) | ❌ No (R2 only) |
| **Global Edge** | ❌ No (single region) | ❌ No (multi-region manual) | ✅ Yes | ❌ No | ✅ Yes (automatic) |
| **Billing Model** | Usage-based | Fixed tiers | Pay-as-you-go | Fixed tiers + hours | Pay-per-use |
| **Max Concurrent (Free/Low Tier)** | Unlimited | Unlimited | Unlimited | **2 dynos (Eco)** | Unlimited |
| **Cold Start Time** | ~1s | N/A (always-on) | ~1s | ~10s (Eco) | < 1s |

### Technical Capabilities

| Capability | Railway | Render | Fly.io | Heroku | CloudFlare DO |
|------------|---------|--------|--------|--------|---------------|
| **Multi-Region Deployment** | ❌ Manual only | ❌ Manual only | ✅ Automatic | ❌ Single region | ✅ Automatic (edge) |
| **Horizontal Scaling** | ✅ Yes | ✅ Yes (Pro+) | ✅ Yes | ✅ Yes (Standard+) | ✅ Yes (millions of DOs) |
| **Custom Domains** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Database Managed** | ✅ Postgres, Redis, MySQL | ✅ Postgres, Redis | ✅ Postgres | ✅ Postgres (add-on) | ❌ DIY (D1 or external) |
| **Docker Support** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes (via Dockerfile) | ⚠️ Limited (Workers runtime) |
| **CI/CD Integration** | ✅ GitHub, GitLab | ✅ GitHub, GitLab | ✅ GitHub Actions | ✅ Git push, GitHub | ✅ GitHub Actions, Wrangler |

### Pricing Transparency & Predictability

| Platform | Predictability | Hidden Costs | Notes |
|----------|----------------|--------------|-------|
| **Heroku** | ⭐⭐⭐⭐⭐ Excellent | Minimal | Fixed pricing, clear tiers |
| **Railway** | ⭐⭐⭐⭐ Very Good | Minimal | Simple formula: base + (GB-min × rate) |
| **Render** | ⭐⭐⭐⭐ Very Good | Minimal | Fixed tiers, straightforward |
| **Fly.io** | ⭐⭐⭐ Good | **$29/mo support fee** | Multiple variables, complex egress |
| **CloudFlare DO** | ⭐⭐⭐ Good | Duration charges can surprise | Pay-per-use = unpredictable for high activity |

### Developer Experience

| Platform | Ease of Deployment | Learning Curve | Documentation | Maturity |
|----------|-------------------|----------------|---------------|----------|
| **Heroku** | ⭐⭐⭐⭐⭐ | Very Low | Excellent | Industry standard (20+ years) |
| **Railway** | ⭐⭐⭐⭐⭐ | Very Low | Good | Newer (5 years) |
| **Render** | ⭐⭐⭐⭐ | Low | Good | Established (7 years) |
| **Fly.io** | ⭐⭐⭐ | Moderate | Excellent | Growing (6 years) |
| **CloudFlare DO** | ⭐⭐ | High | Good | Newer (4 years GA) |

### Final Recommendations by Use Case

#### 1. **Shared Container (All Users in One Service)**
```
🥇 Heroku Eco: $14/mo (includes Postgres!)
🥈 Railway: $28/mo
🥉 Render: $27.50/mo
❌ Avoid: Fly.io ($44.50 with support fee), CloudFlare ($871 if high activity)
```

#### 2. **Multi-Tenant with Scale-to-Zero (Per-User Isolation)**
```
🥇 Railway: $9/mo (true $0 when sleeping)
🥈 Fly.io: $35.26/mo (stopped machine storage adds cost)
❌ Not Possible: Heroku (Eco 2-dyno limit), Render (no scale-to-zero)
❌ Not Applicable: CloudFlare (different model)
```

#### 3. **Always-On Multi-Tenant (Per-User Containers)**
```
🥇 Fly.io: $237/mo (smallest machines: 256MB)
🥈 Railway: $513/mo (minimum: 512MB)
🥉 Heroku Basic: $750/mo
❌ Avoid: Render ($900/mo), CloudFlare ($871/mo duration charges)
```

#### 4. **Global Edge Deployment (Low Latency Worldwide)**
```
🥇 CloudFlare DO: Best edge network, WebSocket Hibernation
🥈 Fly.io: Multi-region, but manual configuration
❌ Not Supported: Railway, Render, Heroku (single/manual regions)
```

#### 5. **High-Burst, Low-Average Traffic (Sporadic Usage)**
```
🥇 CloudFlare DO: True pay-per-use (only pay for active processing)
🥈 Railway: Scale-to-zero with true $0 cost
🥉 Fly.io: Scale-to-zero but stopped machine storage
❌ Avoid: Render (always-on), Heroku Eco (2-dyno limit)
```

#### 6. **Cost-Conscious Prototype/MVP (<$20/month)**
```
🥇 Heroku Eco: $14/mo (shared container + DB, unbeatable)
🥈 Railway: $9/mo (scale-to-zero multi-tenant)
🥉 Render Free: $0/mo (15 min timeout, testing only)
```

#### 7. **Traditional Architecture (Persistent Filesystem Required)**
```
🥇 Railway: Best DX, scale-to-zero, flexible pricing
🥈 Render: Solid, but no scale-to-zero for paid
🥉 Heroku: Great DX, but expensive beyond Eco tier
❌ Not Supported: CloudFlare DO (requires R2 for storage)
```

### AWS Lambda

**Moderate fit:**
- ✅ Full Node.js support
- ✅ EFS for persistent filesystem (optional)
- ✅ Native S3 integration
- ⚠️ Cold starts (less than CloudFlare)
- ⚠️ More complex pricing model

**Best use:** When already in AWS ecosystem

## Real-World Deployment Costs: Large-Scale Multi-Tenant SaaS

### Scenario: 1000 Users × 10 Agents Each = 10,000 Total Agents

This section analyzes real-world costs for deploying Dexto at scale with per-user or per-agent isolation.

#### Architecture Options

**Option 1: One Container Per User (1000 containers)**
```
User 1 Container (512 MB):
├─ Agent 1 (DextoAgent instance)
├─ Agent 2 (DextoAgent instance)
├─ ...
└─ Agent 10 (DextoAgent instance)

User 2 Container:
├─ Agent 1-10 (DextoAgent instances)

... (1000 total containers)
```

**Option 2: One Container Per Agent (10,000 containers)**
```
User 1:
├─ Agent 1 Container (512 MB)
├─ Agent 2 Container (512 MB)
├─ ...
└─ Agent 10 Container (512 MB)

... (10,000 total containers)
```

#### Cost Analysis: Current Architecture (WebSocket)

**Critical Issue**: WebSocket connections prevent scale-to-zero on Railway/Fly.io/Heroku even without explicit ping/pong heartbeats due to:
- Client-side connection management (browser keepalive)
- TCP-level keepalive packets
- Load balancer/proxy behavior

**Result**: Containers stay awake 24/7, paying for idle time.

**Option 1: 1000 Containers (One Per User)**
```yaml
Railway Pricing (Always-On):
├─ Base subscription: $5/month (per account)
├─ Container size: 512 MB per user
├─ Compute: 1000 × 512 MB × 730 hours × 60 min = 21,900,000 GB-minutes
├─ Cost: 21,900,000 × $0.000231 = $5,058.90/month
└─ Total: ~$5,064/month for 1000 users (10,000 agents)

Per-user cost: $5.06/month
Per-agent cost: $0.51/month
```

**Option 2: 10,000 Containers (One Per Agent)**
```yaml
Railway Pricing (Always-On):
├─ Base subscription: $5/month
├─ Container size: 512 MB per agent
├─ Compute: 10,000 × 512 MB × 730 hours × 60 min = 219,000,000 GB-minutes
├─ Cost: 219,000,000 × $0.000231 = $50,589/month
└─ Total: ~$50,594/month for 10,000 agents

Per-agent cost: $5.06/month

Note: Option 1 is 10x cheaper due to resource sharing
```

#### Cost Analysis: Proposed Architecture (REST + SSE)

**Key Change**: Remove persistent WebSocket connections, use REST API + Server-Sent Events (SSE) for streaming.

**Benefits**:
- Connection closes after each request completes
- No outbound packets when idle → container sleeps after 10 minutes
- Zero compute charges when sleeping (Railway/Heroku/Fly.io)

**Assumptions**:
- Average user: 10 messages/month across all agents
- Average message: 3 minutes processing time (including LLM streaming)

**Option 1: 1000 Containers with Scale-to-Zero (Recommended)**
```yaml
Railway Pricing (Scale-to-Zero):
├─ Base subscription: $5/month
├─ Active time per user: 10 msgs × 3 min = 30 min/month
├─ Compute per user: 30 min × 0.5 GB = 15 GB-minutes
├─ Compute cost per user: 15 × $0.000231 = $0.00347/month
├─ Total compute: 1000 × $0.00347 = $3.47/month
├─ Storage: 1000 × 0.1 GB × $0.25 = $25/month
└─ Total: ~$33/month for 1000 users (10,000 agents)

Per-user cost: $0.033/month (~$0.40/year)
Per-agent cost: $0.0033/month (~$0.04/year)

Savings vs WebSocket: 99.3% ($5,064 → $33)
```

**Option 2: 10,000 Containers with Scale-to-Zero**
```yaml
Railway Pricing (Scale-to-Zero):
├─ Base subscription: $5/month
├─ Active time per agent: 1 msg × 3 min = 3 min/month (avg)
├─ Compute per agent: 3 min × 0.5 GB = 1.5 GB-minutes
├─ Compute cost per agent: 1.5 × $0.000231 = $0.000347/month
├─ Total compute: 10,000 × $0.000347 = $3.47/month
├─ Storage: 10,000 × 0.05 GB × $0.25 = $125/month
└─ Total: ~$133/month for 10,000 agents

Per-agent cost: $0.0133/month (~$0.16/year)

Note: Still 4x more expensive than Option 1 (higher storage costs)
```

#### CloudFlare Durable Objects: Why It's More Expensive at Scale

**The Duration Charge Problem**:

CloudFlare charges for **active processing time per Durable Object**, which adds up quickly with many concurrent sessions:

```yaml
CloudFlare DO Pricing (100 concurrent sessions, high activity):
├─ 3M messages/month × 3 min per message = 9M minutes total
├─ At 128 MB per DO: 9M min × 0.128 GB = 1.152M GB-minutes
├─ Duration cost: (1.152M - 400K free) × $12.50/1M GB-sec × 60 = ~$859/month
├─ Plus Workers base: $5/month
└─ Total: ~$864/month for 100 users

Scaling to 1000 users: ~$8,640/month (10x)
```

**Why CloudFlare is expensive here**:
- Each user session gets isolated DO (not shared containers)
- All processing time across all sessions is summed
- LLM streaming time counts as "active" even when waiting for response
- Railway shared container: 87,600 GB-min/month (flat rate)
- CloudFlare: 1.152M GB-min/month (per-use, adds up)

**When CloudFlare is actually cheaper**:
- Low traffic: Within 400K GB-sec free tier (~$5/mo vs Railway $28/mo)
- Burst traffic: Only pay for active spikes (scale-to-zero between bursts)
- Global edge: Low latency worldwide requirements
- Unpredictable patterns: Handles 10-100x traffic spikes automatically

**CloudFlare is NOT cost-effective for**:
- Sustained moderate-to-high activity (Railway/Heroku cheaper)
- Predictable workloads (flat rate beats pay-per-use)
- High message volume across many users

#### Comprehensive Cost Comparison: 1000 Users × 10 Agents

| Platform & Strategy | Monthly Cost | Per-User | Per-Agent | Notes |
|---------------------|--------------|----------|-----------|-------|
| **Railway (1 container/user, WebSocket)** | $5,064 | $5.06 | $0.51 | Always-on, can't sleep |
| **Railway (1 container/user, REST+SSE)** | **$33** | **$0.033** | **$0.0033** | 🏆 Best cost, scale-to-zero |
| **Railway (1 container/agent, WebSocket)** | $50,594 | $50.59 | $5.06 | 10x worse than shared |
| **Railway (1 container/agent, REST+SSE)** | $133 | $0.13 | $0.0133 | 4x worse (storage) |
| **Heroku Eco (1 container/user)** | $14 | $0.014 | $0.0014 | If fits in 1000 hrs/mo |
| **Fly.io (1 container/user, REST+SSE)** | $62 | $0.062 | $0.0062 | +$29 support fee hurts |
| **CloudFlare DO (per-session DOs)** | $8,640 | $8.64 | $0.86 | Too expensive at scale |

#### Deployment Architecture: Recommended Approach

**One Container Per User + REST/SSE + Scale-to-Zero**

**Modified Dockerfile**:
```dockerfile
# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built packages (same as current)
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

# Environment - overridden per container deployment
ENV NODE_ENV=production \
    PORT=3001 \
    USER_ID=${USER_ID} \
    AGENT_CONFIG_SOURCE=s3://dexto-agents/${USER_ID}/agents/ \
    DATABASE_URL=postgresql://...

EXPOSE 3001

# Server mode: REST API + SSE (no persistent WebSocket)
CMD ["sh", "-c", "node packages/cli/dist/index.js --mode server --user $USER_ID"]
```

**Railway Deployment Pattern**:
```bash
# Deploy 1000 containers, one per user
for user_id in $(cat user_ids.txt); do
  railway service create "agent-${user_id}"
  railway up \
    --service "agent-${user_id}" \
    --env USER_ID=${user_id} \
    --env AGENT_CONFIG_SOURCE=s3://dexto-agents/${user_id}/agents/ \
    --env DATABASE_URL=${DATABASE_URL}
done
```

**Container Behavior**:
- User sends message → Container wakes (cold start ~1s)
- Agent processes message → SSE streams response chunks
- Response complete → SSE connection closes
- 10 minutes no requests → Container sleeps
- No compute charges while sleeping → $0 idle cost

**Benefits**:
- ✅ **$33/month total** for 1000 users (10,000 agents)
- ✅ **$0.033/user/month** = ~$0.40/year per user
- ✅ **99.3% cost savings** vs WebSocket always-on
- ✅ **User isolation** (security, stability, independent scaling)
- ✅ **True scale-to-zero** (only pay when active)
- ✅ **Linear scaling** (add users without infrastructure redesign)

**Tradeoffs**:
- ⚠️ Need to migrate from WebSocket to REST + SSE (documented separately)
- ⚠️ Cold start delay (~1s) when user returns after inactivity
- ⚠️ Managing 1000 Railway services (can automate with IaC)
- ⚠️ No bidirectional real-time features (SSE is server → client only)

**Migration Path**:
See [WebSocket to SSE Migration Plan](./websocket-to-sse-migration.md) for detailed architecture changes, implementation steps, and client-side modifications.

#### Key Insights Summary

1. **WebSocket prevents scale-to-zero** on all platforms (Railway, Heroku, Fly.io) due to persistent connections keeping containers awake 24/7.

2. **One container per user is 10x cheaper** than one container per agent due to resource sharing ($5,064 vs $50,594 with WebSocket, $33 vs $133 with REST+SSE).

3. **REST + SSE enables 99.3% cost savings** by allowing true scale-to-zero ($5,064 → $33 for 1000 users).

4. **CloudFlare DO is expensive at sustained scale** ($8,640/mo for 1000 users) but excellent for low-traffic or burst workloads.

5. **Railway is the clear winner** for multi-tenant SaaS with per-user isolation when using REST + SSE architecture.

6. **Heroku Eco is unbeatable** for low-traffic shared container workloads ($14/mo including database) but can't support 1000 separate containers.

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
