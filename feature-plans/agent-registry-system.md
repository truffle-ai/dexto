# Feature Plan: Dexto Agent Registry System

## Overview

The Agent Registry System provides a centralized mechanism for discovering, distributing, and managing Dexto agents. It enables users to easily access pre-built agents through simple commands while maintaining flexibility for custom agents and complex multi-agent systems.

## Current Situation Analysis

### Existing Agent Types

#### 1. Simple Single-File Agents
- `agent.yml` - Default bundled config with filesystem + puppeteer
- `agent-template.yml` - Template for create-app with auto-approve
- `talk2pdf-agent.yml` - Single MCP server integration
- `image-editor-agent.yml` - Python-based MCP server
- `music-agent.yml` - Python-based MCP server

#### 2. Multi-Tool Agents
- `database-agent/database-agent.yml` - Multiple MCP servers + data files
- `product-name-researcher/product-name-researcher.yml` - 3 MCP servers working together

#### 3. Multi-Agent Systems
- `triage-demo/` - Orchestrator + 4 specialist agents running as MCP servers
  - Main orchestrator spawns other Dexto agents
  - Shared documentation files
  - Complex inter-agent communication

### Current Problems

#### Path Resolution Issues
1. **Hardcoded brittle paths** in agent configs:
   - `./agents/database-agent/data/example.db` - breaks when moved
   - `agents/triage-demo/technical-support-agent.yml` - assumes project structure
   - `docs/company-overview.md` - relative path ambiguity

2. **No standardized agent discovery**:
   - Users don't know what agents are available
   - No way to list/browse agents
   - Manual path specification required

3. **No agent distribution mechanism**:
   - Bundled agents buried in node_modules
   - No lazy loading/on-demand installation
   - Everything ships with npm package (bloat)

#### Development vs CLI Usage Confusion
1. **Multiple config locations**:
   - `src/dexto/agents/` - development configs
   - `agents/` - bundled configs
   - `~/.dexto/` - user configs (sometimes)
   - No clear precedence rules

2. **Context-dependent behavior**:
   - Same command works differently in project vs global
   - Path resolution changes based on working directory
   - Confusing for users

### Current Registry Structure (from PR)

The existing `agent-registry.json` maps agent names to their configuration paths but lacks clarity on directory vs single-file agents and doesn't handle resource dependencies well.

## Requirements

### Core Functionality

#### R1: Agent Resolution
- **R1.1**: Support agent names (`database-agent`), paths (`./my-agent.yml`), and URLs (future)
- **R1.2**: Consistent resolution regardless of working directory
- **R1.3**: Clear precedence:
  - Name-based resolution: Reserved names always use registry (cannot be overridden)
  - Path-based resolution: Explicit paths always win (anything with `.yml` suffix or path separators)
  - Registry names: Simple identifiers without extensions or separators
- **R1.4**: Handle both single-file and directory-based agents

#### R2: Registry Structure
- **R2.1**: Global registry at `~/.dexto/agents/` for all CLI usage
- **R2.2**: Preserve directory structures for multi-file agents
- **R2.3**: Support nested agent references (triage-demo/technical-support)
- **R2.4**: Maintain resource files (data/, docs/, etc.)

#### R3: Path Resolution
- **R3.1**: Template variable substitution in configs (`@agent_dir`, `@agent_name`)
  - Not environment variables - internal template variables only
  - Prevents conflicts with user environment
- **R3.2**: Simple path resolution - no magic references
- **R3.3**: Work across all platforms (Windows, Mac, Linux)

#### R4: Discovery & Management
- **R4.1**: List available agents (`dexto list-agents`)
  - Shows both installed agents (in `~/.dexto/agents/`) and available bundled agents
  - Clear sections: "Installed" vs "Available"
- **R4.2**: Show agent metadata (description, author, version)
- **R4.3**: Install agents on-demand from bundled set
  - Atomic installation (temp dir + rename) to prevent corruption
  - Never overwrite user-modified agents
- **R4.4**: Check for agent updates (future)
- **R4.5**: Show resolved path (`dexto which <name>`) for debugging

