# MCP Resources Demo Server

A comprehensive MCP server that demonstrates all three major MCP capabilities: **Resources**, **Prompts**, and **Tools**.

## Purpose

This server provides a complete reference implementation of the Model Context Protocol, demonstrating how to build an MCP server with multiple capabilities. It's used for:
- Testing Dexto's MCP client integration
- Comprehensive integration testing
- Example implementation for building custom MCP servers

## What This Provides

### 1. MCP Resources Capability
Provides structured data resources that can be read by AI assistants.

**Operations:**
- **`resources/list`** - Lists available resources with URIs, names, descriptions, and MIME types
- **`resources/read`** - Reads content of specific resources by URI

**Available Resources:**

1. **Product Metrics Dashboard** (`mcp-demo://product-metrics`)
   - JSON data with KPIs, growth metrics, and feature usage
   - Content: Business analytics and performance indicators

2. **User Feedback Summary** (`mcp-demo://user-feedback`)
   - Markdown format with sentiment analysis and feature requests
   - Content: Customer insights and improvement suggestions

3. **System Status Report** (`mcp-demo://system-status`)
   - JSON data with infrastructure health and performance metrics
   - Content: Service status, uptime, and system monitoring data

### 2. MCP Prompts Capability
Provides reusable prompt templates with argument substitution.

**Operations:**
- **`prompts/list`** - Lists available prompts with descriptions and arguments
- **`prompts/get`** - Retrieves a prompt with argument values substituted

**Available Prompts:**

1. **analyze-metrics** - Analyze product metrics and provide insights
   - **Arguments:**
     - `metric_type` (required) - Type of metric: users, revenue, or features
     - `time_period` (optional) - Time period for analysis (e.g., "Q1 2025")
   - **Usage:** Generates analysis prompt for product metrics dashboard

2. **generate-report** - Generate a comprehensive product report
   - **Arguments:**
     - `report_type` (required) - Type of report: metrics, feedback, or status
   - **Usage:** Creates structured report prompt for specified data type

### 3. MCP Tools Capability
Provides executable tools that perform calculations and formatting.

**Operations:**
- **`tools/list`** - Lists available tools with descriptions and schemas
- **`tools/call`** - Executes a tool with provided arguments

**Available Tools:**

1. **calculate-growth-rate** - Calculate growth rate between two metrics
   - **Parameters:**
     - `current_value` (number, required) - Current metric value
     - `previous_value` (number, required) - Previous metric value
   - **Returns:** Growth rate percentage, absolute change

2. **format-metric** - Format a metric value with appropriate unit
   - **Parameters:**
     - `value` (number, required) - Metric value to format
     - `unit` (enum, required) - Unit type: `users`, `dollars`, or `percentage`
   - **Returns:** Formatted string with proper units and formatting

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

## Testing All Capabilities

Try these interactions to test each capability:

### Testing Resources
1. **List Resources**: "What resources are available?"
2. **Read Specific Resource**: "Show me the product metrics data"
3. **Analyze Content**: "What does the user feedback summary say?"
4. **System Information**: "Check the current system status"

### Testing Prompts
1. **List Prompts**: "What prompts are available?"
2. **Use Prompt with Args**: "Use the analyze-metrics prompt for revenue in Q4 2024"
3. **Generate Report**: "Use generate-report to create a metrics summary"

### Testing Tools
1. **List Tools**: "What tools are available?"
2. **Calculate Growth**: "Use calculate-growth-rate with current value 1500 and previous value 1200"
3. **Format Metrics**: "Format the value 125000 as users"

## Expected Behavior

✅ **With All Capabilities Working:**
- Dexto connects to the MCP server successfully
- **Resources:** ResourceManager.listAllResources() returns 3 resources with URIs like `mcp:resources-demo:mcp-demo://product-metrics`
- **Prompts:** MCPManager.getAllPromptMetadata() returns 2 prompts (analyze-metrics, generate-report)
- **Tools:** MCPManager.getAllTools() returns 2 tools (calculate-growth-rate, format-metric)
- All capabilities are cached and accessible without network calls after initial connection

❌ **If MCP Integration Not Working:**
- Server connection fails during startup
- Capabilities are not discovered or cached
- Resource/prompt/tool operations return errors

## Technical Details

This server demonstrates the complete MCP protocol implementation:

1. **Server Side Implementation**:
   - **Resources**: Implements `resources/list` and `resources/read` handlers
   - **Prompts**: Implements `prompts/list` and `prompts/get` handlers with argument substitution
   - **Tools**: Implements `tools/list` and `tools/call` handlers with schema validation
   - Returns structured data with proper MIME types and schemas
   - Uses standard MCP SDK patterns from `@modelcontextprotocol/sdk`

2. **Client Side** (Dexto):
   - **MCPManager**: Discovers and caches all capabilities from the server
   - **ResourceManager**: Aggregates MCP resources with qualified URIs
   - **PromptManager**: Manages prompt templates and argument substitution
   - **ToolManager**: Executes MCP tools with proper error handling
   - All capabilities are cached for performance (no network calls after initial discovery)

3. **Integration Testing**:
   - Comprehensive integration tests in `packages/core/src/mcp/manager.integration.test.ts`
   - Tests verify resources, prompts, and tools all work together
   - Validates caching behavior and multi-server coordination

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│                  Dexto Client                       │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ResourceManager│  │PromptManager│  │MCPManager│ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │
│         │                 │                │       │
│         └─────────────────┴────────────────┘       │
│                     MCPClient                      │
└─────────────────────┬───────────────────────────────┘
                      │ MCP Protocol (stdio)
                      │ - resources/*
                      │ - prompts/*
                      │ - tools/*
                      ▼
┌─────────────────────────────────────────────────────┐
│       Resources Demo Server (Node.js)               │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │   Resources  │  │   Prompts    │  │  Tools   │ │
│  │  (3 items)   │  │  (2 items)   │  │(2 items) │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
└─────────────────────────────────────────────────────┘
```

## Use Cases

This server validates that Dexto can:
- ✅ Connect to external MCP servers via stdio transport
- ✅ Discover and cache multiple capability types
- ✅ Handle resources with custom URI schemes
- ✅ Execute prompts with argument substitution
- ✅ Call tools with schema validation
- ✅ Coordinate multiple MCP servers simultaneously
- ✅ Provide zero-latency access after caching