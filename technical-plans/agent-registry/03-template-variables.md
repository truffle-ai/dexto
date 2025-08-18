# Technical Plan: Template Variables System

## Overview
Implement template variable substitution for dynamic path resolution in agent configurations, as specified in the feature plan's Template Variables section.

## Template Variables (Per Feature Plan)

### Available Variables
- **`${{dexto.agent_dir}}`**: The directory containing the current agent config file
  - Always resolves to `path.dirname(configPath)` regardless of how config was resolved
  - Registry agents: `${{dexto.agent_dir}}/data/example.db` → `~/.dexto/agents/database-agent/data/example.db`
  - Custom agents: `${{dexto.agent_dir}}/data/example.db` → `/path/to/custom/agent/data/example.db`
  - Project agents: `${{dexto.agent_dir}}/data/example.db` → `/project/agents/data/example.db`

### Key Design Decisions
1. **CI-style convention**: Use `${{dexto.*}}` format familiar from GitHub Actions
2. **Namespacing**: `dexto.` prefix prevents conflicts with user variables  
3. **Resolution timing**: After YAML parsing, before Zod validation
4. **Scope**: Applied to string values in parsed YAML object
5. **Security**: No path traversal allowed beyond agent root
6. **Extensible**: Ready for future defaults and expressions
7. **Universal**: Works for any agent config file (registry, custom, project)
8. **Simple context**: Only need `path.dirname(configPath)` - no complex registry lookups

## Implementation Architecture

### 1. Template Expansion Function
```typescript
function expandTemplateVars(
  config: any, 
  agentDir: string
): any {
  // Deep clone to avoid mutations
  const result = JSON.parse(JSON.stringify(config));
  
  // Walk the config recursively
  function walk(obj: any): any {
    if (typeof obj === 'string') {
      return expandString(obj, agentDir);
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

function expandString(str: string, agentDir: string): string {
  // Replace ${{dexto.agent_dir}} with absolute path
  const result = str.replace(/\${{\s*dexto\.agent_dir\s*}}/g, agentDir);
  
  // Security: Validate no path traversal
  if (result.includes('..')) {
    // Check if resolved path escapes agent directory
    const resolved = path.resolve(agentDir, result);
    if (!resolved.startsWith(agentDir)) {
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
  
  // 3. NEW: Determine template context (simple!)
  const agentDir = path.dirname(absolutePath);
  
  // 4. NEW: Expand template variables
  const expandedConfig = expandTemplateVars(rawConfig, agentDir);
  
  // 5. Return expanded config (Zod will handle env vars later)
  return expandedConfig;
}
```

### 3. Simple Template Context

Template context is now extremely simple - just the directory containing the config file:

```typescript
// In src/core/config/loader.ts integration
const agentDir = path.dirname(absolutePath);
const expandedConfig = expandTemplateVars(rawConfig, agentDir);
```

This works universally for:
- **Registry agents**: `agentDir = ~/.dexto/agents/database-agent/`
- **Custom agents**: `agentDir = /path/to/custom/agent/` 
- **Project agents**: `agentDir = /project/agents/`
- **Any agent**: `agentDir = path.dirname(configPath)`

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
// 2. Template variable expansion (${{dexto.agent_dir}})
// 3. Zod validation & env var expansion ($ENV_VAR)

// Example transformation:
// Original YAML:
"${{dexto.agent_dir}}/data/$DB_NAME.db"

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
      - "${{dexto.agent_dir}}/data/example.db"  # Becomes absolute path
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
      - "${{dexto.agent_dir}}/technical-support-agent.yml"

systemPrompt:
  contributors:
    - type: file
      files:
        - "${{dexto.agent_dir}}/docs/company-overview.md"
```

## Cross-Platform Handling

### Path Separator Normalization
```typescript
function expandString(str: string, agentDir: string): string {
  // Use Node.js path utilities for platform-appropriate separators
  // ${{dexto.agent_dir}} always expands to platform-appropriate path
  const result = str.replace(/\${{\s*dexto\.agent_dir\s*}}/g, 
    path.normalize(agentDir));
  
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
  // Only validate paths that used ${{dexto.agent_dir}}
  if (!original.includes('${{dexto.agent_dir}}')) {
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