#### R5: Developer Experience
- **R5.1**: Development configs remain in `src/dexto/agents/`
- **R5.2**: Clear separation between dev and registry agents
- **R5.3**: `create-app` continues to work as expected

### Edge Cases & Scenarios

#### E1: First-Time User
```bash
# User installs dexto globally
npm install -g dexto

# Runs an agent that doesn't exist locally
dexto -a database-agent

# Expected: 
# 1. Agent not found in ~/.dexto/agents/
# 2. Found in bundled agents
# 3. Copied to ~/.dexto/agents/database-agent/
# 4. Executed with correct paths
```

#### E2: Multi-Agent System Usage
```bash
# User runs triage-demo
dexto -a triage-demo

# Expected:
# 1. Copies entire triage-demo/ directory to ~/.dexto/agents/
# 2. Resolves to ~/.dexto/agents/triage-demo/triage-agent.yml
# 3. Sub-agents resolve correctly when spawned
# 4. Shared docs/ accessible to all sub-agents
```

#### E3: Development Project
```typescript
// In a dexto project
const config = await loadAgentConfig(); 
// Expected: Loads from project locations in order:
// 1. project/agents/agent.yml
// 2. project/src/agents/agent.yml
// 3. project/src/dexto/agents/agent.yml
// 4. Falls back to ~/.dexto/agent.yml or bundled

const config = await loadAgentConfig('database-agent');
// Expected: Resolves through registry (installs to ~/.dexto/agents/ if needed)
```

#### E4: Reserved Names Only
```bash
# User tries to use a non-registered name
dexto -a my-workflow

# Expected: Error: "Agent 'my-workflow' not found. Use a registered agent name or provide a file path."

# User must use explicit path for custom agents
dexto -a ./my-workflow.yml
dexto -a ~/custom-agents/my-workflow.yml

# Expected: Works with file path
```

#### E5: Agent Updates
```bash
# User has old version of database-agent
dexto -a database-agent  # Version 1.0

# After dexto update with new database-agent
npm update -g dexto

dexto -a database-agent
# Expected: Still uses cached version unless explicitly updated
# Future: dexto update-agent database-agent
```

#### E6: Missing Resources
```bash
# Agent references data file that doesn't exist
dexto -a broken-agent

# Expected: Clear error message about missing resource
# "Missing required file: @agent_dir/data/required.db at /Users/x/.dexto/agents/broken-agent/data/required.db"
```

#### E7: [Removed - Out of Scope]
Circular dependency detection is overly complex for early stage. Will rely on timeouts and good documentation.

#### E8: Name Collisions Prevented
```bash
# Reserved names cannot be overridden
# User cannot create ~/.dexto/agents/database-agent.yml manually

dexto -a database-agent

# Expected: Always uses registry version (installs from bundled if needed)
# User must use different names for custom agents
```

#### E9: Template Variables in Multi-Agent Systems
```yaml
# triage-demo/triage-agent.yml references sub-agents
mcpServers:
  technical_support:
    command: npx
    args:
      - dexto
      - --agent
      - "@agent_dir/technical-support-agent.yml"  # Template variable

# Expected: @agent_dir resolves to ~/.dexto/agents/triage-demo/
# Full path: ~/.dexto/agents/triage-demo/technical-support-agent.yml
```

#### E10: Cross-Platform Path Handling
```yaml
# Agent config always uses forward slashes
systemPrompt:
  contributors:
    - type: file
      files:
        - "@agent_dir/docs/overview.md"  # Always forward slashes

# Expected: 
# 1. Configs always use forward slashes
# 2. Template substitution replaces @agent_dir with platform-appropriate path
# 3. Node.js path utilities handle separator conversion automatically
# 4. @agent_dir becomes C:\Users\x\.dexto\agents\my-agent on Windows
# 5. @agent_dir becomes /Users/x/.dexto/agents/my-agent on Mac/Linux
```

