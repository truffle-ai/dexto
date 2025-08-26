---
sidebar_position: 4
---

# Advanced Patterns and Best Practices

Once you're comfortable with the basics, these patterns will help you build production-ready applications.

## Pattern 1: Specialized Agents

Instead of one do-everything agent, create specialized ones:

### Code Reviewer Agent
```yaml
# agents/code-reviewer.yml
systemPrompt: |
  You are a senior code reviewer. Focus on:
  - Code quality and best practices
  - Security vulnerabilities
  - Performance optimizations
  - Clear, actionable feedback
  
  When reviewing code:
  1. Read the entire file or section first
  2. Identify specific issues with line numbers
  3. Suggest concrete improvements
  4. Explain the reasoning behind your recommendations
  5. Prioritize security and maintainability

llm:
  provider: anthropic
  model: claude-3-5-sonnet-20240620
  apiKey: $ANTHROPIC_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```

### Documentation Writer Agent
```yaml
# agents/documentation-writer.yml
systemPrompt: |
  You are a technical writer. Create clear, comprehensive documentation.
  
  Your documentation should:
  - Always include practical examples
  - Explain complex concepts simply
  - Use proper formatting and structure
  - Include troubleshooting sections
  - Consider different skill levels
  
  When writing docs:
  1. Start with a clear overview
  2. Provide step-by-step instructions
  3. Include code examples that work
  4. Add common pitfalls and solutions
  5. End with next steps or related topics

llm:
  provider: openai
  model: gpt-4.1
  apiKey: $OPENAI_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```

### Using Specialized Agents
```typescript
// specialized-agents.ts
import { loadConfigFile, DextoAgent } from 'dexto';

class AgentOrchestrator {
  private codeReviewer: any;
  private docWriter: any;
  
  async initialize() {
    this.codeReviewer = new DextoAgent(
      await loadConfigFile('./agents/code-reviewer.yml')
    );
    await this.codeReviewer.start();
    
    this.docWriter = new DextoAgent(
      await loadConfigFile('./agents/documentation-writer.yml')
    );
    await this.docWriter.start();
  }
  
  async reviewCode(filePath: string) {
    return await this.codeReviewer.run(
      `Review the code in ${filePath}. Focus on security, performance, and best practices.`
    );
  }
  
  async generateDocs(filePath: string) {
    return await this.docWriter.run(
      `Create comprehensive documentation for the code in ${filePath}.`
    );
  }
  
  async fullCodeAudit(directory: string) {
    // First, review the code
    const review = await this.codeReviewer.run(
      `Perform a comprehensive code review of all files in ${directory}.`
    );
    
    // Then, generate updated documentation
    const docs = await this.docWriter.run(
      `Based on this code review: ${review}\n\nUpdate the documentation for ${directory}.`
    );
    
    return { review, docs };
  }
  
  async cleanup() {
    await this.codeReviewer.stop();
    await this.docWriter.stop();
  }
}
```

**Why this works:** Specialized agents give better results than generalists.

## Pattern 2: Smart Error Handling

### Retry Logic with Exponential Backoff
```typescript
async function safeAgentCall(agent: any, message: string, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await agent.run(message);
      return result;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === retries) {
        throw new Error(`Failed after ${retries} attempts: ${error.message}`);
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Circuit Breaker Pattern
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private isOpen = false;
  
  constructor(
    private maxFailures = 5,
    private resetTimeout = 60000 // 1 minute
  ) {}
  
  async execute(fn: () => Promise<any>) {
    if (this.isOpen) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.reset();
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.isOpen = false;
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.maxFailures) {
      this.isOpen = true;
    }
  }
  
  private reset() {
    this.failures = 0;
    this.isOpen = false;
  }
}

// Usage
const breaker = new CircuitBreaker();

async function callAgent(agent: any, message: string) {
  return await breaker.execute(async () => {
    return await agent.run(message);
  });
}
```

