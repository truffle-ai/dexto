# Prompt System Refactor

## Goal
Unify the fragmented prompt system and remove filesystem dependencies from core runtime, enabling serverless deployment while maintaining developer experience.

## Current Problems

### 4 Overlapping Provider Types
1. **StarterPromptProvider** - From `config.starterPrompts` (WebUI buttons)
2. **FilePromptProvider** - Auto-discovers files in `commands/` dirs (filesystem dependency)
3. **CustomPromptProvider** - Database-backed, user-created via API
4. **MCPPromptProvider** - From MCP servers

**Issues:**
- Overlapping purposes (starter vs file - both are "quick access prompts")
- Mixed concerns (config-based vs runtime-created vs external)
- Naming confusion ("starter" suggests temporary/beginner, but they're just UI buttons)
- Auto-discovery is implicit and magical (filesystem scanning at runtime)
- Core runtime has filesystem dependencies (`findDextoSourceRoot()`, etc.)

## Proposed Architecture

### Clean Provider Model

| Provider | Source | Purpose | Persisted In |
|----------|--------|---------|--------------|
| **ConfigPromptProvider** | `config.prompts` | Agent-defined prompts (inline + file) | agent.yml |
| **CustomPromptProvider** | Runtime created | User-created prompts | Database |
| **MCPPromptProvider** | MCP servers | External tool prompts | N/A (dynamic) |

### Key Changes

1. **Remove** `StarterPromptProvider` + `FilePromptProvider` → Single `ConfigPromptProvider`
2. **"Starter" becomes a flag** (`showInStarters`) not a separate provider
3. **Unified schema** with `type: 'inline' | 'file'` discriminator
4. **CLI auto-discovery** - Filesystem scanning happens in CLI enrichment, not core runtime
5. **Template support** - `${{dexto.agent_dir}}` resolved via config loader

## Schema Design

### Prompts Schema (`packages/core/src/prompts/schemas.ts`)

```typescript
const InlinePromptSchema = z.object({
    type: z.literal('inline').default('inline'),
    id: z.string()
        .min(1)
        .max(64)
        .regex(PROMPT_NAME_REGEX, `Prompt id must be ${PROMPT_NAME_GUIDANCE}`),
    title: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().describe('The actual prompt text'),
    category: z.string().optional().default('general')
        .describe('Category for organizing prompts (e.g., general, coding, analysis, tools)'),
    priority: z.number().optional().default(0)
        .describe('Higher numbers appear first'),
    showInStarters: z.boolean().optional().default(false)
        .describe('Show as a clickable button in WebUI starter prompts'),
}).strict();

const FilePromptSchema = z.object({
    type: z.literal('file'),
    file: z.string()
        .describe('Path to markdown file containing prompt (supports ${{dexto.agent_dir}})'),
    showInStarters: z.boolean().optional().default(false)
        .describe('Show as a clickable button in WebUI starter prompts'),
}).strict();

export const PromptsSchema = z
    .array(z.discriminatedUnion('type', [
        InlinePromptSchema,
        FilePromptSchema,
    ]))
    .superRefine((arr, ctx) => {
        const seen = new Map<string, number>();
        arr.forEach((p, idx) => {
            if (p.type === 'inline') {
                if (seen.has(p.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate prompt id: ${p.id}`,
                        path: [idx, 'id'],
                    });
                } else {
                    seen.set(p.id, idx);
                }
            }
        });
    })
    .default([])
    .describe('Agent prompts - inline or file-based');
```

### Agent Config Schema (`packages/core/src/agent/schemas.ts`)

```typescript
// REMOVE:
// starterPrompts: StarterPromptsSchema

