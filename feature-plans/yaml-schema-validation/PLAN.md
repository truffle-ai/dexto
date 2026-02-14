# YAML Static Validation via JSON Schema

## Problem

Agent config YAML files (`agents/coding-agent/coding-agent.yml`) have no static validation. Errors are caught at runtime only. This makes it easy to:
- Misspell field names (`systemprompt` instead of `systemPrompt`)
- Use wrong types (`maxIterations: "10"` instead of `maxIterations: 10`)
- Reference invalid tool/storage/plugin types for the image being used
- Miss required fields
- Add unknown fields that are silently ignored

## Goal

Provide real-time, in-editor validation of agent config YAML files with:
- Autocomplete for all config fields
- Red squiggles for unknown/misspelled keys
- Type validation (string, number, boolean, enum)
- Enum suggestions (e.g., `provider: ` → dropdown of valid LLM providers)
- Required field warnings
- Image-aware validation (valid `type` values depend on the image)

## Approach

### Layer 1: Base schema (image-agnostic)

Generate a JSON Schema from `AgentConfigSchema` (lives in `@dexto/agent-config` after the DI refactor).

```typescript
// packages/agent-config/scripts/generate-schema.ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentConfigSchema } from '../src/schemas/agent-config.js';

const schema = zodToJsonSchema(AgentConfigSchema, {
    name: 'DextoAgentConfig',
    $refStrategy: 'none',
});

fs.writeFileSync(
    path.join(__dirname, '../agent-config.schema.json'),
    JSON.stringify(schema, null, 2),
);
```

This schema knows:
- All field names and nesting (`llm.provider`, `sessions.maxSessions`, etc.)
- Types and defaults for every field
- LLM providers and models (from `LLMConfigSchema`)
- Session/approval/telemetry/MCP/prompt config shapes

This schema does NOT know:
- Which `tools[].type` values are valid (depends on image)
- Which `storage.blob.type` values are valid (depends on image)
- Which `plugins[].type` values are valid (depends on image)
- Which `compaction.type` values are valid (depends on image)

For these fields, the base schema allows `type: string` (any value). This gives partial validation — structure is correct even if the type value isn't validated.

### Layer 2: Image-specific schema

Each image can generate a more specific schema that constrains the `type` fields to only the values that image provides.

```typescript
// packages/agent-config/src/schema-generator.ts
export function generateImageAwareSchema(
    baseSchema: JsonSchema,
    image: DextoImageModule,
): JsonSchema {
    const schema = structuredClone(baseSchema);

    // Constrain tools[].type to image's tool factory keys
    const toolTypes = Object.keys(image.tools);   // ['builtin-tools', 'filesystem-tools', 'process-tools', ...]
    setEnumConstraint(schema, 'tools.items.properties.type', toolTypes);

    // Constrain storage.blob.type to image's storage factory keys
    const storageTypes = Object.keys(image.storage);  // ['local', 'in-memory-blob', 'sqlite', 'postgres', ...]
    setEnumConstraint(schema, 'storage.properties.blob.properties.type', blobTypes(storageTypes));
    setEnumConstraint(schema, 'storage.properties.database.properties.type', dbTypes(storageTypes));
    setEnumConstraint(schema, 'storage.properties.cache.properties.type', cacheTypes(storageTypes));

    // Constrain plugins[].type
    const pluginTypes = Object.keys(image.plugins);
    setEnumConstraint(schema, 'plugins.items.properties.type', pluginTypes);

    // Constrain compaction.type
    const compactionTypes = Object.keys(image.compaction);
    setEnumConstraint(schema, 'compaction.properties.type', compactionTypes);

    return schema;
}
```

Image-local would generate a schema where:
- `tools[].type` is one of: `builtin-tools`, `filesystem-tools`, `process-tools`, `todo-tools`, `plan-tools`
- `storage.database.type` is one of: `sqlite`, `postgres`, `in-memory`
- `plugins[].type` is one of: `content-policy`, `response-sanitizer`
- `compaction.type` is one of: `reactive-overflow`, `noop`

### Layer 3: Per-tool config validation (advanced, future)

Each `StorageFactory` / `ToolFactory` has a `configSchema` field. We could generate schemas where `tools[].type: 'filesystem-tools'` constrains the sibling fields to match `filesystemToolsFactory.configSchema`. This uses JSON Schema's `if/then` or `discriminator` patterns:

