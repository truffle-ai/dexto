# Serverless Refactors - Remove Filesystem Dependencies from Core

## Goal
Remove all filesystem dependencies from the core runtime to enable serverless deployment while maintaining developer experience for local/file-based workflows.

## Current State

// TODO: refer to the prompt-migration plan as well here somewhere in the doc for completeness
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

// TODO: Add more examples here using diffeent URIs than just file for completeness
### Overview
```
┌─────────────────────────────────────────────────────┐
│ Config File (with templates)                        │
│   prompts:                                          │
│     - type: file                                    │
│       file: "${{dexto.agent_dir}}/prompts/base.md" │
│       dataSource: local  # implicit default         │
└─────────────────────────────────────────────────────┘
                     ↓
         Agent-Management: Load & Expand
                     ↓
┌─────────────────────────────────────────────────────┐
│ Resolved Config (absolute paths/URIs)               │
│   prompts:                                          │
│     - type: file                                    │
│       file: "file:///opt/agents/prompts/base.md"   │
│       dataSource: local                             │
└─────────────────────────────────────────────────────┘
                     ↓
         Core: Uses Injected ResourceLoader
                     ↓
┌─────────────────────────────────────────────────────┐
│ ConfigPromptProvider                                │
│   → resourceLoader.load(                            │
│       "file:///opt/agents/prompts/base.md",         │
│       dataSources["local"]                          │
│     )                                               │
└─────────────────────────────────────────────────────┘
                     ↓
         Agent-Management: Loads Resource
                     ↓
        ┌────────────────────────────┐
        │ MultiSourceResourceLoader  │
        │  - local → fs.readFile     │
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
   - Template variable agent dir mainly is primarily a CLI feature which will be local
   - This is currently the only template variable. We can see how to handle other template variables differently if they make sense in the cloud
   - After expansion, everything is a URI (file://, s3://, https://)

2. **All Paths Must Be Absolute**
   - Local files: `file:///absolute/path/to/file.md`
   - S3 objects: `s3://bucket/key/path`
   - HTTP resources: `https://cdn.example.com/path`
   - No relative paths allowed anywhere in core

// TODO: be more explicit about how this handles credentials. i think avoiding envprefix and specifying exact creds needed per source is better
3. **DataSources for Credentials**
   ```yaml
   dataSources:
     local:
       type: local  # Built-in, always available

     company-s3:
       type: s3
       bucket: acme-corp-shared
       region: us-east-1
       envPrefix: COMPANY_AWS  # Uses COMPANY_AWS_ACCESS_KEY_ID, etc.

     team-s3:
       type: s3
       bucket: team-engineering
       region: us-west-2
       envPrefix: TEAM_AWS

     cdn:
       type: http
       baseUrl: https://cdn.example.com
       headers:
         Authorization: Bearer ${CDN_TOKEN}
   ```

4. **Resources Reference DataSources**
   ```yaml
   prompts:
     # Local file (implicit dataSource: local)
     - type: file
       file: "file:///opt/agents/local.md"
       dataSource: local  # Default, can be omitted

     # S3 resource (explicit dataSource required)
     - type: file
       file: "s3://acme-corp-shared/prompts/base.md"
       dataSource: company-s3  # Must reference defined dataSource

     # HTTP resource (explicit dataSource required)
     - type: file
       file: "https://cdn.example.com/prompts/latest.md"
       dataSource: cdn  # Must reference defined dataSource
   ```

5. **Resource Loader Injected into Core**
   - Core defines `ResourceLoader` interface
   - Agent-management implements `MultiSourceResourceLoader`
   - Injected into services that need to load resources
   - Core has zero filesystem/cloud SDK dependencies

## Schema Design

### DataSources Configuration

```typescript
// packages/core/src/agent/schemas.ts

// TODO: may not always be available!
const LocalDataSourceSchema = z.object({
    type: z.literal('local'),
    description: z.string().optional(),
}).describe('Local filesystem data source (always available)');

const S3DataSourceSchema = z.object({
    type: z.literal('s3'),
    bucket: z.string().describe('S3 bucket name'),
    region: z.string().describe('AWS region'),
    envPrefix: z.string().optional()
        .describe('Environment variable prefix for credentials (e.g., "COMPANY_AWS" → COMPANY_AWS_ACCESS_KEY_ID)'),
    description: z.string().optional(),
}).describe('AWS S3 data source');

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
    LocalDataSourceSchema,
    S3DataSourceSchema,
    HttpDataSourceSchema,
]);

const DataSourcesSchema = z.record(z.string(), DataSourceSchema)
    .default({ local: { type: 'local' } })
    .describe('Named data sources for loading external resources');

// Add to AgentConfigSchema
export const AgentConfigSchema = z.object({
    // ... existing fields

    dataSources: DataSourcesSchema,
});
```

### Validation Rules

