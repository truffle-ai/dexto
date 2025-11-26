---
sidebar_position: 6
title: "Events"
---

# Events

Dexto's event system provides real-time visibility into agent operations. Use events for monitoring, analytics, UI updates, and debugging.

## What You'll Learn

- Listening to agent events
- Event types and their data
- Building real-time UIs with events
- Implementing monitoring and analytics

## Event Basics

Access events through the `agentEventBus`:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});

// Listen to events before starting
agent.agentEventBus.on('llm:thinking', (data) => {
  console.log('Agent is thinking...');
});

await agent.start();
```

## LLM Events

### llm:thinking

Emitted when the agent starts processing a message:

```typescript
agent.agentEventBus.on('llm:thinking', ({ sessionId }) => {
  console.log(`Session ${sessionId}: Thinking...`);
  // Show loading indicator
});
```

### llm:chunk

Emitted for each content chunk during streaming:

```typescript
agent.agentEventBus.on('llm:chunk', ({ content, sessionId }) => {
  process.stdout.write(content);
  // Update UI with new content
});
```

### llm:tool-call

Emitted when the agent calls a tool:

```typescript
agent.agentEventBus.on('llm:tool-call', ({ toolName, args, sessionId }) => {
  console.log(`Session ${sessionId}: Using ${toolName}`);
  console.log('Arguments:', JSON.stringify(args, null, 2));
  // Show tool execution indicator
});
```

### llm:tool-result

Emitted when a tool execution completes:

```typescript
agent.agentEventBus.on('llm:tool-result', ({ toolName, success, sanitized, rawResult, sessionId }) => {
  if (success) {
    console.log(`Session ${sessionId}: ${toolName} succeeded`);
    console.log('Result:', sanitized);
  } else {
    console.error(`Session ${sessionId}: ${toolName} failed`);
    console.error('Error:', rawResult ?? sanitized);
  }
});
```

### llm:response

Emitted when the complete response is ready:

```typescript
agent.agentEventBus.on('llm:response', ({ content, usage, reasoning, toolCalls, sessionId }) => {
  console.log(`Session ${sessionId}: Response complete`);
  console.log(`Tokens: ${usage?.totalTokens}`);
  console.log(`Tools used: ${toolCalls?.length ?? 0}`);
  // Hide loading indicator, show completion
});
```

### llm:error

Emitted when an LLM operation fails:

```typescript
agent.agentEventBus.on('llm:error', ({ error, recoverable, sessionId }) => {
  console.error(`Session ${sessionId}: Error occurred`);
  console.error('Error:', error);

  if (recoverable) {
    console.log('Retrying...');
  } else {
    console.log('Fatal error - cannot recover');
    // Show error message to user
  }
});
```

## MCP Events

### mcp:server-connected

Emitted when an MCP server connects or fails to connect:

```typescript
agent.agentEventBus.on('mcp:server-connected', ({ name, success, error }) => {
  if (success) {
    console.log(`Connected to ${name}`);
  } else {
    console.warn(`Failed to connect to ${name}: ${error}`);
  }
});
```

### mcp:server-disconnected

Emitted when an MCP server disconnects:

```typescript
agent.agentEventBus.on('mcp:server-disconnected', ({ name }) => {
  console.log(`Disconnected from ${name}`);
  // Update UI to reflect lost capabilities
});
```

## Complete Event Monitoring

Set up comprehensive monitoring:

```typescript
class AgentMonitor {
  private agent: DextoAgent;
  private stats = {
    messages: 0,
    toolCalls: 0,
    errors: 0,
    totalTokens: 0
  };

  async initialize() {
    this.agent = new DextoAgent({
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
    });

    this.setupEventListeners();
    await this.agent.start();
  }

