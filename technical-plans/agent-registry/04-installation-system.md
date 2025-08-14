# Technical Plan: Agent Installation System

## Overview
Implement the on-demand installation system that copies agents from the bundled registry to `~/.dexto/agents/` when first used, as specified in feature plan requirements R2 and R4.

## Installation Flow

### Trigger Points
1. **CLI Usage**: `dexto -a database-agent` when agent not installed
2. **List Command**: Shows installed vs available agents
3. **First Resolution**: During `resolveAgent()` when registry name not found locally

### Installation Process
```
User runs: dexto -a database-agent
    ↓
Resolution checks ~/.dexto/agents/database-agent
    ↓
Not found - check bundled registry
    ↓
Found - trigger installation
    ↓
Copy from bundled to ~/.dexto/agents/
    ↓
Return installed path for execution
```

## Implementation

### 1. Installation Function
```typescript
async function installAgent(agentName: string): Promise<string> {
  // Get registry entry
  const registryEntry = getRegistryEntry(agentName);
  if (!registryEntry) {
    throw new Error(`Agent '${agentName}' not found in registry`);
  }
  
  // Need new utility that ALWAYS returns global path, not project-relative
  const globalAgentsDir = getDextoGlobalPath('agents'); // ~/.dexto/agents
  const targetDir = path.join(globalAgentsDir, agentName);
  
  // Check if already installed
  if (existsSync(targetDir)) {
    logger.debug(`Agent '${agentName}' already installed`);
    return resolveMainConfig(targetDir);
  }
  
  // Ensure agents directory exists
  await fs.mkdir(globalAgentsDir, { recursive: true });
  
  // Determine source path
  const sourcePath = resolveBundledScript(`agents/${registryEntry.source}`);
  
  // Install based on type (file vs directory)
  if (registryEntry.source.endsWith('/')) {
    await installDirectoryAgent(sourcePath, targetDir, agentName, registryEntry);
  } else {
    await installSingleFileAgent(sourcePath, targetDir, agentName, registryEntry);
  }
  
  logger.info(`✓ Installed agent '${agentName}' to ${targetDir}`, null, 'green');
  
  // Return the main entry point
  if (registryEntry.main) {
    // Directory agent with explicit main file
    return path.join(targetDir, registryEntry.main);
  } else if (!registryEntry.source.endsWith('/')) {
    // Single file agent - use the file name from source
    return path.join(targetDir, path.basename(registryEntry.source));
  } else {
    // Directory without explicit main - use resolution logic
    return resolveMainConfig(targetDir);
  }
}
```

### 2. Directory Agent Installation
```typescript
async function installDirectoryAgent(
  sourceDir: string,
  targetDir: string,
  agentName: string
): Promise<void> {
  const tempDir = `${targetDir}.tmp.${Date.now()}`;
  
  try {
    // Copy to temp directory first (atomic operation)
    await copyDirectory(sourceDir, tempDir);
    
    // Validate the copied agent
    const mainConfig = resolveMainConfig(tempDir);
    if (!existsSync(mainConfig)) {
      throw new Error(`Invalid agent: missing main config file`);
    }
    
    // Atomic rename
    await fs.rename(tempDir, targetDir);
    
  } catch (error) {
    // Clean up temp directory on failure
    if (existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    throw new Error(
      `Failed to install agent '${agentName}': ${error.message}`
    );
  }
}
```

### 3. Single File Agent Installation
```typescript
async function installSingleFileAgent(
  sourceFile: string,
  targetDir: string,
  agentName: string
): Promise<void> {
  // For single files, create a directory with the agent name
  const tempDir = `${targetDir}.tmp.${Date.now()}`;
  
  try {
    await fs.mkdir(tempDir, { recursive: true });
    
    // Copy the single file
    const targetFile = path.join(tempDir, path.basename(sourceFile));
    await fs.copyFile(sourceFile, targetFile);
    
    // Atomic rename
    await fs.rename(tempDir, targetDir);
    
  } catch (error) {
    // Clean up on failure
    if (existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    throw new Error(
      `Failed to install agent '${agentName}': ${error.message}`
    );
  }
}
```

### 4. Directory Copy Utility
```typescript
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
```

## Listing Agents

### List Command Implementation
```typescript
async function listAgents(): Promise<void> {
  const globalAgentsDir = getDextoGlobalPath('agents'); // Always ~/.dexto/agents
  const registry = await loadRegistry();
  
  // Get installed agents
  const installed = new Set<string>();
  if (existsSync(globalAgentsDir)) {
    const dirs = await fs.readdir(globalAgentsDir);
    dirs.forEach(dir => installed.add(dir));
  }
  
  // Separate installed vs available
  const installedAgents = [];
  const availableAgents = [];
  
  for (const [name, entry] of Object.entries(registry.agents)) {
    const agentInfo = {
      name,
      description: entry.description,
      author: entry.author,
      tags: entry.tags
    };
    
    if (installed.has(name)) {
      installedAgents.push(agentInfo);
    } else {
      availableAgents.push(agentInfo);
    }
  }
  
  // Display results
  console.log(chalk.bold.cyan('\n📋 Available Agents:\n'));
  
  if (installedAgents.length > 0) {
    console.log(chalk.bold('Installed (in ~/.dexto/agents/):'));
    installedAgents.forEach(displayAgent);
    console.log();
  }
  
  if (availableAgents.length > 0) {
    console.log(chalk.bold('Available to Install:'));
    availableAgents.forEach(displayAgent);
    console.log();
  }
  
  console.log(chalk.dim('\nUsage: dexto -a <agent-name>'));
}
```

