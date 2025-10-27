---
sidebar_position: 8
---

# Internal Tools

Internal tools are built-in Dexto capabilities that provide core agent functionality like file operations, code search, and command execution. Unlike MCP servers, internal tools are always available and don't require external dependencies.

## Overview

Internal tools enable agents to interact with the local filesystem, execute commands, and collect user input. They're essential for building powerful agents that can read code, make changes, and perform system operations.

**Key characteristics:**
- Built directly into Dexto core
- No external dependencies required
- Can be enabled/disabled per agent
- Subject to tool confirmation policies
- Optimized for common agent workflows

## Configuration

Enable internal tools by listing them in your agent configuration:

```yaml
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
  - bash_output
  - kill_process
```

**Disabling all internal tools:**
```yaml
internalTools: []
```

**Omitting the field** also disables all internal tools (default behavior).

## Available Tools

### ask_user

Ask the user questions and collect structured input during agent execution.

**Use cases:**
- Clarifying ambiguous requirements
- Collecting user preferences or choices
- Gathering additional context for tasks
- Confirming actions before proceeding

**Example usage in system prompt:**
```yaml
systemPrompt: |
  When you need clarification or additional information, use the ask_user tool
  to collect structured input from the user.
```

**Agent workflow:**
```
Agent: I need to know which database to use
→ Uses ask_user tool
User: Provide answer
→ Agent receives response and continues
```

---

### read_file

Read file contents with pagination support for large files.

**Capabilities:**
- Read entire files or specific line ranges
- Automatic pagination for large files
- Line number formatting
- Support for all text formats

**Use cases:**
- Analyzing code before making changes
- Reviewing configuration files
- Reading documentation
- Examining logs

**Parameters:**
- `file_path` (required) - Absolute path to file
- `offset` (optional) - Starting line number
- `limit` (optional) - Number of lines to read

**Example configuration:**
```yaml
internalTools:
  - read_file

systemPrompt: |
  Always read relevant code files before making changes to understand context.
  Use read_file to examine files thoroughly.
```

---

### write_file

Write content to files, creating new files or overwriting existing ones.

**Capabilities:**
- Create new files
- Overwrite existing files
- Automatic directory creation
- UTF-8 encoding support

**Use cases:**
- Creating new source files
- Writing configuration files
- Generating documentation
- Creating test files

**Parameters:**
- `file_path` (required) - Absolute path to file
- `content` (required) - File content to write

**Example configuration:**
```yaml
internalTools:
  - write_file

toolConfirmation:
  mode: event-based
  toolPolicies:
    # Write operations require approval
    alwaysAllow: []
```

**⚠️ Important:** `write_file` typically requires user confirmation unless configured with `auto-approve` mode or added to `alwaysAllow` policy.

---

### edit_file

Edit files by replacing exact text strings, preserving surrounding content.

**Capabilities:**
- Find and replace exact text
- Preserve file structure and formatting
- Replace all occurrences (optional)
- Atomic operations (either succeeds completely or fails)

**Use cases:**
- Updating specific functions or classes
- Modifying configuration values
- Refactoring code
- Applying targeted fixes

**Parameters:**
- `file_path` (required) - Absolute path to file
- `old_string` (required) - Exact text to find
- `new_string` (required) - Replacement text
- `replace_all` (optional) - Replace all occurrences (default: false)

**Example configuration:**
```yaml
internalTools:
  - read_file  # Often used together
  - edit_file

systemPrompt: |
  When editing files:
  1. Read the file first to understand context
  2. Use edit_file to make precise changes
  3. Preserve existing formatting and structure
```

**Best practices:**
- Always read the file before editing
- Use unique `old_string` to avoid ambiguous matches
- Include surrounding context for specificity

---

### glob_files

Find files using glob patterns for fast file discovery.

**Capabilities:**
- Recursive file search
- Pattern matching (wildcards, extensions)
- Results sorted by modification time
- Fast performance on large codebases

**Use cases:**
- Finding files by extension (e.g., `**/*.ts`)
- Locating specific files (e.g., `**/config.yml`)
- Discovering project structure
- Building file lists for processing

**Parameters:**
- `pattern` (required) - Glob pattern
- `path` (optional) - Directory to search (default: current working directory)

**Common patterns:**
```yaml
# All TypeScript files
**/*.ts

# All test files
**/*.test.ts

# Config files in any directory
**/config.{yml,yaml,json}

# Files in specific directory
src/**/*.tsx

# Root-level files only
*.md
```

**Example configuration:**
```yaml
internalTools:
  - glob_files
  - read_file

systemPrompt: |
  Use glob_files to find relevant files before reading them.
  Examples:
  - Find all TypeScript files: **/*.ts
  - Find test files: **/*.test.ts
```

---

### grep_content

Search file contents using regex patterns for code discovery.

**Capabilities:**
- Regex pattern matching
- Search across entire codebase
- Filter by file type or glob pattern
- Context lines (before/after matches)
- Multiple output modes

