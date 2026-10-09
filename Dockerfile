################################################################################
# Build stage - includes dev dependencies
ARG NODE_VERSION=20.18.1

################################################################################
# Build stage - pnpm workspace build and deploy
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

# Install the complete workspace graph before building package dependencies.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -w build

# Copy the CLI and its complete production dependency closure into one portable root.
RUN pnpm --filter dexto --config.node-linker=hoisted deploy --prod --legacy /runtime

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
 && mkdir -p /app/.dexto/database /workspace \
 && chown -R dexto:dexto /app/.dexto /workspace

# The deployed root contains workspace packages as well as external dependencies.
COPY --from=builder --chown=dexto:dexto /runtime/ /app/
COPY scripts/docker-entrypoint.sh /usr/local/bin/dexto-entrypoint
RUN chmod +x /usr/local/bin/dexto-entrypoint

# Environment
ENV NODE_ENV=production \
    PORT=3001 \
    HOME=/app \
    CONFIG_FILE=/app/dist/agents/coding-agent/coding-agent.yml \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Run tasks in a writable workspace, separate from the packaged runtime.
WORKDIR /workspace
USER dexto

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const port=process.env.PORT||3001;const req=http.request({host:'localhost',port,path:'/health'},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.end();"

# Default port for metadata (runtime can override via -e PORT)
EXPOSE 3001

# Server mode: REST APIs + SSE streaming on single port (no Web UI)
ENTRYPOINT ["/usr/local/bin/dexto-entrypoint"]
