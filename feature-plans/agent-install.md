# Feature Plan: Custom Agent Installation & Management

**Status:** Planning
**Owner:** TBD
**Created:** 2025-01-06
**Target:** v0.x.0

## Overview

Enable users to create, install, and manage custom agents alongside the curated registry agents. This includes both CLI and UI workflows, with a user-friendly form-based editor alongside the existing YAML editor.

## Problem Statement

Currently, users can only use agents from the curated registry. Power users want to:
1. Install their own custom agent configurations from local files
2. Create and manage custom agents through the UI
3. Share custom agents with teammates or across projects
4. Edit agents using forms without needing to know YAML syntax

## Goals

1. **CLI Installation:** `dexto install ./my-agent.yml` installs custom agents
2. **Seamless Usage:** `dexto -a my-custom-agent` works like registry agents
3. **UI Integration:** Custom agents appear in AgentSelector, can be switched/edited
4. **User-Friendly Editing:** Form-based editor for non-technical users
5. **Guided Creation:** Wizard for creating new custom agents in UI

## Non-Goals

- Agent marketplace/sharing platform (future)
- Version control for agents (future)
- Remote agent URLs (future)
- Agent templates library (start with 2-3 basic templates)

## Architecture

### Two-Tier Registry System

**Bundled Registry** (read-only, ships with Dexto):
```
/agents/agent-registry.json
```

