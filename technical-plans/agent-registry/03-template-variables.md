# Technical Plan: Template Variables System

## Overview
Implement template variable substitution for dynamic path resolution in agent configurations, as specified in the feature plan's Template Variables section.

## Template Variables (Per Feature Plan)

### Available Variables
- **`@agent_dir`**: The directory containing the current agent
  - Resolves to absolute path of agent's directory
  - Example: `@agent_dir/data/example.db` → `~/.dexto/agents/database-agent/data/example.db`
  
- **`@agent_name`**: The name of the current agent  
  - The registry name or basename of agent directory
  - Example: `database-agent`, `triage-agent`

### Key Design Decisions
1. **NOT environment variables**: Use `@` prefix to distinguish from env vars (`$VAR`)
2. **Resolution timing**: After YAML parsing, before Zod validation
3. **Scope**: Applied to string fields representing file paths or process arguments
4. **Security**: No path traversal allowed beyond agent root

## Implementation Architecture

### 1. Template Expansion Function
```typescript
interface TemplateContext {
  agentDir: string;   // Absolute path to agent directory
  agentName: string;  // Name of the agent
}

function expandTemplateVars(
  config: any, 
  context: TemplateContext
): any {
  // Deep clone to avoid mutations
  const result = JSON.parse(JSON.stringify(config));
  
  // Walk the config recursively
  function walk(obj: any): any {
    if (typeof obj === 'string') {
      return expandString(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map(walk);
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = walk(value);
      }
      return result;
    }
    return obj;
  }
  
  return walk(result);
}

function expandString(str: string, context: TemplateContext): string {
  // Replace template variables
  let result = str;
  
  // Replace @agent_dir with absolute path
  result = result.replace(/@agent_dir/g, context.agentDir);
  
  // Replace @agent_name with agent name
  result = result.replace(/@agent_name/g, context.agentName);
  
  // Security: Validate no path traversal
  if (result.includes('..')) {
    // Check if resolved path escapes agent directory
    const resolved = path.resolve(context.agentDir, result);
    if (!resolved.startsWith(context.agentDir)) {
      throw new Error(
        `Security violation: Path traversal detected in template variable expansion: ${str}`
      );
    }
  }
  
  return result;
}
```

### 2. Integration with Config Loading Flow

The current flow in Dexto is:
1. `loadAgentConfig()` reads YAML file and returns raw object
2. `DextoAgent` constructor receives raw config
3. `AgentConfigSchema.parse()` validates and expands environment variables

We need to insert template expansion AFTER step 1, BEFORE step 3:

```typescript
// In src/core/config/loader.ts
export async function loadAgentConfig(configPath?: string): Promise<AgentConfig> {
  // 1. Resolve the config file path (using registry if needed)
  const absolutePath = await resolveAgent(configPath);
  
  // 2. Read and parse YAML
  const fileContent = await fs.readFile(absolutePath, 'utf-8');
  const rawConfig = parseYaml(fileContent);
  
  // 3. NEW: Determine template context
  const context = getTemplateContext(absolutePath);
  
  // 4. NEW: Expand template variables
  const expandedConfig = expandTemplateVars(rawConfig, context);
  
  // 5. Return expanded config (Zod will handle env vars later)
  return expandedConfig;
}
```

### 3. Using Existing Dexto Utilities

```typescript
import { getDextoGlobalPath, homedir } from '@core/utils/path.js';

function getTemplateContext(configPath: string): TemplateContext {
  // Use getDextoGlobalPath to ensure we always check global agents directory
  const globalAgentsDir = getDextoGlobalPath('agents'); // Always ~/.dexto/agents
  
  const configDir = path.dirname(configPath);
  
  // Check if this is an installed registry agent
  if (configDir.startsWith(globalAgentsDir)) {
    // Extract agent name from path
    const relativePath = path.relative(globalAgentsDir, configDir);
    const agentName = relativePath.split(path.sep)[0];
    
    return {
      agentDir: path.join(globalAgentsDir, agentName),
      agentName: agentName
    };
  }
  
  // For other locations, use directory name as agent name
  return {
    agentDir: configDir,
    agentName: path.basename(configDir)
  };
}
```

## Zod Schema Integration

### Current Zod Processing
The `AgentConfigSchema` in `src/core/agent/schemas.ts` currently:
1. Validates structure
2. Expands environment variables via `.transform()` on string fields
3. Applies defaults

