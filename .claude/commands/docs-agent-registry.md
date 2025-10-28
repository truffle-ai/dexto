---
description: "Update Agent Registry documentation to match agent-registry.json"
allowed-tools: ["bash", "read", "write", "edit", "glob"]
---

# Agent Registry Documentation Updater

Synchronizes `docs/docs/guides/agent-registry.md` with the source of truth at `agents/agent-registry.json`.

## Workflow

### 1. Read the Source Data

Read the agent registry JSON file:

```bash
cat agents/agent-registry.json
```

Parse all agent entries and extract:
- **id**: Agent identifier
- **name**: Display name
- **description**: Agent description
- **author**: Agent author
- **tags**: Array of tags
- **source**: Directory or file path
- **main**: Main configuration file (if applicable)

### 2. Read Agent Configuration Files

For each agent, read its YAML configuration to extract:
- System prompt
- LLM configuration
- MCP servers used
- Internal tools enabled
- Special features

```bash
cat agents/{source}/{main}
```

or for single-file agents:

```bash
cat agents/{source}
```

### 3. Read Current Documentation

```bash
cat docs/docs/guides/agent-registry.md
```

### 4. Compare and Update

For each agent in the registry:

**Check if agent exists in documentation:**
- If missing: Add new agent entry
- If exists: Update description, configuration, tags if changed
- If agent removed from registry: Remove from documentation

**Entry format:**

````markdown
## {name}

{description}

**Author:** {author}
**Tags:** {comma-separated tags}

### Features

- Feature 1
- Feature 2
- Feature 3

### Configuration

{high-level overview of LLM, MCP servers, tools}

### Installation

```bash
dexto install {id}
```

---
````

### 5. Update Documentation

Use the Edit or Write tool to update `docs/docs/guides/agent-registry.md` with all changes.

### 6. Verify

Read the updated file to ensure:
- All agents from registry are present
- No duplicate entries
- Consistent structure
- Installation commands are correct
- Tags and descriptions match registry

## Important Notes

- **Source of truth:** `agents/agent-registry.json`
- **Keep:** Frontmatter, introduction, usage instructions
- **Update:** All agent entries based on JSON + YAML config
- **Remove:** Agents not in JSON registry
- **Format:** Follow existing markdown structure exactly
- **Details:** Extract actual config details from YAML files, don't just copy description
