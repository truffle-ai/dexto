# Technical Plan: Agent Resolution Logic

## Overview
Implement the agent resolution system that handles name-based registry lookups, path-based resolution, and clear precedence rules as defined in the feature plan.

## Resolution Order (Per Feature Plan R1.3)

### 1. Name-Based Resolution
- **Reserved names**: Registry names always use registry (cannot be overridden)
- **Detection**: Simple identifiers without extensions or path separators
- **Examples**: `database-agent`, `triage-agent`, `talk2pdf-agent`

### 2. Path-Based Resolution  
- **Explicit paths always win**: Anything with `.yml` suffix or path separators
- **Detection logic**:
  ```typescript
  function isPath(str: string): boolean {
    // Absolute paths
    if (path.isAbsolute(str)) return true;
    
    // Relative paths with separators
    if (/[\\/]/.test(str)) return true;
    
    // File extensions
    if (/\.(ya?ml|json)$/i.test(str)) return true;
    
    return false;
  }
  ```

### 3. Registry Names
- **Simple identifiers**: No extensions, no path separators
- **Must exist in registry**: Error if not found
- **Case-sensitive matching**: Exact match required

## Resolution Algorithm

```typescript
async function resolveAgent(nameOrPath: string): Promise<string> {
  // 1. Check if it's a path (has separators or extension)
  if (isPath(nameOrPath)) {
    const resolved = path.resolve(nameOrPath);
    if (!existsSync(resolved)) {
      throw new Error(`Agent config not found: ${resolved}`);
    }
    return resolved;
  }
  
  // 2. Must be a registry name - check if installed
  const globalAgentsDir = getDextoGlobalPath('agents');
  const installedPath = path.join(globalAgentsDir, nameOrPath);
  if (existsSync(installedPath)) {
    // Return the main config file from installed agent
    return resolveMainConfig(installedPath);
  }
  
  // 3. Check if available in bundled registry
  const registryEntry = await getRegistryEntry(nameOrPath);
  if (registryEntry) {
    // Trigger installation (see 04-installation-system.md)
    await installAgent(nameOrPath);
    return resolveMainConfig(installedPath);
  }
  
  // 4. Not found - provide helpful error
  const available = await listAvailableAgents();
  throw new Error(
    `Agent '${nameOrPath}' not found. ` +
    `Available agents: ${available.join(', ')}. ` +
    `Use a file path for custom agents.`
  );
}
```

## Main Config Resolution

For directory-based agents, need to find the main config file:

```typescript
function resolveMainConfig(agentDir: string): string {
  const stat = fs.statSync(agentDir);
  
  // If it's a file, return as-is
  if (stat.isFile()) {
    return agentDir;
  }
  
  // For directories, look for main config
  const registryEntry = getRegistryEntryByPath(agentDir);
  if (registryEntry?.main) {
    return path.join(agentDir, registryEntry.main);
  }
  
  // Fallback: look for agent.yml or first .yml file
  const defaultPath = path.join(agentDir, 'agent.yml');
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  
  // Find first .yml file
  const files = fs.readdirSync(agentDir);
  const yamlFile = files.find(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  if (yamlFile) {
    return path.join(agentDir, yamlFile);
  }
  
  throw new Error(`No config file found in agent directory: ${agentDir}`);
}
```

## Integration Points

### 1. With loadAgentConfig (src/core/config/loader.ts)
```typescript
export async function loadAgentConfig(configPath?: string): Promise<AgentConfig> {
  let absolutePath: string;
  
  if (configPath) {
    // Try agent registry resolution first
    try {
      absolutePath = await resolveAgent(configPath);
    } catch (error) {
      // Fall back to legacy resolution
      absolutePath = resolveConfigPath(configPath);
    }
  } else {
    // No path provided - use default resolution
    absolutePath = resolveConfigPath(configPath);
  }
  
  // Continue with file loading...
}
```

### 2. With CLI (src/app/index.ts)
- `-a/--agent` flag accepts both names and paths
- Resolution happens transparently
- Clear error messages guide users

## Error Messages

### Agent Not Found
```
❌ Agent 'my-workflow' not found.
Available registry agents: database-agent, triage-agent, talk2pdf-agent
Use a file path for custom agents (e.g., ./my-workflow.yml)
```

### File Not Found
```
❌ Agent config file not found: /path/to/config.yml
```

### Invalid Registry Entry
```
❌ Registry agent 'database-agent' configuration is missing or corrupted. 
Please reinstall dexto or check the installation.
```

future - dexto update-agent database-agent or something equivalent

## Implementation Notes

**IMPORTANT**: The code snippets in this document are illustrative examples. Before implementing:
1. Read and analyze the actual function signatures and types in the codebase
2. Check how `loadAgentConfig` currently works and its error handling
3. Verify the registry types and interfaces match the actual implementation
4. Some code shown may have errors or inconsistencies - always validate against the actual codebase
5. The `resolveAgent` function shown is conceptual - adapt to existing patterns

## Success Criteria
1. Reserved names always resolve to registry
2. Paths always resolve to files
3. Clear error messages with available options
4. Seamless integration with existing code
5. No breaking changes to current behavior