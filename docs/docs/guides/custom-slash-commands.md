---
sidebar_position: 10
title: "Custom Slash Commands"
---

# Custom Slash Commands

Custom slash commands (also called File Prompts) let you create reusable prompt templates that work like shortcuts in the Dexto CLI and Web UI. Think of them as your personal command library that you can invoke with a simple `/command-name` syntax.

## What are Custom Slash Commands?

Markdown files with prompt templates that support:
- **Positional arguments** – `$1`, `$2`, etc. for structured inputs
- **Free-form content** – `$ARGUMENTS` for flexible text
- **Local or global scope** – Project-specific or user-wide
- **Auto-discovery** – Loaded automatically on startup

## Creating a Command

Create a `.md` file with frontmatter and your prompt template:

```markdown
---
description: Translate text between languages
argument-hint: [from-lang] [to-lang] [text]
---

Translate from $1 to $2:

$3
```

**Save locations:**
- **Local** (project-specific): `<your-project>/commands/translate.md`
- **Global** (available everywhere): `~/.dexto/commands/translate.md`

## Using Commands

**In Web UI:**
Type `/` to discover and invoke your custom commands.

**In CLI:**
```bash
dexto
> /translate english spanish "Hello world"
```

This expands to:
```
Translate from english to spanish:

Hello world
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | ✅ Yes | Brief description shown in command list |
| `argument-hint` | ⚠️ Recommended | Argument names for UI hints like `[style] [length?]` |
| `name` | ❌ Optional | Override the filename as command name |

## Placeholder Types

**Positional (`$1`-`$9`):**
```markdown
---
description: Code review comment
argument-hint: [file] [line] [severity]
---

**Code Review for $1 (Line $2)**
Severity: $3
```

**Free-form (`$ARGUMENTS`):**
```markdown
---
description: Improve any text
---

Please improve the following text:

$ARGUMENTS
```

**Mixed approach:**
```markdown
---
description: Analyze code with focus
argument-hint: [language] [focus]
---

Analyze this $1 code focusing on: $2

$ARGUMENTS
```

**Escape literal dollar signs with `$$`:**
```markdown
The cost is $$100 per month.
```

## Example: Git Commit Message

**File**: `commands/commit-msg.md`

```markdown
---
description: Generate semantic commit message
argument-hint: [type]
---

Generate a commit message of type "$1" for these changes:

$ARGUMENTS

Follow conventional commits format. Be concise and descriptive.
```

**Usage**:
```bash
/commit-msg feat "Added user authentication with OAuth2"
```

## Viewing Available Commands

**In Web UI:** Type `/` to see all commands.

**In CLI:**
```bash
> /prompts
```

Shows commands from:
- Built-in starter prompts
- Local `commands/` directory
- Global `~/.dexto/commands` directory
- Connected MCP server prompts

## Best Practices

✅ **DO:**
- Use descriptive names (`analyze-performance` not `analyze`)
- Add clear descriptions for discoverability
- Use `argument-hint` for inline hints
- Use kebab-case filenames (`my-command.md`)

❌ **DON'T:**
- Use spaces in filenames (breaks resolution)
- Make overly complex prompts (split into multiple commands)
- Forget the `description` field (required to appear)

## How It Works

Dexto's `ConfigPromptProvider` loads prompts from your agent configuration (both inline and file-based). For file-based prompts, it parses markdown files with frontmatter and registers them as slash commands. When invoked, placeholders expand with your arguments and send to the LLM.

## Troubleshooting

**Command doesn't appear:**
- File must end with `.md`
- Valid YAML frontmatter required
- `description` field must be present
- Must be in `commands/` or `~/.dexto/commands`

**Arguments not expanding:**
- Use `$1`-`$9` or `$ARGUMENTS` only
- Match argument order to `argument-hint`
- Use `$$` for literal dollar signs

## See Also

- [CLI Guide](./cli/overview) - Interactive commands and options
- [MCP Prompts](../mcp/prompts) - Prompts from external MCP servers
- [Agent Configuration](./configuring-dexto/overview) - Customize agent behavior
