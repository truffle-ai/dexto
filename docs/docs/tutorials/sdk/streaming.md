---
sidebar_position: 4
title: "Streaming"
---

# Streaming

Streaming provides real-time responses for interactive applications. Instead of waiting for the complete response, you receive content as it's generated, creating a more engaging user experience.

## What You'll Learn

- Using the stream() method for real-time responses
- Handling different event types
- Building streaming chat UIs
- Integrating with web frameworks

## Basic Streaming

The `stream()` method returns an async iterator of events:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();

// Stream the response
for await (const event of await agent.stream('Explain quantum computing', {
  sessionId: session.id
})) {
  if (event.type === 'llm:chunk') {
    process.stdout.write(event.content);
  }
}

await agent.stop();
```

This prints the response in real-time as it's generated.

## Event Types

The stream emits several event types:

### llm:thinking

Emitted when the agent starts processing:

```typescript
for await (const event of await agent.stream(message, { sessionId })) {
  if (event.type === 'llm:thinking') {
    console.log('Agent is thinking...');
  }
}
```

### llm:chunk

Emitted for each piece of content:

```typescript
for await (const event of await agent.stream(message, { sessionId })) {
  if (event.type === 'llm:chunk') {
    // event.content contains the text chunk
    process.stdout.write(event.content);
  }
}
```

### llm:tool-call

Emitted when the agent uses a tool:

```typescript
for await (const event of await agent.stream(message, { sessionId })) {
  if (event.type === 'llm:tool-call') {
    console.log(`Using tool: ${event.toolName}`);
    console.log('Arguments:', event.args);
  }
}
```

### llm:tool-result

Emitted when a tool execution completes:

```typescript
for await (const event of await agent.stream(message, { sessionId })) {
  if (event.type === 'llm:tool-result') {
    if (event.success) {
      console.log(`Tool ${event.toolName} completed`);
    } else {
      console.error(`Tool ${event.toolName} failed`);
    }
  }
}
```

### llm:response

Emitted when the complete response is ready:

```typescript
for await (const event of await agent.stream(message, { sessionId })) {
  if (event.type === 'llm:response') {
    console.log(`\nComplete. Tokens used: ${event.usage?.totalTokens}`);
    console.log('Full content:', event.content);
  }
}
```

## Complete Event Handler

Handle all event types:

```typescript
async function handleStream(agent: DextoAgent, message: string, sessionId: string) {
  let fullContent = '';

  for await (const event of await agent.stream(message, { sessionId })) {
    switch (event.type) {
      case 'llm:thinking':
        console.log('Thinking...');
        break;

      case 'llm:chunk':
        fullContent += event.content;
        process.stdout.write(event.content);
        break;

      case 'llm:tool-call':
        console.log(`\nCalling tool: ${event.toolName}`);
        break;

      case 'llm:tool-result':
        console.log(`Tool result: ${event.success ? 'success' : 'failed'}`);
        break;

      case 'llm:response':
        console.log(`\nDone! Used ${event.usage?.totalTokens} tokens`);
        break;
    }
  }

  return fullContent;
}
```

## Server-Sent Events (SSE)

Integrate streaming with Express for web applications:

```typescript
import express from 'express';
import { DextoAgent } from '@dexto/core';

const app = express();
app.use(express.json());

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

app.post('/chat/stream', async (req, res) => {
  const { message, sessionId } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of await agent.stream(message, { sessionId })) {
      // Send event to client
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(3000);
```

### Client-Side SSE Handler

Connect from the browser:

```typescript
async function streamChat(message: string, sessionId: string) {
  const response = await fetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(7).trim();
        continue;
      }

      if (line.startsWith('data:')) {
        const data = JSON.parse(line.slice(6));
        handleEvent(eventType, data);
      }
    }
  }
}

function handleEvent(type: string, data: any) {
  switch (type) {
    case 'llm:chunk':
      appendToMessage(data.content);
      break;
    case 'llm:tool-call':
      showToolIndicator(data.toolName);
      break;
    case 'llm:response':
      markComplete(data.usage);
      break;
  }
}
```

## React Integration

Build a streaming chat component:

```typescript
import { useState, useEffect } from 'react';

function StreamingChat() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  async function sendMessage() {
    setIsStreaming(true);
    setResponse('');

    const res = await fetch('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId: sessionId || undefined
      })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = JSON.parse(line.slice(6));

          if (data.type === 'llm:chunk') {
            setResponse(prev => prev + data.content);
          } else if (data.type === 'llm:response') {
            setIsStreaming(false);
            if (!sessionId) {
              setSessionId(data.sessionId);
            }
          }
        }
      }
    }
  }

  return (
    <div>
      <div className="messages">
        {response && <div className="message">{response}</div>}
      </div>
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={isStreaming}
      />
      <button onClick={sendMessage} disabled={isStreaming}>
        {isStreaming ? 'Streaming...' : 'Send'}
      </button>
    </div>
  );
}
```

## Performance Considerations

### Buffering Chunks

For smoother UI updates, buffer small chunks:

```typescript
async function streamWithBuffering(agent: DextoAgent, message: string, sessionId: string) {
  let buffer = '';
  let lastFlush = Date.now();
  const flushInterval = 100; // milliseconds

  for await (const event of await agent.stream(message, { sessionId })) {
    if (event.type === 'llm:chunk') {
      buffer += event.content;

      // Flush buffer periodically
      if (Date.now() - lastFlush > flushInterval) {
        process.stdout.write(buffer);
        buffer = '';
        lastFlush = Date.now();
      }
    }
  }

  // Flush remaining buffer
  if (buffer) {
    process.stdout.write(buffer);
  }
}
```

### Error Handling

Handle stream interruptions gracefully:

```typescript
async function safeStream(agent: DextoAgent, message: string, sessionId: string) {
  try {
    for await (const event of await agent.stream(message, { sessionId })) {
      if (event.type === 'llm:chunk') {
        process.stdout.write(event.content);
      }
    }
  } catch (error) {
    console.error('\nStream error:', error.message);
    console.log('Falling back to generate()...');

    // Fallback to non-streaming
    const response = await agent.generate(message, { sessionId });
    console.log(response.content);
  }
}
```

## Choosing: stream() vs generate()

Use `stream()` when:
- Building interactive UIs
- Users need immediate feedback
- Responses may be long
- Building chat applications

Use `generate()` when:
- Building APIs or batch processing
- You need the complete response at once
- Simplicity is preferred
- Working with structured data

## Next Steps

- **[Tools](./tools.md)** - Add MCP tools to your streaming agent
- **[Events](./events.md)** - Monitor streaming with the event system
- **[Error Handling](./error-handling.md)** - Handle streaming failures gracefully
