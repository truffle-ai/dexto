---
sidebar_position: 9
---

# Deployment Guide

Deploy Dexto agents using Docker for local or production environments.

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
   # Add other API keys as needed
   ```

3. **Run the container**
   ```bash
   docker run --env-file .env -p 3001:3001 dexto
   ```

Your Dexto server will be available at `http://localhost:3001` with:
- ✅ SQLite database connected
- ✅ MCP servers (filesystem & puppeteer) connected
- ✅ REST API + SSE streaming endpoints available

### Port Configuration

By default, Dexto server mode runs on port 3001 and web mode on port 3000. Customize the port using the `PORT` environment variable or `--port` flag:

```bash
# Using environment variable
docker run --env-file .env -e PORT=8080 -p 8080:8080 dexto

# Using CLI flag (requires modifying Dockerfile CMD)
docker run --env-file .env -p 8080:8080 dexto --port 8080
```

```bash
# Web mode with custom port (serves both UI and API)
docker run --env-file .env -p 3000:3000 dexto --port 3000
```

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
      - "3001:3001"
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