// TODO: be more explicit here how we will enforce this for every schema we have (including plugins, file prompt contributor, etc.)
1. **All resource URIs must be absolute**
   ```typescript
   // Example for FilePromptSchema (from prompt refactor plan)
   const FilePromptSchema = z.object({
       type: z.literal('file'),
       file: z.string()
           .superRefine((uri, ctx) => {
               // Must be absolute URI: file://, s3://, https://
               try {
                   const url = new URL(uri);
                   const validSchemes = ['file', 's3', 'http', 'https'];
                   const scheme = url.protocol.slice(0, -1);
                   if (!validSchemes.includes(scheme)) {
                       ctx.addIssue({
                           code: z.ZodIssueCode.custom,
                           message: `Invalid URI scheme "${scheme}". Must be one of: ${validSchemes.join(', ')}`,
                       });
                   }
               } catch {
                   ctx.addIssue({
                       code: z.ZodIssueCode.custom,
                       message: 'Must be an absolute URI (file://, s3://, https://). Use ${{dexto.agent_dir}} template for local files.',
                   });
               }
           }),
       dataSource: z.string().default('local')
           .describe('Data source name (must exist in dataSources config)'),
       showInStarters: z.boolean().optional().default(false),
   });
   ```

// TODO: this creates dependencies between schemas so we need to explain how we will handle that
2. **DataSource must exist for remote URIs**
   ```typescript
   // Cross-field validation in AgentConfigSchema
   .superRefine((config, ctx) => {
       // Validate all file references have valid dataSources
       config.prompts?.forEach((prompt, idx) => {
           if (prompt.type === 'file') {
               const dataSource = config.dataSources[prompt.dataSource];
               if (!dataSource) {
                   ctx.addIssue({
                       code: z.ZodIssueCode.custom,
                       message: `Unknown dataSource "${prompt.dataSource}"`,
                       path: ['prompts', idx, 'dataSource'],
                   });
               }

               // Validate URI scheme matches dataSource type
               const url = new URL(prompt.file);
               const scheme = url.protocol.slice(0, -1);
               if (scheme === 's3' && dataSource.type !== 's3') {
                   ctx.addIssue({
                       code: z.ZodIssueCode.custom,
                       message: `URI uses s3:// but dataSource "${prompt.dataSource}" is type "${dataSource.type}"`,
                       path: ['prompts', idx, 'file'],
                   });
               }
               // Similar checks for http/https
           }
       });
   });
   ```

## Core Interfaces

### ResourceLoader Interface

```typescript
// packages/core/src/resources/loader-interface.ts

