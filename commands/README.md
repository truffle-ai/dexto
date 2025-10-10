# Dexto Commands (File Prompts)

This directory contains File Prompts — reusable prompt templates that work like Claude Code's custom slash commands.

## Prompt Types in Dexto

Dexto supports four types of prompts, each with different capabilities:

### 1. 📁 File Prompts (Commands)
Location:
- Local: `commands/`
- Global: `~/.dexto/commands`
Format: Markdown files with frontmatter
Arguments: Positional placeholders (`$1`, `$2`, `$ARGUMENTS`)
Best for: Simple, file-based prompts you can version control

### 2. 🔌 MCP Prompts
Source: Connected MCP servers
Format: Defined by MCP protocol
Arguments: Named arguments (e.g., `report_type: "metrics"`)
Best for: Complex prompts from external services (GitHub, databases, etc.)

### 3. ⚡ Starter Prompts
Source: Built into Dexto
Format: Hardcoded in code
Arguments: Varies by prompt
Best for: Common operations provided out-of-the-box

### 4. ✨ Custom Prompts
Source: Created at runtime via API/UI
Format: Stored in database
Arguments: Positional placeholders like File Prompts
Best for: User-created prompts that need persistence

---

## Creating File Prompts

### Basic Structure

Create a `.md` file in this directory with frontmatter:

```markdown
---
description: Short description of what this prompt does
argument-hint: [required-arg] [optional-arg?]
---

# Prompt Title

Your prompt content here using $1, $2, or $ARGUMENTS placeholders.
```

### Frontmatter Fields

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `description` | ✅ Yes | Brief description shown in UI | `"Summarize text with style and length"` |
| `argument-hint` | ⚠️ Recommended | Argument names for UI hints | `"[style] [length]"` |
| `name` | ❌ Optional | Override filename as command name | `"quick-summary"` |
| `category` | ❌ Optional | Group prompts by category | `"text-processing"` |
| `id` | ❌ Optional | Unique identifier | `"summarize-v2"` |

### Argument Placeholders

File prompts support Claude Code's positional argument system:

| Placeholder | Expands To | Use Case |
|-------------|------------|----------|
| `$1`, `$2`, ..., `$9` | Individual arguments by position | Structured parameters |
| `$ARGUMENTS` | Remaining arguments after `$1..$9` | Free-form text content |
| `$$` | Literal dollar sign | When you need `$` in output |

### Examples

#### Example 1: Structured Arguments Only

```markdown
---
description: Translate text between languages
argument-hint: [from-lang] [to-lang] [text]
---

Translate from $1 to $2:

$3
```

Usage: `/translate english spanish "Hello world"`
Expands to:
```
Translate from english to spanish:

Hello world
```

#### Example 2: Mixed Structured + Free-form

```markdown
---
description: Analyze code with focus area
argument-hint: [file] [focus]
---

Analyze the code in **$1** focusing on: $2

Full input for context:
$ARGUMENTS
```

Usage: `/analyze utils.ts performance "function slow() { ... }"`
Expands to:
```
Analyze the code in **utils.ts** focusing on: performance

Full input for context:
utils.ts performance function slow() { ... }
```

#### Example 3: Free-form Only

```markdown
---
description: Improve any text
argument-hint: [text-to-improve]
---

Please improve the following text:

$ARGUMENTS
```

Usage: `/improve "This sentence not good"`
Expands to:
```
Please improve the following text:

This sentence not good
```

---

## Usage in the UI

### Invoking File Prompts

1. Type `/` in chat — opens slash command autocomplete
2. Select your prompt — shows inline argument hints
3. Provide arguments — positional order matters!

### Argument Display

The UI shows:
- `<argname>` — Required argument
- `<argname?>` — Optional argument
- Hover tooltip — Argument description (if provided)

Example UI display for summarize:
```
/summarize <style> <length>
           ^required  ^required
```

---

## How Different Prompt Types Handle Arguments

### File Prompts vs MCP Prompts

File Prompts (like `summarize`):
```
User types: /summarize technical 100 "Machine learning..."
           ↓
Expands:    $1="technical", $2="100", $ARGUMENTS="technical 100 Machine learning..."
           ↓
Result:     Prompt text with placeholders replaced
```

MCP Prompts (like `generate-report`):
```
User types: /generate-report metrics
           ↓
Maps:       _positional=["metrics"] → report_type="metrics"
           ↓
Result:     MCP server receives {report_type: "metrics"}
```

Key difference:
- File prompts: Simple string replacement in markdown
- MCP prompts: Structured data passed to external servers

---

## Best Practices

### ✅ DO:

- Use descriptive names — `analyze-performance` not `analyze`
- Add clear descriptions — help users understand what it does
- Include usage examples — in the prompt content or description
- Use `argument-hint` — enables inline UI hints
- Keep it focused — one clear purpose per prompt
- Use `$1`, `$2` for structure — when you need specific parameters
- Use `$ARGUMENTS` for flexibility — when content is variable

### ❌ DON'T:

- Don't use spaces in filenames — use kebab-case: `my-prompt.md`
- Don't create overly complex prompts — split into multiple files
- Don't forget argument-hint — users need to know what to provide
- Don't rely on order if flexible — document expected argument positions

---

## Testing Your Prompts

1. Create the `.md` file in this directory
2. Restart the agent (or wait for hot reload)
3. Type `/your-prompt-name` in chat
4. Test with different arguments — verify placeholders expand correctly

---

## Advanced: Argument-Hint Parsing

The `argument-hint` field is parsed to create structured argument definitions:

```markdown
argument-hint: [style] [length?] [extra-param]
```

Becomes:
```json
[
  { "name": "style", "required": true },
  { "name": "length", "required": false },
  { "name": "extra-param", "required": true }
]
```

Rules:
- `[name]` = required argument
- `[name?]` = optional argument (with `?`)
- Order matters — matches positional `$1`, `$2` positions

---

## Troubleshooting

### Prompt doesn't appear in slash command list

- Check filename ends with `.md`
- Verify frontmatter is valid YAML
- Ensure description field is present
- Put your file in `commands/` (local) or `~/.dexto/commands` (global)
- Restart the agent

---

## Further Reading

- Prompt Manager Architecture: `packages/core/src/prompts/prompt-manager.ts`
- File Prompt Provider: `packages/core/src/prompts/providers/file-prompt-provider.ts`
- Placeholder Expansion: `packages/core/src/prompts/utils.ts` (expandPlaceholders function)

