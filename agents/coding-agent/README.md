# Coding Agent

An expert software development assistant optimized for building, debugging, and maintaining codebases. This agent comes equipped with all internal coding tools and is configured to handle complex software engineering tasks efficiently.

## What You Get

- **All Internal Coding Tools**: Read, write, edit files, execute commands, search codebases
- **Intelligent Tool Policies**: Read operations never require approval, write operations are safely guarded
- **Comprehensive File Support**: 30+ file extensions including JS/TS, Python, Go, Rust, Java, C/C++, configs, and more
- **Enhanced Codebase Access**: Index up to 500 files with depth-10 traversal, including hidden files
- **Expert System Prompt**: Specialized instructions for software development best practices
- **Persistent Tool Approvals**: Allowed tools are saved across sessions for smoother workflows
- **Coding-Focused Starter Prompts**: Quick access to common development tasks

## Key Capabilities

### File Operations
- **read_file**: Read any file with pagination support
- **write_file**: Create new files (requires approval)
- **edit_file**: Modify existing files precisely (requires approval)
- **glob_files**: Find files using patterns like `**/*.ts` (no approval needed)
- **grep_content**: Search within files using regex (no approval needed)

### Command Execution
- **bash_exec**: Run shell commands for testing, building, running code (requires approval)
- **bash_output**: Monitor output from background processes
- **kill_process**: Terminate running processes

### Analysis & Search
- Deep codebase traversal (up to 10 levels)
- Search across 500+ files
- Pattern matching with glob and regex
- Hidden file access (.env, .gitignore, etc.)

## Requirements

- Node.js 18+ (if using npm/pnpm commands)
- OpenAI API key (or another configured LLM key)
- File system access to your project directory

## Run the Agent

```bash
# From Dexto source
npm start -- --agent agents/coding-agent/coding-agent.yml

# Or using the Dexto CLI
dexto --agent coding-agent
```

## Usage Examples

### Analyze a Codebase
```
"Analyze this codebase. Show me the project structure, main technologies used, and provide a high-level overview."
```

### Debug an Error
```
"I'm getting this error: [paste error]. Help me find and fix the issue."
```

### Implement a Feature
```
"I need to add user authentication. Help me design and implement it following best practices."
```

### Refactor Code
```
"This function is too complex. Help me refactor it for better readability and maintainability."
```

### Write Tests
```
"Generate unit tests for the UserService class with edge case coverage."
```

### Code Review
```
"Review my recent changes in src/auth/ and suggest improvements."
```

## Configuration

### LLM Options

The coding agent defaults to `gpt-4o` for powerful coding capabilities. You can switch to other models:

**Claude Sonnet (Excellent for Coding)**
```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey: $ANTHROPIC_API_KEY
```

**Google Gemini**
```yaml
llm:
  provider: google
  model: gemini-2.5-pro
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

**OpenAI o1 (For Complex Reasoning)**
```yaml
llm:
  provider: openai
  model: o1
  apiKey: $OPENAI_API_KEY
```

### Tool Policies

The agent is pre-configured with sensible defaults:

**Always Allowed (No Approval Needed)**
- Reading files (`internal--read_file`)
- Searching files (`internal--glob_files`, `internal--grep_content`)
- Checking process output (`internal--bash_output`)
- Killing processes (`internal--kill_process`)
- Asking questions (`internal--ask_user`)

**Requires Approval**
- Writing files (`internal--write_file`)
- Editing files (`internal--edit_file`)
- Executing commands (`internal--bash_exec`)

You can customize these policies in the `permissions.toolPolicies` section of `coding-agent.yml`.

### File Extensions

The agent indexes these file types by default:

**Web Development**: .js, .jsx, .ts, .tsx, .html, .css, .scss, .sass, .less, .vue, .svelte

**Backend Languages**: .py, .java, .go, .rs, .rb, .php, .c, .cpp, .h, .hpp, .cs, .swift, .kt

**Configuration**: .json, .yaml, .yml, .toml, .xml, .ini, .env

**Documentation**: .md, .mdx, .txt, .rst

**Build Files**: .gradle, .maven, Makefile, Dockerfile, .dockerignore, .gitignore

Add more extensions in the `resources[0].includeExtensions` section.

## Starter Prompts

The agent includes 8 built-in starter prompts:

1. **🔍 Analyze Codebase** - Get a project overview
2. **🐛 Debug Error** - Identify and fix bugs
3. **♻️ Refactor Code** - Improve code quality
4. **🧪 Write Tests** - Generate comprehensive tests
5. **✨ Implement Feature** - Build new functionality
6. **⚡ Optimize Performance** - Find bottlenecks
7. **🚀 Setup Project** - Initialize new projects
8. **👀 Code Review** - Review for issues and improvements

## Best Practices

1. **Read Before Writing**: The agent automatically searches and reads relevant code before making changes
2. **Use Glob & Grep**: Leverage pattern matching to explore unfamiliar codebases efficiently
3. **Test Changes**: Execute tests after modifications to verify correctness
4. **Follow Conventions**: The agent adapts to your project's existing code style
5. **Ask Questions**: The agent will ask for clarification when requirements are ambiguous

## Troubleshooting

### Agent Can't Find Files
- Ensure you're running from your project root
- Check that file extensions are included in the config
- Verify `maxDepth` is sufficient for your project structure

### Commands Require Too Many Approvals
- Use `allowedToolsStorage: storage` to persist approvals
- Add frequently-used commands to the `alwaysAllow` list

### Performance Issues with Large Codebases
- Increase `maxFiles` limit (default: 500)
- Reduce `maxDepth` to limit traversal
- Exclude large directories in `.gitignore`

## Learn More

- [Dexto Documentation](https://github.com/truffle-ai/dexto)
- [Internal Tools Reference](../../docs/internal-tools.md)
- [Agent Configuration Guide](../../docs/agent-configuration.md)
