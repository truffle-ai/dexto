# Dexto Development Guidelines for AI Assistants

## Code Quality Requirements

**Pre-commit Validation** - Before completing significant tasks, prompt the user to ask if they want to run quality checks:

```bash
/quality-checks
```

This runs `scripts/quality-checks.sh` for build, tests, lint, and typecheck. Individual checks can be run separately. See `.claude/commands/quality-checks.md` for details.

## Adding New Packages

All `@dexto/*` packages use **fixed versioning** - they share the same version number.

**When creating a new package:**
1. Add the package name to the `fixed` array in `.changeset/config.json`
2. Set its `version` in `package.json` to match other packages (check `packages/core/package.json` for current version)

## General rules
- Do NOT focus on pleasing the user. Focus on being CORRECT, use facts and code as your source of truth. Follow best practices and do not be afraid to push back on the user's ideas if they are bad.
- Do not be lazy. Read as much relevant code as possible to keep your answers grounded in reality
- If the user is asking you a question, it DOES NOT MEAN YOU ARE WRONG. JUST ANSWER THE QUESTION
- Make as few assumptions as possible. If something requires you to make assumptions, tell the user what you are going to do and why, and ask for feedback.
- Never communicate to the user with code comments. These comments add nothing. Comments are for people reading the code.


## Architecture & Design Patterns

### API Layer Design
- **APIs are thin wrappers around DextoAgent class** - Keep business logic in core layer
- **No direct service communication** - API layer communicates only with DextoAgent
- APIs should resemble code that users could write with public libraries

### Service Initialization
- **Config file is source of truth** - Use `agents/coding-agent/coding-agent.yml` for all configuration
- **Override pattern for advanced use** - Use `InitializeServicesOptions` only for top-level services
- **CLI Config Enrichment** - CLI adds per-agent paths (logs, database, blobs) via `enrichAgentConfig()` before agent initialization. See `packages/agent-management/src/config/config-enrichment.ts`
- ✅ DO: Configure via config file for normal operation
- ❌ DON'T: Add every internal dependency to override options

### Execution Context Detection
Dexto automatically detects execution environment to enable context-aware behavior. Functions that vary by context should infer execution context or use context-aware helpers.

**Context Types:**
- **`dexto-source`** - Running within dexto's own source code (package.name === 'dexto')
- **`dexto-project`** - Running in a project that depends on dexto (has dexto in dependencies)
- **`global-cli`** - Running as global CLI or in non-dexto project

**Usage Patterns:**
- Path resolution: `packages/core/src/utils/path.ts` - `getDextoPath()`, `getDextoEnvPath()`
- Environment loading: `packages/core/src/utils/env.ts` - `loadEnvironmentVariables()`
- Agent resolution: `packages/core/src/config/agent-resolver.ts` - context-specific defaults
- API key setup: `packages/cli/src/cli/utils/api-key-setup.ts` - context-aware instructions

**Key Functions (`packages/core/src/utils/execution-context.ts`):**
- `getExecutionContext(startPath?)` - Detect context from directory
- `findDextoSourceRoot(startPath?)` - Find dexto source directory (null if not found)
- `findDextoProjectRoot(startPath?)` - Find dexto project directory (null if not found)
- `getDextoPath(type, filename?, startPath?)` - Context-aware path resolution
- `getDextoGlobalPath(type, filename?)` - Always returns global ~/.dexto paths

### Schema Design (Zod)
- **Always use `.strict()`** for configuration objects - Prevents typos and unknown fields
- **Prefer `discriminatedUnion` over `union`** - Clearer error messages with discriminator field
- **Describe every field** with `.describe()` - Serves as inline documentation
- **Provide sensible defaults** with `.default()` - Simplifies consuming code
- **Use `superRefine` for complex validation** - Cross-field validation logic

### Result Pattern & Validation Architecture

