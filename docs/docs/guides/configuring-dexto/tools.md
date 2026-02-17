---
sidebar_position: 11
---

# Tools

Tools are configured via the `tools:` list (tool factories). Each entry selects a factory by
`type` and provides factory-specific configuration.

If you omit `tools`, Dexto uses the active image defaults.

:::tip Reference
See **[agent.yml → Tools](./agent-yml.md#tools)** for the full schema.
:::

## Example

```yaml
tools:
  - type: builtin-tools
    enabledTools:
      - ask_user
      - invoke_skill
      - delegate_to_url

  - type: filesystem-tools
    allowedPaths: ["."]
    blockedPaths: [".git", "node_modules/.bin", ".env"]
    enableBackups: false

  - type: process-tools
    securityLevel: moderate

  - type: todo-tools

  - type: plan-tools
    basePath: "${{dexto.project_dir}}/plans"

  - type: lifecycle-tools
    enabledTools:
      - search_history
      - view_logs
      - memory_list
```

## Notes

- Use `enabled: false` on any entry to disable that tool factory.
- Local tool IDs are unprefixed (e.g. `read_file`, `bash_exec`).
- MCP tool IDs are prefixed as `mcp--<server_name>--<tool_name>`. In `permissions.toolPolicies`,
  you can also use `mcp--<tool_name>` to match any MCP server that exposes that tool.
