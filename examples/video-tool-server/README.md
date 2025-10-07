# Video Tool MCP Server

This example MCP server returns a sample video clip when the `get_sample_video` tool is invoked. It is useful when testing the Dexto UI's ability to render video results from tool calls.

## Quick start

```bash
node examples/video-tool-server/video-mcp-server.mjs
```

The server listens on stdio, so you can reference it from your Dexto agent configuration:

```yaml
tools:
  - type: mcp
    transport: stdio
    command: node
    args:
      - examples/video-tool-server/video-mcp-server.mjs
```

## Tool reference

- `get_sample_video`
  - **description**: Returns a CC0-licensed flower video clip from MDN's media assets.
  - **optional arguments**:
    - `format`: `"mp4"` (default) or `"webm"`
  - **return value**:
    - A short text summary and a `resource` part with the video URI, MIME type, and filename metadata.

The sample URLs point to public-domain media hosted by MDN (`interactive-examples.mdn.mozilla.net`), keeping the example light-weight while avoiding large binaries in this repository.
