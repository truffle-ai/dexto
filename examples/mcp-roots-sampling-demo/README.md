# MCP Roots & Sampling Demo

A **production-ready** example demonstrating Dexto's new MCP roots and sampling capabilities with a Code Review Assistant server.

## What This Demonstrates

### 🗂️ **MCP Roots** - Secure Filesystem Access
- Client declares `roots` capability during MCP initialization
- Server requests filesystem roots via `roots/list` MCP method
- Secure access within defined boundaries (only configured paths)
- Automatic root configuration from Dexto's internal resources

### 🤖 **MCP Sampling** - AI Analysis with User Approval
- Server sends `sampling/createMessage` requests to client
- User approval workflow (human-in-the-loop) for LLM requests
- Real integration with Dexto's LLM services (Anthropic, OpenAI, etc.)
- Configurable model preferences and prompts

## Features

The Code Review Assistant provides these **real** tools:

1. **`setup_project_access`** - Request and configure filesystem roots (run first!)
2. **`list_project_files`** - Browse files in the configured project roots
3. **`review_code_file`** - Get AI-powered code analysis via MCP sampling
4. **`suggest_improvements`** - Get specific improvement suggestions via AI

## Quick Start

### 1. Prerequisites
```bash
# Make sure Dexto is built
cd /path/to/dexto
pnpm run build

# Install demo dependencies
cd examples/mcp-roots-sampling-demo
npm install
```

### 2. Set Up API Keys
```bash
# Copy and configure environment variables
cp ../../.env.example ../../.env

# Add your API key (required for sampling to work):
# ANTHROPIC_API_KEY=your_key_here
# or OPENAI_API_KEY=your_key_here
```

### 3. Test via CLI
```bash
# From the Dexto root directory
dexto chat -a examples/mcp-roots-sampling-demo/demo-agent.yml
```

### 4. Test via WebUI
```bash
# Start Dexto server with the demo agent
dexto --mode web -a examples/mcp-roots-sampling-demo/demo-agent.yml --web-port 3001

# Open http://localhost:3001 in your browser
```

## Step-by-Step Testing

Follow these exact steps to test the functionality:

### Step 1: Set Up Roots Access
```
Please run setup_project_access
```
**Expected**: You should see the configured filesystem roots (., ./packages, ./examples)

### Step 2: Browse Files
```
Can you list the JavaScript files in this project?
```
**Expected**: List of .js files from the project roots

### Step 3: Test AI Analysis (with User Approval)
```
Please review the file "examples/mcp-roots-sampling-demo/server.js"
```
**Expected**: 
- User approval prompt for AI sampling request
- If approved: Real AI analysis of the code
- If declined: Fallback with explanation

### Step 4: Test Targeted Analysis
```
Can you suggest security improvements for "examples/mcp-roots-sampling-demo/server.js"?
```
**Expected**: Focused AI analysis with security-specific suggestions

## How It Works

### Roots Integration
1. **Agent Config**: `internalResources.filesystem.paths` defines accessible directories
2. **Auto-Configuration**: DextoAgent automatically configures MCP roots from filesystem resources
3. **MCP Request**: Server calls `roots/list` to get available filesystem roots
4. **Secure Access**: Server can only access files within the returned root paths

### Sampling Integration  
1. **MCP Request**: Server sends `sampling/createMessage` with messages and preferences
2. **User Approval**: Dexto prompts user for approval (human-in-the-loop security)
3. **LLM Integration**: If approved, request goes to configured LLM service (Anthropic, OpenAI, etc.)
4. **Response**: AI analysis is returned to server and included in tool result

## Architecture Flow

```
User → DextoAgent → MCP Server (Code Review Assistant)
  ↓                    ↓
  ↓                    📁 Requests roots/list
  ↓                    ← Gets: [file://./,file://./packages,file://./examples]
  ↓                    ↓
  ↓                    📄 Accesses files within roots
  ↓                    ↓
  ↓                    🤖 Sends sampling/createMessage
  ↓                    ↑
  ↓                    ← User approval prompt
  ↓                    ↓
  📊 LLM Analysis  ←  ✅ If approved
```

## Configuration Details

### Agent Configuration (`demo-agent.yml`)
- **`internalResources.filesystem.paths`**: Defines MCP roots automatically
- **`mcp.servers.code-review-assistant`**: Configures the MCP server connection
- **`llm.provider`**: Determines which LLM service handles sampling requests

### Server Implementation (`server.js`)
- **Real MCP Protocol**: Uses `@modelcontextprotocol/sdk` for genuine MCP communication
- **Actual Sampling**: Sends real `sampling/createMessage` requests to client
- **No Mocking**: Everything works with the actual MCP implementation

## Troubleshooting

### "Failed to set up project access"
- **Cause**: MCP roots capability not working
- **Solution**: Ensure Dexto is built with the latest MCP roots implementation

### "Sampling request failed"
- **Cause**: User declined, missing API keys, or sampling not configured
- **Solutions**: 
  - Check API keys in `.env`
  - Approve sampling requests when prompted
  - Verify LLM provider configuration

### "File not found in any project roots"
- **Cause**: Trying to access files outside configured roots
- **Solution**: Only access files within the configured paths (., ./packages, ./examples)

## What's New in This Implementation

This demonstrates the **first real implementation** of:

✅ **MCP Roots**: Production-ready filesystem access control  
✅ **MCP Sampling**: Live AI integration with user approval workflow  
✅ **Auto-Configuration**: Seamless setup from existing Dexto resources  
✅ **Security**: Human-in-the-loop approval for all AI requests  
✅ **Real Protocol**: Genuine MCP communication, no simulation  

Perfect for testing, development, and as a foundation for building your own MCP servers! 🚀