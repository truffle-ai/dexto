# Dexto Development Guidelines for AI Assistants

## Code Quality Requirements

**Pre-commit Validation** - Before completing any task, ALWAYS run and ensure ALL commands pass:
1. `npm run build` - Verify compilation
2. `npm test` - Ensure all tests pass  
3. `npm run lint` - Check code style
4. `npm run typecheck` - Validate TypeScript types

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
- **Config file is source of truth** - Use `agent.yml` for all configuration
- **Override pattern for advanced use** - Use `InitializeServicesOptions` only for top-level services
- ✅ DO: Configure via config file for normal operation
- ❌ DON'T: Add every internal dependency to override options

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
   - Source of truth: see `mapErrorTypeToStatus(type: ErrorType)` in `src/app/api/middleware/errorHandler.ts`. Keep this document in sync with that mapping.

4. **Defensive API Validation** - API layer validates request schemas
   - Use Zod schemas for request validation at API boundary
   - Provides early error detection and clear error messages
   - Prevents malformed data from reaching core logic

#### Result Pattern Helpers
Use standardized helpers from `src/core/schemas/helpers.ts`:

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
  - Examples: `src/core/config/loader.ts`, `src/core/llm/services/vercel.ts`
- **Validation errors**: Schema validation, input parsing, configuration validation with multiple issues  
  - Examples: `src/core/agent/DextoAgent.ts` (switchLLM validation)

**Error Factory Pattern (REQUIRED):**
Each module should have an error factory class that creates properly typed errors.
- **Reference example**: `src/core/config/errors.ts` - Follow this pattern for new modules

**API Integration:**
The error middleware (`src/app/api/middleware/errorHandler.ts`) automatically maps error types to HTTP status codes.

**❌ DON'T**: Use plain `Error` or `throw new Error()`  
**✅ DO**: Create module-specific error factories and use typed error classes

## Code Standards

### Import Requirements
- **All imports must end with `.js`** for ES module compatibility

### Module Organization
- **Selective index.ts strategy** - Only create index.ts files at logical module boundaries that represent cohesive public APIs
- **✅ DO**: Add index.ts for main entry points and modules that export types/interfaces used by external consumers
- **❌ DON'T**: Add index.ts for purely internal implementation folders
- **Direct imports preferred** - Import directly from source files rather than through re-export chains for internal usage
- **Avoid wildcard exports** - Prefer explicit named exports (`export { Type1, Type2 }`) over `export *` to improve tree-shaking and make dependencies explicit
- **Watch for mega barrels** - If a barrel exports >20 symbols or pulls from >10 files, consider splitting into thematic sub-barrels with subpath exports
- **Clear API boundaries** - index.ts files mark what's public vs internal implementation

**TODO**: Current codebase has violations of these rules (wildcard exports in `src/core/index.ts`, potential mega barrel in events) that need refactoring.

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

### TypeScript Best Practices
- **Strict null safety** - Handle null/undefined cases explicitly
- **Proper error handling** - Use type guards and proper error messages
- **Consistent return patterns** - All API endpoints return responses consistently
- **Avoid `any` types** - Use specific types unless absolutely necessary
  - **In tests**: For invalid input testing, prefer `@ts-expect-error` over `as any` to be explicit about intentional type violations

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

### API Layer (`src/app/api/`)
- **Express.js REST API** with WebSocket support for real-time communication
- **Key endpoints**: `/api/message`, `/api/mcp/servers`, `/api/sessions`, `/api/llm/switch`
- **MCP integration**: Multiple transport types (stdio, HTTP, SSE) with tool aggregation
- **WebSocket events**: `thinking`, `chunk`, `toolCall`, `toolResult`, `response`
- **Session management**: Multi-session support with persistent storage
- **A2A communication**: Agent-to-Agent via `.well-known/agent.json`

### WebUI Layer (`src/app/webui/`)
- **Next.js 14** with App Router, React 18, TypeScript, Tailwind CSS
- **Key components**: `ChatApp`, `MessageList`, `InputArea`, `ServersPanel`, `SessionPanel`
- **State management**: React Context + custom hooks for WebSocket communication
- **Communication**: WebSocket for real-time events, REST API for operations
- **Multi-mode operation**: CLI, Web, Server, Discord, Telegram, MCP modes

### Layer Interaction Flow
```
User Input → WebUI → WebSocket/REST → API → DextoAgent → Core Services
                ← WebSocket Events ← Agent Event Bus ← Core Services
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
- `npm test` - Run all tests (unit + integration)
- `npm run test:unit` - Run only unit tests (fast, for development)
- `npm run test:integ` - Run only integration tests (thorough, for CI/releases)
- `npm run test:unit:watch` - Watch mode for unit tests during development
- `npm run test:integ:watch` - Watch mode for integration tests

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