```json
{
    "tools": {
        "items": {
            "if": { "properties": { "type": { "const": "filesystem-tools" } } },
            "then": {
                "properties": {
                    "allowedPaths": { "type": "array", "items": { "type": "string" } },
                    "readOnly": { "type": "boolean" }
                }
            }
        }
    }
}
```

This is more complex to generate but gives full autocomplete for tool-specific config fields.

## How it works with images

The config schema varies by image. Here's the flow:

```
Developer creates/edits agent YAML
        │
        ▼
IDE reads schema reference from:
  (a) modeline comment in YAML file, OR
  (b) workspace settings (yaml.schemas), OR
  (c) Dexto VS Code extension auto-detects
        │
        ▼
Schema could be:
  - Base schema (image-agnostic) → partial validation, always works
  - Image-specific schema → full validation including valid type values
```

### Generating image-specific schemas

**Option A: Build-time generation (simplest)**

Each image package includes a build step:

```json
// packages/image-local/package.json
{
    "scripts": {
        "generate-schema": "tsx scripts/generate-schema.ts"
    }
}
```

```typescript
// packages/image-local/scripts/generate-schema.ts
import { generateImageAwareSchema, loadBaseSchema } from '@dexto/agent-config';
import imageLocal from '../src/index.js';

const schema = generateImageAwareSchema(loadBaseSchema(), imageLocal);
fs.writeFileSync('agent-config.schema.json', JSON.stringify(schema, null, 2));
```

The generated schema ships with the image package. Users reference it:

```yaml
# yaml-language-server: $schema=./node_modules/@dexto/image-local/agent-config.schema.json
agentId: coding-agent
```

**Option B: CLI command**

```bash
dexto generate-schema --image=@dexto/image-local --output=./.schema.json
```

Generates the schema for the specified image. Workspace settings reference it.

**Option C: VS Code extension (best UX)**

A Dexto VS Code extension that:
1. Detects agent YAML files (pattern: `agents/**/*.yml`)
2. Reads the `image` field from the YAML (e.g., `image: '@dexto/image-local'`)
3. Dynamically loads the image and generates the schema
4. Provides the schema to the YAML language server

This gives zero-config validation that adapts as you change the `image` field.

### For consumer libraries

If someone builds on Dexto and creates their own image:

```typescript
// @acme/image-enterprise
import { extendImage } from '@dexto/agent-config';
import imageLocal from '@dexto/image-local';

const acmeImage = extendImage(imageLocal, {
    tools: { 'jira-tools': jiraFactory, 'slack-tools': slackFactory },
    storage: { 'dynamodb': dynamoFactory },
});

export default acmeImage;
```

They run `dexto generate-schema --image=@acme/image-enterprise` and get a schema that includes `jira-tools`, `slack-tools`, and `dynamodb` as valid types — in addition to everything from image-local.

## Implementation plan

### Phase 1: Base schema generation
- [ ] Add `zod-to-json-schema` dependency to `@dexto/agent-config`
- [ ] Write `generate-schema.ts` script
- [ ] Add `agent-config.schema.json` to package exports
- [ ] Add build step to regenerate on schema changes
- [ ] Document modeline usage for users

### Phase 2: Image-aware schema generation
- [ ] Implement `generateImageAwareSchema()` in `@dexto/agent-config`
- [ ] Add `generate-schema` script to `@dexto/image-local`
- [ ] Ship image-specific schema with `@dexto/image-local`
- [ ] Add `dexto generate-schema` CLI command

### Phase 3: Per-tool config validation (future)
- [ ] Generate `if/then` discriminated schemas from factory `configSchema` fields
- [ ] Full autocomplete for tool-specific, storage-specific, plugin-specific config

### Phase 4: VS Code extension (future)
- [ ] Create `dexto-vscode` extension
- [ ] Auto-detect agent YAML files
- [ ] Dynamic schema generation from `image` field
- [ ] Zero-config validation

## Dependencies

- Requires `AgentConfigSchema` to live in `@dexto/agent-config` (from DI refactor plan)
- Requires `DextoImageModule` interface with typed factory maps (from DI refactor plan)
- `zod-to-json-schema` package (well-maintained, 2M+ weekly downloads)

## Notes

- Base schema (Phase 1) works independently of the DI refactor — can be built against the current `AgentConfigSchema` in core
- Image-aware schemas (Phase 2+) require the DI refactor to be complete (images as typed `DextoImageModule` with factory maps)
- The VS Code extension (Phase 4) is the ultimate UX but not required for value — modeline + workspace settings work today
