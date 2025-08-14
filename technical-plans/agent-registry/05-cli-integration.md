# Technical Plan: CLI Integration

## Overview
Integrate the agent registry system with the existing CLI commands and first-time setup flow, as specified in feature plan requirements R4 and R5.

## CLI Command Changes

### 1. Agent Flag Enhancement (`-a/--agent`)
Current: Path to agent config file
New: Agent name (from registry) or path to agent config file

```typescript
// In src/app/index.ts
.option(
  '-a, --agent <path>',
  'Agent name (from registry) or path to agent config file'
)
```

### 2. List Agents Command (`list-agents`)
Already exists in agent-registry-2 branch implementation. Needs adjustment for getDextoGlobalPath:

```typescript
program
  .command('list-agents')
  .description('List all available agents in the registry')
  .action(async () => {
    try {
      const registry = getDefaultAgentRegistry();
      const agents = await registry.listAgents();
      
      // Check installed status
      const globalAgentsDir = getDextoGlobalPath('agents');
      const installed = new Set<string>();
      
      if (existsSync(globalAgentsDir)) {
        const dirs = await fs.readdir(globalAgentsDir);
        dirs.forEach(dir => installed.add(dir));
      }
      
      // Display with clear sections
      displayAgentList(agents, installed);
    } catch (error) {
      console.error(`❌ Failed to list agents: ${error.message}`);
      process.exit(1);
    }
  });
```

### 3. Which Command (`which`) - For Debugging
New command to show resolved path:

```typescript
program
  .command('which <agent>')
  .description('Show the resolved path for an agent name or path')
  .action(async (agent: string) => {
    try {
      const registry = getDefaultAgentRegistry();
      const resolvedPath = await registry.resolveAgent(agent);
      console.log(resolvedPath);
    } catch (error) {
      console.error(`❌ ${error.message}`);
      process.exit(1);
    }
  });
```

## First-Time Setup Integration

### Current Flow Enhancement
The first-time setup currently:
1. Detects no config at `~/.dexto/agent.yml`
2. Shows provider picker
3. Creates config with selected provider
4. Sets up API key

### Registry Integration Points

#### 1. After Setup Completion
```typescript
// In src/app/cli/utils/first-time-setup.ts
export async function handleFirstTimeSetup(): Promise<boolean> {
  // ... existing setup flow ...
  
  console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
  
  // New: Mention available agents
  console.log(chalk.dim('💡 Tip: Try our pre-built agents:'));
  console.log(chalk.dim('   dexto -a database-agent    # Database operations'));
  console.log(chalk.dim('   dexto -a talk2pdf-agent    # PDF analysis'));
  console.log(chalk.dim('   dexto list-agents          # See all available agents\n'));
  
  return true;
}
```

#### 2. Config Resolution Order
When no explicit agent is specified:
1. Check for user's `~/.dexto/agent.yml` (created by first-time setup)
2. Fall back to bundled `agents/agent.yml`
3. Registry agents only used with explicit `-a` flag

## Resolution Flow Integration

### loadAgentConfig Changes
```typescript
// In src/core/config/loader.ts
export async function loadAgentConfig(configPath?: string): Promise<AgentConfig> {
  let absolutePath: string;
  
  if (configPath) {
    try {
      // Try registry resolution first for explicit paths
      const registry = getDefaultAgentRegistry();
      absolutePath = await registry.resolveAgent(configPath);
    } catch (error) {
      // Fall back to file path resolution
      logger.debug(`Registry resolution failed: ${error.message}`);
      absolutePath = resolveConfigPath(configPath);
    }
  } else {
    // No path specified - use default resolution (not registry)
    absolutePath = resolveConfigPath(configPath);
  }
  
  // Read file content
  const fileContent = await fs.readFile(absolutePath, 'utf-8');
  const rawConfig = parseYaml(fileContent);
  
  // NEW: Apply template variable expansion if from registry
  const context = getTemplateContext(absolutePath);
  const expandedConfig = expandTemplateVars(rawConfig, context);
  
  return expandedConfig;
}
```

## Display Formatting