// ADD:
prompts: PromptsSchema.describe(
    'Agent prompts configuration (inline text or file references)'
).default([]),
```

## Implementation Plan

**Note:** We do not need backward compatibility - we don't have enough users to warrant a migration period. Breaking changes are acceptable.

### Phase 1: Create New Schema & Remove Old

1. **Create new schemas** (`prompts/schemas.ts`)
   - `InlinePromptSchema`
   - `FilePromptSchema`
   - `PromptsSchema` (discriminated union)

2. **Update AgentConfig** (`agent/schemas.ts`)
   - **Remove** `starterPrompts` field entirely
   - **Add** new `prompts` field

3. **Create ConfigPromptProvider** (`prompts/providers/config-prompt-provider.ts`)
   - Reads from `config.prompts`
   - Handles both `type: 'inline'` and `type: 'file'`
   - Parses markdown frontmatter for file-based prompts

4. **Add CLI enrichment** (`cli/src/config/prompt-enrichment.ts`)
   ```typescript
   export async function enrichPromptsFromFiles(
       config: ValidatedAgentConfig,
       configPath: string
   ): Promise<ValidatedAgentConfig> {
       const configDir = path.dirname(configPath);
       const commandDirs = [
           path.join(configDir, 'commands'),
           path.join(homedir(), '.dexto', 'commands')
       ];

       const discoveredFiles: string[] = [];
       for (const dir of commandDirs) {
           if (existsSync(dir)) {
               const files = await readdir(dir);
               for (const file of files) {
                   if (file.endsWith('.md')) {
                       discoveredFiles.push(path.join(dir, file));
                   }
               }
           }
       }

       // Add discovered files to config.prompts
       const discoveredPrompts = discoveredFiles.map(file => ({
           type: 'file' as const,
           file: file,
           showInStarters: false,
       }));

       return {
           ...config,
           prompts: [
               ...config.prompts,
               ...discoveredPrompts
           ]
       };
   }
   ```

5. **Update PromptManager**
   - **Remove** `StarterPromptProvider` and `FilePromptProvider`
   - **Add** `ConfigPromptProvider`
   - Keep only: `config`, `custom`, `mcp` providers

### Phase 2: Migrate All Agent Configs

**Goal:** Update all shipped agent.yml files to use new `prompts` field

**Agent configs to migrate:**
```bash
# Find all agent.yml files
find . -name "*.yml" -o -name "*.yaml" | grep -E "(agent|default)" | grep -v node_modules
```

**Migration script** (`scripts/migrate-agent-configs.ts`):
```typescript
// Read agent.yml
// Transform starterPrompts → prompts with type: 'inline'
// Add showInStarters: true to maintain button behavior
// Write back to agent.yml
```

**Example transformation:**

```yaml
# BEFORE:
starterPrompts:
  - id: quick-start
    title: "Quick Start"
    description: "Get started with Dexto"
    prompt: "Help me understand how to use Dexto..."
    category: general
    priority: 100

# AFTER:
prompts:
  - type: inline
    id: quick-start
    title: "Quick Start"
    description: "Get started with Dexto"
    prompt: "Help me understand how to use Dexto..."
    category: general
    priority: 100
    showInStarters: true  # ← Maintain WebUI button behavior
