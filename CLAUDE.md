# Saiki Development Guidelines for AI Assistants

## Code Quality Requirements

**Pre-commit Validation** - Before completing any task, ALWAYS run and ensure ALL commands pass:
1. `npm run build` - Verify compilation
2. `npm test` - Ensure all tests pass  
3. `npm run lint` - Check code style
4. `npm run typecheck` - Validate TypeScript types

## Architecture & Design Patterns

### API Layer Design
- **APIs are thin wrappers around SaikiAgent class** - Keep business logic in core layer
- **No direct service communication** - API layer communicates only with SaikiAgent
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

## Code Standards

### Import Requirements
- **All imports must end with `.js`** for ES module compatibility

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
- **Avoid `any` types** - Use specific types unless absolutely necessary (rare exceptions in tests)

### Git and PR Standards
- **Never include "Generated with Claude Code" footers** - In commit messages, PR descriptions, or any documentation
- **Clean commit messages** - Focus on technical changes and business value
- **Descriptive PR titles** - Should clearly indicate the change without AI attribution
- **NEVER use `git add .`** - Always specify exact files: `git add file1.ts file2.ts`
- **Stage only relevant changes** - Only add files that were actually modified for the current task
- **Avoid untracked files** - Never commit untracked files unless explicitly intended by user

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
User Input → WebUI → WebSocket/REST → API → SaikiAgent → Core Services
                ← WebSocket Events ← Agent Event Bus ← Core Services
```

## Documentation
- **Update documentation when making changes** - Check `/docs` folder
- **Never create documentation proactively** - Only when explicitly requested

### Mermaid Diagrams in Documentation
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

## Error Handling Patterns
- Use proper type guards for error checking
- Include context in error messages with template literals
- Handle async operations with try/catch
- Return consistent error responses from APIs

## Maintaining This File
**Important**: Keep this CLAUDE.md file updated when you discover:
- New architectural patterns or design decisions
- Important code conventions not covered here
- Critical debugging or troubleshooting information
- New quality check requirements or testing patterns
- Significant changes to the codebase structure

Add new sections or update existing ones to ensure this remains a comprehensive reference for AI assistants working on this codebase.

Remember: Configuration drives behavior, APIs are thin wrappers, and quality checks are mandatory before completion.
