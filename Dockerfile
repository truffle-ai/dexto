################################################################################
# Build stage - includes dev dependencies
ARG NODE_VERSION=20.18.1

################################################################################
# Build stage - pnpm workspace build and prune
FROM node:${NODE_VERSION}-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Install a pinned pnpm globally (avoid Corepack signature issues in containers)
ARG PNPM_VERSION=10.12.4
RUN npm i -g pnpm@${PNPM_VERSION}

# Copy workspace manifests for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/webui/package.json packages/webui/package.json

# Install workspace dependencies (with lockfile)
RUN pnpm install --frozen-lockfile

# Copy sources and build all packages (embeds WebUI into CLI dist)
COPY . .
RUN pnpm -w build

# Prune to production dependencies
# Prune to production dependencies at the workspace root
# (keeps per-package node_modules; smaller image without dev deps)
RUN pnpm prune --prod

################################################################################
# Production stage - minimal Alpine with Chromium
FROM node:${NODE_VERSION}-alpine AS production

# Install Chromium runtime
RUN apk add --no-cache \
    chromium \
    && rm -rf /var/cache/apk/* /tmp/*

WORKDIR /app

# Create non-root user and data dir
RUN addgroup -g 1001 -S dexto && adduser -S dexto -u 1001 \
 && mkdir -p /app/.dexto/database && chown -R dexto:dexto /app/.dexto

# Copy only what we need for runtime
COPY --from=builder --chown=dexto:dexto /app/node_modules ./node_modules
COPY --from=builder --chown=dexto:dexto /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=builder --chown=dexto:dexto /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder --chown=dexto:dexto /app/packages/cli/package.json ./packages/cli/package.json
# Copy core workspace package since pnpm links it via node_modules
COPY --from=builder --chown=dexto:dexto /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder --chown=dexto:dexto /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=dexto:dexto /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder --chown=dexto:dexto /app/agents ./agents
COPY --from=builder --chown=dexto:dexto /app/package.json ./

# Environment
ENV NODE_ENV=production \
    PORT=3001 \
    API_PORT=3001 \
    CONFIG_FILE=/app/agents/coding-agent/coding-agent.yml \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Run as non-root
USER dexto

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const port=process.env.API_PORT||process.env.PORT||3001;const req=http.request({host:'localhost',port,path:'/health'},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.end();"

# Fixed port for metadata (runtime can override via -e API_PORT)
EXPOSE 3001

# Server mode: REST APIs + SSE streaming on single port (no Web UI)
CMD ["sh", "-c", "node packages/cli/dist/index.js --mode server --agent $CONFIG_FILE"]
