# Dexto Playground

This project is an interactive playground for testing MCP tools/servers tools and building your own AI agents.

[MCP - Model Context Protocol]

## Features

- **Tool Testing Playground**: Connect and test MCP servers and their tools interactively
- **Simple Chat Interface**: Clean, focused conversation with AI agents
- **Server Management**: Easy connection and management of MCP servers
- **Tool Discovery**: Explore available tools and their capabilities
- **Configuration Export**: Export your tool setup for use with Claude Desktop or other MCP clients

## What is MCP?

The Model Context Protocol (MCP) allows AI models to securely connect to external tools and data sources. Dexto provides a simple interface to:

- Connect to MCP servers
- Test tool functionality
- Chat with AI agents that have access to your tools
- Export configurations for other clients

## Quick Start

1. Connect a MCP server using the "Tools" panel
2. Test individual tools in the playground (`/playground`)
3. Chat with AI agents that can use your connected tools
4. Export your configuration when ready

This project is built with [Next.js](https://nextjs.org) and uses modern web technologies for a smooth development experience.

## Developer guide

Clear out ports 3000 (linux):
```bash
lsof -ti:3000-3001 | xargs kill -9   
```

Start one server for the API at the root directory of this project [port 3001]:
```bash
[  2:29PM ]  [ ~/Projects/dexto(storage✗) ]
 $ npm run build && npm link && dexto --mode server
 ```

then start the npm dev server [port 3000]

```bash
[  2:31PM ]  [ karaj@MacBook-Pro:~/Projects/dexto/src/app/webui(storage✗) ]
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start testing your tools.

This is temporary because the application functionality uses Dexto APIs built in the same project
