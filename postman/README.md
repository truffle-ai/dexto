# Postman Collections

This folder contains Postman collections for testing Dexto APIs.

## Available Collections

### `dexto-webhooks.postman_collection.json`
Complete API collection for testing Dexto webhook functionality including:
- Webhook management (register, list, get, test, remove)
- Event triggers (send message, reset conversation)
- Other API endpoints (health, sessions, LLM config)

## Setup Instructions

1. **Import Collection**
   - Open Postman
   - Click "Import" → "File"
   - Select the collection JSON file
   - Click "Import"

2. **Configure Variables**
   - Click collection name → "Variables" tab
   - Update `webhookUrl` with your webhook.site URL
   - Update `baseUrl` if server runs on different port
   - Save changes

3. **Start Dexto Server**
   ```bash
   npm run build
   node dist/src/app/index.js --mode server --agent test-config.yml
   ```

4. **Test Workflow**
   - Health Check → Register Webhook → Test Webhook → Send Message
   - Check webhook.site to see received events

## Variables Used

| Variable | Description | Default |
|----------|-------------|---------|
| `baseUrl` | Dexto server URL | `http://localhost:3000` |
| `webhookUrl` | Test webhook endpoint | `https://webhook.site/your-unique-id` |
| `webhookSecret` | HMAC verification secret | `test_secret_123` |
| `sessionId` | Session ID for events | `test-session-123` |
| `webhookId` | Auto-set from registration | *(empty)* |

## Features

- ✅ Parametric URLs with variables
- ✅ Auto-capture webhook ID from registration
- ✅ Pretty printing enabled (`?pretty=true`)
- ✅ Pre-configured request bodies
- ✅ Complete webhook testing workflow