## First-Time User Experience

### Integration with First-Time Setup
When a new user runs `dexto` for the first time:
1. First-time setup creates `~/.dexto/agent.yml`
2. Registry agents are available immediately via `-a` flag
3. No pre-installation needed - agents install on demand

### Example Flow
```bash
# Fresh install
$ npm install -g dexto

# First run - triggers setup
$ dexto
🎉 Welcome to Dexto! Let's get you started.
[Provider selection...]
✓ Created your config at: ~/.dexto/agent.yml

# Use registry agent - auto-installs
$ dexto -a database-agent
✓ Installed agent 'database-agent' to ~/.dexto/agents/database-agent
🚀 Initializing Dexto with config: ~/.dexto/agents/database-agent/database-agent.yml
```

## Atomic Operations

### Why Atomic Installation
- Prevents partial installations on failure
- Allows safe concurrent access
- Easy cleanup on errors
- No corrupted agent directories

### Implementation Pattern
```typescript
// Always use temp + rename pattern
const tempPath = `${targetPath}.tmp.${Date.now()}`;
try {
  // Do work in temp location
  await doInstallation(tempPath);
  
  // Validate installation
  await validateInstallation(tempPath);
  
  // Atomic rename (succeeds or fails completely)
  await fs.rename(tempPath, targetPath);
} catch (error) {
  // Clean up temp files
  await cleanup(tempPath);
  throw error;
}
```

## Error Handling

### User-Friendly Messages
```typescript
// Agent not found
❌ Agent 'unknown-agent' not found in registry.
Available agents: database-agent, triage-agent, talk2pdf-agent

// Installation failed
❌ Failed to install agent 'database-agent': Permission denied
Try running with appropriate permissions or check ~/.dexto/agents/

// Corrupted source
❌ Agent 'database-agent' appears to be corrupted in the bundle.
Please reinstall dexto: npm install -g dexto
```

## Security Considerations

### Installation Security
1. **No overwrites**: Never overwrite existing installed agents
2. **Path validation**: Ensure all paths stay within `~/.dexto/agents/`
3. **Source validation**: Verify source files exist before copying
4. **Permission handling**: Clear errors for permission issues

## New Utility Required

### getDextoGlobalPath
Since `getDextoPath()` returns project-relative paths when in a project, we need a new utility that ALWAYS returns the global path:

```typescript
// In src/core/utils/path.ts
export function getDextoGlobalPath(type: string, filename?: string): string {
  // ALWAYS return global path, ignore project context
  const basePath = path.join(homedir(), '.dexto', type);
  return filename ? path.join(basePath, filename) : basePath;
}
```

This ensures registry agents are always installed globally at `~/.dexto/agents/`, never in project directories.

## Source vs Main Entry Point Handling

The registry structure distinguishes between:
- **`source`**: What to copy from the bundle (file or directory)
- **`main`**: The entry point config file within a directory

### Resolution Logic
1. **Single file agent** (`source: "talk2pdf-agent.yml"`):
   - Copy file to `~/.dexto/agents/talk2pdf-agent/talk2pdf-agent.yml`
   - Entry point is the copied file

2. **Directory with explicit main** (`source: "database-agent/", main: "database-agent.yml"`):
   - Copy entire directory to `~/.dexto/agents/database-agent/`
   - Entry point is `~/.dexto/agents/database-agent/database-agent.yml`

3. **Directory without main** (`source: "some-agent/"`):
   - Copy entire directory
   - Look for `agent.yml` first, then any `.yml` file

## Implementation Notes

**IMPORTANT**: The code snippets in this document are illustrative examples. Before implementing:
1. Read and analyze existing file system utilities in the codebase
2. Check how `resolveBundledScript` actually works for finding bundled files
3. Verify error handling patterns and existing error classes
4. Some code shown may have errors or inconsistencies - always validate against the actual codebase
5. The copy functions shown are simplified - ensure proper error handling and edge cases

Use existing Dexto utilities and patterns where applicable:
- Create `getDextoGlobalPath()` for global-only paths
- Use `resolveBundledScript()` for finding bundled files
- Use `logger` for all logging
- Use existing error classes from `@core/error`
- Follow Result pattern for operations that can fail

## Success Criteria
1. Agents install on first use transparently
2. Atomic operations prevent corruption
3. Clear separation of installed vs available
4. No pre-installation required
5. Works cross-platform
6. Preserves complete agent structure (directories, data files, etc.)