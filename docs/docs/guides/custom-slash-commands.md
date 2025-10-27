---
sidebar_position: 10
title: "Custom Slash Commands"
---

# Custom Slash Commands

Custom slash commands (also called File Prompts) let you create reusable prompt templates that work like shortcuts in the Dexto CLI. Think of them as your personal command library that you can invoke with a simple `/command-name` syntax.

## What are Custom Slash Commands?

Custom slash commands are markdown files with prompt templates that support:
- **Placeholder arguments** – Use `$1`, `$2`, etc. for structured inputs
- **Free-form content** – Use `$ARGUMENTS` for flexible text
- **Local or global scope** – Store them per-project or user-wide
- **Auto-discovery** – Dexto automatically loads them on startup

## Creating Your First Command

### Basic Structure

Create a `.md` file with frontmatter and your prompt template:

```markdown
---
description: Translate text between languages
argument-hint: [from-lang] [to-lang] [text]
---

Translate from $1 to $2:

$3
```

### Where to Save Commands

**Local commands** (project-specific):
```
<your-project>/commands/translate.md
```

**Global commands** (available everywhere):
```
~/.dexto/commands/translate.md
```

### Using the Command

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

### Positional Placeholders

Use `$1` through `$9` for specific arguments:

```markdown
---
description: Create a code review comment
argument-hint: [file] [line] [severity]
---

**Code Review for $1 (Line $2)**

Severity: $3

Please review this code and provide feedback.
```

Usage:
```
/code-review utils.ts 42 high
```

### Free-form with $ARGUMENTS

Use `$ARGUMENTS` to capture all remaining text:

```markdown
---
description: Improve any text
argument-hint: [text-to-improve]
---

Please improve the following text:

$ARGUMENTS
```

Usage:
```
/improve This sentence not good grammar has
```

### Mixed Approach

Combine structured and free-form:

```markdown
---
description: Analyze code with focus area
argument-hint: [language] [focus]
---

Analyze this $1 code focusing on: $2

Code to analyze:
$ARGUMENTS
```

Usage:
```
/analyze typescript performance function calculateTotal() { ... }
```

### Escaping Dollar Signs

Use `$$` for literal dollar signs:

```markdown
---
description: Display pricing
---

The cost is $$100 per month.
```

## Practical Examples

### Example 1: Quick Summarizer

**File**: `commands/summarize.md`

```markdown
---
description: Summarize text with specific style and length
argument-hint: [style] [length]
---

Summarize the following in $1 style with approximately $2 words:

$ARGUMENTS
```

**Usage**:
```
/summarize technical 100 "Long article text here..."
```

### Example 2: Git Commit Message Generator

**File**: `commands/commit-msg.md`

```markdown
---
description: Generate semantic commit message from diff
argument-hint: [type]
---

Generate a commit message of type "$1" for these changes:

$ARGUMENTS

Follow conventional commits format. Be concise and descriptive.
```

**Usage**:
```
/commit-msg feat "Added user authentication with OAuth2"
```

### Example 3: Documentation Writer

**File**: `commands/doc.md`

```markdown
---
description: Write documentation for code
argument-hint: [code-snippet]
---

Write clear, concise documentation for this code:

$ARGUMENTS

Include:
- Purpose and functionality
- Parameter descriptions
- Return value
- Usage example
```

**Usage**:
```
/doc function calculateTotal(items: Item[]): number { ... }
```

## Viewing Available Commands

**In Web UI:**
Type `/` to see all available commands.

**In CLI:**
```bash
dexto
> /prompts
```

This shows all commands from:
- Built-in starter prompts
- Your local `commands/` directory
- Your global `~/.dexto/commands` directory
- Connected MCP server prompts

## Best Practices

### ✅ DO:

- **Use descriptive names** – `analyze-performance` not just `analyze`
- **Add clear descriptions** – Help users understand what the command does
- **Use argument-hint** – Enables inline hints in the CLI
- **Keep focused** – One clear purpose per command
- **Use kebab-case** – `my-command.md` not `my command.md`

### ❌ DON'T:

- **Don't use spaces in filenames** – Breaks command resolution
- **Don't make overly complex prompts** – Split into multiple commands
- **Don't forget descriptions** – Required for commands to appear
- **Don't rely on undocumented argument order** – Always use `argument-hint`

## How It Works (Brief)

Under the hood, Dexto's `FilePromptProvider` scans your command directories for `.md` files, parses the frontmatter, and registers them as available slash commands. When you invoke a command, it expands the placeholders with your arguments and sends the result to the LLM.

The system prefers local commands over global ones, so you can override global commands on a per-project basis.

## Troubleshooting

### Command doesn't appear in `/prompts` list

- Check the file ends with `.md`
- Verify frontmatter has valid YAML syntax
- Ensure `description` field is present
- File must be in `commands/` or `~/.dexto/commands`
- Try restarting Dexto CLI

### Arguments not expanding correctly

- Check you're using `$1`-`$9` or `$ARGUMENTS`, not other syntax
- Verify argument order matches your `argument-hint`
- Use `$$` to escape literal dollar signs
- Make sure there are no typos in placeholder names

## Next Steps

- Explore the [CLI Guide](./cli.md) for more interactive commands
- Check out [MCP Integration](../mcp/overview.md) to use prompts from external servers
- Learn about [agent configuration](./configuring-dexto/overview.md) to customize behavior