#### E11: First-Time User Setup Integration
```bash
# New user runs dexto for first time
dexto

# Expected:
# 1. Detects no config at ~/.dexto/agent.yml
# 2. Runs first-time setup (provider selection)
# 3. Creates ~/.dexto/agent.yml with selected provider
# 4. Registry agents available immediately via -a flag
```

## Success Criteria

### User Experience
1. **Zero configuration**: Agents work immediately after `npm install -g dexto`
2. **Intuitive naming**: `dexto -a database-agent` just works
3. **Clear errors**: Helpful messages when things go wrong
4. **Fast resolution**: No noticeable delay in agent loading

### Technical
1. **No hardcoded paths**: All paths resolved dynamically
2. **Cross-platform**: Works on Windows, Mac, Linux (case-insensitive on Windows/macOS)
3. **Efficient storage**: Only copy agents when actually used
4. **Clean architecture**: Clear separation of concerns
5. **Atomic operations**: Install to temp dir first, then rename
6. **Security**: Path traversal prevention in template variables

### Compatibility
1. **Existing projects work**: No breaking changes to create-app projects
2. **Current agents work**: All bundled agents function correctly
3. **Future-proof**: Ready for remote agents, versions, plugins

## Template Variables

### Available Variables
Dexto provides internal template variables for agent configs to resolve paths dynamically:

- **`@agent_dir`**: The directory containing the current agent
  - Example: `@agent_dir/data/example.db` → `~/.dexto/agents/database-agent/data/example.db`
- **`@agent_name`**: The name of the current agent
  - Example: `database-agent` or `triage-agent`

### Resolution Timing
Template variables are resolved **at config load time**, after YAML parsing but before validation. This ensures:
- Child processes receive absolute paths, not template variables
- No need to pass template context to spawned agents
- Clear separation between registry agents (names) and file paths

### Usage Examples
```yaml
# database-agent.yml
mcpServers:
  sqlite:
    type: stdio
    command: npx
    args:
      - -y
      - "@executeautomation/database-server"
      - "@agent_dir/data/example.db"  # Resolves to agent's data directory

# triage-demo/triage-agent.yml
mcpServers:
  technical_support:
    type: stdio
    command: npx
    args:
      - dexto
      - --agent
      - "@agent_dir/technical-support-agent.yml"  # Resolves to sibling agent

systemPrompt:
  contributors:
    - type: file
      files:
        - "@agent_dir/docs/company-overview.md"  # Resolves to agent's docs
```

### Template Variable Rules
- **Scope**: Applied only to string fields that represent file paths or process arguments
- **Syntax**: `@agent_dir` and `@agent_name` (distinct from env vars `$VAR` or `${VAR}`)
- **Order**: Template variables → environment variables → path normalization
- **Security**: No path traversal (`../`) allowed beyond agent root
- **Platform**: Use forward slashes in configs; Node.js path utilities handle platform differences
- **Not environment variables**: Cannot be overridden by users

### Implementation Approach
Template substitution should be implemented as a post-processing step:
```typescript
// After YAML parsing, before Zod validation
function expandTemplateVars(config: any, agentDir: string): any {
  // Recursively walk config object
  // Replace @agent_dir with absolute path
  // Replace @agent_name with basename of agentDir
  // Return modified config for validation
}
```
This keeps template expansion separate from environment variable expansion in Zod schemas.

## Registry Structure