### Graceful Degradation
```typescript
class RobustAgent {
  constructor(
    private primaryAgent: any,
    private fallbackAgent?: any
  ) {}
  
  async run(message: string, options: { timeout?: number } = {}) {
    const timeout = options.timeout || 30000; // 30 seconds
    
    try {
      // Try primary agent with timeout
      const result = await Promise.race([
        this.primaryAgent.run(message),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]);
      
      return result;
    } catch (error) {
      console.warn(`Primary agent failed: ${error.message}`);
      
      // Fall back to simpler agent or cached response
      if (this.fallbackAgent) {
        console.log('Trying fallback agent...');
        return await this.fallbackAgent.run(message);
      }
      
      // Return helpful error message
      return "I'm experiencing technical difficulties. Please try again later or rephrase your request.";
    }
  }
}
```

**Why this matters:** LLM APIs can be unreliable. Graceful handling keeps your apps running.

## Pattern 3: Event-Driven Architecture

### Agent Event System
```typescript
import { EventEmitter } from 'events';

class SmartAgent extends EventEmitter {
  constructor(private agent: any) {
    super();
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    // Track when tools are used
    this.agent.agentEventBus.on('llmservice:toolCall', (toolInfo: any) => {
      console.log(`🔧 Used tool: ${toolInfo.toolName}`);
      this.emit('toolUsed', toolInfo);
    });
    
    // Handle conversation resets
    this.agent.agentEventBus.on('dexto:conversationReset', () => {
      console.log('🔄 Conversation reset');
      this.emit('conversationReset');
    });
    
    // Track token usage
    this.agent.agentEventBus.on('llmservice:completion', (data: any) => {
      this.emit('tokensUsed', {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      });
    });
  }
  
  async processTask(task: string) {
    console.log(`📋 Processing: ${task}`);
    this.emit('taskStarted', { task });
    
    try {
      const result = await this.agent.run(task);
      console.log(`✅ Completed: ${task}`);
      this.emit('taskCompleted', { task, result });
      return result;
    } catch (error) {
      console.log(`❌ Failed: ${task}`);
      this.emit('taskFailed', { task, error });
      throw error;
    }
  }
}
```

### Analytics and Monitoring
```typescript
class AgentAnalytics {
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalTokens: 0,
    averageResponseTime: 0,
    toolUsage: new Map<string, number>()
  };
  
  constructor(agent: SmartAgent) {
    this.setupListeners(agent);
  }
  
  private setupListeners(agent: SmartAgent) {
    agent.on('taskStarted', ({ task }) => {
      this.metrics.totalRequests++;
    });
    
    agent.on('taskCompleted', ({ task, result }) => {
      this.metrics.successfulRequests++;
    });
    
    agent.on('taskFailed', ({ task, error }) => {
      this.metrics.failedRequests++;
    });
    
    agent.on('tokensUsed', ({ totalTokens }) => {
      this.metrics.totalTokens += totalTokens;
    });
    
    agent.on('toolUsed', ({ toolName }) => {
      const current = this.toolUsage.get(toolName) || 0;
      this.toolUsage.set(toolName, current + 1);
    });
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0 
        ? this.metrics.successfulRequests / this.metrics.totalRequests 
        : 0,
      toolUsage: Object.fromEntries(this.metrics.toolUsage)
    };
  }
  
  reset() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      averageResponseTime: 0,
      toolUsage: new Map()
    };
  }
}
```

**Why this helps:** Events let you build reactive applications that respond to what's happening.

## Pattern 4: Performance Optimization

### Request Batching
```typescript
class BatchedAgent {
  private pendingRequests: Array<{
    message: string;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  
  private batchTimer: NodeJS.Timeout | null = null;
  
  constructor(
    private agent: any,
    private batchSize = 5,
    private batchDelay = 100 // milliseconds
  ) {}
  
  async run(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ message, resolve, reject });
      
      if (this.pendingRequests.length >= this.batchSize) {
        this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), this.batchDelay);
      }
    });
  }
  
  private async processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    const batch = this.pendingRequests.splice(0);
    if (batch.length === 0) return;
    
    try {
      // Process requests in parallel
      const results = await Promise.allSettled(
        batch.map(({ message }) => this.agent.run(message))
      );
      
      // Resolve/reject individual promises
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          batch[index].resolve(result.value);
        } else {
          batch[index].reject(result.reason);
        }
      });
    } catch (error) {
      // Reject all if batch processing fails
      batch.forEach(({ reject }) => reject(error));
    }
  }
}
```

