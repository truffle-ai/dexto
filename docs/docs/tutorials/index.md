---
sidebar_position: 1
---

# Building Applications

Now let's build something useful. We'll create three types of applications, each building on what you've learned.

## Application 1: Smart File Organizer

Let's build an agent that can organize messy directories:

```typescript
// file-organizer.ts
import 'dotenv/config';
import { loadConfigFile, DextoAgent } from '@dexto/core';

const config = await loadConfigFile('./agents/default-agent.yml');
const agent = new DextoAgent(config);

// Start the agent
await agent.start();

console.log("🗂️ Smart File Organizer");
console.log("I can help organize your files by type, date, or project.\n");

const task = "Look at the current directory and suggest how to organize these files. Create folders if needed.";
const response = await agent.run(task);
console.log(response);

// Clean shutdown
await agent.stop();
```

**What you're learning:** Single-purpose agents with clear objectives work best.

### Making it Interactive

Let's add some user input:

```typescript
// interactive-organizer.ts
import 'dotenv/config';
import { loadConfigFile, DextoAgent } from '@dexto/core';
import readline from 'readline';

const config = await loadConfigFile('./agents/default-agent.yml');
const agent = new DextoAgent(config);
await agent.start();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("🗂️ Smart File Organizer");
console.log("Commands: 'analyze', 'organize by type', 'organize by date', 'exit'\n");

function askQuestion() {
  rl.question("What would you like to do? ", async (input) => {
    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }
    
    let task;
    switch (input.toLowerCase()) {
      case 'analyze':
        task = "Analyze the current directory and tell me what files are here.";
        break;
      case 'organize by type':
        task = "Organize files by type (documents, images, code, etc.). Create folders and move files.";
        break;
      case 'organize by date':
        task = "Organize files by creation date. Create year/month folders and move files.";
        break;
      default:
        task = input;
    }
    
    try {
      const response = await agent.run(task);
      console.log(`\n🤖 ${response}\n`);
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
    
    askQuestion();
  });
}

askQuestion();

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await agent.stop();
  rl.close();
  process.exit(0);
});
```

## Application 2: Interactive Code Helper

Now let's build something interactive for developers:

```typescript
// code-helper.ts
import 'dotenv/config';
import { loadConfigFile, DextoAgent } from '@dexto/core';
import readline from 'readline';

const agent = new DextoAgent(
  await loadConfigFile('./agents/default-agent.yml')
);
await agent.start();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("💻 Your Code Helper is ready!");
console.log("Ask me about code, files, or type 'exit' to quit.\n");

function askQuestion() {
  rl.question("You: ", async (input) => {
    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }
    
    try {
      const response = await agent.run(input);
      console.log(`\n🤖 ${response}\n`);
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
    
    askQuestion();
  });
}

askQuestion();

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await agent.stop();
  rl.close();
  process.exit(0);
});
```

**What you're learning:** Adding interaction is just a few lines of code. The agent handles the complexity.

### Specialized Code Helper Configuration

Create a specialized configuration for code assistance:

```yaml
# agents/code-helper.yml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  
systemPrompt: |
  You are a senior software engineer and code reviewer.
  
  Your expertise includes:
  - Code review and best practices
  - Debugging and troubleshooting
  - Architecture and design patterns
  - Security considerations
  - Performance optimization
  
  When helping with code:
  1. Read and understand the codebase structure first
  2. Provide specific, actionable feedback
  3. Explain your reasoning
  4. Suggest improvements with examples
  5. Consider security and performance implications
  
  Use the filesystem tools to examine code files when needed.

llm:
  provider: anthropic
  model: claude-4-sonnet-20250514
  apiKey: $ANTHROPIC_API_KEY
```

## Application 3: Web API Service

Ready for something more advanced? Let's create a web service:

