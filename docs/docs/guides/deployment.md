---
sidebar_position: 9
---

# Deployment Guide

Run Dexto agents locally, in an existing sandbox, or in Docker.

## Local or Sandbox Server

Run an agent behind the REST and streaming API on your machine or inside an existing sandbox with Dexto installed:

```bash
dexto --mode server --agent ./agent.yml --port 3001

# In another terminal, after the server reports it is running:
curl http://localhost:3001/health
```

Supply the model credentials required by your agent configuration. The CLI reports the server as running after agent initialization and successful socket binding. If the port is already occupied, startup exits with an error instead of reporting success.

Use Ctrl+C or send SIGTERM to stop the local server. Shutdown closes the HTTP listener and active connections, closes its MCP transport, and stops the current agent. Streaming clients disconnect during shutdown.

## Docker Deployment

### Quick Start

1. **Build the Docker image**

    ```bash
    docker build -t dexto .
    ```

2. **Create environment file**

    ```bash
    # .env
    OPENAI_API_KEY=your_openai_api_key
    ANTHROPIC_API_KEY=your_anthropic_api_key
    DEXTO_SERVER_API_KEY=your_local_server_api_key
    # Add other API keys as needed
    ```

3. **Run the container**
    ```bash
    docker run --env-file .env -p 3001:3001 dexto
    ```

Production API requests require `Authorization: Bearer <DEXTO_SERVER_API_KEY>`; `/health` remains public.

Your Dexto server will be available at `http://localhost:3001` with:

- ✅ SQLite database connected
- ✅ Local filesystem and process tools available
- ✅ REST API + SSE streaming endpoints available

### Port Configuration

The container uses `PORT=3001` by default. Set `PORT` and the matching published port to customize it:

```bash
# Using environment variable
docker run --env-file .env -e PORT=8080 -p 8080:8080 dexto
```

```bash
# Web mode with custom port (serves both UI and API)
docker run --env-file .env -e PORT=3000 -p 3000:3000 dexto --mode web
```

The container runs as a non-root user with a writable `/workspace` working directory. Agent data lives under `/app/.dexto`, so the volume examples below persist SQLite sessions and local blob data. The default configuration is the bundled coding agent; set `CONFIG_FILE` to a mounted YAML file to use another agent. Additional arguments are forwarded to the CLI, and `docker stop` sends SIGTERM directly to its Node process.

### Background Mode

Run Dexto in detached mode:

```bash
# Start in background
docker run -d --name dexto-server --env-file .env -p 3001:3001 dexto

# View logs
docker logs -f dexto-server

# Stop server
docker stop dexto-server
```

### Docker Compose

For easier management:

```yaml
# docker-compose.yml
version: '3.8'
services:
    dexto:
        build: .
        ports:
            - '3001:3001'
        env_file:
            - .env
        volumes:
            - dexto_data:/app/.dexto
        restart: unless-stopped

volumes:
    dexto_data:
```

Run with:

```bash
docker compose up --build
```

## Production Setup

### Environment Variables

```bash
# Production environment variables
NODE_ENV=production
PORT=3001
CONFIG_FILE=/app/configuration/dexto.yml
```

### Persistent Storage

Mount a volume for persistent data:

```bash
docker run -d \
  --name dexto-server \
  --env-file .env \
  -p 3001:3001 \
  -v dexto_data:/app/.dexto \
  dexto
```

### Resource Limits

Set memory and CPU limits:

```bash
docker run -d \
  --name dexto-server \
  --env-file .env \
  --memory=1g \
  --cpus=1 \
  -p 3001:3001 \
  dexto
```

## API Endpoints

Once deployed, your Dexto server provides:

### REST API

- `POST /api/message` - Send async message
- `POST /api/message-sync` - Send sync message
- `POST /api/reset` - Reset conversation
- `GET /api/mcp/servers` - List MCP servers
- `GET /health` - Health check
- And many more for sessions, LLM management, agents, webhooks, etc.

**See the complete [REST API Documentation](/api/rest/)** for all available endpoints.

### Server-Sent Events (SSE)

- Real-time events and streaming responses
- Connect to `http://localhost:3001/api/message-stream`

**See the [SDK Events Reference](/api/sdk/events)** for event types and usage.

## Next Steps

- **[Dexto SDK Guide](./dexto-sdk.md)** - Integrate Dexto into your application's codebase
- **[API Reference](/api)** - Complete API documentation

For more detailed information on configuring agents, refer to the [Dexto Configuration Guide](./configuring-dexto/overview.md).

### Building with the Dexto SDK for TypeScript

For custom builds and advanced integration, you can use the [Dexto SDK Guide](./dexto-sdk.md) to bundle Dexto into your own applications.

For a complete technical reference, see the [API Reference](/api).

## Hosting Options