```

**Agents to update:**
- `agents/default-agent.yml`
- `examples/*/agent.yml`
- Any other shipped agent configurations
- Documentation examples

### Phase 3: Update WebUI

**Goal:** WebUI filters `config.prompts` by `showInStarters: true`

1. **Update WebUI prompt fetching**
   ```typescript
   // Filter prompts for starter buttons
   const starterButtons = prompts.filter(p =>
       p.source === 'config' &&
       p.metadata?.showInStarters === true
   );
   ```

2. **Update prompt display logic**
   - Group by category
   - Sort by priority
   - Show as clickable buttons

### Phase 4: Cleanup & Verification

**Goal:** Ensure all old code is removed and tests pass

1. **Verify removals:**
   - `StarterPromptProvider` deleted
   - `FilePromptProvider` deleted
   - `StarterPromptsSchema` deleted
   - `starterPrompts` field removed from schema
   - No filesystem dependencies in core prompts

2. **Run tests:**
   - Unit tests pass
   - Integration tests pass
   - All agent configs valid

3. **Update exports:**
   - Remove old providers from `prompts/index.ts`
   - Update core exports

## Configuration Examples

### Inline Prompts (WebUI Buttons)

```yaml
prompts:
  # Quick access button in WebUI
  - type: inline
    id: daily-standup
    title: "Daily Standup"
    description: "Generate a daily standup summary"
    prompt: |
      Generate a daily standup summary based on my recent work:
      - What did I accomplish yesterday?
      - What am I working on today?
      - Any blockers?
    showInStarters: true
    category: productivity
    priority: 100

  # Another button
  - type: inline
    id: code-review
    title: "Code Review"
    prompt: "Review this code for security, performance, and maintainability"
    showInStarters: true
    category: coding
    priority: 90
```

### File-Based Prompts (Auto-discovered by CLI)

```yaml
prompts:
  # Explicitly referenced file
  - type: file
    file: "${{dexto.agent_dir}}/commands/analyze-architecture.md"
    showInStarters: false

  # Files in commands/ are auto-discovered by CLI enrichment
  # No need to explicitly list them (unless you want to override showInStarters)
```

### Mixed Configuration

```yaml
prompts:
  # Inline prompt as WebUI button
  - type: inline
    id: quick-start
    title: "Quick Start"
    prompt: "Help me get started..."
    showInStarters: true

  # Background prompt (not a button)
  - type: inline
    id: code-review-template
    prompt: "Review this code for: security, performance, maintainability"
    showInStarters: false

  # File-based prompt with button
  - type: file
    file: "${{dexto.agent_dir}}/commands/daily-standup.md"
    showInStarters: true

  # CLI auto-discovers additional files in:
  # - <agent-dir>/commands/*.md
  # - ~/.dexto/commands/*.md
```

## Markdown File Format

File-based prompts use frontmatter metadata:

```markdown
---
id: analyze-code
title: Analyze Code Architecture
description: Deep dive into codebase architecture
category: coding
priority: 50
---

# Analyze Code Architecture

Please analyze the codebase architecture focusing on:

1. **Component Structure**: How are components organized?
2. **Data Flow**: How does data move through the system?
3. **Dependencies**: What are the key dependencies?
4. **Technical Debt**: Any obvious areas for improvement?

Provide a comprehensive analysis with recommendations.
```

## Migration Checklist

### Code Changes
- [ ] Create new schemas (`InlinePromptSchema`, `FilePromptSchema`, `PromptsSchema`)
- [ ] Add `prompts` field to `AgentConfigSchema`
- [ ] Create `ConfigPromptProvider`
- [ ] Add CLI enrichment for file discovery
- [ ] Update `PromptManager` to use `ConfigPromptProvider`
- [ ] Write migration script for agent.yml files

### Agent Config Migrations
- [ ] Migrate `agents/default-agent.yml`
- [ ] Migrate all example agent configs
- [ ] Update documentation examples
- [ ] Update CLI init templates

### WebUI Updates
- [ ] Update prompt filtering (`showInStarters: true`)
- [ ] Update starter buttons display
- [ ] Update prompt categorization

### Cleanup
- [ ] Remove `StarterPromptProvider`
- [ ] Remove `FilePromptProvider`
- [ ] Remove `starterPrompts` from schema
- [ ] Remove filesystem dependencies from core
- [ ] Update documentation

### Testing
- [ ] Test CLI enrichment discovers files correctly
- [ ] Test `${{dexto.agent_dir}}` template expansion
- [ ] Test WebUI starter buttons with new schema
- [ ] Test all migrated agent configs
- [ ] Test type safety of discriminated union

## Benefits

✅ **Cleaner architecture** - Single provider for config-based prompts
✅ **Serverless-ready** - No filesystem scanning in core runtime
✅ **Explicit configuration** - Users see what prompts are available in config
✅ **Better UX** - `showInStarters` flag makes button behavior explicit
✅ **Easier to extend** - Can add `type: 'url'`, `type: 'template'` later
✅ **Type-safe** - Discriminated union provides excellent TypeScript inference

## Risks & Mitigation

**Risk:** Breaking existing agent configs
**Mitigation:** Not a concern - we don't have enough users. Migration script provided for internal configs only.

**Risk:** WebUI changes break user workflows
**Mitigation:** Minimal risk due to small user base. `showInStarters: true` maintains exact same button behavior.

**Risk:** Missing edge cases in file discovery
**Mitigation:** CLI enrichment is explicit and traceable, logs discovered files

## Future Extensions

Once this refactor is complete, we can easily add:

- `type: 'url'` - Fetch prompts from remote URLs
- `type: 'template'` - Jinja/Handlebars templates with complex logic
- `type: 'plugin'` - Prompts provided by plugins
- Prompt versioning and A/B testing
- Prompt analytics and usage tracking