```typescript
// web-service.ts
import express from 'express';
import { loadConfigFile, DextoAgent } from '@dexto/core';

const app = express();
app.use(express.json());

// Initialize our agent once
const agent = new DextoAgent(
  await loadConfigFile('./agents/default-agent.yml')
);
await agent.start();

// Simple chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const response = await agent.run(message);
    
    res.json({ 
      success: true, 
      response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', agent: 'ready' });
});

// File analysis endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { path = '.' } = req.body;
    const response = await agent.run(`Analyze the files in ${path} and provide a summary.`);
    
    res.json({
      success: true,
      analysis: response,
      path,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const server = app.listen(3000, () => {
  console.log('🚀 Dexto web service running on http://localhost:3000');
  console.log('Endpoints:');
  console.log('  POST /chat - Chat with the agent');
  console.log('  POST /analyze - Analyze files');
  console.log('  GET /health - Health check');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  server.close(async () => {
    await agent.stop();
    process.exit(0);
  });
});
```

**What you're learning:** The same agent works everywhere—CLI, web, mobile—anywhere TypeScript runs.

### Testing Your Web Service

Test it with curl:

```bash
# Health check
curl http://localhost:3000/health

# Chat with the agent
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What files are in the current directory?"}'

# Analyze files
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"path": "."}'
```

## Key Patterns You've Learned

### 1. Single Purpose Agents
Each application has a clear, focused purpose:
- **File Organizer**: Manages file organization
- **Code Helper**: Assists with development tasks
- **Web Service**: Provides API access to agent capabilities

### 2. Configuration Over Code
Notice how we didn't write complex AI integration code. Instead:
- **Configure capabilities** in YAML
- **Use simple API calls** to interact
- **Let Dexto handle** the complexity

### 3. Consistent API
The same `agent.run()` call works in:
- **Command line tools**
- **Interactive applications**
- **Web services**
- **Any TypeScript/JavaScript environment**

### 4. Error Handling
Always wrap agent calls in try-catch blocks:
```typescript
try {
  const response = await agent.run(message);
  // Handle success
} catch (error) {
  // Handle errors gracefully
}
```

## Customizing for Your Use Case

### Environment-Specific Configurations

**Development**
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini  # Faster, cheaper for dev
  apiKey: $OPENAI_API_KEY
```

**Production**
```yaml
llm:
  provider: openai
  model: gpt-4.1  # More capable for production
  apiKey: $OPENAI_API_KEY
  temperature: 0.3  # More consistent responses
```

### Adding More Capabilities

Add new tools by including more MCP servers:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"
    
  # Add more servers for additional capabilities
```

## What You've Built

You now have three working applications that demonstrate:
- ✅ **File management** with AI assistance
- ✅ **Interactive development** tools
- ✅ **Web API** integration
- ✅ **Error handling** and user experience
- ✅ **Flexible configuration** for different environments

## Contributing Your Own Examples

Built something cool? We'd love to see it! Consider contributing your agent to help others learn:

### Share Your Agent

1. **Create an example agent** following our [Community Contribution Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#2-creating-example-agents)
2. **Add it to the `agents/` directory** with proper documentation
3. **Submit a pull request** to share it with the community

### Benefits of Contributing

- **Help others learn** from your solutions
- **Get feedback** on your approach
- **Build your reputation** in the AI agent community
- **Potential for pre-installed status** in our official registry (see [pre-installed criteria](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#3-requesting-pre-installed-agent-status))

```mermaid
flowchart TD
  A[Build your agent] --> B[Add to agents/ with README + usage]
  B --> C[Open PR with docs snippet]
  C --> D[Review & feedback]
  D --> E[Merge]
  E --> F[Listed in tutorials + eligible for pre-installed review]
```

## Next Steps

Ready to take it to the next level?

- **Learn advanced patterns**: Check out [Advanced Patterns](./advanced-patterns) for production-ready techniques
- **Add more tools**: Explore [MCP servers](../mcp/connecting-servers) for additional capabilities
- **Deploy your service**: See the [deployment guide](../guides/deployment) for production hosting
- **Contribute to the community**: Learn how to [contribute MCPs and agents](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#contributing-mcps-and-example-agents)
- **Join the community**: Share your creations in our [Discord](https://discord.gg/GFzWFAAZcm)

You're well on your way to building amazing AI applications! 🎉 