/**
 * Core interface for loading resources from various sources
 * Core defines interface, agent-management provides implementation
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
    | LocalDataSource
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
}
```

// TODO: we should do the easiest stuff first that aligns with our previous plan (the config dir stuff, file prompt migration, before we do all the new features)
## Implementation Plan

### Phase 1: Foundation

1. **Add dataSources schema** (`agent/schemas.ts`)
   - LocalDataSourceSchema, S3DataSourceSchema, HttpDataSourceSchema
   - DataSourcesSchema with default `{ local: { type: 'local' } }`
   - Add to AgentConfigSchema

2. **Create ResourceLoader interface** (`resources/loader-interface.ts`)
   - Define interface (core never implements it)
   - Define error types

3. **Update template expansion** (`agent-management/config/loader.ts`)
   - Add `file://` prefix to expanded absolute paths
   - Template: `${{dexto.agent_dir}}/x` → `file:///opt/agents/x`

4. **Move path validation to schemas**
   - Move plugin validation from service code to schema
   - Consistent validation everywhere

### Phase 2: Agent-Management Implementation

1. **Implement MultiSourceResourceLoader** (`agent-management/resources/resource-loader.ts`)
   - Local: `fs.readFile()`
   - S3: AWS SDK with credential chain (env vars, IAM roles, etc.)
   - HTTP: `fetch()` with custom headers

2. **Credential handling**
   - Local: No credentials needed
   - S3: Standard AWS credential chain
     - `${envPrefix}_ACCESS_KEY_ID` and `${envPrefix}_SECRET_ACCESS_KEY` env vars
     - Falls back to default AWS credentials (IAM roles, etc.)
   - HTTP: Custom headers with env var expansion

### Phase 3: Core Integration

1. **Update service initializer** (`utils/service-initializer.ts`)
   - Remove `configDir` parameter
   - Add `resourceLoader: ResourceLoader` parameter
   - Pass resourceLoader to services that need it

2. **Update SystemPromptManager** (`systemPrompt/manager.ts`)
   - Remove `configDir` parameter
   - Add `resourceLoader: ResourceLoader` parameter
   - Pass to FileContributor

3. **Update FileContributor** (`systemPrompt/contributors.ts`)
   - Remove direct `fs.readFile()` calls
   - Use injected `resourceLoader.load(uri, dataSource)`

4. **Update PluginManager** (`plugins/manager.ts`)
   - Remove `configDir` from options
   - Add `resourceLoader: ResourceLoader`
   - Support loading plugins from S3/HTTP

### Phase 4: Prompt System Integration

1. **Implement ConfigPromptProvider** (per prompt refactor plan)
   - Use resourceLoader to fetch file-based prompts
   - Support all URI schemes

2. **Update CLI enrichment** (`cli/config/prompt-enrichment.ts`)
   - Auto-discovered files get `file://` URIs
   - All use `dataSource: local`

### Phase 5: DextoAgent Updates

// TODO: we should be more explicit about 'config source' that is more generic than config path and describes where the config is stored. we can drop 'agentfilepath' nomenclature, call it getAgentSourceFile instead?

1. **Update constructor**
   - Keep `configPath` for `reload()` and `getAgentFilePath()`
   - But don't pass it to services

2. **Update reload() method**
   - Load config from agent-management
   - ResourceLoader created by agent-management, not passed from outside

3. **Source resolver support** (future work)
   - Support `reload()` from any source (file://, s3://, https://)
   - DataSources allow each source type

## Configuration Examples

### Simple Local Development
```yaml
# No dataSources needed - local is default
prompts:
  - type: file
    file: "${{dexto.agent_dir}}/prompts/base.md"
    # dataSource: local (implicit)
```

After template expansion:
```yaml
prompts:
  - type: file
    file: "file:///opt/agents/prompts/base.md"
    dataSource: local
```

### Production with S3
```yaml
dataSources:
  company-prompts:
    type: s3
    bucket: acme-corp-prompts
    region: us-east-1
    description: "Shared company prompts"

prompts:
  - type: file
    file: "s3://acme-corp-prompts/shared/base-instructions.md"
    dataSource: company-prompts
    showInStarters: true
```

### Multi-Source Configuration
```yaml
dataSources:
  local:
    type: local

  shared-s3:
    type: s3
    bucket: shared-assets
    region: us-east-1
    envPrefix: SHARED

  team-s3:
    type: s3
    bucket: team-engineering
    region: us-west-2
    envPrefix: TEAM

  cdn:
    type: http
    baseUrl: https://cdn.example.com
    headers:
      Authorization: Bearer ${CDN_TOKEN}

prompts:
  # Local custom prompt
  - type: file
    file: "${{dexto.agent_dir}}/custom.md"
    dataSource: local

  # Company-wide shared prompt (S3)
  - type: file
    file: "s3://shared-assets/prompts/company-wide.md"
    dataSource: shared-s3

  # Team-specific prompt (different S3 account)
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
```

## Benefits

### For Serverless Deployment
- ✅ Core has zero filesystem dependencies
- ✅ Core has zero cloud SDK dependencies
- ✅ Works in Lambda, Cloud Run, Cloud Functions
- ✅ No concept of "working directory" in core

### For Multi-Tenant SaaS
- ✅ Each tenant can have different data sources
- ✅ Per-tenant S3 buckets with separate credentials
- ✅ Centralized credential management

### For Enterprise Users
- ✅ Clear separation of credential scopes
- ✅ Audit trail of data source access
- ✅ Support for multiple AWS accounts
- ✅ Support for internal CDNs/APIs

### For Developer Experience
- ✅ Simple local development (templates + local dataSource)
- ✅ Clear errors when dataSource is missing
- ✅ Explicit configuration (no magic)
- ✅ Backward compatible (local is default)

## Migration Path

### For Internal Configs
- Template expansion already works
- Just adds `file://` prefix (non-breaking)
- No action needed

### For Advanced Users (S3/HTTP)
- New feature, opt-in
- Document in examples
- We don't need backward compatibility, few users

## Risks & Mitigation

**Risk**: Credential management complexity
**Mitigation**: Use standard credential chains (AWS SDK, env vars). Document clearly. Needs more research

**Risk**: URI validation bugs
**Mitigation**: Comprehensive schema validation with clear error messages.

**Risk**: Breaking changes for configPath usage
**Mitigation**: Keep configPath in DextoAgent for reload(), just don't propagate to services.

## Future Extensions

Once this is complete:
- Easy to add `type: 'gcs'` (Google Cloud Storage)
- Easy to add `type: 'azure'` (Azure Blob Storage)
- Easy to add `type: 'postgres'` (load from database)
- Plugin bundling can reference remote plugins
- Config itself can be loaded from S3/HTTP (source resolver)

## Testing Strategy

1. **Schema validation tests**
   - Valid dataSources configurations
   - Invalid URI schemes rejected
   - Unknown dataSources rejected
   - Scheme/dataSource type mismatches caught

2. **Resource loader tests**
   - Mock S3 client, verify correct bucket/key
   - Mock fetch, verify headers
   - Credential chain behavior

3. **Integration tests**
   - Load prompts from local files
   - Load prompts from S3 (mocked)
   - Mixed sources in same config

4. **Template expansion tests**
   - Verify `file://` prefix added
   - Security: path traversal still blocked


// TODO: added by human
### open questions
1. How do things like Convex DB, Neon DB, Supabase, and potentially CloudFlare Durable Objects factor into this? I am considering using CloudFlare for our cloud deployment on our proprietary platform, so I want to kind of understand more about those things.
2. How does this impact our entire bundling logic that we have in ../project-based-architecture.md? The idea here is to allow users to define their configs locally and based on where they want to deploy. Maybe they could provide a deployment config or something. We could even convert local files into remote files, upload them somewhere, and push them as part of bundling. But we will need to figure out how we would handle custom code-based stuff as well like plugins and other places that provide custom code.

