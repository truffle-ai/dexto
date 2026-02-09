# Tool Surface Refactor — Follow-up to DI Refactor

> **Prerequisite:** DI refactor (tools unification into `Tool[]`). This plan addresses remaining coupling that the DI refactor doesn't fully solve.

## Problems

### 1. Tool name prefix system (`internal--`, `custom--`, `mcp--`)

Prefixes are **added** in one place (`ToolManager.buildAllTools()`, 3 lines) and **stripped** in 15+ places across 5 packages:

| Package | Files stripping prefixes | Method |
|---------|------------------------|--------|
| Core | `tool-manager.ts` | `.replace()` |
| CLI | `messageFormatting.ts`, `processStream.ts`, `prompt-commands.ts` | `normalizeToolName()`, regex |
| WebUI | `MessageList.tsx`, `ToolCallTimeline.tsx`, `ServersPanel.tsx`, `handlers.ts` | regex, `startsWith()` |
| Server | `tools.ts` | prefix check |
| Agent-management | `runtime-service.ts` | `.replace()` |

**With unified `tools: Tool[]` from the DI refactor, the internal/custom distinction disappears.** There are no "internal" or "custom" tools — just tools. The prefix system should be removed entirely. MCP tools may still need a prefix (they come from external servers), but that's the only case.

### 2. Hardcoded tool name checks (25+ tool names across 30+ files)

**Core (policy coupling):**
- `tool-manager.ts`: `isBashTool()` checks `bash_exec` by name
- `config-prompt-provider.ts`: hardcoded map `{ bash: 'custom--bash_exec', read: 'custom--read_file', ... }`

**CLI (display coupling — the worst offender):**
- `messageFormatting.ts`: `TOOL_CONFIGS` object with 20+ hardcoded entries:
  ```typescript
  const TOOL_CONFIGS = {
      read_file: { displayName: 'Read', argsToShow: ['path'], primaryArg: 'path' },
      write_file: { displayName: 'Write', argsToShow: ['path'], primaryArg: 'path' },
      edit_file: { displayName: 'Edit', argsToShow: ['path'], primaryArg: 'path' },
      bash_exec: { displayName: 'Bash', argsToShow: ['command'], primaryArg: 'command' },
      glob_files: { displayName: 'Glob', argsToShow: ['pattern'], primaryArg: 'pattern' },
      grep_content: { displayName: 'Grep', argsToShow: ['pattern'], primaryArg: 'pattern' },
      plan_create: { displayName: 'Plan', argsToShow: ['title'], primaryArg: 'title' },
      // ... 15+ more
  };
  ```
- `toolUtils.ts`: checks `edit_file`, `write_file` for file operation detection
- `ApprovalPrompt.tsx`: checks `plan_review`, `write_file` for special rendering
- `OverlayContainer.tsx`: checks `plan_create`, `plan_review` for overlay display
- `processStream.ts`: checks `plan_review` for plan handling

**WebUI (display coupling):**
- `ToolCallTimeline.tsx`: tool-specific summaries for `bash_exec`, `read_file`, `grep_content`

### 3. Duplicated prefix logic

The same regex pattern is written independently in at least 8 different files:
```typescript
// Appears in various forms across the codebase
toolName.replace(/^(internal--|custom--|mcp--)/,'')
toolName.replace(/^internal--/, '').replace(/^custom--/, '')
/^(internal--|custom--|mcp--|internal__|custom__|mcp__)/.test(toolName)
```

## Goals

1. **Remove prefix system** — tools are just tools, no `internal--`/`custom--` prefix
2. **Move display logic to tools** — tools declare how they should be displayed
3. **Move approval logic to tools** — tools declare their approval behavior
4. **Zero hardcoded tool names in core** — core has no knowledge of specific tools
5. **Minimal hardcoded tool names in CLI/WebUI** — display driven by tool metadata, with optional CLI-side overrides for UX polish

## Design

### Tool interface extensions

```typescript
interface Tool {
    id: string;
    description: string;
    inputSchema: z.ZodSchema;
    execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;

    // Source tracking (replaces prefix system)
    source?: 'image' | 'mcp';  // only MCP tools need distinction; image tools are the default

    // Display metadata (replaces TOOL_CONFIGS hardcoding)
    display?: {
        displayName?: string;        // 'Read File', 'Bash', 'Grep'
        category?: string;           // 'filesystem', 'shell', 'search', 'planning', 'general'
        primaryArg?: string;         // which arg to show in compact view ('path', 'command', 'pattern')
        argsToShow?: string[];       // which args to include in display
        formatResult?(result: unknown): unknown;  // tool-specific result formatting
        summarizeArgs?(args: unknown): string;     // compact summary ('git push origin main')
    };

    // Approval hooks (replaces isBashTool + bash-pattern-utils)
    approval?: {
        requiresApproval?(args: unknown): boolean;
        extractPattern?(args: unknown): string | null;
        suggestPatterns?(args: unknown): PatternSuggestion[];
        matchesApprovedPattern?(args: unknown, approvedPatterns: string[]): boolean;
        isDangerous?(args: unknown): boolean;
    };

    // Aliases for prompt compatibility
    aliases?: string[];  // ['bash'] for Claude Code compat
}
```

