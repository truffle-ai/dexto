---
sidebar_position: 8
sidebar_label: "Memory"
---

# Memory Configuration

Configure the memory system to store and retrieve persistent information about user preferences, context, and important facts.

## Overview

The Memory system allows your Dexto agent to remember information across conversations and sessions. Memories can be created by users, system prompts, or programmatically through the API. They support tagging, metadata, and pinning for auto-loading into the system prompt.

## Type Definition

```typescript
export type Memory = {
    id: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    metadata?: {
        source?: 'user' | 'system';
        pinned?: boolean;
        [key: string]: any; // Custom fields allowed
    };
};

export type CreateMemoryInput = {
    content: string;
    tags?: string[];
    metadata?: {
        source?: 'user' | 'system';
        pinned?: boolean;
        [key: string]: any;
    };
};
```

## Memory Fields

### Required Fields

- **id** (string): Unique identifier for the memory (auto-generated)
- **content** (string): The actual memory content (1-10,000 characters)
- **createdAt** (number): Creation timestamp in Unix milliseconds (auto-generated)
- **updatedAt** (number): Last update timestamp in Unix milliseconds (auto-generated)

### Optional Fields

- **tags** (string[]): Optional tags for categorization (max 10 tags, each 1-50 characters)
- **metadata** (object): Additional metadata for the memory
  - **source** ('user' | 'system'): Source of the memory
  - **pinned** (boolean): Whether this memory is pinned for auto-loading
  - **Custom fields**: Any additional custom fields using passthrough

## Validation Rules

The Memory system enforces strict validation to ensure data quality:

### Content Validation
- **Minimum length**: 1 character
- **Maximum length**: 10,000 characters
- **Type**: Must be a non-empty string

```yaml
# Valid
content: "User prefers concise responses"

# Invalid - empty string
content: ""

# Invalid - exceeds 10,000 characters
content: "..." # very long text
```

### Tags Validation
- **Maximum tags**: 10 tags per memory
- **Tag length**: 1-50 characters per tag
- **Type**: Array of strings

```yaml
# Valid
tags: ["preference", "communication", "style"]

# Invalid - exceeds 10 tags
tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11"]

# Invalid - tag exceeds 50 characters
tags: ["this-is-a-very-long-tag-name-that-exceeds-the-maximum-allowed-length"]
```

### Metadata Validation
- **source**: Must be 'user' or 'system' if provided
- **pinned**: Must be boolean if provided
- **Custom fields**: Any additional fields are allowed (passthrough)

```yaml
# Valid
metadata:
  source: user
  pinned: true
  customField: "any value"
  customNumber: 42

# Invalid - invalid source value
metadata:
  source: "admin"  # Only 'user' or 'system' allowed
```

## Pinned Memories

Pinned memories are automatically loaded into the system prompt, making them available to the agent without explicit retrieval.

### Pinning a Memory

```yaml
metadata:
  pinned: true
```

### Using Pinned Memories in System Prompt

Configure the memory contributor in your system prompt to load pinned memories:

```yaml
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant.

    - id: memories
      type: memory
      priority: 40
      enabled: true
      options:
        pinnedOnly: true      # Only load pinned memories
        limit: 10             # Maximum 10 memories
        includeTimestamps: false
        includeTags: true
```

## Memory Source Types

Memories can originate from different sources:

### User Memories
- Created by end users through conversation or UI
- Typically contain preferences, context, or personal information

```yaml
metadata:
  source: user
```

### System Memories
- Created automatically by the system or agent
- Typically contain system-generated context or inferred information

```yaml
metadata:
  source: system
```

## Configuration Examples

### Basic Memory Creation

```yaml
# Minimal memory
content: "User prefers concise responses"

# With tags
content: "Project uses TypeScript with strict mode"
tags: ["technical", "configuration"]

# With metadata
content: "User's timezone is PST"
metadata:
  source: user
  pinned: false
```

### Memory with Custom Metadata

```yaml
content: "Customer #12345 prefers email communication"
tags: ["customer", "communication", "preference"]
metadata:
  source: user
  pinned: true
  customerId: "12345"
  priority: "high"
  category: "communication-preference"
```

### System Prompt Integration

```yaml
# Complete system prompt with memory integration
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a customer support agent.
        Use available tools and context to help users effectively.

    - id: dateTime
      type: dynamic
      priority: 10
      source: dateTime
      enabled: true

    - id: memories
      type: memory
      priority: 40
      enabled: true
      options:
        includeTimestamps: false
        includeTags: true
        limit: 10
        pinnedOnly: false  # Load all memories, not just pinned
```

### Hybrid Approach: Pinned + On-Demand

Use pinned memories for critical context that should always be available, and query other memories on-demand:

