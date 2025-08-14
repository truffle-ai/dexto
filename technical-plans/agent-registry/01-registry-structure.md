# Technical Plan: Agent Registry Structure

## Overview
Define the registry structure for agent discovery, storage, and metadata management based on the feature plan requirements.

## Registry Components

### 1. Bundled Registry (`agents/agent-registry.json`)
```json
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
    }
  }
  ....
}
```

### 2. Local Agent Storage (`~/.dexto/agents/`)
- **Purpose**: Store installed agents from registry
- **Structure**: Preserves original directory structure
- **Precedence**: Once installed, always use local version
- **Example Layout**:
  ```
  ~/.dexto/agents/
  ├── database-agent/
  │   ├── database-agent.yml
  │   └── data/
  │       └── example.db
  ├── triage-demo/
  │   ├── triage-agent.yml
  │   ├── technical-support-agent.yml
  │   ├── billing-agent.yml
  │   └── docs/
  │       └── company-overview.md
  ```

### 3. Registry Field Definitions
- **version**: Registry format version (not per-agent)
- **description**: User-facing description for discovery
- **author**: Creator attribution
- **tags**: Searchable tags for filtering
- **source**: Path to agent file or directory (trailing slash = directory)
- **main**: Entry point for directory agents (optional for single files)

## Key Design Decisions

### 1. Directory vs Single File
- **Trailing slash convention**: `source: "dir/"` = directory, `source: "file.yml"` = single file
- **Directory agents**: Preserve complete structure (data files, docs, sub-agents)
- **Single file agents**: Simpler for standalone agents

### 2. No Special Types
- All agents are equal in the registry
- Multi-agent systems (like triage-demo) are just agents that use other agents as MCP servers
- No need for complex type hierarchies

### 3. Reserved Names
- Registry agent names are reserved and cannot be overridden
- Users must use different names for custom agents
- Ensures consistency and prevents confusion

### 4. Minimal Metadata
- Only essential fields kept
- No per-agent versions in initial implementation
- No timestamps or complex dependency tracking
- Focus on simplicity and clarity

## Implementation Requirements

### TypeScript Interface
```typescript
interface RegistryEntry {
  description: string;
  author: string;
  tags: string[];
  source: string;  // Path to file or directory
  main?: string;   // Entry point for directories
}

interface Registry {
  version: string;
  agents: Record<string, RegistryEntry>;
}
```

### File Organization
```
agents/
├── agent-registry.json       # Registry metadata
├── database-agent/           # Multi-file agent
│   ├── database-agent.yml
│   └── data/
├── talk2pdf-agent.yml       # Single-file agent
└── triage-demo/             # Complex multi-agent system
    ├── triage-agent.yml
    └── [sub-agents...]
```

## Implementation Notes

**IMPORTANT**: The code snippets in this document are illustrative examples. Before implementing:
1. Read and analyze the actual function signatures and types in the codebase
2. Check existing patterns and utilities that can be reused
3. Verify type definitions match current schemas
4. Some code shown may have errors or inconsistencies - always validate against the actual codebase

## Success Criteria
1. Registry format is simple and extensible
2. Clear distinction between directory and single-file agents
3. Metadata supports discovery and filtering
4. Structure preserves agent resources and dependencies
5. Format is ready for future enhancements (versions, remote agents)