**User Registry** (writable, on user's machine):
```
~/.dexto/agent-registry.json
```

**All Installed Agents** (single directory):
```
~/.dexto/agents/
├── default-agent/      # From bundled registry
├── database-agent/     # From bundled registry
└── my-coding-agent/    # From user registry (custom)
```

At runtime, both registries are merged. **Agent names must be unique across both registries** - custom agents cannot have the same name as bundled agents.

**Important:** User registry only contains custom agents. Builtin agents are NOT added to user registry when installed - installation state is tracked by filesystem presence in `~/.dexto/agents/`.

### Registry Entry Schema

Both bundled and user registries use the same structure:

```typescript
// In agent-registry.json
{
  "version": "1.0.0",
  "agents": {
    "agent-name": {
      "description": string;
      "author": string;
      "tags": string[];
      "source": string;          // "agent-name/" or "agent.yml"
      "main"?: string;            // Required if source is directory
      "type": "builtin" | "custom";  // NEW
    }
  }
}
```

**Examples:**

Bundled registry entry:
```json
{
  "default-agent": {
    "description": "Default Dexto agent",
    "author": "Truffle AI",
    "tags": ["default", "filesystem"],
    "source": "default-agent.yml",
    "type": "builtin"
  }
}
```

User registry entry (custom agent):
```json
{
  "my-coding-agent": {
    "description": "Custom coding agent",
    "author": "John Doe",
    "tags": ["coding", "custom"],
    "source": "my-coding-agent/",
    "main": "agent.yml",
    "type": "custom"
  }
}
```

### How Registry Merging Works

```
Bundled Registry (agents/agent-registry.json):
{
  "default-agent": { type: "builtin", ... },
  "database-agent": { type: "builtin", ... }
}

User Registry (~/.dexto/agent-registry.json):
{
  "my-coding-agent": { type: "custom", ... },
  "my-research-agent": { type: "custom", ... }
}

Merged View at Runtime:
{
  "default-agent": { type: "builtin", ... },      // from bundled
  "database-agent": { type: "builtin", ... },     // from bundled
  "my-coding-agent": { type: "custom", ... },     // from user
  "my-research-agent": { type: "custom", ... }    // from user
}

Installation State (checked via filesystem):
~/.dexto/agents/
├── default-agent/      ✓ installed (builtin)
├── my-coding-agent/    ✓ installed (custom)
└── my-research-agent/  ✓ installed (custom)
(database-agent is available but not installed)
```

### Agent Resolution Priority

```
1. Explicit file path: dexto -a ./my-agent.yml
2. Merged registry lookup: dexto -a my-coding-agent
   - Single merged view of all agents (bundled + custom)
   - Names are guaranteed unique (validated at install time)
3. Preferences default: dexto (no -a flag)
```

## Implementation Phases

### Phase 0: Foundation

**Goal:** Infrastructure and types for two-tier registry

**Tasks:**
- [ ] Add `type: "builtin" | "custom"` field to `AgentRegistryEntrySchema`
- [ ] Make `type` field optional with default `"builtin"` (backwards compat)
- [ ] Create user registry utilities (`user-registry.ts`):
  - `loadUserRegistry()` - Load `~/.dexto/agent-registry.json`, return empty if not exists
  - `saveUserRegistry()` - Write user registry atomically
  - `mergeRegistries()` - Merge bundled + user registries (user for custom only)
  - `addAgentToUserRegistry()` - Add custom agent entry with `type: "custom"`
  - `removeAgentFromUserRegistry()` - Remove custom agent entry
  - `userRegistryHasAgent()` - Check if agent exists in user registry
- [ ] Write unit tests for user registry utilities

**Note:** User registry only contains custom agents. Builtin agents are never added to user registry.

**Files to modify:**
- `packages/core/src/agent/registry/types.ts` - Add `type` field
- Create: `packages/core/src/agent/registry/user-registry.ts` - User registry utilities

**Deliverable:** User registry utilities tested, registry types updated

---

### Phase 1: Core Registry & Resolution

**Goal:** Extend existing registry to support user registry (no interface changes)

**Tasks:**
- [ ] Update `LocalAgentRegistry` class (modify existing methods, no new interface methods):
  - `loadRegistry()` - Load and merge both bundled + user registries
  - `getAvailableAgents()` - Returns merged view
  - `installAgent()` - Detect file path vs name, handle both:
    - If file path: install as custom agent + add to user registry
    - If name: install from bundled registry (existing behavior)
  - `uninstallAgent()` - Improve protection logic:
    - Current: Hardcoded protection for 'default-agent'
    - New: Check preferences to get default agent, protect that one
    - Builtin agents: Can be uninstalled from disk (stay in bundled registry, can reinstall)
    - Custom agents: Uninstalled from disk AND removed from user registry
  - `hasAgent()` - Check merged registry
- [ ] Add validation:
  - Prevent custom agent names that conflict with bundled registry
  - Validate YAML before installation
- [ ] Update `agent-resolver.ts`:
  - No changes needed - already uses `registry.hasAgent()` and `registry.resolveAgent()`
  - Resolution automatically works with merged registry
- [ ] Write integration tests for merged registry

**Files to modify:**
- `packages/core/src/agent/registry/registry.ts`
- `packages/core/src/agent/registry/errors.ts` - Add name conflict error

**Deliverable:** `resolveAgentPath('my-custom-agent')` works, single merged view of agents

**Testing:**
```typescript
// Test merged registry
registry.getAvailableAgents() // → includes both bundled + custom
registry.hasAgent('default-agent') // → true (bundled)
registry.hasAgent('my-custom-agent') // → true (custom)

// Test resolution
resolveAgentPath('my-custom-agent') // → custom agent path
resolveAgentPath('default-agent')   // → bundled agent path
resolveAgentPath('./agent.yml')    // → explicit path

// Test name conflicts prevented
registry.installAgent('./agent.yml', metadata: { name: 'default-agent', ... })
// → throws error: name already exists in bundled registry
```

---

### Phase 2: CLI Commands

**Goal:** Users can install custom agents via CLI

**Tasks:**
- [ ] Enhance `install.ts` command:
  - Detect if input is file path vs registry name (use `isPath()` util)
  - If file path:
    - Add interactive prompts for metadata (name, description, author, tags)
    - Support non-interactive mode with flags (`--name`, `--description`, etc.)
    - Validate agent name doesn't conflict with bundled registry
    - Call `registry.installAgent(filePath, metadata)`
  - If registry name: existing behavior
  - Add analytics events
- [ ] Update `list-agents.ts`:
  - Group agents by `type` field
  - Show "Custom Agents" and "Built-in Agents" sections
  - Add badge/indicator for agent type
- [ ] Extend existing `uninstall.ts` command:
  - Check preferences to get default agent, block uninstalling it (unless --force)
  - Builtin agents: Can be uninstalled (deleted from disk only)
  - Custom agents: Fully uninstalled (disk + user registry)
  - Show different messages based on agent type

**Files to modify:**
- `packages/cli/src/cli/commands/install.ts`
- `packages/cli/src/cli/commands/list-agents.ts`
- `packages/cli/src/cli/commands/uninstall.ts`

**CLI Usage:**
```bash
# Interactive install (custom agent from file)
dexto install ./my-agent.yml
? Agent name: my-coding-agent
? Description: Custom agent for coding tasks
? Author: (optional)
? Tags (comma-separated): coding,custom
✓ Installed custom agent 'my-coding-agent'

# Non-interactive install
dexto install ./my-agent.yml --name "my-agent" --description "My custom agent" --tags "coding,custom"

# Install from registry (existing behavior)
dexto install default-agent
✓ Installed agent 'default-agent'

# List agents (grouped by type)
dexto list-agents
Custom Agents:
  • my-coding-agent - Custom agent for coding tasks

Built-in Agents:
  • default-agent - Default Dexto agent
  • database-agent - AI agent for database operations

# Uninstall custom agent (removed from disk + user registry)
dexto uninstall my-coding-agent
✓ Uninstalled custom agent 'my-coding-agent'

# Uninstall builtin agent (removed from disk only, can reinstall)
dexto uninstall database-agent
✓ Uninstalled agent 'database-agent' (can reinstall with: dexto install database-agent)

# Uninstall default agent (blocked - it's the default in preferences)
dexto uninstall default-agent
✗ Cannot uninstall default agent. Change your default agent first with: dexto setup
```

**Deliverable:** CLI workflow complete and tested

**Validation Point 1:** ✅ Users can create and use custom agents entirely via CLI

---

### Phase 3: Basic API & UI Integration

**Goal:** Custom agents visible and switchable in UI

**Tasks:**
- [ ] Update existing API endpoints in `server.ts`:
  - `GET /api/agents` - Already returns merged view, add `type` field to response
  - `POST /api/agents/install` - Add support for custom agent metadata in request body
  - Add validation endpoint: `POST /api/agents/validate-name` - Check name conflicts
- [ ] Update `DextoAgent` class:
  - `listAgents()` - Already works with merged registry, add `type` field
  - `installAgent()` - Add overload to accept metadata for custom agents
  - `uninstallAgent()` - Already works, just validates `type` field
- [ ] Update `AgentSelector.tsx`:
  - Group agents by `type` field in response
  - Add visual indicator for custom agents (badge/icon)
  - Add delete button for custom agents only
  - Handle agent switching (no changes needed - works transparently)

**Files to modify:**
- `packages/cli/src/api/server.ts`
- `packages/core/src/agent/DextoAgent.ts`
- `packages/webui/components/AgentSelector.tsx`

**API Changes:**
```typescript
// List all agents (existing endpoint, enhanced response)
GET /api/agents
Response: {
  installed: AgentItem[],  // Includes both types, with type field
  available: AgentItem[],  // Includes both types, with type field
  current: { name: string }
}

// AgentItem now includes:
interface AgentItem {
  name: string;
  description: string;
  author: string;
  tags: string[];
  type: 'builtin' | 'custom';  // NEW
  installed: boolean;
}

// Install agent (existing endpoint, enhanced to accept metadata)
POST /api/agents/install
Body (registry agent): { name: string }
Body (custom agent): {
  filePath: string,
  metadata: { name: string, description: string, author?: string, tags?: string[] }
}
Response: { installed: true, name: string }

// Validate name (new endpoint)
POST /api/agents/validate-name
Body: { name: string }
Response: { valid: boolean, conflict?: 'builtin' | 'custom' }
```

**UI Changes:**
```tsx
<AgentSelector>
  {/* Group by type automatically from API response */}
  <Section title="Custom">
    {customAgents.map(agent => (
      <AgentItem
        agent={agent}
        badge="Custom"
        onDelete={handleDelete}  // Only shown for custom
      />
    ))}
  </Section>

  <Section title="Built-in">
    {builtinAgents.map(agent => (
      <AgentItem agent={agent} />
    ))}
  </Section>
</AgentSelector>
```

**Deliverable:** Custom agents fully integrated into UI with type distinction

**Validation Point 2:** ✅ CLI-installed custom agents now visible and usable in UI

---

### Phase 4: Form Editor Foundation

**Goal:** Non-technical users can edit agents with forms

**Tasks:**
- [ ] Create `FormEditor.tsx` component:
  - Accordion-based layout for sections
  - Basic Info section (read-only: name, description)
  - LLM Configuration section (provider, model, API key)
  - System Prompt section (textarea for instructions)
- [ ] Update `CustomizePanel.tsx`:
  - Add editor mode toggle (Form/YAML)
  - Implement state management for both modes
  - Handle mode switching with dirty state
- [ ] Implement two-way sync:
  - Form changes → update config → regenerate YAML
  - YAML changes → parse → update config → update form
  - Handle YAML parsing errors gracefully
- [ ] Add validation:
  - Real-time validation in form fields
  - Show inline error messages
  - Disable save if validation fails

**Files to create:**
- `packages/webui/components/FormEditor.tsx`
- `packages/webui/components/form-sections/LLMConfigSection.tsx`
- `packages/webui/components/form-sections/SystemPromptSection.tsx`

**Files to modify:**
- `packages/webui/components/CustomizePanel.tsx`

**Component Structure:**
```tsx
<CustomizePanel>
  <Header>
    <SegmentedControl value={mode} onChange={setMode}>
      <Option value="form">Form Editor</Option>
      <Option value="yaml">YAML Editor</Option>
    </SegmentedControl>
  </Header>

  <Content>
    {mode === 'form' ? (
      <FormEditor config={config} onChange={handleFormChange} />
    ) : (
      <YamlEditor value={yaml} onChange={handleYamlChange} />
    )}
  </Content>

  <Footer>
    <ValidationStatus />
    <SaveButton />
  </Footer>
</CustomizePanel>
```

**Deliverable:** Users can edit LLM + system prompt via forms

**Validation Point 3:** ✅ Non-technical users can customize agents without YAML

---

### Phase 5: Form Editor - Advanced Sections

**Goal:** Full coverage of common agent configuration

**Tasks:**
- [ ] Add MCP Servers section:
  - List view of configured servers
  - Add/remove/edit server configs
  - Form fields for server type, command, args
- [ ] Add Storage Configuration section:
  - Cache type selector (in-memory/redis)
  - Database type selector (sqlite/postgres)
  - Connection string inputs
- [ ] Add Tool Confirmation section:
  - Mode selector (auto-approve/manual)
  - Timeout input
  - Allowed tools storage type
- [ ] Add advanced features detection:
  - Detect when config is too complex for form
  - Show warning: "Some advanced features may not be editable in form mode"
  - Provide link to YAML editor

**Files to create:**
- `packages/webui/components/form-sections/McpServersSection.tsx`
- `packages/webui/components/form-sections/StorageSection.tsx`
- `packages/webui/components/form-sections/ToolConfirmationSection.tsx`

**Deliverable:** Form editor covers 90% of agent configs

---

### Phase 6: Agent Creation Wizard

**Goal:** Guided experience for creating custom agents

**Tasks:**
- [ ] Create `AgentCreationWizard.tsx` component:
  - Step 1: Choose source (template/import/scratch)
  - Step 2: Basic info (name, description, tags)
  - Step 3: LLM configuration
  - Step 4: System prompt
  - Step 5: Review & create
- [ ] Create agent templates:
  - `minimal-agent.yml` - Bare minimum config
  - `default-agent.yml` - Full-featured template
  - `coding-agent.yml` - Optimized for coding tasks
- [ ] Add creation API endpoint:
  - `POST /api/agents/custom/create`
  - Accepts wizard data, creates agent
  - Returns agent name
- [ ] Add "+ New Agent" button:
  - In AgentSelector dropdown
  - Opens wizard dialog
- [ ] Implement creation flow:
  - Create agent from wizard data
  - Optionally switch to new agent
  - Optionally open CustomizePanel for advanced edits

**Files to create:**
- `packages/webui/components/AgentCreationWizard.tsx`
- `packages/webui/components/wizard-steps/ChooseSourceStep.tsx`
- `packages/webui/components/wizard-steps/BasicInfoStep.tsx`
- `packages/webui/components/wizard-steps/LLMConfigStep.tsx`
- `packages/webui/components/wizard-steps/SystemPromptStep.tsx`
- `packages/webui/components/wizard-steps/ReviewStep.tsx`
- `agents/minimal-agent.yml`
- `agents/coding-agent.yml`

**Files to modify:**
- `packages/webui/components/AgentSelector.tsx`
- `packages/cli/src/api/server.ts`

**Wizard Flow:**
```
Step 1: Choose Source
┌─────────────────────────────────┐
│ [Template] [Import] [Scratch]  │
└─────────────────────────────────┘

Step 2: Basic Info
┌─────────────────────────────────┐
│ Name: my-coding-agent           │
│ Description: ___                │
│ Tags: coding, custom            │
└─────────────────────────────────┘

Step 3: LLM Config
┌─────────────────────────────────┐
│ Provider: [OpenAI ▼]            │
│ Model: [gpt-4 ▼]                │
│ API Key: $OPENAI_API_KEY        │
└─────────────────────────────────┘

Step 4: System Prompt
┌─────────────────────────────────┐
│ You are a coding assistant...   │
│                                 │
└─────────────────────────────────┘

Step 5: Review
┌─────────────────────────────────┐
│ ✓ Name: my-coding-agent         │
│ ✓ LLM: OpenAI gpt-4             │
│ ✓ Prompt configured             │
│                                 │
│ [☑] Set as default agent        │
│                                 │
│ [Create Agent]                  │
└─────────────────────────────────┘
```

**Deliverable:** Beautiful onboarding for creating custom agents

**Validation Point 4:** ✅ Users can create custom agents entirely from UI with guided wizard

---

### Phase 7: Polish & Enhancement

**Goal:** Production-ready feature

**Tasks:**
- [ ] User preferences:
  - Add "default editor mode" to preferences
  - Remember last used editor mode per user
  - Add to preferences API
- [ ] Enhanced validation:
  - Field-level validation messages in form
  - Suggestion system ("Did you mean gpt-4?")
  - Link to docs for each field
- [ ] Documentation:
  - Update CLI docs: `docs/docs/guides/cli.md`
  - Add guide: "Creating Custom Agents"
  - Update API docs with new endpoints
- [ ] Analytics:
  - Track custom agent creation (source: cli/ui)
  - Track editor mode usage (form/yaml)
  - Track wizard completion rate
- [ ] Error handling:
  - Better error messages for validation failures
  - Recovery suggestions
  - "Report issue" link for unexpected errors
- [ ] Testing:
  - E2E tests for full workflows
  - Integration tests for API endpoints
  - Unit tests for all new components

**Deliverable:** Feature complete, documented, and polished

---

## Testing Strategy

### Unit Tests
- Storage utilities (read/write metadata)
- Agent resolution priority
- Form ↔ YAML sync logic
- Validation helpers

### Integration Tests
- CLI commands (install, list, uninstall)
- API endpoints (all custom agent routes)
- Agent switching with custom agents
- CustomizePanel with both editors

### E2E Tests
- Full CLI workflow: install → list → run → uninstall
- Full UI workflow: wizard → create → edit → switch
- Cross-environment: CLI install → UI edit → CLI run

### Manual Testing Checklist
- [ ] Install custom agent via CLI, verify appears in UI
- [ ] Create custom agent via wizard, verify usable in CLI
- [ ] Edit agent in form mode, verify YAML is correct
- [ ] Edit agent in YAML mode, verify form updates
- [ ] Switch between custom and registry agents
- [ ] Delete custom agent, verify removed everywhere
- [ ] Handle invalid YAML gracefully
- [ ] Handle name conflicts appropriately

---

## Open Questions

1. **Should we allow exporting/sharing custom agents?**
   - Pro: Users can share configs with team
   - Con: Adds complexity, security concerns
   - Decision: Defer to future iteration

2. **Should custom agents support directories (not just single files)?**
   - Pro: Can include additional resources (multiple YAML files, assets, etc.)
   - Con: More complex installation
   - Decision: Yes, support both - follow same pattern as bundled agents

3. **Should we validate API keys exist when installing agents?**
   - Pro: Catches errors early
   - Con: Requires environment access
   - Decision: Warn but don't block (soft validation)

4. **Default editor mode for new users?**
   - Option A: Form (easier for beginners)
   - Option B: YAML (more powerful)
   - Decision: Form, with prominent toggle to YAML

5. **What happens when Dexto updates and a new bundled agent conflicts with user's custom agent?**
   - Since names must be unique, this would be caught at runtime
   - Options:
     - A: Block Dexto update (bad UX)
     - B: Warn user, ask them to rename their custom agent
     - C: Auto-rename user's agent to `{name}-custom`
   - Decision: TBD - defer until this becomes a real issue

---

## Future Enhancements (Post-MVP)

- **Agent Marketplace:** Browse/install community agents
- **Version Control:** Track agent changes, rollback
- **Remote URLs:** Install from GitHub, URLs
- **Agent Duplication:** "Copy and customize" existing agents
- **Import from Code:** Generate agent from existing codebase analysis
- **Team Sharing:** Org-level custom agents
- **Agent Testing:** Built-in test framework for custom agents

---

## Related Documents

- [Architecture: Execution Context Detection](../CLAUDE.md#execution-context-detection)
- [Architecture: Agent Resolution](../packages/core/src/config/agent-resolver.ts)
- [API Documentation](../docs/docs/api/overview.md)
- [CLI Guide](../docs/docs/guides/cli.md)