### Caching
```typescript
class CachedAgent {
  private cache = new Map<string, { result: any; timestamp: number }>();
  
  constructor(
    private agent: any,
    private cacheTTL = 5 * 60 * 1000 // 5 minutes
  ) {}
  
  async run(message: string): Promise<string> {
    const key = this.generateCacheKey(message);
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log('Cache hit');
      return cached.result;
    }
    
    const result = await this.agent.run(message);
    
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
    
    return result;
  }
  
  private generateCacheKey(message: string): string {
    // Simple hash function for cache key
    return Buffer.from(message).toString('base64');
  }
  
  clearCache() {
    this.cache.clear();
  }
}
```

## Pattern 5: Multi-Agent Coordination

```typescript
class AgentWorkflow {
  private agents = new Map<string, any>();
  
  async addAgent(name: string, configPath: string) {
    const config = await loadConfigFile(configPath);
    const agent = new DextoAgent(config);
    await agent.start();
    this.agents.set(name, agent);
  }
  
  async executeWorkflow(steps: Array<{
    agent: string;
    task: string;
    dependencies?: string[];
  }>) {
    const results = new Map<string, any>();
    
    for (const step of steps) {
      // Wait for dependencies
      if (step.dependencies) {
        await this.waitForDependencies(step.dependencies, results);
      }
      
      const agent = this.agents.get(step.agent);
      if (!agent) {
        throw new Error(`Agent ${step.agent} not found`);
      }
      
      // Include dependency results in task
      let task = step.task;
      if (step.dependencies) {
        const depResults = step.dependencies.map(dep => results.get(dep)).join('\n\n');
        task = `${task}\n\nPrevious results:\n${depResults}`;
      }
      
      const result = await agent.run(task);
      results.set(step.agent, result);
    }
    
    return results;
  }
  
  private async waitForDependencies(dependencies: string[], results: Map<string, any>) {
    // In a real implementation, this would handle async dependencies
    for (const dep of dependencies) {
      if (!results.has(dep)) {
        throw new Error(`Dependency ${dep} not satisfied`);
      }
    }
  }
  
  async cleanup() {
    for (const [name, agent] of this.agents) {
      await agent.stop();
    }
    this.agents.clear();
  }
}

// Usage
const workflow = new AgentWorkflow();
await workflow.addAgent('analyzer', './agents/code-analyzer.yml');
await workflow.addAgent('reviewer', './agents/code-reviewer.yml');
await workflow.addAgent('documenter', './agents/documentation-writer.yml');

const results = await workflow.executeWorkflow([
  {
    agent: 'analyzer',
    task: 'Analyze the codebase structure and identify key components.'
  },
  {
    agent: 'reviewer',
    task: 'Review the code for quality and security issues.',
    dependencies: ['analyzer']
  },
  {
    agent: 'documenter',
    task: 'Create comprehensive documentation based on the analysis and review.',
    dependencies: ['analyzer', 'reviewer']
  }
]);

// Clean up when done
await workflow.cleanup();
```

## What You've Learned

These advanced patterns give you:
- ✅ **Specialized agents** for better results
- ✅ **Robust error handling** for production reliability
- ✅ **Event-driven architecture** for reactive applications
- ✅ **Performance optimization** for scale
- ✅ **Multi-agent coordination** for complex workflows

## Next Steps

You're now equipped with production-ready patterns! Here's what to explore next:

- **Deploy your application**: Check out the [Deployment Guide](../guides/deployment.md) for deployment and scaling guidance
- **Join the community**: Share your patterns and learn from others in our [Discord](https://discord.gg/GFzWFAAZcm)
- **Contribute back**: Help improve Dexto by sharing your experiences and patterns

You're ready to build enterprise-grade AI applications! 🚀 