### What tools declare (examples)

```typescript
// In @dexto/tools-process
const bashExecTool: Tool = {
    id: 'bash_exec',
    description: 'Execute a bash command',
    inputSchema: BashExecSchema,
    execute: executeBash,

    display: {
        displayName: 'Bash',
        category: 'shell',
        primaryArg: 'command',
        argsToShow: ['command'],
        summarizeArgs: (args) => (args as any).command?.split('\n')[0] ?? '',
        formatResult: (result) => ({
            type: 'shell',
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
        }),
    },

    approval: {
        requiresApproval: () => true,  // always needs approval
        extractPattern: (args) => generateBashPatternKey((args as any).command),
        suggestPatterns: (args) => generateBashPatternSuggestions((args as any).command),
        matchesApprovedPattern: (args, patterns) => {
            const key = generateBashPatternKey((args as any).command);
            return patterns.some(p => patternCovers(p, key));
        },
        isDangerous: (args) => isDangerousCommand((args as any).command),
    },

    aliases: ['bash'],
};
```

```typescript
// In @dexto/tools-filesystem
const readFileTool: Tool = {
    id: 'read_file',
    description: 'Read a file',
    inputSchema: ReadFileSchema,
    execute: executeReadFile,

    display: {
        displayName: 'Read',
        category: 'filesystem',
        primaryArg: 'path',
        argsToShow: ['path'],
    },
};

const writeFileTool: Tool = {
    id: 'write_file',
    display: {
        displayName: 'Write',
        category: 'filesystem',
        primaryArg: 'path',
        argsToShow: ['path'],
    },
    // no special approval hooks — uses default approval flow
};
```

### What changes in core

**ToolManager becomes generic:**
- Remove `INTERNAL_TOOL_PREFIX`, `CUSTOM_TOOL_PREFIX` constants
- Remove `isBashTool()` — use `tool.approval?.requiresApproval(args)` instead
- Remove `bash-pattern-utils.ts` import — tool provides pattern logic
- Remove prefix addition in `buildAllTools()` — tools have their `id` as-is
- Generic pattern store: `Map<string, string[]>` (toolId → approved patterns)
- Generic approval flow using `tool.approval` hooks
- MCP tools get `source: 'mcp'` and keep their server-based prefix for disambiguation

**ApprovalManager becomes generic:**
- Remove `addBashPattern()`, `matchesBashPattern()`, `clearBashPatterns()`
- Replace with `addPattern(toolId, pattern)`, `matchesPattern(toolId, patternKey)`, `clearPatterns(toolId?)`

**Prompt provider becomes configurable:**
- Remove hardcoded `CLAUDE_CODE_TOOL_MAP`
- Use `tool.aliases` to build the mapping dynamically

### What changes in CLI

**`messageFormatting.ts` — the biggest change:**
- Remove `TOOL_CONFIGS` hardcoded object
- Replace with dynamic lookup: `tool.display?.displayName ?? tool.id`
- `getToolConfig()` reads from `tool.display` metadata, not a hardcoded map
- `formatToolArgsForDisplay()` uses `tool.display.argsToShow` and `tool.display.primaryArg`
- `formatToolHeader()` uses `tool.display.summarizeArgs()` if available

**`normalizeToolName()` — simplify or remove:**
- With no prefixes, this becomes `(name) => name` or is deleted
- MCP tool prefix may still need stripping for display

**`toolUtils.ts` — use categories instead of names:**
- `isFileOperation(tool)` → `tool.display?.category === 'filesystem'`
- `isPlanTool(tool)` → `tool.display?.category === 'planning'`

**`ApprovalPrompt.tsx`, `OverlayContainer.tsx` — use categories:**
- `if (toolName === 'plan_review')` → `if (tool.display?.category === 'planning')`
- `if (toolName === 'write_file')` → `if (tool.display?.category === 'filesystem')`

### What changes in WebUI

**`ToolCallTimeline.tsx`:**
- Remove `stripToolPrefix()` — no prefixes
- Use `tool.display.summarizeArgs()` instead of hardcoded tool-specific logic

**All prefix stripping locations:**
- Remove regex patterns that strip `internal--`/`custom--`
- Tool IDs are clean, no stripping needed

### How CLI/WebUI access tool metadata

