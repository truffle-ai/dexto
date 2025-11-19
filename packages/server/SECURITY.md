# Dexto Server Security

## 🔒 Authentication Overview

The Dexto server implements **API key authentication** to protect against unauthorized access.

## Configuration

### Environment Variables

```bash
# Required for production security
DEXTO_SERVER_API_KEY=your-secret-api-key-here

# Optional: Enable production mode (requires API key)
NODE_ENV=production

# Optional: Explicitly require auth even in development
DEXTO_SERVER_REQUIRE_AUTH=true
```

### Security Modes

| Mode | Environment | Auth Required | Notes |
|------|-------------|---------------|-------|
| **Development (default)** | No env vars | ❌ No | Default mode - safe for local dev |
| **Production** | `NODE_ENV=production` + `DEXTO_SERVER_API_KEY` | ✅ Yes | Requires API key authentication |
| **Explicit Auth** | `DEXTO_SERVER_REQUIRE_AUTH=true` + `DEXTO_SERVER_API_KEY` | ✅ Yes | Force auth in any environment |

## Usage

### Client Authentication

**HTTP Requests:**
```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3000/api/llm/current
```

**JavaScript Fetch:**
```javascript
fetch('http://localhost:3000/api/message', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'Hello' })
});
```

### Public Routes (No Auth Required)

These routes are always accessible:
- `GET /health` - Health check
- `GET /.well-known/agent-card.json` - A2A agent discovery
- `GET /openapi.json` - API documentation

## Security Best Practices

### ✅ DO:

1. **Set DEXTO_SERVER_API_KEY in production**
   ```bash
   export DEXTO_SERVER_API_KEY=$(openssl rand -base64 32)
   ```

2. **Use HTTPS in production**
   - Deploy behind reverse proxy (nginx, Caddy, Cloudflare)
   - Never send API keys over unencrypted HTTP

3. **Rotate API keys regularly**
   ```bash
   # Generate new key
   NEW_KEY=$(openssl rand -base64 32)
   # Update environment variable
   export DEXTO_SERVER_API_KEY=$NEW_KEY
   # Restart server
   ```

4. **Use environment-specific keys**
   - Different keys for dev/staging/production
   - Never commit keys to version control

5. **Monitor unauthorized access attempts**
   - Check logs for "Unauthorized API access attempt" warnings
   - Set up alerts for repeated failures

### ❌ DON'T:

1. **Don't use weak or guessable API keys**
   - ❌ `DEXTO_SERVER_API_KEY=password123`
   - ❌ `DEXTO_SERVER_API_KEY=dexto`
   - ✅ `DEXTO_SERVER_API_KEY=$(openssl rand -base64 32)`

2. **Don't expose API keys in client-side code**
   ```javascript
   // ❌ NEVER DO THIS
   const apiKey = 'sk-abc123...';
   fetch('/api/message', { headers: { 'Authorization': `Bearer ${apiKey}` }});
   ```

3. **Don't set DEXTO_SERVER_REQUIRE_AUTH=false in production**
   - Only use for testing on isolated networks

4. **Don't share API keys across environments**
   - Each environment should have its own key

## Development Workflow

### Local Development (No Auth)

```bash
# Start server in development mode
NODE_ENV=development npm start

# Access from browser without auth
curl http://localhost:3000/api/llm/current
```

### Production Deployment

```bash
# Generate secure API key
export DEXTO_SERVER_API_KEY=$(openssl rand -base64 32)

# Start server in production mode
NODE_ENV=production npm start

# All requests now require authentication
curl -H "Authorization: Bearer $DEXTO_SERVER_API_KEY" \
     https://api.example.com/api/llm/current
```

## Threat Model

### Protected Against:

- ✅ Unauthorized API access
- ✅ Unauthorized message sending
- ✅ Unauthorized configuration changes
- ✅ Unauthorized session/memory access
- ✅ Brute force attacks (when combined with rate limiting)

### Not Protected Against (Additional Measures Needed):

- ⚠️ DDoS attacks → Add rate limiting middleware
- ⚠️ API key leakage → Use secrets management (Vault, AWS Secrets Manager)
- ⚠️ Man-in-the-middle → Use HTTPS/TLS
- ⚠️ Insider threats → Implement audit logging

## Additional Security Layers (Recommended)

### 1. Rate Limiting

```typescript
import { rateLimiter } from 'hono-rate-limiter';

app.use('*', rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
}));
```

### 2. IP Whitelisting

```bash
# Add to your reverse proxy (nginx example)
location /api {
  allow 10.0.0.0/8;
  deny all;
  proxy_pass http://localhost:3000;
}
```

### 3. Network Isolation

- Deploy API server on private network
- Use VPN or private networking for access
- Firewall rules to restrict incoming connections

## Logging and Monitoring

The server logs authentication events:

```log
# Successful auth (debug level)
Authorization successful for /api/llm/current

# Failed auth (warning level)
⚠️ Unauthorized API access attempt
  path: /api/message
  hasKey: false
  origin: https://malicious.com
  userAgent: curl/7.81.0
```

Set up monitoring for:
- Repeated 401 responses
- Unusual access patterns
- Requests from unexpected IPs/origins

## FAQ

**Q: Can I use the API without authentication in development?**
A: Yes, set `NODE_ENV=development` and access from localhost.

**Q: How do I generate a secure API key?**
A: Use `openssl rand -base64 32` or a password manager.

**Q: Can I use multiple API keys?**
A: Currently no. For multi-tenant scenarios, implement token-based auth with JWT.

**Q: What if my API key is compromised?**
A: Generate a new key immediately and update all clients.

**Q: Does SSE need authentication too?**
A: Yes, pass `Authorization: Bearer <key>` header when connecting to the event stream.

**Q: Can I disable auth for specific routes?**
A: Public routes (/health, /.well-known/agent-card.json) are always accessible. To add more, modify `PUBLIC_ROUTES` in `middleware/auth.ts`.

## Contact

For security concerns or to report vulnerabilities, contact: security@dexto.dev
