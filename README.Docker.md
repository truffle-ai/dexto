# Running Dexto with Docker

This image runs the Dexto CLI in server mode (API + SSE streaming). It uses pnpm workspaces and builds from the current repo (no published packages required).

## Build the image

```bash
docker build -t dexto:local .
```

## Provide configuration and API keys

Create a `.env` file with your keys (see `README.md`):

```ini
OPENAI_API_KEY=...
# add other provider keys as needed
```

The coding agent config is baked into the image at `/app/agents/coding-agent/coding-agent.yml`. You can mount your own agents folder if desired.

## Run: API server only (default)

```bash
docker run --rm \
  --env-file .env \
  -e API_PORT=3001 \
  -p 3001:3001 \
  dexto:local
```

What it does:
- Starts REST + SSE streaming server on `API_PORT` (default 3001)
- Uses Chromium inside the image for Puppeteer tools
- Stores runtime data under `/app/.dexto` (in‑container)

Endpoints:
- API base: `http://localhost:3001/api/`
- Health: `http://localhost:3001/health`
- MCP servers: `http://localhost:3001/api/mcp/servers`

Persist data between runs (recommended):

```bash
docker run --rm \
  --env-file .env \
  -e API_PORT=3001 \
  -p 3001:3001 \
  -v dexto_data:/app/.dexto \
  dexto:local
```

Use a custom agent config:

```bash
docker run --rm \
  --env-file .env \
  -e API_PORT=3001 \
  -e CONFIG_FILE=/app/agents/my-agent.yml \
  -v $(pwd)/agents:/app/agents:ro \
  -p 3001:3001 \
  dexto:local
```

## Run with WebUI (optional)

The image embeds the built WebUI. To run the WebUI alongside the API, start the CLI in `web` mode. This requires two ports (frontend and API):

```bash
docker run --rm \
  --env-file .env \
  -e FRONTEND_PORT=3000 \
  -e API_PORT=3001 \
  -p 3000:3000 -p 3001:3001 \
  dexto:local \
  sh -c "node packages/cli/dist/index.js --mode web --agent $CONFIG_FILE"
```

Open the WebUI: `http://localhost:3000` (the UI calls the API on `http://localhost:3001`).

## Docker Compose (example)

```yaml
services:
  dexto:
    image: dexto:local
    build: .
    environment:
      API_PORT: 3001
    ports:
      - "3001:3001"
    volumes:
      - dexto_data:/app/.dexto
      - ./agents:/app/agents:ro
    env_file: .env

volumes:
  dexto_data: {}
```

## Notes
- Healthcheck uses `API_PORT` (falls back to `PORT` or 3001).
- The container runs as a non‑root user (`dexto`).
- The image builds from your repo code; no published `@dexto/core` is required.