### Template Variables Come First
```typescript
// Order of operations:
// 1. YAML parsing → raw object
// 2. Template variable expansion (@agent_dir, @agent_name)
// 3. Zod validation & env var expansion ($ENV_VAR)

// Example transformation:
// Original YAML:
"@agent_dir/data/$DB_NAME.db"

// After template expansion:
"/Users/x/.dexto/agents/database-agent/data/$DB_NAME.db"

// After Zod env expansion:
"/Users/x/.dexto/agents/database-agent/data/production.db"
```

### No Zod Schema Changes Needed
- Template expansion happens before Zod sees the config
- Zod continues to handle environment variables as it does today
- Clean separation of concerns

## Usage Examples

### Database Agent
```yaml
# database-agent.yml
mcpServers:
  sqlite:
    command: npx
    args:
      - -y
      - "@executeautomation/database-server"
      - "@agent_dir/data/example.db"  # Becomes absolute path
```

### Triage Demo Multi-Agent
```yaml
# triage-demo/triage-agent.yml
mcpServers:
  technical_support:
    command: npx
    args:
      - dexto
      - --agent
      - "@agent_dir/technical-support-agent.yml"

systemPrompt:
  contributors:
    - type: file
      files:
        - "@agent_dir/docs/company-overview.md"
```

## Cross-Platform Handling

### Path Separator Normalization
```typescript
function expandString(str: string, context: TemplateContext): string {
  let result = str;
  
  // Use Node.js path utilities for platform-appropriate separators
  // @agent_dir always expands to platform-appropriate path
  result = result.replace(/@agent_dir/g, 
    path.normalize(context.agentDir));
  
  result = result.replace(/@agent_name/g, context.agentName);
  
  return result;
}
```

### Config File Convention
- Configs always use forward slashes
- Template expansion produces platform-appropriate paths
- Node.js handles conversion automatically

## Security Considerations

### Path Traversal Prevention
```typescript
function validateExpandedPath(
  original: string, 
  expanded: string, 
  agentDir: string
): void {
  // Only validate paths that used @agent_dir
  if (!original.includes('@agent_dir')) {
    return;
  }
  
  const resolved = path.resolve(expanded);
  const agentRoot = path.resolve(agentDir);
  
  if (!resolved.startsWith(agentRoot)) {
    throw new Error(
      `Security: Template expansion attempted to escape agent directory.\n` +
      `Original: ${original}\n` +
      `Expanded: ${expanded}\n` +
      `Agent root: ${agentRoot}`
    );
  }
}
```

## Testing Requirements

### Unit Tests
1. Basic variable substitution
2. Nested object traversal  
3. Array handling
4. Path traversal prevention
5. Cross-platform path handling
6. Missing variable handling (no-op)
7. Complex multi-agent configs

### Integration Tests
1. Database agent with data files
2. Triage demo with sub-agents
3. System prompt file references
4. MCP server arguments
5. Template vars + env vars combined

## Implementation Notes

**IMPORTANT**: The code snippets in this document are illustrative examples. Before implementing:
1. Read and analyze how config loading currently works in `src/core/config/loader.ts`
2. Understand the exact flow of YAML parsing → Zod validation → environment variable expansion
3. Check existing utility functions for path manipulation and reuse them
4. Some code shown may have errors or inconsistencies - always validate against the actual codebase
5. The recursive walking function is conceptual - ensure it handles all edge cases

The actual implementation should:

1. **Use existing Dexto utilities** wherever possible:
   - `getDextoPath()` for standard paths
   - `homedir()` from existing utils
   - `logger` for debug output
   - Error classes from `@core/error`

2. **Follow Dexto patterns**:
   - Result pattern for validation
   - Proper error handling
   - Consistent logging

3. **Consider adding new utilities**:
   - `getDextoGlobalPath()` - returns global paths only (not project-relative)
   - `isInstalledAgent(path)` - checks if path is in global agents dir
   - `getAgentNameFromPath(path)` - extracts agent name

## Success Criteria
1. Template variables work in all string fields
2. Cross-platform compatibility maintained
3. Security: No path traversal vulnerabilities
4. Clear separation from environment variables
5. Transparent to existing code after expansion
6. Clean integration with Zod validation pipeline