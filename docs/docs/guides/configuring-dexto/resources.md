---
sidebar_position: 12
---

# Resources

## What are Resources?

Resources let your Dexto agent expose local files and blob storage directly to the LLM as context. Unlike MCP resources (from external servers), these are managed by your agent.

:::tip Quick Reference
For complete field documentation, see **[agent.yml → Resources](./agent-yml#resources)**.
:::

## Resource Types

### Filesystem Resources

Expose local files and directories to your agent:

```yaml
resources:
  - type: filesystem
    paths: ["./docs", "./src"]
    maxDepth: 3
    maxFiles: 1000
    includeHidden: false
    includeExtensions: [".md", ".ts", ".js", ".json"]
```

**Key options:**
- `paths` - Directories/files to expose (required)
- `maxDepth` - How deep to traverse directories (default: 3)
- `maxFiles` - Maximum files to index (default: 1000, max: 10000)
- `includeExtensions` - File types to include (default: common text files)

### Blob Resources

Expose blob storage (images, documents, generated files):

```yaml
storage:
  blob:
    type: local
    maxBlobSize: 52428800  # 50MB

resources:
  - type: blob
```

Blob storage settings go in `storage.blob` section. The resource just enables LLM access to stored blobs.

## Using Resources

### In Web UI

Type `@` to auto-complete and reference resources:
```
@file:///project/README.md summarize this
```

### Via SDK

```typescript
// List all resources (internal + MCP)
const resources = await agent.resourceManager.list();

// Read a resource
const content = await agent.resourceManager.read('file:///path/to/file');
```

## Configuration Patterns

**Documentation bot:**
```yaml
resources:
  - type: filesystem
    paths: ["./documentation"]
    maxDepth: 5
    includeExtensions: [".md", ".mdx"]
```

**Project context:**
```yaml
resources:
  - type: filesystem
    paths: ["./src", "./tests", "./README.md"]
    includeExtensions: [".ts", ".tsx", ".js", ".json", ".md"]
  - type: blob
```

**Config files only:**
```yaml
resources:
  - type: filesystem
    paths: ["."]
    maxDepth: 2
    includeExtensions: [".json", ".yaml", ".yml", ".toml"]
```

## Best Practices

1. **Be selective** - Only expose necessary directories
2. **Set reasonable limits** - Use `maxDepth` and `maxFiles` to prevent performance issues
3. **Filter extensions** - Include only relevant file types
4. **Exclude secrets** - Never expose `.env`, credentials, private keys
5. **Use path variables** - `${{dexto.agent_dir}}` for portable configs

## See Also

- [agent.yml → Resources](./agent-yml#resources) - Complete field reference
- [Storage Configuration](./storage) - Blob storage backend settings
- [MCP Resources](../../mcp/resources) - External MCP server resources