### Bundled Registry Format
```json
// agents/agent-registry.json
{
  "version": "1.0.0",
  "agents": {
    "database-agent": {
      "description": "AI agent for database operations and SQL queries",
      "author": "Truffle AI",
      "tags": ["database", "sql", "data", "queries"],
      "source": "database-agent/",  // directory with trailing slash
      "main": "database-agent.yml"  // entry point within directory
    },
    "talk2pdf-agent": {
      "description": "PDF document analysis and conversation",
      "author": "Truffle AI",
      "tags": ["pdf", "documents", "analysis"],
      "source": "talk2pdf-agent.yml"  // single file (no main needed)
    },
    "image-editor-agent": {
      "description": "AI agent for image editing and manipulation",
      "author": "Truffle AI",
      "tags": ["images", "editing", "graphics"],
      "source": "image-editor-agent/",
      "main": "image-editor-agent.yml"
    },
    "music-agent": {
      "description": "AI agent for music creation and audio processing",
      "author": "Truffle AI",
      "tags": ["music", "audio", "creation"],
      "source": "music-agent/",
      "main": "music-agent.yml"
    },
    "product-researcher-agent": {
      "description": "AI agent for product name research and branding",
      "author": "Truffle AI",
      "tags": ["product", "research", "branding", "naming"],
      "source": "product-name-researcher/",
      "main": "product-name-researcher.yml"
    },
    "triage-agent": {
      "description": "Customer support triage system",
      "author": "Truffle AI",
      "tags": ["support", "triage", "routing", "multi-agent"],
      "source": "triage-demo/",
      "main": "triage-agent.yml"
      // No special type - just another agent that happens to use MCP servers
    }
  }
}
```

### Registry Field Definitions
- **`version`**: Registry format version (not per-agent)
- **`description`**: User-facing description for discovery
- **`author`**: Creator attribution (future-proof for community agents)
- **`tags`**: Searchable tags for filtering and discovery
- **`source`**: Path to agent file or directory (trailing slash = directory)
- **`main`**: Entry point for directory agents (optional for single files)

### Key Design Decisions
1. **Trailing slash convention**: `source: "dir/"` = directory, `source: "file.yml"` = single file
   - Directories preserve structure (data files, docs, sub-agents)
   - Single files are simpler for standalone agents
2. **No special types**: All agents are equal, some just use other agents as MCP servers
3. **Simple resolution**: The `main` field points to entry point for directories
4. **Template variables**: `@agent_dir` and `@agent_name` for path resolution (not environment variables)
5. **Minimal metadata**: Only essential fields kept (no per-agent versions, timestamps, or display names)
6. **Installation precedence**: Once installed to `~/.dexto/agents/`, always use installed version
   - Simplifies behavior and prevents unexpected updates
   - Future: Add `dexto update-agent` for explicit updates

## Out of Scope (For Now)

1. **Remote agent fetching** from URLs/GitHub (existing code to be commented out)
2. **Agent versioning** and updates (tracked but not used)
3. **Agent marketplace** or central repository
4. **Plugin system** with code execution
5. **Agent dependencies** (one agent requiring another)
6. **Project-local registry** (only global for now)
7. **Circular dependency detection** (rely on timeouts)
8. **Custom user agents in registry** (must use file paths)

## Migration Impact

### What Changes
1. **Bundled agents** get `@agent_dir` template variables instead of hardcoded paths
2. **Registry location** standardized to `~/.dexto/agents/`
3. **Resolution logic** uses new registry system
4. **Template processing** runs before environment variable expansion

### What Stays Same
1. **CLI commands** work identically
2. **Project structure** unchanged for create-app
3. **Config format** remains YAML with same schema

## Rollout Strategy

### Phase 1: Core Registry (MVP)
- Audit existing agents (e.g., talk2pdf-agent) to determine single-file vs directory
- Implement basic resolution logic
- Add template variable substitution
- Update bundled agents with proper paths
- Add `dexto which` command for debugging
- Atomic installation with validation
- Ship with next minor version

### Phase 2: Enhanced Discovery
- Add `list-agents` command with filtering
- Implement agent metadata display
- Add update checking
- Better error messages with recovery suggestions

### Phase 3: Extended Features
- Remote agent fetching
- Version management
- Agent marketplace
- Plugin support

## User Stories

### Story 1: New User Discovery
As a new Dexto user, I want to see what agents are available so I can start using them immediately.

**Acceptance Criteria:**
- `dexto list-agents` shows all available agents
- Each agent has a clear description
- Usage examples are provided

### Story 2: Agent Execution
As a user, I want to run agents by name without worrying about paths or installation.

**Acceptance Criteria:**
- `dexto -a database-agent` works on first run
- Agent is automatically installed if needed
- All resources (data files, docs) work correctly

### Story 3: Custom Agent Creation
As a developer, I want to create custom agents that work alongside bundled ones.