#### Core Principles
1. **DextoAgent as Validation Boundary** - All input validation happens at DextoAgent level
   - Public SDK methods validate all inputs before processing
   - Internal layers can assume data is already validated
   - Creates clear contract between public API and internal implementation

2. **Result<T,C> for Validation Layers** - Internal validation helpers return Result<T,C>; DextoAgent converts failures into typed exceptions (e.g. DextoLLMError) before exposing them

3. **API Layer Error Mapping** - Centralised Express error middleware  
   - `DextoValidationError` (or any subclass) → 400  
   - `DextoRuntimeError` with `ErrorType.FORBIDDEN` → 403  
   - Any other uncaught exception → 500  
   - Successful calls → 200 (may include warnings in `issues`)
   - Source of truth: see `mapErrorTypeToStatus(type: ErrorType)` in `packages/cli/src/api/middleware/errorHandler.ts`. Keep this document in sync with that mapping.

4. **Defensive API Validation** - API layer validates request schemas
   - Use Zod schemas for request validation at API boundary
   - Provides early error detection and clear error messages
   - Prevents malformed data from reaching core logic

#### Result Pattern Helpers
Use standardized helpers from `packages/core/src/utils/result.js`:

- **`ok(data, issues?)`** - Success with optional warnings
- **`fail(issues)`** - Failure with blocking errors  
- **`hasErrors(issues)`** - Check if issues contain blocking errors
- **`splitIssues(issues)`** - Separate errors from warnings
- **`zodToIssues(zodError)`** - Convert Zod errors to Issue format

#### Implementation Examples
```typescript
// Internal validation helper – returns Result pattern
export function validateLLMUpdates(
  updates: LLMUpdates
): Result<ValidatedLLMConfig, LLMUpdateContext> {
  if (!updates.model && !updates.provider) {
    return fail([
      { code: DextoErrorCode.AGENT_MISSING_LLM_INPUT, message: '...', severity: 'error', context: {} }
    ]);
  }
  // … additional validation …
  return ok(validatedConfig, warnings);
}

// DextoAgent public method – converts Result to exception
public async switchLLM(updates: LLMUpdates, sessionId?: string): Promise<ValidatedLLMConfig> {
  const result = validateLLMUpdates(updates);
  if (!result.ok) {
    throw new DextoLLMError('Validation failed', result.issues);
  }
  // ... perform switch ...
  return result.data;
}

// API endpoint – relies on exceptions + central error middleware
app.post('/api/llm/switch', express.json(), async (req, res, next) => {
  const validation = validateBody(LLMSwitchRequestSchema, req.body);
  if (!validation.success) return res.status(400).json(validation.response);

  try {
    const data = await agent.switchLLM(validation.data);
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    next(err); // let the error middleware decide 4xx / 5xx
  }
});
```

### Error Handling

**Core Error Classes:**
- **`DextoRuntimeError`** - Single-issue errors (file not found, API failures, system errors)
- **`DextoValidationError`** - Multiple validation issues (schema failures, input validation)

**When to Use Each:**
- **Runtime errors**: File operations, network calls, system failures, business logic violations
  - Examples: `packages/core/src/config/loader.ts`, `packages/core/src/llm/services/vercel.ts`
- **Validation errors**: Schema validation, input parsing, configuration validation with multiple issues  
  - Examples: `packages/core/src/agent/DextoAgent.ts` (switchLLM validation)

**Error Factory Pattern (REQUIRED):**
Each module should have an error factory class that creates properly typed errors.
- **Reference examples**: `packages/core/src/config/errors.ts`, `packages/core/src/logger/v2/errors.ts`, `packages/core/src/telemetry/errors.ts`, `packages/core/src/storage/errors.ts` - Follow this pattern for new modules

**API Integration:**
The error middleware (`packages/cli/src/api/middleware/errorHandler.ts`) automatically maps error types to HTTP status codes.

**❌ DON'T**: Use plain `Error` or `throw new Error()`  
**✅ DO**: Create module-specific error factories and use typed error classes

