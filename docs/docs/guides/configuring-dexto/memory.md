---
sidebar_position: 4
sidebar_label: "Memory"
---

# Memory Configuration

Configure the memory system to store and retrieve persistent information about user preferences, context, and important facts across conversations.

:::tip Complete Reference
For complete field documentation, see **[agent.yml → Memories](./agent-yml.md#memories)**.
:::

## Overview

The Memory system allows your Dexto agent to remember information across conversations and sessions. Memories can be created by users, the system, or programmatically through the API.

**Key features:**
- Persistent storage across sessions
- Tagging and metadata support
- Pinned memories for auto-loading
- Flexible filtering and retrieval
- Integration with system prompts

Memories are stored in your configured database backend and can be automatically included in the system prompt for context-aware interactions.

## Memory Structure

Each memory contains:
- **content** - The actual memory text (1-10,000 characters)
- **tags** - Optional categorization (max 10 tags, 1-50 chars each)
- **metadata** - Source tracking, pinning, and custom fields
- **timestamps** - Creation and last update times

```yaml
# Example memory structure
content: "User prefers concise responses"
tags: ["preference", "communication"]
metadata:
  source: user
  pinned: true
  customField: "any value"
```

## Enabling Memories

Memory is configured at the top level of your agent.yml file:

```yaml
memories:
  enabled: true
  priority: 40
  limit: 10
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable memory inclusion in system prompt |
| `priority` | number | `40` | Position in system prompt (lower = earlier) |
| `limit` | number | - | Maximum memories to include |
| `includeTimestamps` | boolean | `false` | Show last updated date |
| `includeTags` | boolean | `true` | Include associated tags |
| `pinnedOnly` | boolean | `false` | Only include pinned memories |

## Pinned Memories

Pinned memories are automatically loaded into the system prompt when `pinnedOnly` is false, or exclusively loaded when `pinnedOnly` is true.

### Configuring Pinned Memories Only

```yaml
memories:
  enabled: true
  priority: 40
  pinnedOnly: true    # Only load pinned memories
  limit: 5            # Keep system prompt compact
```

### When to Pin Memories

**Pin these:**
- Critical user preferences (communication style, constraints)
- Important project context (tech stack, standards)
- User-specific requirements (accessibility needs, language)

**Don't pin these:**
- Temporary context (current task details)
- Historical information (past interactions)
- Optional details (nice-to-have context)

## Use Cases

| Scenario | Memory Strategy |
|----------|----------------|
| **Personal Assistant** | Pin schedules, preferences, important dates |
| **Customer Support** | Store customer history, preferences, past issues |
| **Development Assistant** | Remember tech stack, coding standards, project structure |
| **Research Agent** | Track research topics, sources, findings |

## Configuration Examples

### Basic Memory Integration

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

systemPrompt: |
  You are a helpful AI assistant that remembers user preferences.

memories:
  enabled: true
  priority: 40
  limit: 15
  includeTimestamps: true
  includeTags: true
```

### Hybrid Approach: Pinned + On-Demand

```yaml
memories:
  enabled: true
  pinnedOnly: true    # Only auto-load critical context
  limit: 5            # Keep system prompt compact
```

Then query additional memories programmatically when needed:

```typescript
// In your application code
const memories = await agent.memory.list({
    tags: ["customer", "billing"],
    limit: 20
});
```

## Example Output Format

Memories appear in the system prompt as:

```
## User Memories
- User prefers concise responses [Tags: preference, communication]
- Project uses TypeScript with strict mode [Tags: technical, configuration]
- User's timezone is PST [Tags: personal] (Updated: 1/15/2025)
```

## Storage Requirements

Memories require persistent storage:

```yaml
storage:
  database:
    type: sqlite  # Required for persistent memories
```

Memory data uses the key pattern: `memory:item:{id}`

## Best Practices

1. **Pin sparingly** - Only pin critical information that should always be available
2. **Tag consistently** - Develop a tagging strategy for easy filtering
3. **Keep content focused** - Each memory should contain a single, clear piece of information
4. **Use source field** - Track whether memories came from users or system
5. **Set reasonable limits** - Use `limit` option to prevent system prompt bloat
6. **Regular cleanup** - Review and remove outdated memories periodically
7. **Combine approaches** - Use pinned for core context, query on-demand for specific needs

## See Also

- [agent.yml Reference → Memories](./agent-yml.md#memories) - Complete field documentation
- [System Prompt Configuration](./systemPrompt.md) - How to configure system prompts
- [Storage Configuration](./storage.md) - Database setup for persistent memories