**Acceptance Criteria:**
- Can create agents in `~/.dexto/agents/`
- Custom agents work with same commands as bundled
- Can override bundled agents with custom versions

### Story 4: Multi-Agent System Usage
As a user, I want to use complex multi-agent systems without manual setup.

**Acceptance Criteria:**
- `dexto -a triage-demo` installs entire system
- Sub-agents resolve and communicate correctly
- Shared resources are accessible

## Technical Considerations

### Performance
- Lazy loading to avoid copying unused agents
- Efficient directory copying for multi-file agents
- Caching of resolved paths

### Security
- Validate agent configs before execution
- Sandbox file access to agent directories
- Clear permissions model for future remote agents

### Maintainability
- Clear separation between registry and resolution logic
- Comprehensive test coverage for edge cases
- Well-documented public APIs

## Appendix: Example list-agents Output

```
📋 Available Agents:

Installed (in ~/.dexto/agents/):
• database-agent - AI agent for database operations and SQL queries
  Author: Truffle AI | Tags: database, sql, data, queries

• triage-agent - Customer support triage system
  Author: Truffle AI | Tags: support, triage, routing, multi-agent

Available to Install:
• talk2pdf-agent - PDF document analysis and conversation
  Author: Truffle AI | Tags: pdf, documents, analysis

• image-editor-agent - AI agent for image editing and manipulation
  Author: Truffle AI | Tags: images, editing, graphics

Usage: dexto -a <agent-name>
```

## Technical plan
Check technical-plans/agent-registry for detailed technical plans

## Task List

After every sub-task, commit relevant changes and update task list

### Phase 1: Foundation (Core Infrastructure)
- [x] **1.1 Add getDextoGlobalPath utility** - Always returns global `~/.dexto/` paths, not project-relative
- [x] **1.2 Port agent registry types** - Clean up and adapt from agent-registry-2 branch
- [x] **1.3 Implement registry loading** - JSON parsing, validation, bundled script resolution
- [x] **1.4 Audit bundled agents** - Determine which are single-file vs directory, update registry JSON

### Phase 2: Core Resolution Logic  
- [ ] **2.1 Implement agent resolution logic** - Name vs path detection, registry lookups
- [ ] **2.2 Template variable expansion system** - Insert into config loading pipeline after YAML, before Zod
- [ ] **2.3 Update loadAgentConfig integration** - Try registry first, fall back to file paths
- [ ] **2.4 Test with database-agent** - First agent to get template variables, verify data files work

### Phase 3: Installation System
- [ ] **3.1 Implement atomic installation** - Temp directory + rename pattern for safety
- [ ] **3.2 Handle directory vs single-file agents** - Preserve structure, resolve main entry points  
- [ ] **3.3 Auto-install on first use** - Trigger from resolution logic when registry agent not found
- [ ] **3.4 Update remaining bundled agents** - Apply template variables to all agents

### Phase 4: CLI Integration
- [ ] **4.1 Update -a/--agent flag behavior** - Accept names or paths transparently
- [ ] **4.2 Verify list-agents command** - Ensure it uses getDextoGlobalPath, shows installed vs available
- [ ] **4.3 Add which command** - For debugging resolution: `dexto which database-agent`
- [ ] **4.4 Enhance first-time setup** - Add tips about available agents after setup completes

### Phase 5: Testing & Polish
- [ ] **5.1 Cross-platform testing** - Windows, Mac, Linux path handling
- [ ] **5.2 Multi-agent system testing** - triage-demo with sub-agents and shared resources
- [ ] **5.3 Edge case testing** - All scenarios from E1-E11 in feature plan
- [ ] **5.4 Error message polish** - Clear, helpful messages with suggestions
- [ ] **5.5 Documentation updates** - User-facing docs about registry system

### Priority Dependencies
- Everything depends on **1.1** (getDextoGlobalPath)
- **2.2** needs **2.1** (template expansion needs resolution working)  
- **3.x** needs **2.x** (installation needs template variables)
- **4.x** can be done in parallel with core work
- **5.x** should be continuous but comprehensive testing comes last