---
slug: /
sidebar_position: 1
---

# Getting Started

Welcome to the Dexto API. This guide will walk you through the essential first steps to begin interacting with your Dexto agent programmatically.

## 1. Starting the API Server

Before you can make any API calls, you must start the Dexto server. This single command enables both the REST and SSE streaming APIs.

Run the following command in your terminal:

```bash
dexto --mode server
```

By default, the server will run on port `3001`. You should see a confirmation message in your terminal indicating that the server has started successfully.

**Customize the port:**
```bash
dexto --mode server --port 8080
```

This starts the API server on port 8080 instead of the default 3001.

## 2. Choosing Your API

Dexto offers two distinct APIs to suit different use cases. Understanding when to use each is key to building your application effectively.

### When to use the REST API?
Use the **REST API** for synchronous, request-response actions where you want to perform a task and get a result immediately. It's ideal for:
-   Managing resources (e.g., listing or adding MCP servers).
-   Retrieving configuration or session data.
-   Triggering a single, non-streamed agent response.

**Base URL**: `http://localhost:3001`

### When to use Server-Sent Events (SSE)?
Use **Server-Sent Events (SSE)** for building interactive, real-time applications. It's the best choice for:
-   Streaming agent responses (`chunk` events) as they are generated.
-   Receiving real-time events from the agent's core, such as `toolCall` and `toolResult`.
-   Creating chat-like user interfaces.

**Stream URL**: `http://localhost:3001/api/message-stream`

## 3. What's Next?

Now that your server is running and you know which API to use, you can dive into the specifics:

-   Explore the **[REST API Reference](/api/rest)** - comprehensive documentation of all HTTP endpoints.
-   Learn about the **[SDK Events Reference](/api/sdk/events)**. 