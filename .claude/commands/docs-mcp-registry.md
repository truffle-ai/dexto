---
description: "Update MCP Registry documentation to match server-registry-data.json"
allowed-tools: ["bash", "read", "write", "edit"]
---

# MCP Registry Documentation Updater

Synchronizes `docs/docs/mcp/mcp-registry.md` with the source of truth at `packages/webui/lib/server-registry-data.json`.

## Workflow

### 1. Read the Source Data

Read the MCP registry JSON file:

```bash
cat packages/webui/lib/server-registry-data.json
```

Parse all server entries and extract:
- **id**: Server identifier
- **name**: Display name
- **description**: Server description
- **category**: productivity, creative, research, development, data
- **icon**: Emoji icon
- **config**: YAML configuration (type, command, args, env, timeout, etc.)
- **tags**: Array of tags
- **isOfficial**: Whether it's an official MCP server
- **author**: Server author
- **homepage**: Homepage/repository URL
- **requirements**: Platform requirements (node version, python version, dependencies)

### 2. Read Current Documentation

```bash
cat docs/docs/mcp/mcp-registry.md
```

### 3. Compare and Update

For each server in the registry:

**Check if server exists in documentation:**
- If missing: Add new server entry
- If exists: Update configuration, description, tags, requirements if changed
- If server removed from registry: Remove from documentation

**Maintain section structure:**
- Group by category (Productivity, Creative, Research, Development, Data & Visualization)
- Alphabetize servers within each category
- Include all fields: name, author badge, description, YAML config, tags, requirements, homepage

**Entry format:**

```markdown
### {name}
**{Official/Community} MCP Server** by {author}

{description}

```yaml
mcpServers:
  {id}:
    type: {type}
    command: {command}
    args: {args}
    {env if present}
    timeout: {timeout}
```

**Tags:** {comma-separated tags}
**Requirements:** {node/python version, dependencies}
**Homepage:** {homepage}

---
```

### 4. Update Documentation

Use the Edit or Write tool to update `docs/docs/mcp/mcp-registry.md` with all changes.

### 5. Verify

Read the updated file to ensure:
- All servers from registry are present
- No duplicate entries
- Proper YAML formatting
- Consistent structure
- All sections are properly ordered

## Important Notes

- **Source of truth:** `packages/webui/lib/server-registry-data.json`
- **Keep:** Frontmatter, introduction paragraph, "Additional Resources" section
- **Update:** All server entries based on JSON data
- **Remove:** Servers not in JSON registry
- **Format:** Follow existing markdown structure exactly