Currently CLI/WebUI receive tool calls as events (`llm:tool-call`) with just `toolName` and `args`. They don't have access to the `Tool` object.

**Approach:** Include tool display metadata in the tool call event:

```typescript
// Event payload
interface ToolCallEvent {
    toolName: string;
    args: unknown;
    callId: string;
    // NEW: display metadata from the tool definition
    display?: {
        displayName?: string;
        category?: string;
        primaryArg?: string;
        argsToShow?: string[];
    };
    source?: 'image' | 'mcp';
}
```

This way CLI/WebUI don't need to look up the Tool object — the metadata travels with the event. Core's ToolManager attaches `tool.display` to the event when emitting it.

## Files affected

### Core (remove tool-specific logic)

| File | Change |
|------|--------|
| `tools/tool-manager.ts` (1588 lines) | Remove prefixes, `isBashTool()`, bash approval flow. Add generic approval hooks. |
| `tools/bash-pattern-utils.ts` (137 lines) | **DELETE** — logic moves to `@dexto/tools-process` |
| `approval/manager.ts` | Remove `addBashPattern()`/`matchesBashPattern()`/`clearBashPatterns()`. Add generic `addPattern()`/`matchesPattern()`. |
| `prompts/providers/config-prompt-provider.ts` | Remove `CLAUDE_CODE_TOOL_MAP`. Build mapping from `tool.aliases`. |
| `tools/types.ts` | Add `display?`, `approval?`, `aliases?`, `source?` to `Tool` interface |
| `tools/display-types.ts` | Remove `ShellDisplayData` (tool provides its own via `display.formatResult`) |

### CLI (remove hardcoded tool configs)

| File | Change |
|------|--------|
| `ink-cli/utils/messageFormatting.ts` | Remove `TOOL_CONFIGS`, `normalizeToolName()`. Use `tool.display` from events. |
| `ink-cli/utils/toolUtils.ts` | Replace name checks with category checks. |
| `ink-cli/services/processStream.ts` | Remove prefix stripping. |
| `ink-cli/components/ApprovalPrompt.tsx` | Replace name checks with category checks. |
| `ink-cli/containers/OverlayContainer.tsx` | Replace name checks with category checks. |
| `cli/commands/interactive-commands/prompt-commands.ts` | Remove prefix stripping. |

### WebUI (remove prefix stripping)

| File | Change |
|------|--------|
| `components/MessageList.tsx` | Remove prefix regex. |
| `components/ToolCallTimeline.tsx` | Remove `stripToolPrefix()`. Use display metadata from events. |
| `components/ServersPanel.tsx` | Remove prefix logic. |
| `lib/events/handlers.ts` | Remove prefix regex. |
| `components/AgentEditor/FormEditorTabs.tsx` | Remove prefix construction. |

### Server

| File | Change |
|------|--------|
| `hono/routes/tools.ts` | Remove prefix checks. Use `tool.source`. |

### Agent-management

| File | Change |
|------|--------|
| `tool-provider/runtime-service.ts` | Remove prefix stripping. |

## Migration path

This refactor should happen AFTER the DI refactor (tools unification removes internal/custom distinction) but can be done incrementally:

### Step 1: Remove prefix system
- Remove prefix addition in `ToolManager.buildAllTools()`
- Remove all prefix stripping across the codebase
- MCP tools keep a prefix (or use `source: 'mcp'`)
- This is a breaking change for any consumer checking prefixed names

### Step 2: Add display metadata to Tool interface
- Add `display?` field to `Tool` interface
- Existing tools add display metadata
- CLI/WebUI start reading from `tool.display` with fallback to `TOOL_CONFIGS`
- Gradual migration: `getToolConfig(toolName)` first checks `tool.display`, then falls back to hardcoded

### Step 3: Add approval hooks to Tool interface
- Add `approval?` field to `Tool` interface
- Move `bash-pattern-utils.ts` to `@dexto/tools-process`
- Bash tool declares its approval hooks
- ToolManager switches from `isBashTool()` to `tool.approval` hooks
- ApprovalManager becomes generic

### Step 4: Remove hardcoded tool configs
- Delete `TOOL_CONFIGS` from CLI
- Delete `CLAUDE_CODE_TOOL_MAP` from core
- Delete `ShellDisplayData` from core
- All display/approval logic driven by tool metadata

### Step 5: Propagate display metadata in events
- ToolManager attaches `tool.display` to `llm:tool-call` events
- CLI/WebUI consume display metadata from events
- No need to look up Tool objects in the presentation layer

## Scope estimate

- ~30 files touched
- ~500 lines of hardcoded tool logic removed
- ~200 lines of new generic infrastructure added
- Net reduction in coupling and code
- Recommend 3-5 days of focused work after DI refactor is stable
