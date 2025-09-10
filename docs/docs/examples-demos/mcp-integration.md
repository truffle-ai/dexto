---
title: "Adding Custom MCP Servers"
hide_title: true

---

## 🛠️ Adding Custom MCP Servers

Add your own Model Context Protocol (MCP) servers to extend Dexto's capabilities

```bash
# Edit your agent configuration or use the WebUI
dexto --mode web
```


<img src="https://github.com/user-attachments/assets/1a3ca1fd-31a0-4e1d-ba93-23e1772b1e79" alt="Add MCP Server Example" width="600"/>

This example demonstrates how to extend Dexto with custom tools and data sources. You can:

- Connect to any MCP-compatible server
- Add custom tools for your specific use case
- Integrate with external APIs and services
- Configure servers through YAML or the WebUI

### Configuration Methods

**Via YAML:**
```yaml
mcpServers:
  custom_api:
    type: http
    url: $CUSTOM_MCP_URL
    headers:
      Authorization: "Bearer $CUSTOM_MCP_TOKEN"
```

**Via WebUI:**
Use the web interface to add servers interactively with real-time validation and testing.

See [MCP Configuration Guide](../mcp/connecting-servers) for complete setup instructions.