**Use cases:**
- Finding function or class definitions
- Searching for API usage
- Locating configuration values
- Code analysis and refactoring

**Parameters:**
- `pattern` (required) - Regex pattern
- `path` (optional) - Directory/file to search
- `output_mode` (optional) - `content` (show matches), `files_with_matches` (file paths only), `count` (match counts)
- `glob` (optional) - Filter files by glob pattern
- `type` (optional) - Filter by file type (js, py, rust, etc.)
- `-i` (optional) - Case-insensitive search
- `-n` (optional) - Show line numbers
- `-A`, `-B`, `-C` (optional) - Context lines after/before/around matches

**Example configuration:**
```yaml
internalTools:
  - grep_content
  - glob_files

systemPrompt: |
  Use grep_content to search code:
  - Find function definitions: "function\\s+functionName"
  - Find imports: "import.*fromModule"
  - Find class usage: "new\\s+ClassName"
```

**Common patterns:**
```bash
# Find function definitions
function\s+myFunction

# Find class definitions
class\s+MyClass

# Find imports
import.*from.*module-name

# Find API calls
api\.endpoint\(
```

---

### bash_exec

Execute shell commands with output capture and timeout support.

**Capabilities:**
- Run any shell command
- Capture stdout and stderr
- Configurable timeouts
- Background execution support
- Error handling

**Use cases:**
- Running tests
- Building projects
- Git operations
- Package management (npm, pip, etc.)
- File operations (mv, cp, mkdir)

**Parameters:**
- `command` (required) - Command to execute
- `timeout` (optional) - Timeout in milliseconds (default: 30 minutes, max: 2 hours)
- `run_in_background` (optional) - Run command asynchronously

**Example configuration:**
```yaml
internalTools:
  - bash_exec
  - bash_output  # For background processes

toolConfirmation:
  mode: event-based
  toolPolicies:
    alwaysAllow:
      - internal--bash_exec--npm test
      - internal--bash_exec--git status
    alwaysDeny:
      - internal--bash_exec--rm -rf*
```

**Safety guidelines:**
```yaml
systemPrompt: |
  When using bash_exec:
  - Explain what the command does before executing
  - Avoid destructive operations without confirmation
  - Use specific commands, avoid wildcards in rm/delete
  - Check command output for errors
```

**⚠️ Security:** bash_exec is powerful but dangerous. Always use with tool confirmation policies to prevent destructive operations.

---

### bash_output

Retrieve output from background bash processes.

**Capabilities:**
- Monitor long-running commands
- Stream output as it becomes available
- Filter output with regex
- Non-blocking operation

**Use cases:**
- Monitoring build processes
- Checking test progress
- Watching server logs
- Long-running scripts

**Parameters:**
- `bash_id` (required) - ID of background process
- `filter` (optional) - Regex to filter output lines

**Example configuration:**
```yaml
internalTools:
  - bash_exec
  - bash_output
  - kill_process

systemPrompt: |
  For long-running commands:
  1. Start with bash_exec and run_in_background=true
  2. Periodically check progress with bash_output
  3. Use kill_process if needed to terminate
```

**Workflow example:**
```yaml
# 1. Start background process
bash_exec: npm run build
run_in_background: true
→ Returns process ID: bash-123

# 2. Check progress
bash_output: bash-123
→ Returns new output since last check

# 3. Filter output
bash_output: bash-123
filter: "error|warning"
→ Returns only error/warning lines
```

---

### kill_process

Terminate background bash processes.

**Capabilities:**
- Stop running processes cleanly
- Immediate termination
- Works with bash_exec background processes

**Use cases:**
- Stopping hung processes
- Canceling long-running operations
- Cleaning up after errors
- User-requested cancellation

**Parameters:**
- `shell_id` (required) - ID of process to kill

**Example configuration:**
```yaml
internalTools:
  - bash_exec
  - bash_output
  - kill_process

toolConfirmation:
  toolPolicies:
    alwaysAllow:
      - internal--kill_process  # Usually safe to kill without confirmation
```

---

## Common Tool Combinations

### File Analysis Agent

```yaml
internalTools:
  - read_file
  - glob_files
  - grep_content
  - ask_user

systemPrompt: |
  You analyze codebases by:
  1. Using glob_files to find relevant files
  2. Using grep_content to search for patterns
  3. Using read_file to examine specific files
  4. Using ask_user to clarify requirements
```

### Coding Agent

```yaml
internalTools:
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
  - ask_user

systemPrompt: |
  You're a coding assistant that:
  1. Reads code before making changes
  2. Uses glob/grep to find files
  3. Edits or writes files as needed
  4. Runs tests with bash_exec
  5. Asks for clarification when needed
```

### DevOps Agent

```yaml
internalTools:
  - read_file
  - write_file
  - bash_exec
  - bash_output
  - kill_process
  - ask_user

systemPrompt: |
  You're a DevOps assistant that:
  1. Manages configuration files
  2. Runs deployment commands
  3. Monitors process output
  4. Handles long-running operations
```