```yaml
# System prompt configuration
systemPrompt:
  contributors:
    - id: memories
      type: memory
      priority: 40
      enabled: true
      options:
        pinnedOnly: true    # Only auto-load pinned memories
        limit: 5            # Keep system prompt compact
        includeTimestamps: false
        includeTags: true
```

Then programmatically query additional memories when needed:

```typescript
// In your application code
const memories = await agent.memory.list({
    tags: ["customer", "billing"],
    limit: 20
});
```

## Memory Contributor Options

When using the memory contributor in system prompts:

- **`includeTimestamps`** (boolean): Include the last updated date for each memory (default: `false`)
- **`includeTags`** (boolean): Include associated tags for each memory (default: `true`)
- **`limit`** (number): Maximum number of memories to load (default: unlimited)
- **`pinnedOnly`** (boolean): Only load pinned memories (default: `false`)

### Output Format

The memory contributor formats memories as a bulleted list in the system prompt:

```
## User Memories
- User prefers concise responses [Tags: preference, communication]
- Project uses TypeScript with strict mode [Tags: technical, configuration]
- User's timezone is PST [Tags: personal] (Updated: 1/15/2025)
```

## Complete Configuration Example

### Production Agent with Memories

```yaml
# LLM configuration
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.7

# System prompt with memory integration
systemPrompt:
  contributors:
    - id: core
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant that remembers user preferences.
        Use the available memories to personalize your responses.
        When you learn something important about the user, ask if they'd like you to remember it.

    - id: dateTime
      type: dynamic
      priority: 10
      source: dateTime
      enabled: true

    - id: memories
      type: memory
      priority: 40
      enabled: true
      options:
        includeTimestamps: true
        includeTags: true
        limit: 15
        pinnedOnly: false

# Storage configuration
storage:
  cache:
    type: in-memory
  database:
    type: sqlite  # Persistent storage for memories
```

## Common Use Cases

### Personal Assistant
Store user preferences, schedules, and important information:

```yaml
# Example memories
- content: "User prefers morning meetings between 9-11 AM"
  tags: ["schedule", "preference"]
  metadata:
    source: user
    pinned: true

- content: "User is allergic to peanuts"
  tags: ["health", "dietary"]
  metadata:
    source: user
    pinned: true
    importance: critical
```

### Customer Support Agent
Store customer history and preferences:

```yaml
# Example memories
- content: "Customer #12345 prefers email over phone"
  tags: ["customer", "communication", "preference"]
  metadata:
    source: system
    pinned: false
    customerId: "12345"

- content: "Previous issue with billing resolved on 2025-01-15"
  tags: ["customer", "billing", "history"]
  metadata:
    source: system
    pinned: false
    customerId: "12345"
    ticketId: "TK-9876"
```

### Development Assistant
Store project context and technical preferences:

```yaml
# Example memories
- content: "Project uses TypeScript with strict mode enabled"
  tags: ["technical", "configuration", "typescript"]
  metadata:
    source: system
    pinned: true

- content: "Team follows Airbnb style guide for code formatting"
  tags: ["code-style", "standards"]
  metadata:
    source: user
    pinned: true

- content: "Use Vitest for testing, not Jest"
  tags: ["testing", "tooling"]
  metadata:
    source: user
    pinned: true
```

## Best Practices

1. **Use pinned memories sparingly**: Only pin critical information that should always be available
2. **Tag consistently**: Develop a consistent tagging strategy for easy retrieval
3. **Keep content focused**: Each memory should contain a single, clear piece of information
4. **Use source field**: Track whether memories came from users or system for better organization
5. **Leverage custom metadata**: Add application-specific fields for advanced filtering
6. **Set reasonable limits**: Use the `limit` option in memory contributors to prevent system prompt bloat
7. **Regular cleanup**: Implement a process to review and remove outdated memories
8. **Combine approaches**: Use pinned memories for core context, query on-demand for specific needs

## Storage Requirements

Memories require persistent storage to work correctly:

```yaml
storage:
  database:
    type: sqlite  # Required for persistent memories
    # path: ./data/dexto.db  # Optional custom path
```

Memory storage uses the following key format:
- **Key pattern**: `memory:item:{id}`
- **Storage backend**: Database (not cache)

## Integration with System Prompt

The memory system integrates with the system prompt through the memory contributor. See the [System Prompt Configuration](./systemPrompt.md#memory-contributors) guide for detailed information on configuring memory contributors.

## Next Steps

- **Learn about system prompts**: See [System Prompt Configuration](./systemPrompt.md) for detailed contributor configuration
- **Configure storage**: Check [Storage Configuration](./storage.md) for database setup
- **Build with memories**: Explore the API documentation for programmatic memory management
