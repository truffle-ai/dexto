# LangChain Agent Example

This directory contains a self-contained LangChain agent that demonstrates how someone would typically build an agent using LangChain, and how to wrap it in an MCP server for integration with Saiki.

## Architecture

```
┌─────────────────┐
│   MCP Server    │  ← Wraps the agent with a single tool
│  (mcp-server.js)│
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ LangChain Agent │  ← Complete agent with internal orchestration
│   (agent.js)    │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ Internal Tools  │  ← Agent's own tools (calculate, analyze, etc.)
│   & Reasoning   │
└─────────────────┘
```

## Components

### 1. LangChain Agent (`agent.js`)

This represents how someone would typically build an agent using LangChain:

- **Self-contained**: Has its own LLM, tools, and reasoning capabilities
- **Internal orchestration**: Uses LangChain's RunnableSequence for tool selection and execution
- **Structured reasoning**: Uses StructuredOutputParser for decision-making
- **Multiple tools**: Internal tools for calculations, analysis, search, and content creation
- **Single entry point**: `agent.run(input)` method for all interactions

**Key Features:**
- Mathematical calculations
- Text analysis (sentiment, topics, summary)
- Information search (simulated)
- Creative content generation
- Intelligent tool selection and reasoning

### 2. MCP Server (`mcp-server.js`)

Wraps the LangChain agent in an MCP server:

- **Single tool**: `chat_with_langchain_agent` - exposes the entire agent
- **Clean interface**: Simple message input, complex response output
- **Delegation**: Forwards requests to the agent's main entry point
- **Error handling**: Robust error handling and logging

## Usage

### Running the Agent Directly

```bash
# Test the LangChain agent directly
npm run agent

# Then interact with it:
# > Calculate 2^10 + 15 * 3
# > Analyze the sentiment of "I love this product!"
# > Search for information about AI agents
# > Create a short story about a robot
```

### Running the MCP Server

```bash
# Start the MCP server
npm start
```

### Integration with Saiki

```yaml
# In your Saiki agent configuration
mcpServers:
  langchain:
    type: stdio
    command: node
    args: ["./agents/external-framework-example/langchain-agent/mcp-server.js"]
    env:
      OPENAI_API_KEY: $OPENAI_API_KEY
    timeout: 30000
    connectionMode: strict
```

## How It Works

### 1. Agent Construction

The LangChain agent is built using typical LangChain patterns:

```javascript
class LangChainAgent {
    constructor() {
        // Initialize LLM
        this.llm = new ChatOpenAI({...});
        
        // Define tools
        this.tools = {
            calculate: this.calculate.bind(this),
            analyze: this.analyze.bind(this),
            // ...
        };
        
        // Create agent chain with reasoning
        this.agentChain = this.createAgentChain();
    }
}
```

### 2. Reasoning and Tool Selection

The agent uses structured reasoning to decide what to do:

```javascript
createAgentChain() {
    const outputParser = StructuredOutputParser.fromZodSchema(
        z.object({
            reasoning: z.string(),
            tool_to_use: z.string().optional(),
            tool_input: z.any().optional(),
            response: z.string(),
        })
    );
    
    // Chain that reasons about input and selects tools
    return RunnableSequence.from([...]);
}
```

### 3. MCP Wrapping

The MCP server provides a clean interface:

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

## Example Interactions

### Through Saiki

```bash
# Saiki will use the LangChain agent for complex tasks
saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to help me solve this math problem: 2^10 + 15 * 3"

saiki --agent ./saiki-agent-with-langchain.yml "Ask the LangChain agent to analyze this text: 'I love this product, it's amazing!'"

saiki --agent ./saiki-agent-with-langchain.yml "Have the LangChain agent create a short story about AI"
```

### Expected Behavior

1. **Saiki receives the request**
2. **Saiki calls the MCP tool** `chat_with_langchain_agent`
3. **MCP server forwards to LangChain agent**
4. **LangChain agent reasons about the request** and decides which internal tools to use
5. **LangChain agent executes internal tools** and provides a comprehensive response
6. **Response flows back through MCP to Saiki**
7. **Saiki presents the final result**

## Benefits of This Approach

### 1. **Modular Design**
- LangChain agent is completely self-contained
- Can be developed and tested independently
- Easy to version and maintain

### 2. **Clean Integration**
- Single tool interface through MCP
- No need to expose individual functions
- Agent handles its own complexity

### 3. **Realistic Example**
- Shows how someone would actually build a LangChain agent
- Demonstrates typical LangChain patterns
- Illustrates proper separation of concerns

### 4. **Extensible**
- Easy to add new internal tools to the agent
- Can be wrapped in different interfaces
- Can be used with other MCP clients

## Development

### Adding New Tools

To add a new tool to the LangChain agent:

1. Add the tool method to the `LangChainAgent` class
2. Add it to the `tools` object in the constructor
3. Update the agent prompt to mention the new tool
4. The agent will automatically learn to use it

### Testing

```bash
# Test the agent directly
npm run agent

# Test the MCP server
npm start

# Test with Saiki
saiki --agent ./saiki-agent-with-langchain.yml "test message"
```

## Dependencies

- `@langchain/openai`: LangChain's OpenAI integration
- `langchain`: Core LangChain framework
- `@modelcontextprotocol/sdk`: MCP server implementation
- `zod`: Schema validation

This example demonstrates the proper way to build a self-contained LangChain agent and wrap it in an MCP server for integration with other frameworks like Saiki. 