## Tool Confirmation

Internal tools respect your tool confirmation settings. Configure which tools require approval:

```yaml
internalTools:
  - read_file
  - write_file
  - edit_file
  - bash_exec

toolConfirmation:
  mode: event-based

  toolPolicies:
    # Safe, read-only operations
    alwaysAllow:
      - internal--read_file
      - internal--glob_files
      - internal--grep_content
      - internal--ask_user
      - internal--bash_output
      - internal--kill_process

    # Require confirmation for writes
    # (write_file, edit_file, bash_exec not in alwaysAllow)

    # Explicitly deny dangerous operations
    alwaysDeny:
      - internal--bash_exec--rm -rf*
      - internal--bash_exec--sudo*
```

See [Tool Confirmation guide](./toolConfirmation.md) for detailed configuration.

## Internal Resources

Internal tools work alongside internal resources. Resources provide context (file trees, blob storage), while tools enable actions:

```yaml
internalTools:
  - read_file
  - write_file
  - glob_files

internalResources:
  enabled: true
  resources:
    - type: filesystem
      paths: ["."]
      includeExtensions: [".ts", ".js", ".json"]
    - type: blob
```

See [Agent Configuration reference](./agent-yml.md#internal-resources) for resource configuration.

## Best Practices

### 1. Enable Only What You Need

```yaml
# ❌ Don't enable everything
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
  - bash_output
  - kill_process

# ✅ Enable based on agent purpose
internalTools:
  - read_file
  - glob_files
  - ask_user
```

### 2. Pair Tools with Clear Instructions

```yaml
internalTools:
  - read_file
  - edit_file

systemPrompt: |
  IMPORTANT: Always read files before editing them.

  Workflow:
  1. Use read_file to understand current content
  2. Plan your changes
  3. Use edit_file with precise old_string/new_string
```

### 3. Use Safe Defaults

```yaml
toolConfirmation:
  mode: event-based

  toolPolicies:
    # Read operations: auto-approve
    alwaysAllow:
      - internal--read_file
      - internal--glob_files
      - internal--grep_content

    # Write operations: require confirmation
    # (write_file, edit_file, bash_exec require approval)
```

### 4. Provide Usage Examples in System Prompt

```yaml
systemPrompt: |
  ## Finding Files
  - Use glob_files with pattern "**/*.ts" to find TypeScript files
  - Use grep_content to search for specific code patterns

  ## Editing Files
  - Always read_file first to see current content
  - Use edit_file with unique old_string for precise changes
  - Include surrounding context to avoid ambiguous matches

  ## Running Commands
  - Use bash_exec for tests: "npm test"
  - Check git status: "git status"
  - Never use destructive commands without explicit approval
```

## Examples

### Read-Only Code Analysis Agent

```yaml
internalTools:
  - read_file
  - glob_files
  - grep_content
  - ask_user

toolConfirmation:
  mode: auto-approve  # Safe since all tools are read-only
  allowedToolsStorage: memory

systemPrompt: |
  You're a code analysis assistant. You can:
  - Find files with glob_files
  - Search code with grep_content
  - Read files with read_file
  - Ask clarifying questions

  You CANNOT modify files or run commands.
```

### Full-Featured Development Agent

```yaml
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec

toolConfirmation:
  mode: event-based
  allowedToolsStorage: storage

  toolPolicies:
    alwaysAllow:
      - internal--ask_user
      - internal--read_file
      - internal--glob_files
      - internal--grep_content

systemPrompt: |
  You're a full-featured development assistant with file system access
  and command execution capabilities.

  Capabilities:
  - Read and analyze code
  - Create and modify files
  - Search codebases
  - Run tests and builds
  - Collect user input

  Guidelines:
  - Always read before editing
  - Test changes after modifications
  - Ask for confirmation on destructive operations
```

## Troubleshooting

### Tool Not Working

**Check tool is enabled:**
```yaml
internalTools:
  - read_file  # Make sure tool is in the list
```

**Check tool confirmation settings:**
```yaml
toolConfirmation:
  mode: event-based
  toolPolicies:
    alwaysAllow:
      - internal--read_file  # Or approve when prompted
```

### Permission Errors

Internal tools run with the same permissions as the Dexto process. Ensure:
- File paths are accessible
- User has read/write permissions
- Commands are in system PATH

### Command Timeouts

```yaml
# Increase timeout for long-running commands
internalTools:
  - bash_exec

# In system prompt, mention timeout parameter:
systemPrompt: |
  For long commands, use:
  bash_exec: "npm run build"
  timeout: 600000  # 10 minutes
```

## Related Documentation

- [Tool Confirmation](./toolConfirmation.md) - Configure tool approval policies
- [Agent Configuration](./agent-yml.md) - Complete YAML reference
- [Internal Resources](./agent-yml.md#internal-resources) - Filesystem and blob resources
- [System Prompt](./systemPrompt.md) - Guide agents on tool usage
