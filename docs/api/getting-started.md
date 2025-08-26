---
slug: /
sidebar_position: 1
---

# Getting Started

Welcome to the Dexto API. This guide will walk you through the essential first steps to begin interacting with your Dexto agent programmatically.

## 1. Starting the API Server

Before you can make any API calls, you must start the Dexto server. This single command enables both the REST and WebSocket APIs.

Run the following command in your terminal:

```bash
dexto --mode server
```

By default, the server will run on port `3001`. You should see a confirmation message in your terminal indicating that the server has started successfully.

## 2. Choosing Your API

Dexto offers two distinct APIs to suit different use cases. Understanding when to use each is key to building your application effectively.

### When to use the REST API?
Use the **REST API** for synchronous, request-response actions where you want to perform a task and get a result immediately. It's ideal for:
-   Managing resources (e.g., listing or adding MCP servers).
-   Retrieving configuration or session data.
-   Triggering a single, non-streamed agent response.

**Base URL**: `http://localhost:3001`

### When to use the WebSocket API?
Use the **WebSocket API** for building interactive, real-time applications that require a persistent connection. It's the best choice for:
-   Streaming agent responses (`chunk` events) as they are generated.
-   Receiving real-time events from the agent's core, such as `toolCall` and `toolResult`.
-   Creating chat-like user interfaces.

**Connection URL**: `ws://localhost:3001/`

## 3. What's Next?

Now that your server is running and you know which API to use, you can dive into the specifics:

-   Explore the **[REST API](./rest/conversation.md)** endpoints.
-   Learn about the **[WebSocket API](./websocket.md)** events and messages. 