---
sidebar_position: 7
title: "Error Handling"
---

# Error Handling

Robust error handling is essential for production applications. Learn how to handle failures gracefully, implement retry logic, and build resilient agents.

## What You'll Learn

- Handling agent initialization errors
- Retry logic for failed requests
- Graceful degradation patterns
- Monitoring and recovery strategies

## Common Error Types

### Initialization Errors

Handle errors during agent creation and startup:

```typescript
import { DextoAgent } from '@dexto/core';

try {
  const agent = new DextoAgent({
    llm: {
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: process.env.OPENAI_API_KEY
    }
  });

  await agent.start();
  console.log('Agent started successfully');
} catch (error) {
  console.error('Failed to initialize agent:', error.message);

  if (error.message.includes('API key')) {
    console.error('Check your OPENAI_API_KEY environment variable');
  }

  process.exit(1);
}
```

### LLM Request Errors

Handle errors during generate() calls:

```typescript
const agent = new DextoAgent(config);
await agent.start();
const session = await agent.createSession();

try {
  const response = await agent.generate('Hello', { sessionId: session.id });
  console.log(response.content);
} catch (error) {
  console.error('Generation failed:', error.message);

  // Check error type
  if (error.message.includes('rate limit')) {
    console.log('Rate limited - waiting before retry');
    await new Promise(resolve => setTimeout(resolve, 60000));
  } else if (error.message.includes('timeout')) {
    console.log('Request timed out');
  } else {
    console.log('Unknown error occurred');
  }
}
```

### MCP Connection Errors

Monitor and handle MCP server failures:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    },
    web_search: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp'],
      env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
    }
  }
});

agent.agentEventBus.on('mcp:server-connected', ({ name, success, error }) => {
  if (!success) {
    console.warn(`MCP server '${name}' failed to connect: ${error}`);
    console.log('Agent will continue without this capability');
  }
});

await agent.start();
// Agent works even if some MCP servers failed to connect
```

## Retry Logic

### Basic Retry Pattern

Implement exponential backoff:

```typescript
async function generateWithRetry(
  agent: DextoAgent,
  message: string,
  sessionId: string,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await agent.generate(message, { sessionId });
      return response.content;
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

      // Don't retry on validation errors
      if (error.message.includes('validation')) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
}

// Usage
try {
  const response = await generateWithRetry(agent, 'Hello', session.id);
  console.log(response);
} catch (error) {
  console.error('All retry attempts failed:', error.message);
}
```

### Advanced Retry with Circuit Breaker

Prevent cascading failures:

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private resetTimeout: number = 60000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.error('Circuit breaker opened');
    }
  }
}

// Usage
const circuitBreaker = new CircuitBreaker();

async function safeGenerate(agent: DextoAgent, message: string, sessionId: string) {
  try {
    return await circuitBreaker.execute(async () => {
      const response = await agent.generate(message, { sessionId });
      return response.content;
    });
  } catch (error) {
    if (error.message === 'Circuit breaker is open') {
      return 'Service temporarily unavailable. Please try again later.';
    }
    throw error;
  }
}
```

## Graceful Degradation

### Fallback Providers

Switch to backup LLM provider on failure:

```typescript
class ResilientAgent {
  private agent: DextoAgent;
  private fallbackAgent: DextoAgent;

  async initialize() {
    // Primary agent
    try {
      this.agent = new DextoAgent({
        llm: {
          provider: 'openai',
          model: 'gpt-5-mini',
          apiKey: process.env.OPENAI_API_KEY
        }
      });
      await this.agent.start();
      console.log('Using primary provider: OpenAI');
    } catch (error) {
      console.warn('Primary provider failed:', error.message);

      // Fallback to Anthropic
      this.fallbackAgent = new DextoAgent({
        llm: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          apiKey: process.env.ANTHROPIC_API_KEY
        }
      });
      await this.fallbackAgent.start();
      console.log('Using fallback provider: Anthropic');

      this.agent = this.fallbackAgent;
    }
  }

  async generate(message: string, sessionId: string): Promise<string> {
    try {
      const response = await this.agent.generate(message, { sessionId });
      return response.content;
    } catch (error) {
      if (this.fallbackAgent && this.agent !== this.fallbackAgent) {
        console.log('Switching to fallback provider');
        this.agent = this.fallbackAgent;
        const response = await this.fallbackAgent.generate(message, { sessionId });
        return response.content;
      }
      throw error;
    }
  }
}
```

### Reduced Functionality Mode

Continue operating with limited capabilities:

