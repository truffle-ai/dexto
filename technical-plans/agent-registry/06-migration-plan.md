# Technical Plan: Migration and Rollout Strategy

## Overview
Step-by-step plan to migrate existing agents to use the registry system with template variables, ensuring backward compatibility and minimal disruption.

## Phase 1: Core Infrastructure (Foundation)

### 1.1 Add Path Utilities
```typescript
// src/core/utils/path.ts
export function getDextoGlobalPath(type: string, filename?: string): string {
  // ALWAYS return global path, ignore project context
  const basePath = path.join(homedir(), '.dexto', type);
  return filename ? path.join(basePath, filename) : basePath;
}
```

### 1.2 Create Registry Module
- Port `src/core/agent-registry/` from agent-registry-2 branch
- Update to use `getDextoGlobalPath` instead of `getDextoPath`
- Remove remote URL fetching code (commented out for future)
- Simplify to focus on local registry only

### 1.3 Create Registry JSON
Update `agents/agent-registry.json` with proper structure:
- Audit each agent to determine if single-file or directory
- Add proper `source` and `main` fields
- Remove unnecessary metadata (keep minimal)

## Phase 2: Template Variable System

### 2.1 Implement Template Expansion
- Add `expandTemplateVars` function to config loader
- Insert between YAML parsing and Zod validation
- Test with simple cases first

### 2.2 Update Bundled Agents
Convert hardcoded paths to template variables:

#### Before:
```yaml
# database-agent.yml
mcpServers:
  sqlite:
    args:
      - "./agents/database-agent/data/example.db"
```

#### After:
```yaml
# database-agent.yml
mcpServers:
  sqlite:
    args:
      - "@agent_dir/data/example.db"
```

### 2.3 Update Multi-Agent Systems
Special attention to triage-demo:
```yaml
# triage-demo/triage-agent.yml
mcpServers:
  technical_support:
    args:
      - dexto
      - --agent
      - "@agent_dir/technical-support-agent.yml"  # Not a registry name!
```

## Phase 3: Installation System

### 3.1 Implement Install Function
- Create atomic installation with temp directory pattern
- Handle both single-file and directory agents
- Add proper error handling and cleanup

### 3.2 Integration with Resolution
- Update `loadAgentConfig` to try registry first
- Fall back to file path resolution
- Trigger auto-installation when needed

## Phase 4: CLI Integration

### 4.1 Update Existing Commands
- Enhance `-a/--agent` flag description
- Ensure `list-agents` command works (from agent-registry-2)
- Add `which` command for debugging

### 4.2 First-Time Setup Enhancement
- Add tips about available agents after setup
- Keep default behavior unchanged (uses ~/.dexto/agent.yml)

## Testing Checklist

### Unit Tests
- [ ] Template variable expansion
- [ ] Path resolution logic
- [ ] Registry loading
- [ ] Installation functions

### Integration Tests
- [ ] Fresh install flow
- [ ] Each bundled agent works
- [ ] Multi-agent systems (triage-demo)
- [ ] Cross-platform paths

### Manual Testing
- [ ] `npm install -g dexto` fresh install
- [ ] `dexto` first-time setup
- [ ] `dexto -a database-agent` auto-installs
- [ ] `dexto -a ./custom.yml` still works
- [ ] `dexto list-agents` shows correct status
- [ ] Project usage unaffected

## Migration Steps for Each Agent

### 1. Single-File Agents
These need to be checked if they're actually single files or directories:
- `agent.yml` - Default config
- `agent-template.yml` - Template for create-app
- `talk2pdf-agent.yml` - Verify if truly single file
- `image-editor-agent.yml` - Verify if truly single file
- `music-agent.yml` - Verify if truly single file

### 2. Directory Agents
- `database-agent/` - Has data files
- `product-name-researcher/` - Multiple MCP servers
- `triage-demo/` - Complex multi-agent system

### 3. Path Updates Required
For each agent, replace:
- Relative paths → `@agent_dir/...`
- Hardcoded paths → Template variables
- Test thoroughly after changes

## Rollback Plan

If issues arise:
1. Registry resolution fails → Falls back to file paths
2. Template expansion fails → Config validation catches it
3. Installation fails → Clean error message, manual workaround
4. All else fails → Revert to previous version

## Success Metrics

### Phase 1 Complete When:
- Registry loads successfully
- Path utilities work correctly
- No breaking changes to existing flow

### Phase 2 Complete When:
- Template variables expand correctly
- All bundled agents updated
- Tests pass with new paths

### Phase 3 Complete When:
- Agents install on demand
- Atomic operations prevent corruption
- Error messages are helpful

### Phase 4 Complete When:
- CLI commands work seamlessly
- First-time users can discover agents
- Existing workflows unchanged

## Implementation Order

1. **Start with infrastructure** (Phase 1)
   - Less risky, foundational
   - Can be tested in isolation

2. **Add template variables** (Phase 2)
   - Test with one agent first
   - Roll out to all agents

3. **Enable installation** (Phase 3)
   - Test locally first
   - Add guards and error handling

4. **Polish CLI** (Phase 4)
   - User-facing changes last
   - Ensure smooth experience

## Implementation Notes

**IMPORTANT**: The code snippets and examples in this document are illustrative. Before implementing:
1. Audit the actual bundled agents to verify single-file vs directory structure
2. Test each agent after migration to ensure it still works
3. Check that all paths resolve correctly on Windows, Mac, and Linux
4. Some agents may have special requirements not covered here
5. The migration should be done incrementally with testing at each step

## Risk Mitigation

### High Risk Areas
1. **Path resolution** - Test extensively on all platforms
2. **Triage-demo** - Complex multi-agent system needs careful testing
3. **Windows paths** - Ensure cross-platform compatibility

### Mitigation Strategies
1. **Feature flag** - Consider adding a flag to disable registry temporarily
2. **Gradual rollout** - Migrate one agent at a time
3. **Extensive logging** - Add debug logs for troubleshooting
4. **Clear documentation** - Update README with new features

## Post-Migration Cleanup

After successful migration:
1. Remove old hardcoded paths from agents
2. Update documentation with registry info
3. Add registry agent creation guide
4. Consider deprecation notices for old patterns

## Future Enhancements (Out of Scope)

Listed for reference but NOT part of this migration:
- Remote agent fetching from URLs
- Agent versioning system
- Update notifications
- Agent marketplace
- Dependency management