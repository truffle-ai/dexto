---
sidebar_position: 1
title: "System Prompt Preparation"
---

# System Prompt Preparation

Your agent's system prompt tells it how to behave. But what happens when you need that prompt to include content from files, user preferences, or information that changes at runtime?

## The Problem

You're building a support agent that needs product documentation in its context:

```yaml
# support-agent.yml
systemPrompt: |
  You are a support agent for Acme Corp.

  Here is the product documentation:
  [... 500 lines of docs pasted here ...]

  Here is the FAQ:
  [... 200 more lines ...]
```

This works, but it's a mess:
- Updating docs means editing the YAML file
- The config becomes huge and hard to read
- You can't reuse the same docs across multiple agents

## The Solution

Instead of one giant string, compose your prompt from **contributors**:

```yaml
# support-agent.yml
systemPrompt:
  contributors:
    - id: personality
      type: static
      priority: 1
      content: You are a friendly support agent for Acme Corp.

    - id: docs
      type: file
      priority: 2
      files:
        - ./knowledge/product-guide.md
        - ./knowledge/faq.md
```

Now your personality lives in the config, but documentation lives in separate files that are easy to update.

## How It Works

Contributors are assembled in priority order (lower number = first). The example above produces:

```
You are a friendly support agent for Acme Corp.

<fileContext>
## ./knowledge/product-guide.md

[contents of product-guide.md]

---

## ./knowledge/faq.md

[contents of faq.md]
</fileContext>
```

## Contributor Types

### Static: Inline Text

For content that lives in your config:

```yaml
- id: personality
  type: static
  priority: 1
  content: |
    You are a helpful assistant.
    Always be concise and accurate.
```

### File: External Documents

For content that lives in separate files:

```yaml
- id: knowledge
  type: file
  priority: 2
  files:
    - ./docs/guide.md
    - ./docs/faq.md
```

Only `.md` and `.txt` files are supported. Files are cached by default to avoid repeated disk reads.

### Dynamic: Runtime Content

For content computed when the agent runs:

```yaml
- id: datetime
  type: dynamic
  priority: 3
  source: date
```

The built-in `date` source adds the current date, so your agent knows "today."

## A Complete Example

Here's a research agent with all the pieces:

```yaml
# research-agent.yml
name: Research Assistant

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey: $ANTHROPIC_API_KEY

systemPrompt:
  contributors:
    - id: base
      type: static
      priority: 1
      content: |
        You are a market research assistant.
        Always cite sources when making claims.

    - id: industry
      type: file
      priority: 10
      files:
        - ./knowledge/industry-overview.md
        - ./knowledge/competitors.md

    - id: datetime
      type: dynamic
      priority: 20
      source: date
```

The final prompt includes:
1. Base personality (priority 1)
2. Industry knowledge from files (priority 10)
3. Current date/time (priority 20)

## Tips

**Space your priorities.** Use 1, 10, 20 instead of 1, 2, 3. This leaves room to insert new contributors later without renumbering.

**Disable without deleting.** Add `enabled: false` to temporarily skip a contributor:

```yaml
- id: verbose-docs
  type: file
  priority: 5
  enabled: false  # Skipped
  files: [./docs/detailed.md]
```

**Keep files focused.** Smaller, topic-specific files are easier to maintain than one giant knowledge base.

## What's Next?

You've learned how to build modular, maintainable system prompts. Continue exploring:

- **[SDK Guide](/docs/guides/dexto-sdk)** - Complete SDK documentation
- **[Configuration Reference](/docs/guides/configuring-dexto/systemPrompt)** - All system prompt options
