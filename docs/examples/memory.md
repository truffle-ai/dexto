---
title: "Memory: Persistent Context & Learning"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Memory: Persistent Context & Learning

Create and save memories so your agent automatically uses them to create personalized experiences.

<ExpandableImage src="/assets/memory_demo.gif" alt="Memory Demo" title="Memory: Persistent Context & Learning" width={900} />

## What it does

Dexto's memory system allows agents to:
- **Remember user preferences** across sessions
- **Learn from past interactions** to provide better responses
- **Store important context** for future reference
- **Personalize responses** based on saved information

## How it works

Agents automatically create and retrieve memories during conversations. You can also manually save important information:

```bash
# In any Dexto session
> "Remember that I prefer TypeScript over JavaScript"
> "Save that my timezone is PST"
> "Remember my favorite color is blue"
```

The agent will use these memories in future conversations:

```bash
# Later in a different session
> "Create a new project for me"
# Agent: "I'll create a TypeScript project for you since that's your preference..."
```

## Memory Types

- **User Preferences**: Personal settings and choices
- **Context**: Important background information
- **Facts**: Specific details to remember
- **Learned Patterns**: Behavioral insights from interactions

## Managing Memories

### View memories
```bash
dexto --mode web
# Navigate to "Memories" in the sidebar
```

### Clear memories
Delete individual memories or clear all via the Web UI settings.

## Privacy

- Memories are stored locally by default
- Configure storage backend (Redis, PostgreSQL, SQLite)
- Full control over what gets saved
- Export and import capabilities

## Learn More

- [Session Management](/docs/guides/configuring-dexto/sessions)
- [Storage Configuration](/docs/guides/configuring-dexto/storage)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