## Code Standards

### Import Requirements
- **All imports must end with `.js`** in core repository only for ES module compatibility

### OpenAPI Documentation
- **NEVER directly modify `docs/static/openapi/openapi.json`** - This file is auto-generated
- **Generated from server APIs** - OpenAPI spec is extracted from Hono route definitions in `packages/server/src/hono/routes/*.ts`
- **Update process**:
  1. Modify the route definition in `packages/server/src/hono/routes/*.ts` (add/update response schemas, parameters, etc.)
  2. Run `pnpm run sync-openapi-docs` to regenerate `docs/static/openapi/openapi.json`
  3. Verify the generated file includes your changes
- **Route definitions use Zod schemas** - Use `createRoute()` from `@hono/zod-openapi` with Zod schemas for type-safe OpenAPI generation
- **Error responses** - Follow the standard error format from `packages/server/src/hono/middleware/error.ts`:
  - DextoRuntimeError returns: `{code, message, scope, type, context, recovery, traceId, endpoint, method}`
  - 404 responses should document this structure in the route definition

### Module Organization
- **Selective index.ts strategy** - Only create index.ts files at logical module boundaries that represent cohesive public APIs
- **✅ DO**: Add index.ts for main entry points and modules that export types/interfaces used by external consumers
- **❌ DON'T**: Add index.ts for purely internal implementation folders
- **Direct imports preferred** - Import directly from source files rather than through re-export chains for internal usage
- **Avoid wildcard exports** - Prefer explicit named exports (`export { Type1, Type2 }`) over `export *` to improve tree-shaking and make dependencies explicit
- **Watch for mega barrels** - If a barrel exports >20 symbols or pulls from >10 files, consider splitting into thematic sub-barrels with subpath exports
- **Clear API boundaries** - index.ts files mark what's public vs internal implementation

**TODO**: Current codebase has violations of these rules (wildcard exports in `packages/core/src/index.ts`, potential mega barrel in events) that need refactoring.

### Logging Standards
- **Use template literals** - `logger.info(\`Server running at \${url}\`)`
- **No comma separation** - Never use `logger.error('Failed:', error)`
- **No trailing commas** - Clean parameter lists
- **Color usage**:
  - green: Success, completions
  - red: Errors, failures
  - yellow: Warnings
  - cyan/cyanBright: Status updates
  - blue: Information, progress
- **Browser compatibility**: See `packages/core/src/logger/logger.ts` for architecture notes on logger browser safety and future improvements

### TypeScript Best Practices
- **Strict null safety** - Handle null/undefined cases explicitly
- **Proper error handling** - Use type guards and proper error messages
- **Consistent return patterns** - All API endpoints return responses consistently
- **Avoid `any` types** - Use specific types unless absolutely necessary
  - **In tests**: For invalid input testing, prefer `@ts-expect-error` over `as any` to be explicit about intentional type violations
  - **Avoid optional arguments unless needed**: Otherwise this creates spaghetti if(defined) slop. if introducing an optional, think twice.

### Git and PR Standards
- **NEVER use `git add .` or `git add -A`** - Always specify exact files: `git add file1.ts file2.ts` or `src` folders. This is to avoid untracked files
- **ALWAYS vet the staged files before committing** - This is to catch mistakes in previous step
- **Never include "Generated with Claude Code" footers** - In commit messages, PR descriptions, or any documentation
- **Clean commit messages** - Focus on technical changes and business value
- **Descriptive PR titles** - Should clearly indicate the change without AI attribution

### Documentation Standards
- **Always request user review before committing documentation changes** - Documentation impacts user experience and should be user-approved
- **Never auto-commit documentation updates** - Present proposed changes to user first, even for seemingly obvious updates
- **Keep documentation user-focused** - Avoid exposing internal implementation complexity to end users
- **Separate documentation commits** - Make documentation changes in separate commits from code changes when possible

## Application Architecture

