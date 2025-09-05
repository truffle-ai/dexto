# MCP Server Registry

This directory contains the MCP (Model Context Protocol) server registry system for Dexto.

## Structure

- `serverRegistry.ts` - The main registry service that manages MCP server entries
- `server-registry-data.json` - External JSON file containing all built-in server definitions

## Adding New MCP Servers

To add a new MCP server to the registry, simply edit the `server-registry-data.json` file. No code changes are required!

### Server Entry Format

Each server entry should follow this structure:

```json
{
  "id": "unique-server-id",
  "name": "Display Name",
  "description": "Brief description of what this server does",
  "category": "productivity|research|creative|development",
  "icon": "📁",
  "config": {
    "type": "stdio|http|sse",
    "command": "npx|uvx|python",
    "args": ["-y", "package-name"],
    "env": {
      "API_KEY": ""
    },
    "timeout": 30000
  },
  "tags": ["tag1", "tag2"],
  "isOfficial": true,
  "isInstalled": false,
  "requirements": {
    "platform": "all|windows|mac|linux",
    "node": ">=18.0.0",
    "python": ">=3.10"
  },
  "author": "Author Name",
  "homepage": "https://github.com/author/repo",
  "matchIds": ["server-id", "alternative-id"]
}
```

### Configuration Types

#### Stdio (Node.js/npm)
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "package-name"],
  "env": {
    "API_KEY": ""
  }
}
```

#### Stdio (Python/uvx)
```json
{
  "type": "stdio",
  "command": "uvx",
  "args": ["package-name"]
}
```

#### HTTP/SSE
```json
{
  "type": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer $API_KEY"
  }
}
```

### Categories

- **productivity** - File operations, task management, workflow tools
- **research** - Search, data analysis, information gathering
- **creative** - Image editing, music creation, content generation
- **development** - Code analysis, debugging, development tools

### Icons

Use appropriate emojis for each server type:
- 📁 File operations
- 🔍 Search/research
- 🖼️ Image/media
- 🎵 Audio/music
- 🌐 Web/browser
- 📋 Task management
- 🤗 AI/ML models

## Benefits of External JSON

1. **No rebuilds required** - Add servers by editing JSON only
2. **Easy maintenance** - All server data in one place
3. **Version control friendly** - Track server additions in git
4. **Non-developer friendly** - Anyone can add servers without touching code
5. **Consistent structure** - Enforced schema for all entries

## Example: Adding Tavily Search

```json
{
  "id": "tavily",
  "name": "Tavily Search",
  "description": "Web search and research using Tavily AI search engine",
  "category": "research",
  "icon": "🔍",
  "config": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "tavily-mcp@0.1.3"],
    "env": {
      "TAVILY_API_KEY": ""
    },
    "timeout": 30000
  },
  "tags": ["search", "web", "research", "ai"],
  "isOfficial": false,
  "isInstalled": false,
  "requirements": { "platform": "all", "node": ">=18.0.0" },
  "author": "Tavily AI",
  "homepage": "https://www.npmjs.com/package/tavily-mcp",
  "matchIds": ["tavily"]
}
```

## Testing

After adding a new server to the JSON file:

1. Restart the Dexto WebUI
2. Navigate to the server registry
3. Verify the new server appears in the list
4. Test adding it to an agent

## Troubleshooting

- **Server not appearing**: Check JSON syntax and restart WebUI
- **Import errors**: Ensure the JSON file is valid and accessible
- **Type errors**: Verify the server entry matches the expected schema
