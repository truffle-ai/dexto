# External Framework Integration Example

This example demonstrates how to connect a self-contained LangChain agent to Saiki via the Model Context Protocol (MCP), enabling multi-framework agent orchestration.

## Overview

The example shows:
1. **Self-contained LangChain Agent**: A complete agent built using typical LangChain patterns
2. **MCP Server Wrapper**: How to wrap the agent with a single tool entry point
3. **Saiki Integration**: How to connect the external framework to Saiki
4. **Multi-framework Orchestration**: Coordinating tasks across different AI frameworks

## Architecture

```
┌─────────────────┐    MCP Protocol    ┌─────────────────┐
│   Saiki Agent   │ ◄────────────────► │ LangChain Agent │
│   (Orchestrator)│                    │   (MCP Server)  │
└─────────────────┘                    └─────────────────┘
         │                                       │
         │                                       │
         ▼                                       ▼
┌─────────────────┐                    ┌─────────────────┐
│   Saiki Tools   │                    │  LangChain LLM  │
│  (Filesystem,   │                    │   (OpenAI API)  │
│   Puppeteer)    │                    └─────────────────┘
└─────────────────┘
```

## Directory Structure

```
agents/external-framework-example/
├── langchain-agent/           # Self-contained LangChain agent
│   ├── agent.js              # Complete LangChain agent with internal tools
│   ├── mcp-server.js         # MCP server that wraps the agent
│   ├── package.json          # Dependencies for the agent
│   └── README.md             # Agent-specific documentation
├── saiki-agent-with-langchain.yml  # Saiki agent configuration
├── setup.sh                  # Automated setup script
├── test-integration.sh       # Integration testing script
├── example-usage.md          # Practical usage examples
├── architecture-diagram.md   # Detailed architecture explanation
├── QUICK_START.md           # Quick start guide
├── SUMMARY.md               # High-level overview
└── README.md                # This file
```

## Key Components

### 1. LangChain Agent (`langchain-agent/agent.js`)

A complete, self-contained LangChain agent that demonstrates typical LangChain development patterns:

- **Self-contained**: Has its own LLM, tools, and reasoning capabilities
- **Internal orchestration**: Uses LangChain's RunnableSequence for tool selection and execution
- **Structured reasoning**: Uses StructuredOutputParser for decision-making
- **Multiple internal tools**: Calculations, analysis, search, and content creation
- **Single entry point**: `agent.run(input)` method for all interactions

### 2. MCP Server (`langchain-agent/mcp-server.js`)

Wraps the LangChain agent in an MCP server with a single tool:

- **Single tool**: `chat_with_langchain_agent` - exposes the entire agent
- **Clean interface**: Simple message input, complex response output
- **Delegation**: Forwards requests to the agent's main entry point
- **Error handling**: Robust error handling and logging

### 3. Saiki Configuration (`saiki-agent-with-langchain.yml`)

Configures Saiki to connect to the LangChain agent:

- **MCP server connection**: Configures stdio connection to the LangChain server
- **System prompt**: Explains the agent's multi-framework capabilities
- **Tool coordination**: Instructions for orchestrating between frameworks

## Setup Instructions

### 1. Automated Setup

```bash
# From the Saiki project root
./agents/external-framework-example/setup.sh
```

### 2. Manual Setup

```bash
# Navigate to the example directory
cd agents/external-framework-example

# Install LangChain agent dependencies
cd langchain-agent
npm install
chmod +x mcp-server.js agent.js

# Set environment variable
export OPENAI_API_KEY="your_openai_api_key_here"
```

### 3. Test the Integration

```bash
# Test the LangChain agent directly
cd langchain-agent
npm run agent

# Test the MCP server
npm start

# Test with Saiki
saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to calculate: 2^10 + 15 * 3"
```

## Available Tools

### LangChain Agent Tool (via MCP)

**`chat_with_langchain_agent`**
- Interact with a complete LangChain agent that has its own internal tools and reasoning capabilities
- The agent can handle:
  - Mathematical calculations and problem solving
  - Text analysis (sentiment, topics, summary)
  - Information search and research
  - Creative content generation (stories, poems, articles)
  - Intelligent tool selection and reasoning

### Saiki Tools

- File system operations
- Web browsing via Puppeteer
- General AI assistance

## Usage Examples

### Basic LangChain Agent Interaction

