# @dexto/image-local

Local development base image for Dexto agents with filesystem and process tools.

## Features

- **SQLite database** - Persistent, local data storage
- **Local filesystem blob storage** - Store blobs on local disk
- **In-memory caching** - Fast temporary storage
- **FileSystem tools** - read, write, edit, glob, grep operations
- **Process tools** - bash exec, output, kill operations
- **Offline-capable** - No external dependencies required
- **Zero configuration** - Sensible defaults for local development

## Installation

```bash
pnpm add @dexto/image-local @dexto/core @dexto/agent-management
```

## Quick Start

### 1. Create Agent Config

```yaml
# agents/my-agent.yml
systemPrompt:
  contributors:
    - type: static
      content: |
        You are a helpful AI assistant with filesystem and process capabilities.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514

# Enable filesystem and process tools
customTools:
  - type: filesystem-tools
    allowedPaths: ['.']
    blockedPaths: ['.git', 'node_modules']
  - type: process-tools
    securityLevel: moderate
```

### 2. Create Your App

```typescript
// index.ts
import { createAgent } from '@dexto/image-local';
import { loadAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('./agents/my-agent.yml');

// Providers already registered! Just create and use.
const agent = createAgent(config, './agents/my-agent.yml');
await agent.start();

// Agent now has filesystem and process tools available
const response = await agent.run('List the files in the current directory');
console.log(response.content);

await agent.shutdown();
```

**Important**: When using an image, only import from the image package (`@dexto/image-local`). Do not import from `@dexto/core` directly - the image provides everything you need.

## What's Included

### Registered Providers

- **Blob Storage**: `local`, `in-memory`
- **Custom Tools**: `filesystem-tools`, `process-tools`

### FileSystem Tools

When `filesystem-tools` is enabled in your config:

- `read_file` - Read file contents with pagination
- `write_file` - Write or overwrite files
- `edit_file` - Edit files with search/replace operations
- `glob_files` - Find files matching glob patterns
- `grep_content` - Search file contents using regex

### Process Tools

When `process-tools` is enabled in your config:

- `bash_exec` - Execute bash commands (foreground or background)
- `bash_output` - Retrieve output from background processes
- `kill_process` - Terminate background processes

## Configuration

### FileSystem Tools Config

```yaml
customTools:
  - type: filesystem-tools
    allowedPaths: ['.', '/tmp']
    blockedPaths: ['.git', 'node_modules', '.env']
    blockedExtensions: ['.exe', '.dll']
    maxFileSize: 10485760  # 10MB
    workingDirectory: /path/to/project
    enableBackups: true
    backupPath: ./backups
    backupRetentionDays: 7
```

### Process Tools Config

```yaml
customTools:
  - type: process-tools
    securityLevel: moderate  # strict | moderate | permissive
    workingDirectory: /path/to/project
    maxTimeout: 30000  # milliseconds
    maxConcurrentProcesses: 5
    maxOutputBuffer: 1048576  # 1MB
    allowedCommands: ['ls', 'cat', 'grep']  # strict mode only
    blockedCommands: ['rm -rf', 'sudo']
    environment:
      MY_VAR: value
```

## Architecture

### On-Demand Service Initialization

Services are initialized only when needed:

- **FileSystemService** is created when `filesystem-tools` provider is used
- **ProcessService** is created when `process-tools` provider is used
- No overhead if tools aren't configured

### Provider Registration

The image uses **side-effect registration** - providers are registered automatically when you import from the package:

```typescript
import { createAgent } from '@dexto/image-local';
// Providers registered as side-effect! ✓
```

All exports from the image (`createAgent`, registries, etc.) trigger provider registration on first import.

## Default Configuration

The image provides sensible defaults:

```typescript
{
  storage: {
    blob: { type: 'local', storePath: './data/blobs' },
    database: { type: 'sqlite', path: './data/agent.db' },
    cache: { type: 'in-memory' }
  },
  logging: {
    level: 'info',
    fileLogging: true
  },
  customTools: [
    {
      type: 'filesystem-tools',
      allowedPaths: ['.'],
      blockedPaths: ['.git', 'node_modules/.bin', '.env']
    },
    {
      type: 'process-tools',
      securityLevel: 'moderate'
    }
  ]
}
```

## Security

### FileSystem Tools

- Path validation prevents directory traversal
- Blocked paths and extensions prevent access to sensitive files
- File size limits prevent memory exhaustion
- Optional backups protect against data loss

### Process Tools

- Command validation blocks dangerous patterns
- Injection detection prevents command injection
- Configurable security levels (strict/moderate/permissive)
- Process limits prevent resource exhaustion

## See Also

- [@dexto/core](../core) - Core agent framework
- [@dexto/bundler](../bundler) - Image bundler
- [Image Tutorial](../../docs/docs/tutorials/images/) - Learn about images

## License

MIT