  private setupEventListeners() {
    // Track messages
    this.agent.agentEventBus.on('llm:thinking', () => {
      this.stats.messages++;
    });

    // Track tool usage
    this.agent.agentEventBus.on('llm:tool-call', ({ toolName }) => {
      this.stats.toolCalls++;
      console.log(`Tool called: ${toolName}`);
    });

    // Track token usage
    this.agent.agentEventBus.on('llm:response', ({ usage }) => {
      if (usage) {
        this.stats.totalTokens += usage.totalTokens;
      }
    });

    // Track errors
    this.agent.agentEventBus.on('llm:error', ({ error, recoverable }) => {
      this.stats.errors++;
      console.error('Error:', error);

      if (!recoverable) {
        // Alert on critical errors
        this.sendAlert('Critical LLM error', error);
      }
    });

    // Monitor server health
    this.agent.agentEventBus.on('mcp:server-disconnected', ({ name }) => {
      console.warn(`Server ${name} disconnected`);
      this.sendAlert('MCP server disconnected', name);
    });
  }

  getStats() {
    return { ...this.stats };
  }

  private sendAlert(title: string, details: any) {
    // Implement alerting logic
    console.error(`ALERT: ${title}`, details);
  }
}
```

## Real-Time UI Updates

Build a chat UI that reacts to events:

```typescript
class ChatUI {
  private agent: DextoAgent;
  private sessions = new Map<string, {
    messages: Array<{ role: string; content: string }>;
    isThinking: boolean;
    currentTool?: string;
  }>();

  async initialize() {
    this.agent = new DextoAgent({
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
    });

    this.setupEventHandlers();
    await this.agent.start();
  }

  private setupEventHandlers() {
    this.agent.agentEventBus.on('llm:thinking', ({ sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.isThinking = true;
        this.render(sessionId);
      }
    });

    this.agent.agentEventBus.on('llm:tool-call', ({ toolName, sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.currentTool = toolName;
        this.render(sessionId);
      }
    });

    this.agent.agentEventBus.on('llm:response', ({ content, sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.messages.push({ role: 'assistant', content });
        session.isThinking = false;
        session.currentTool = undefined;
        this.render(sessionId);
      }
    });
  }

  private render(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Update UI
    console.clear();
    for (const msg of session.messages) {
      console.log(`${msg.role}: ${msg.content}`);
    }

    if (session.isThinking) {
      console.log('Assistant: Thinking...');
    }

    if (session.currentTool) {
      console.log(`Assistant: Using ${session.currentTool}...`);
    }
  }

  async sendMessage(userId: string, message: string) {
    const sessionId = `user-${userId}`;

    // Initialize session if needed
    if (!this.sessions.has(sessionId)) {
      await this.agent.createSession(sessionId);
      this.sessions.set(sessionId, { messages: [], isThinking: false });
    }

    // Add user message
    const session = this.sessions.get(sessionId)!;
    session.messages.push({ role: 'user', content: message });
    this.render(sessionId);

    // Generate response (events will update UI)
    await this.agent.generate(message, { sessionId });
  }
}
```

## Analytics and Logging

Track usage patterns:

```typescript
class AgentAnalytics {
  private agent: DextoAgent;
  private analytics: {
    conversationLengths: number[];
    toolUsage: Record<string, number>;
    tokenUsage: { input: number; output: number; total: number };
    responseTimesByTool: Record<string, number[]>;
  } = {
    conversationLengths: [],
    toolUsage: {},
    tokenUsage: { input: 0, output: 0, total: 0 },
    responseTimesByTool: {}
  };

  async initialize() {
    this.agent = new DextoAgent({
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
    });

    this.setupTracking();
    await this.agent.start();
  }

  private setupTracking() {
    const conversationStarts = new Map<string, number>();
    const toolStartTimes = new Map<string, number>();

    // Track conversation start
    this.agent.agentEventBus.on('llm:thinking', ({ sessionId }) => {
      if (!conversationStarts.has(sessionId)) {
        conversationStarts.set(sessionId, Date.now());
      }
    });

    // Track tool usage
    this.agent.agentEventBus.on('llm:tool-call', ({ toolName, sessionId }) => {
      this.analytics.toolUsage[toolName] = (this.analytics.toolUsage[toolName] ?? 0) + 1;
      toolStartTimes.set(`${sessionId}-${toolName}`, Date.now());
    });

    this.agent.agentEventBus.on('llm:tool-result', ({ toolName, sessionId }) => {
      const key = `${sessionId}-${toolName}`;
      const startTime = toolStartTimes.get(key);
      if (startTime) {
        const duration = Date.now() - startTime;
        if (!this.analytics.responseTimesByTool[toolName]) {
          this.analytics.responseTimesByTool[toolName] = [];
        }
        this.analytics.responseTimesByTool[toolName].push(duration);
        toolStartTimes.delete(key);
      }
    });

    // Track token usage
    this.agent.agentEventBus.on('llm:response', ({ usage, sessionId }) => {
      if (usage) {
        this.analytics.tokenUsage.input += usage.inputTokens ?? 0;
        this.analytics.tokenUsage.output += usage.outputTokens ?? 0;
        this.analytics.tokenUsage.total += usage.totalTokens;
      }

      // Track conversation length
      const startTime = conversationStarts.get(sessionId);
      if (startTime) {
        const duration = Date.now() - startTime;
        this.analytics.conversationLengths.push(duration);
        conversationStarts.delete(sessionId);
      }
    });
  }