```bash
# Mathematical problem solving
saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to solve this math problem: 2^10 + 15 * 3"

# Text analysis
saiki --agent ./saiki-agent-with-langchain.yml "Ask the LangChain agent to analyze this text: 'I love this product!'"

# Creative content
saiki --agent ./saiki-agent-with-langchain.yml "Have the LangChain agent create a short story about AI"
```

### Multi-framework Orchestration

```bash
# Complex workflow combining Saiki and LangChain
saiki --agent ./saiki-agent-with-langchain.yml "Read the README.md file, then use the LangChain agent to analyze its content"

# Web scraping + LangChain analysis
saiki --agent ./saiki-agent-with-langchain.yml "Search the web for information about AI agents, then have the LangChain agent summarize the findings"

# Creative content + file management
saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to generate a creative story, then save it as an HTML file"
```

## Implementation Details

### LangChain Agent Pattern

The LangChain agent demonstrates typical LangChain development patterns:

```javascript
class LangChainAgent {
    constructor() {
        // Initialize LLM
        this.llm = new ChatOpenAI({...});
        
        // Define internal tools
        this.tools = {
            calculate: this.calculate.bind(this),
            analyze: this.analyze.bind(this),
            // ...
        };
        
        // Create agent chain with reasoning
        this.agentChain = this.createAgentChain();
    }
    
    async run(input) {
        // Main entry point - delegates to internal reasoning
        return await this.agentChain.invoke({ user_input: input });
    }
}
```

### MCP Server Pattern

The MCP server provides a clean wrapper:

```javascript
this.server.tool(
    'chat_with_langchain_agent',
    'Chat with a complete LangChain agent...',
    { message: z.string() },
    async ({ message }) => {
        // Delegate to agent's main entry point
        const response = await this.agent.run(message);
        return { content: [{ type: 'text', text: response }] };
    }
);
```

### Saiki Configuration

```yaml
mcpServers:
  langchain:
    type: stdio
    command: node
    args: ["./agents/external-framework-example/langchain-agent/mcp-server.js"]
    env:
      OPENAI_API_KEY: $OPENAI_API_KEY
    connectionMode: strict
```

## Benefits of This Approach

### 1. **Realistic Example**
- Shows how someone would actually build a LangChain agent
- Demonstrates typical LangChain patterns and best practices
- Illustrates proper separation of concerns

### 2. **Modular Design**
- LangChain agent is completely self-contained
- Can be developed and tested independently
- Easy to version and maintain

### 3. **Clean Integration**
- Single tool interface through MCP
- No need to expose individual functions
- Agent handles its own complexity

### 4. **Framework Interoperability**
- Standard MCP protocol for framework communication
- Language-agnostic implementation
- Future-proof architecture

## Extending the Example

### Adding New Frameworks

To add another framework (e.g., AutoGen):

1. Create a self-contained agent for the framework
2. Wrap it in an MCP server with a single tool
3. Add it to the Saiki configuration
4. Update the system prompt with new capabilities

### Adding New Tools to LangChain Agent

1. Add the tool method to the `LangChainAgent` class
2. Add it to the `tools` object in the constructor
3. Update the agent prompt to mention the new tool
4. The agent will automatically learn to use it

## Troubleshooting

### Common Issues

1. **Connection Errors**: Ensure the LangChain agent is running and accessible
2. **API Key Issues**: Verify OPENAI_API_KEY is set correctly
3. **Dependency Issues**: Run `npm install` in the langchain-agent directory
4. **Permission Issues**: Make sure the server files are executable

### Debug Mode

Run Saiki with verbose logging:

```bash
saiki --agent ./saiki-agent-with-langchain.yml --verbose
```

## Next Steps

1. **Try the example**: Follow the setup instructions and test the integration
2. **Extend it**: Add your own tools to the LangChain agent or connect other frameworks
3. **Build on it**: Use this pattern for your own multi-framework applications
4. **Contribute**: Share your extensions and improvements with the community

## Related Documentation

- [LangChain Agent Documentation](langchain-agent/README.md) - Detailed agent implementation
- [Example Usage Guide](example-usage.md) - Practical usage examples
- [Architecture Overview](architecture-diagram.md) - Detailed architecture explanation
- [Quick Start Guide](QUICK_START.md) - Quick setup instructions
- [Summary](SUMMARY.md) - High-level overview and significance

The external framework integration example showcases the future of AI development - where different frameworks work together to create more powerful, flexible, and capable AI systems. 