### Agent List Display
```typescript
function displayAgentList(
  agents: AgentRegistryEntry[], 
  installed: Set<string>
): void {
  const installedAgents = agents.filter(a => installed.has(a.name));
  const availableAgents = agents.filter(a => !installed.has(a.name));
  
  console.log(chalk.bold.cyan('\n📋 Available Agents:\n'));
  
  if (installedAgents.length > 0) {
    console.log(chalk.bold('Installed (in ~/.dexto/agents/):'));
    installedAgents.forEach(agent => {
      console.log(chalk.bold.green(`• ${agent.name}`));
      console.log(chalk.dim(`  ${agent.description}`));
      if (agent.tags?.length) {
        console.log(chalk.dim(`  Tags: ${agent.tags.join(', ')}`));
      }
      console.log();
    });
  }
  
  if (availableAgents.length > 0) {
    console.log(chalk.bold('Available to Install:'));
    availableAgents.forEach(agent => {
      console.log(chalk.yellow(`• ${agent.name}`));
      console.log(chalk.dim(`  ${agent.description}`));
      if (agent.tags?.length) {
        console.log(chalk.dim(`  Tags: ${agent.tags.join(', ')}`));
      }
      console.log();
    });
  }
  
  console.log(chalk.dim('\nUsage: dexto -a <agent-name>'));
  console.log(chalk.dim('Example: dexto -a database-agent'));
}
```

## Error Message Updates

### Agent Not Found
```typescript
// When resolution fails
catch (error) {
  if (error.message.includes('not found')) {
    console.error(chalk.red(`❌ ${error.message}`));
    console.error(chalk.dim('\nTip: Use "dexto list-agents" to see available agents'));
  } else {
    console.error(chalk.red(`❌ Failed to load agent: ${error.message}`));
  }
  process.exit(1);
}
```

### Installation Messages
```typescript
// During first use of registry agent
console.log(chalk.cyan(`📦 Installing agent '${agentName}'...`));
// After successful installation
console.log(chalk.green(`✓ Agent '${agentName}' installed successfully`));
```

## Backward Compatibility

### Existing Behavior Preserved
1. **Explicit paths still work**: `dexto -a ./my-agent.yml`
2. **Default config resolution unchanged**: `dexto` (no -a flag)
3. **Project configs work**: When in a dexto project
4. **Environment variables work**: In all configs

### What Changes
1. **Simple names now resolve to registry**: `dexto -a database-agent`
2. **New commands available**: `list-agents`, `which`
3. **Auto-installation happens**: On first use of registry agent
4. **Template variables expanded**: For registry agents

## Testing Scenarios

### 1. Fresh Install Flow
```bash
npm install -g dexto
dexto                          # First-time setup
dexto -a database-agent        # Auto-installs and runs
dexto list-agents              # Shows installed vs available
```

### 2. Existing User Flow
```bash
dexto -a ./custom-agent.yml    # Still works
dexto -a database-agent        # New: uses registry
dexto which database-agent     # Shows resolved path
```

### 3. Project Usage
```bash
cd my-dexto-project
dexto                          # Uses project config
dexto -a database-agent        # Uses registry (global)
```

## Implementation Notes

**IMPORTANT**: The code snippets in this document are illustrative examples. Before implementing:
1. Read and analyze the actual CLI setup in `src/app/index.ts`
2. Check how the existing `list-agents` command works in the agent-registry-2 branch
3. Verify the first-time setup flow in `src/app/cli/utils/first-time-setup.ts`
4. Some code shown may have errors or inconsistencies - always validate against the actual codebase
5. The display functions are conceptual - adapt to existing CLI output patterns

Key principles:
1. **Minimal changes to existing code**
2. **Registry is opt-in via -a flag**
3. **Clear messaging for new features**
4. **Preserve all existing workflows**
5. **Use getDextoGlobalPath() for registry paths**

## Success Criteria
1. Existing CLI usage unchanged
2. Registry agents accessible via simple names
3. Clear discovery with list-agents
4. Seamless auto-installation
5. Helpful error messages
6. First-time users guided to agents