  getReport() {
    const avgConversationLength = this.analytics.conversationLengths.reduce((a, b) => a + b, 0) /
                                   this.analytics.conversationLengths.length;

    const toolResponseTimes: Record<string, number> = {};
    for (const [tool, times] of Object.entries(this.analytics.responseTimesByTool)) {
      toolResponseTimes[tool] = times.reduce((a, b) => a + b, 0) / times.length;
    }

    return {
      totalConversations: this.analytics.conversationLengths.length,
      avgConversationLength: `${(avgConversationLength / 1000).toFixed(2)}s`,
      toolUsage: this.analytics.toolUsage,
      avgToolResponseTimes: toolResponseTimes,
      tokenUsage: this.analytics.tokenUsage
    };
  }
}
```

## Debugging with Events

Use events for detailed debugging:

```typescript
function setupDebugLogging(agent: DextoAgent) {
  const debug = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  };

  agent.agentEventBus.on('llm:thinking', ({ sessionId }) => {
    debug(`Session ${sessionId}: Started thinking`);
  });

  agent.agentEventBus.on('llm:chunk', ({ content, sessionId }) => {
    debug(`Session ${sessionId}: Chunk received`, { length: content.length });
  });

  agent.agentEventBus.on('llm:tool-call', ({ toolName, args, sessionId }) => {
    debug(`Session ${sessionId}: Tool call`, { toolName, args });
  });

  agent.agentEventBus.on('llm:tool-result', ({ toolName, success, sanitized, rawResult, sessionId }) => {
    debug(`Session ${sessionId}: Tool result`, {
      toolName,
      success,
      result: success ? sanitized : rawResult
    });
  });

  agent.agentEventBus.on('llm:response', ({ content, usage, toolCalls, sessionId }) => {
    debug(`Session ${sessionId}: Response complete`, {
      contentLength: content.length,
      usage,
      toolCallCount: toolCalls?.length ?? 0
    });
  });

  agent.agentEventBus.on('llm:error', ({ error, recoverable, sessionId }) => {
    debug(`Session ${sessionId}: ERROR`, { error, recoverable });
  });
}
```

## Best Practices

### 1. Event Handler Cleanup

Remove listeners when done:

```typescript
const handler = (data) => console.log(data);
agent.agentEventBus.on('llm:response', handler);

// Later...
agent.agentEventBus.off('llm:response', handler);
```

### 2. Handle Missing Session Context

Not all events include session information:

```typescript
agent.agentEventBus.on('mcp:server-connected', ({ name, success }) => {
  // No sessionId here - this is agent-wide
  console.log(`Server ${name}: ${success ? 'connected' : 'failed'}`);
});
```

### 3. Avoid Heavy Processing in Handlers

Keep event handlers lightweight:

```typescript
// Bad - blocks event loop
agent.agentEventBus.on('llm:chunk', ({ content }) => {
  performExpensiveOperation(content); // Blocks other events
});

// Good - offload to async queue
agent.agentEventBus.on('llm:chunk', ({ content }) => {
  asyncQueue.add(() => performExpensiveOperation(content));
});
```

## Next Steps

- **[Error Handling](./error-handling.md)** - Handle failures gracefully
- **[API Reference](/api/sdk/events)** - Complete event documentation
- **[Streaming](./streaming.md)** - Combine events with streaming
