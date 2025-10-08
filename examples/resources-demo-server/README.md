# MCP Resources Demo Server

A real, working MCP server that demonstrates the **Resources capability**.

## Purpose

This server tests that Dexto's client-side resource handling is set up correctly by providing a clean MCP Resources implementation.

## What This Provides

### MCP Resources Capability
- **`resources/list`** - Lists available resources with URIs, names, descriptions, and MIME types
- **`resources/read`** - Reads content of specific resources by URI

### Available Resources

1. **Product Metrics Dashboard** (`mcp-demo://product-metrics`)
   - JSON data with KPIs, growth metrics, and feature usage
   - Content: Business analytics and performance indicators

2. **User Feedback Summary** (`mcp-demo://user-feedback`) 
   - Markdown format with sentiment analysis and feature requests
   - Content: Customer insights and improvement suggestions

3. **System Status Report** (`mcp-demo://system-status`)
   - JSON data with infrastructure health and performance metrics
   - Content: Service status, uptime, and system monitoring data

## Setup

1. Install dependencies:
   ```bash
   cd examples/resources-demo-server
   npm install
   ```

2. Run with Dexto:
   ```bash
   # From project root
   dexto --agent ./examples/resources-demo-server/agent.yml
   ```

## Testing MCP Resources

Try these commands to test resource access:

1. **List Resources**: "What resources are available?"
2. **Read Specific Resource**: "Show me the product metrics data"
3. **Analyze Content**: "What does the user feedback summary say?"
4. **System Information**: "Check the current system status"

## Expected Behavior

✅ **With MCP Resources Working:**
- Dexto connects to the external MCP server
- ResourceManager.listAllResources() returns the 3 demo resources
- Resources have URIs like `mcp:resources-demo:mcp-demo://product-metrics`
- You can read resource content through the ResourceManager

❌ **If MCP Resources Not Working:**
- Server connection fails
- No resources appear in ResourceManager
- Resource read operations fail

## Technical Details

This demonstrates the complete MCP Resources flow:

1. **Server Side**: 
   - Implements `resources/list` and `resources/read` handlers
   - Returns structured data with proper MIME types
   - Uses standard MCP SDK patterns

2. **Client Side** (Dexto):
   - MCPManager discovers and caches resources
   - ResourceManager aggregates MCP resources 
   - Resources become available for AI conversations

## Architecture

```
┌─────────────────┐    MCP Protocol    ┌──────────────────┐
│   Dexto Client  │ ◄─────────────────► │  MCP Resources   │
│                 │   resources/list   │     Server       │
│ ResourceManager │   resources/read   │                  │
└─────────────────┘                    └──────────────────┘
```

This validates that your Dexto client can properly consume MCP Resources from external servers.