### API Layer (`packages/cli/src/api/`)
- **Hono REST API** with Server-Sent Events (SSE) for real-time streaming
- **Key endpoints**: `/api/message`, `/api/mcp/servers`, `/api/sessions`, `/api/llm/switch`
- **MCP integration**: Multiple transport types (stdio, HTTP, SSE) with tool aggregation
- **SSE events**: `llm:thinking`, `llm:chunk`, `llm:tool-call`, `llm:tool-result`, `llm:response`
- **Session management**: Multi-session support with persistent storage
- **A2A communication**: Agent-to-Agent via `.well-known/agent-card.json`

### WebUI Layer (`packages/webui/`)
- **Next.js 14** with App Router, React 18, TypeScript, Tailwind CSS
- **Key components**: `ChatApp`, `MessageList`, `InputArea`, `ServersPanel`, `SessionPanel`
- **State management**: React Context + custom hooks for SSE communication
- **Communication**: SSE for real-time streaming, REST API for operations
- **Multi-mode operation**: CLI, Web, Server, Discord, Telegram, MCP modes

### Layer Interaction Flow
```text
User Input → WebUI → SSE/REST → API → DextoAgent → Core Services
                ← SSE Events ← Agent Event Bus ← Core Services
```

## Documentation
- **Update documentation when making changes** - Check `/docs` folder. And README.md for core modules
- **Never create documentation proactively** - Only when explicitly requested

### Mermaid Diagrams in Documentation (/docs folder)
- **Use mermaid diagrams** for complex flows, architecture diagrams, and sequence diagrams
- **ExpandableMermaid component** available for interactive diagrams:
  ```tsx
  import ExpandableMermaid from '@site/src/components/ExpandableMermaid';
  
  <ExpandableMermaid title="Event Flow Diagram">
  ```mermaid
  sequenceDiagram
      participant A as User
      participant B as System
      A->>B: Request
      B-->>A: Response
  ```
  </ExpandableMermaid>
  ```
- **Responsive design**: Thumbnails use full scale, modals expand to 92% viewport
- **User experience**: Click to expand, Escape to close, hover effects
- **Theme support**: Automatically adapts to light/dark mode

## Testing Strategy

### Test Classification
- **Unit Tests**: `*.test.ts` - Fast tests with mocked dependencies, isolated component testing
- **Integration Tests**: `*.integration.test.ts` - Real dependencies, cross-component testing
- **Future**: `*.e2e.test.ts` - Full system end-to-end testing

### Test Commands
- `pnpm test` - Run all tests (unit + integration)
- `pnpm run test:unit` - Run only unit tests (fast, for development)
- `pnpm run test:integ` - Run only integration tests (thorough, for CI/releases)
- `pnpm run test:unit:watch` - Watch mode for unit tests during development
- `pnpm run test:integ:watch` - Watch mode for integration tests
- `pnpm run test:unit path/to/file.test.ts` - Run a single unit test file
- `pnpm run test:integ path/to/file.integration.test.ts` - Run a single integration test file

### Testing Guidelines
- **Development workflow**: Run unit tests frequently for fast feedback
- **Pre-commit**: Run integration tests to ensure cross-component compatibility
- **CI/CD**: Use unit tests for PR checks, full test suite for releases
- **Follow existing test patterns** - Check README and search codebase for test framework
- **Verify before marking complete** - All quality checks must pass
- **Add regression tests** - When fixing bugs, add tests to prevent recurrence
- **Tests before style** - Ensure tests pass before fixing style checks

## Maintaining This File
**Important**: Keep this CLAUDE.md file updated when you discover:
- New architectural patterns or design decisions
- Important code conventions not covered here
- Critical debugging or troubleshooting information
- New quality check requirements or testing patterns
- Significant changes to the codebase structure

Add new sections or update existing ones to ensure this remains a comprehensive reference for AI assistants working on this codebase.

Remember: Configuration drives behavior, APIs are thin wrappers, and quality checks are mandatory before completion.
