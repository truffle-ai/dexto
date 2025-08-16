################################################################################
# Build stage - includes dev dependencies
ARG NODE_VERSION=20.18.1

################################################################################
# Build stage - optimized for smaller final image
FROM node:${NODE_VERSION}-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies - allow scripts for native modules
RUN npm ci --include=dev

# Copy source and build
COPY . .
RUN npm run build

# Clean up and prepare production node_modules with native bindings
RUN npm prune --production && \
    npm cache clean --force && \
    rm -rf /root/.npm /tmp/* /usr/lib/node_modules/npm/man /usr/lib/node_modules/npm/doc /usr/lib/node_modules/npm/html /usr/lib/node_modules/npm/scripts

################################################################################
# Production stage - minimal Alpine with Chromium
FROM node:${NODE_VERSION}-alpine AS production

# Install only essential Chromium dependencies in single layer
RUN apk add --no-cache \
    chromium \
    && rm -rf /var/cache/apk/* /tmp/*

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S dexto && adduser -S dexto -u 1001

# Create .dexto directory with proper permissions for database
RUN mkdir -p /app/.dexto/database && \
    chown -R dexto:dexto /app/.dexto

# Copy only essential production files
COPY --from=builder --chown=dexto:dexto /app/dist ./dist
COPY --from=builder --chown=dexto:dexto /app/node_modules ./node_modules
COPY --from=builder --chown=dexto:dexto /app/package.json ./
COPY --from=builder --chown=dexto:dexto /app/agents ./agents

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_FILE=/app/agents/agent.yml \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Switch to non-root user
USER dexto

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.request({host:'localhost',port:process.env.PORT||3000,path:'/health'}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"

# Single port for deployment platform
EXPOSE $PORT

# Server mode: REST APIs + WebSocket on single port
CMD ["sh", "-c", "node dist/src/app/index.js --mode server --web-port $PORT --agent $CONFIG_FILE"] 