```typescript
class DegradableAgent {
  private agent: DextoAgent;
  private hasTools = false;

  async initialize() {
    const mcpServers = {
      filesystem: {
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
      },
      web_search: {
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', 'tavily-mcp'],
        env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
      }
    };

    try {
      // Try with full features
      this.agent = new DextoAgent({
        llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
        mcpServers
      });
      await this.agent.start();
      this.hasTools = true;
      console.log('Agent initialized with all tools');
    } catch (error) {
      console.warn('Failed to initialize with tools:', error.message);

      // Fallback to basic agent without tools
      this.agent = new DextoAgent({
        llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
      });
      await this.agent.start();
      console.log('Agent initialized without tools');
    }
  }

  async generate(message: string, sessionId: string): Promise<string> {
    if (!this.hasTools && this.requiresTools(message)) {
      return 'Sorry, advanced features are currently unavailable. I can still answer general questions.';
    }

    const response = await this.agent.generate(message, { sessionId });
    return response.content;
  }

  private requiresTools(message: string): boolean {
    const toolKeywords = ['file', 'search', 'web', 'database'];
    return toolKeywords.some(keyword => message.toLowerCase().includes(keyword));
  }
}
```

## Error Monitoring

### Centralized Error Tracking

Log all errors for analysis:

```typescript
class ErrorTracker {
  private errors: Array<{
    timestamp: Date;
    type: string;
    message: string;
    sessionId?: string;
    recoverable: boolean;
  }> = [];

  setupTracking(agent: DextoAgent) {
    agent.agentEventBus.on('llm:error', ({ error, recoverable, sessionId }) => {
      this.logError('llm', error, sessionId, recoverable);
    });

    agent.agentEventBus.on('mcp:server-connected', ({ name, success, error }) => {
      if (!success && error) {
        this.logError('mcp', `${name}: ${error}`, undefined, false);
      }
    });
  }

  private logError(type: string, message: string, sessionId?: string, recoverable: boolean = false) {
    const errorEntry = {
      timestamp: new Date(),
      type,
      message,
      sessionId,
      recoverable
    };

    this.errors.push(errorEntry);
    console.error('Error logged:', errorEntry);

    // Send to external monitoring service
    if (!recoverable) {
      this.sendAlert(errorEntry);
    }
  }

  private sendAlert(error: any) {
    // Implement alerting logic
    console.error('CRITICAL ERROR:', error);
  }

  getErrorReport() {
    const total = this.errors.length;
    const critical = this.errors.filter(e => !e.recoverable).length;
    const byType = this.errors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return { total, critical, byType };
  }
}

// Usage
const errorTracker = new ErrorTracker();
errorTracker.setupTracking(agent);
```

### Health Checks

Monitor agent health:

```typescript
class HealthMonitor {
  private agent: DextoAgent;
  private lastSuccessfulRequest = Date.now();
  private consecutiveFailures = 0;

  constructor(agent: DextoAgent) {
    this.agent = agent;
    this.setupMonitoring();
  }

  private setupMonitoring() {
    this.agent.agentEventBus.on('llm:response', () => {
      this.lastSuccessfulRequest = Date.now();
      this.consecutiveFailures = 0;
    });

    this.agent.agentEventBus.on('llm:error', ({ recoverable }) => {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= 5) {
        console.error('Multiple consecutive failures detected');
        this.attemptRecovery();
      }
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      const session = await this.agent.createSession('health-check');
      await this.agent.generate('test', { sessionId: session.id });
      await this.agent.deleteSession(session.id);
      return true;
    } catch (error) {
      console.error('Health check failed:', error.message);
      return false;
    }
  }

  private async attemptRecovery() {
    console.log('Attempting to recover agent...');
    try {
      await this.agent.stop();
      await this.agent.start();
      this.consecutiveFailures = 0;
      console.log('Recovery successful');
    } catch (error) {
      console.error('Recovery failed:', error.message);
    }
  }
}
```

## Best Practices

### 1. Validate Early

Check configuration before starting:

```typescript
function validateConfig(config: any): void {
  if (!config.llm?.apiKey) {
    throw new Error('API key is required');
  }

  if (!config.llm?.provider) {
    throw new Error('Provider is required');
  }

  if (!config.llm?.model) {
    throw new Error('Model is required');
  }
}

try {
  validateConfig(config);
  const agent = new DextoAgent(config);
  await agent.start();
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}
```

### 2. Clean Up Resources

Always clean up on errors:

```typescript
const agent = new DextoAgent(config);

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await agent.stop();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await agent.stop();
  process.exit(1);
});
```

### 3. User-Friendly Error Messages

Translate technical errors for users:

```typescript
function getUserFriendlyError(error: Error): string {
  const message = error.message.toLowerCase();

  if (message.includes('rate limit')) {
    return 'Too many requests. Please try again in a minute.';
  }

  if (message.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }

  if (message.includes('api key')) {
    return 'Authentication failed. Please check your API key.';
  }

  return 'An error occurred. Please try again later.';
}

try {
  const response = await agent.generate(message, { sessionId });
  console.log(response.content);
} catch (error) {
  console.log(getUserFriendlyError(error));
}
```

## Next Steps

- **[API Reference](/api/sdk/dexto-agent)** - Complete method documentation
- **[Events](./events.md)** - Monitor errors with the event system
- **[Deployment Guide](/docs/guides/deployment)** - Production deployment strategies
