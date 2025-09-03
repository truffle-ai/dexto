# PromptsManager

The PromptsManager is a unified interface for managing prompts from multiple sources, implementing the Model Context Protocol (MCP) specification for prompt discovery and retrieval.

## Overview

The PromptsManager aggregates prompts from MCP servers and internal markdown files, providing a standardized interface that follows the MCP specification. It acts as the single point of contact for all prompt operations in the Dexto system.

## Architecture

```
Application → PromptsManager → [MCPPromptProvider, InternalPromptProvider, StarterPromptProvider]
```

### Components

- **PromptsManager**: Pure aggregator that delegates to registered prompt providers
- **MCPPromptProvider**: Bridges to MCP servers, exposing their prompts
- **InternalPromptProvider**: Reads markdown files from a configured directory
- **StarterPromptProvider**: Exposes starter prompts from agent configuration

## MCP Compliance

The PromptsManager implements the MCP specification (2025-06-18) for prompts:

### Prompt Structure

```typescript
interface PromptDefinition {
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    arguments?: PromptArgument[] | undefined;
}

interface PromptArgument {
    name: string;
    description?: string;
    required: boolean;
}
```

### Content Types

Supports all MCP content types:
- **Text**: Plain text messages
- **Image**: Base64-encoded images with MIME types
- **Audio**: Base64-encoded audio with MIME types
- **Resource**: Embedded server-side resources

### Pagination Support

```typescript
interface PromptListResult {
    prompts: PromptInfo[];
    nextCursor?: string | undefined;
}
```

## API Reference

### Core Methods

#### `initialize()`
Initialize the PromptsManager and build the initial prompt cache.

#### `list()`
Get all available prompts as a `PromptSet` (indexed by name).

#### `listPrompts(cursor?: string)`
Get all available prompts with pagination support (MCP-compliant).

#### `getPrompt(name: string, args?: Record<string, unknown>)`
Retrieve a specific prompt by name with optional arguments.

#### `has(name: string)` / `hasPrompt(name: string)`
Check if a prompt exists.

#### `getPromptDefinition(name: string)`
Get prompt metadata without executing the prompt.

#### `getPromptsBySource(source: 'mcp' | 'internal' | 'starter')`
Filter prompts by their source.

#### `searchPrompts(query: string)`
Search prompts by name, title, or description.

#### `refresh()`
Refresh the prompt cache from all sources.

### Provider Access

#### `getProvider(source: string)`
Get a specific provider by source name. Returns `undefined` if the provider doesn't exist.

#### `getProviderSources()`
Get all registered provider source names.

#### `updateStarterPrompts(agentConfig?: AgentConfig)`
Update starter prompts configuration (updates the starter provider).

## Usage Examples

### Basic Prompt Discovery

```typescript
const promptsManager = new PromptsManager(mcpManager, './prompts');
await promptsManager.initialize();

// List all prompts
const allPrompts = await promptsManager.list();
console.log('Available prompts:', Object.keys(allPrompts));

// Get a specific prompt
const prompt = await promptsManager.getPrompt('code-review', {
    language: 'typescript',
    file: 'src/index.ts'
});
```

### MCP-Compliant Operations

```typescript
// List prompts with pagination support
const result = await promptsManager.listPrompts();
console.log(`Found ${result.prompts.length} prompts`);

// Get prompt definition
const definition = await promptsManager.getPromptDefinition('code-review');
if (definition?.arguments) {
    console.log('Required arguments:', 
        definition.arguments.filter(arg => arg.required).map(arg => arg.name)
    );
}
```

### Source-Specific Operations

```typescript
// Get only MCP prompts
const mcpPrompts = await promptsManager.getPromptsBySource('mcp');

// Get only internal prompts
const internalPrompts = await promptsManager.getPromptsBySource('internal');

// Get only starter prompts
const starterPrompts = await promptsManager.getPromptsBySource('starter');

// Search across all prompts
const searchResults = await promptsManager.searchPrompts('review');

// Access providers directly if needed
const mcpProvider = promptsManager.getProvider('mcp');
const sources = promptsManager.getProviderSources(); // ['mcp', 'internal', 'starter']
```

## Prompt Sources

### MCP Prompts

Prompts from connected MCP servers that support the prompts capability. These prompts follow the full MCP specification and can include:

- Structured arguments with validation
- Multiple content types (text, image, audio, resources)
- Server-side prompt templates

### Internal Prompts

Prompts defined in markdown files within a configured directory. These are converted to MCP-compliant format and support:

- Natural language context via `_context` argument
- Key-value argument parsing
- Markdown content processing

### Starter Prompts

Prompts defined in the agent configuration for quick access to common workflows. These prompts:

- Are prefixed with `starter:` followed by their configured ID
- Support the same argument patterns as internal prompts
- Include additional metadata like category, icon, and priority
- Are intended for prominent display in user interfaces

## Error Handling

The PromptsManager provides comprehensive error handling:

- **Prompt not found**: Clear error messages when prompts don't exist
- **Argument validation**: Validates required arguments and warns about unknown ones
- **Source routing**: Properly routes requests to appropriate providers
- **Cache management**: Handles cache invalidation and refresh operations

## Performance Features

- **Unified Caching**: Single aggregated cache for all providers for fast access
- **Lazy loading**: Prompts are loaded on-demand from providers
- **Cache invalidation**: Centralized cache refresh across all providers
- **Provider isolation**: Each provider manages its own internal caching strategy
- **Clean Architecture**: Pure aggregator pattern eliminates complexity and improves maintainability

## Configuration

```typescript
const promptsManager = new PromptsManager(
    mcpManager,           // MCP manager instance
    './prompts',          // Directory for internal markdown prompts
    agentConfig           // Agent configuration (for starter prompts)
);
```

## MCP Integration

The PromptsManager seamlessly integrates with the MCP ecosystem:

1. **Discovery**: Automatically discovers prompts from connected MCP servers
2. **Compatibility**: Ensures internal prompts follow MCP standards
3. **Unified Interface**: Single API for both MCP and internal prompts
4. **Future-Ready**: Prepared for MCP protocol updates and new features

## Best Practices

1. **Initialize early**: Call `initialize()` during system startup
2. **Handle errors**: Always wrap prompt operations in try-catch blocks
3. **Use pagination**: For large prompt collections, use `listPrompts()` with cursors
4. **Validate arguments**: Check prompt definitions before execution
5. **Refresh when needed**: Call `refresh()` when prompt sources change

## Future Enhancements

- **Real-time updates**: Support for `listChanged` notifications
- **Advanced pagination**: Full cursor-based pagination implementation
- **Prompt versioning**: Support for prompt versioning and updates
- **Content validation**: Enhanced content type validation and conversion
- **Performance optimization**: Advanced caching strategies and lazy loading
