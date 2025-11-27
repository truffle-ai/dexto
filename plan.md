# MCP-UI Integration Plan

## Executive Summary

Implement MCP-UI support in Dexto to enable MCP servers to return rich, interactive UI resources instead of just text and images. This is a **generic infrastructure improvement** that benefits multiple use cases:

| Use Case | Current State | With MCP-UI |
|----------|---------------|-------------|
| Gaming Agent | Static PNG per tool call | Live MJPEG video stream |
| Browser Automation | Screenshots | Live browser view |
| Dashboards | Text/JSON | Interactive charts |
| Forms | Not possible | User input collection |

---

## Background Research

### MCP-UI Protocol

[MCP-UI](https://mcpui.dev/) is an open protocol for delivering rich, dynamic interfaces from MCP servers. It has been **standardized into MCP Apps Extension (SEP-1865)** as part of the official MCP specification, co-authored by OpenAI, Anthropic, and MCP-UI maintainers.

**Key Concepts:**
- **UI Resources**: HTML content delivered via `ui://` URI scheme
- **Content Types**: `rawHtml`, `externalUrl`, `remoteDom`
- **Security**: Sandboxed iframes with restricted permissions
- **Communication**: Bidirectional postMessage-based JSON-RPC

### SDK Packages

```bash
# Server-side
npm install @mcp-ui/server

# Client-side
npm install @mcp-ui/client
```

---

## Current Dexto Architecture

### MCP Client Layer (`packages/core/src/mcp/`)

| File | Purpose |
|------|---------|
| `mcp-client.ts` | MCP client with stdio/SSE/HTTP transport support |
| `manager.ts` | Server lifecycle, tool caching, execution |
| `types.ts` | Type interfaces |
| `schemas.ts` | Zod validation |

### Tool Result Flow

```
MCP Server → MCPClient.callTool() → sanitizeToolResult() → SanitizedToolResult
                                                               ↓
                                        sessionEventBus.emit('llm:tool-result')
                                                               ↓
                                        SSE → WebUI → MessageList.tsx
```

### Current Content Types (`packages/core/src/context/types.ts`)

```typescript
export interface SanitizedToolResult {
    content: Array<TextPart | ImagePart | FilePart>;
    resources?: Array<{
        uri: string;
        kind: 'image' | 'audio' | 'video' | 'binary';
        mimeType: string;
        filename?: string;
    }>;
    meta: { toolName: string; toolCallId: string; success?: boolean };
}
```

**Key Insight**: The `resources` array already supports audio/video kinds, but they're not rendered as first-class content parts. MCP-UI integration extends this pattern.

### WebUI Rendering (`packages/webui/`)

| File | Purpose |
|------|---------|
| `components/MessageList.tsx` | Primary message/tool result rendering |
| `components/hooks/useChat.ts` | SSE event processing, state management |
| `components/hooks/useResourceContent.ts` | Resource fetching and normalization |

**Rendering Flow:**
1. SSE delivers `llm:tool-result` event with `SanitizedToolResult`
2. `useChat.ts` updates message state
3. `MessageList.tsx` extracts and renders content parts
4. Images/audio/video render as separate bubbles

---

## MCP-UI Technical Specification

### UI Resource Format

```typescript
interface UIResource {
    type: 'resource';
    resource: {
        uri: string;           // e.g., "ui://gameboy/live-view"
        mimeType: string;      // "text/html" | "text/uri-list" | "application/vnd.mcp-ui.remote-dom"
        text?: string;         // Inline HTML content
        blob?: string;         // Base64 encoded content
    };
}
```

### Content Types

#### 1. Raw HTML (`text/html`)
```typescript
createUIResource({
    uri: 'ui://widget/1',
    content: { type: 'rawHtml', htmlString: '<div>Hello</div>' },
    encoding: 'text'
});
```
- Rendered via `srcDoc` in sandboxed iframe
- Safest option for trusted content

#### 2. External URL (`text/uri-list`)
```typescript
createUIResource({
    uri: 'ui://dashboard/1',
    content: { type: 'externalUrl', iframeUrl: 'https://example.com/widget' },
    encoding: 'text'
});
```
- Rendered via `src` in sandboxed iframe
- Useful for MJPEG streams, external widgets

#### 3. Remote DOM (`application/vnd.mcp-ui.remote-dom`)
```typescript
createUIResource({
    uri: 'ui://form/1',
    content: { type: 'remoteDom', script: '/* JS that builds DOM */' },
    encoding: 'text'
});
```
- Script runs in Web Worker
- DOM changes serialized and rendered by host
- Enables native look-and-feel

### Bidirectional Communication

**From Iframe to Host:**
```typescript
type UIActionResult =
    | { type: 'tool'; payload: { toolName: string; params: object } }
    | { type: 'prompt'; payload: { prompt: string } }
    | { type: 'intent'; payload: { intent: string; params: object } }
    | { type: 'notify'; payload: { message: string } }
    | { type: 'link'; payload: { url: string } };
```

**Example - Iframe sends tool call:**
```javascript
window.parent.postMessage({
    type: 'tool',
    messageId: 'unique-id',
    payload: { toolName: 'refresh_data', params: {} }
}, '*');
```

**Host receives and responds:**
```typescript
const handleUIAction = async (action: UIActionResult) => {
    if (action.type === 'tool') {
        const result = await executeTool(action.payload.toolName, action.payload.params);
        return result;
    }
};
```

### Security Model

1. **Iframe Sandboxing**: `sandbox="allow-scripts"` (omit `allow-same-origin` for rawHtml)
2. **Origin Validation**: Always validate `event.origin` before processing messages
3. **CSP Headers**: Restrict content sources and execution
4. **User Consent**: Tool invocations require user approval
5. **Predeclared Templates**: Hosts can review HTML before rendering

---

## Implementation Plan

### Phase 1: Core Type Extensions

**Files to modify:**
- `packages/core/src/context/types.ts`
- `packages/core/src/context/utils.ts`
- `packages/server/src/hono/schemas/responses.ts`

**Add UIResourcePart type:**
```typescript
// packages/core/src/context/types.ts
export interface UIResourcePart {
    type: 'ui-resource';
    uri: string;                    // ui://component/instance
    mimeType: string;               // text/html, text/uri-list, etc.
    content?: string;               // Inline HTML or URL
    blob?: string;                  // Base64 content
    metadata?: {
        title?: string;
        preferredSize?: { width: number; height: number };
    };
}

// Update SanitizedToolResult
export interface SanitizedToolResult {
    content: Array<TextPart | ImagePart | FilePart | UIResourcePart>;
    // ... rest unchanged
}
```

**Add Zod schema:**
```typescript
// packages/server/src/hono/schemas/responses.ts
export const UIResourcePartSchema = z.object({
    type: z.literal('ui-resource'),
    uri: z.string().startsWith('ui://'),
    mimeType: z.string(),
    content: z.string().optional(),
    blob: z.string().optional(),
    metadata: z.object({
        title: z.string().optional(),
        preferredSize: z.object({
            width: z.number(),
            height: z.number(),
        }).optional(),
    }).optional(),
}).strict();
```

### Phase 2: MCP Client Detection

**Files to modify:**
- `packages/core/src/context/utils.ts`

**Detect UI resources in tool results:**
```typescript
// In normalizeToolResult()
function isUIResource(item: unknown): boolean {
    return (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'resource' &&
        'resource' in item &&
        typeof item.resource === 'object' &&
        item.resource !== null &&
        'uri' in item.resource &&
        typeof item.resource.uri === 'string' &&
        item.resource.uri.startsWith('ui://')
    );
}

// In sanitization pipeline, convert to UIResourcePart
if (isUIResource(part)) {
    return {
        type: 'ui-resource',
        uri: part.resource.uri,
        mimeType: part.resource.mimeType || 'text/html',
        content: part.resource.text,
        blob: part.resource.blob,
    };
}
```

### Phase 3: WebUI Integration

**Files to modify:**
- `packages/webui/components/hooks/useChat.ts`
- `packages/webui/components/hooks/useResourceContent.ts`
- `packages/webui/components/MessageList.tsx`

**New file:**
- `packages/webui/components/UIResourceRenderer.tsx`

#### 3.1 Add Dependencies

```bash
cd packages/webui
pnpm add @mcp-ui/client
```

#### 3.2 Add Type Guard (useChat.ts)

```typescript
export interface UIResourcePart {
    type: 'ui-resource';
    uri: string;
    mimeType: string;
    content?: string;
    blob?: string;
    metadata?: {
        title?: string;
        preferredSize?: { width: number; height: number };
    };
}

export function isUIResourcePart(part: unknown): part is UIResourcePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'ui-resource'
    );
}
```

#### 3.3 Create UIResourceRenderer Component

```typescript
// packages/webui/components/UIResourceRenderer.tsx
import React, { useCallback } from 'react';
import { UIResourceRenderer as MCPUIRenderer } from '@mcp-ui/client';
import type { UIActionResult } from '@mcp-ui/client';

interface UIResourceRendererProps {
    resource: {
        uri: string;
        mimeType: string;
        content?: string;
        blob?: string;
    };
    onToolCall?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
    onPrompt?: (prompt: string) => void;
    className?: string;
}

export function UIResourceRenderer({
    resource,
    onToolCall,
    onPrompt,
    className,
}: UIResourceRendererProps) {
    const handleUIAction = useCallback(async (action: UIActionResult) => {
        switch (action.type) {
            case 'tool':
                if (onToolCall) {
                    return await onToolCall(action.payload.toolName, action.payload.params);
                }
                break;
            case 'prompt':
                if (onPrompt) {
                    onPrompt(action.payload.prompt);
                }
                break;
            case 'notify':
                // Could show toast notification
                console.log('UI notification:', action.payload.message);
                break;
            case 'link':
                window.open(action.payload.url, '_blank', 'noopener');
                break;
        }
        return { status: 'handled' };
    }, [onToolCall, onPrompt]);

    // Convert our format to MCP-UI format
    const mcpResource = {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.content,
        blob: resource.blob,
    };

    return (
        <div className={className}>
            <MCPUIRenderer
                resource={mcpResource}
                onUIAction={handleUIAction}
                supportedContentTypes={['rawHtml', 'externalUrl']}
                htmlProps={{
                    autoResizeIframe: true,
                    style: {
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                    },
                }}
            />
        </div>
    );
}
```

#### 3.4 Integrate into MessageList.tsx

```typescript
// In tool result extraction (around line 486)
const toolResultUIResources: UIResourcePart[] = [];

// Add to extraction loop
if (isUIResourcePart(part)) {
    toolResultUIResources.push(part);
}

// Render UI resources as separate bubbles (after images/video/audio)
{toolResultUIResources.map((uiResource, index) => (
    <div key={`${msgKey}-ui-${index}`} className="w-full mt-2">
        <div className="flex items-end w-full justify-start">
            <LayoutIcon className="h-7 w-7 mr-2 mb-1 text-muted-foreground" />
            <div className="flex flex-col items-start max-w-[90%]">
                <div className="text-xs text-muted-foreground mb-1">
                    {uiResource.metadata?.title || 'Interactive UI'}
                </div>
                <UIResourceRenderer
                    resource={uiResource}
                    onToolCall={handleToolCall}
                    onPrompt={handlePrompt}
                    className="w-full"
                />
            </div>
        </div>
    </div>
))}
```

### Phase 4: GameBoy MCP Server Enhancement

**Files to modify:**
- `/Users/karaj/Projects/mcp-servers/src/gameboy/index.ts`
- `/Users/karaj/Projects/mcp-servers/src/gameboy/package.json`

#### 4.1 Add Streamable HTTP Transport

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'http';
import { createUIResource } from '@mcp-ui/server';

const PORT = process.env.MCP_PORT || 3002;

// Create HTTP server with multiple endpoints
const httpServer = http.createServer((req, res) => {
    if (req.url === '/stream') {
        // MJPEG stream endpoint
        serveMjpegStream(res);
    } else if (req.url?.startsWith('/mcp')) {
        // MCP protocol endpoint
        mcpTransport.handleRequest(req, res);
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// MJPEG streaming
function serveMjpegStream(res: http.ServerResponse) {
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    streamClients.add(res);
    res.on('close', () => streamClients.delete(res));
}

// Frame push interval
setInterval(() => {
    if (!emulator.isRomLoaded() || streamClients.size === 0) return;

    emulator.doFrame();
    const jpeg = emulator.getScreenAsJpeg(); // Need to implement

    for (const client of streamClients) {
        client.write(`--frame\r\nContent-Type: image/jpeg\r\n\r\n`);
        client.write(jpeg);
        client.write('\r\n');
    }
}, 66); // ~15 FPS
```

#### 4.2 Add UI Resource Tool

```typescript
{
    name: 'start_game_view',
    description: 'Start live game view with video stream',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        const streamUrl = `http://localhost:${PORT}/stream`;

        const uiResource = createUIResource({
            uri: 'ui://gameboy/live-view',
            content: {
                type: 'rawHtml',
                htmlString: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { margin: 0; background: #000; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                            img { max-width: 100%; height: auto; image-rendering: pixelated; }
                        </style>
                    </head>
                    <body>
                        <img src="${streamUrl}" alt="GameBoy Screen" />
                    </body>
                    </html>
                `,
            },
            encoding: 'text',
            metadata: {
                title: 'GameBoy Live View',
            },
            uiMetadata: {
                'preferred-frame-size': { width: 320, height: 288 },
            },
        });

        return { content: [uiResource] };
    },
}
```

#### 4.3 Update Gaming Agent Config

```yaml
# agents/gaming-agent/gaming-agent.yml
mcpServers:
  gameboy:
    type: http                    # Changed from stdio
    url: http://localhost:3002/mcp
    timeout: 60000
    connectionMode: strict
```

### Phase 5: Testing & Documentation

#### 5.1 Test Cases

1. **Unit Tests**
   - UI resource detection in sanitization
   - Type guard functions
   - Zod schema validation

2. **Integration Tests**
   - Tool result with UI resource flows through SSE
   - WebUI receives and renders UI resource
   - Bidirectional communication works

3. **E2E Tests**
   - Gaming agent with live stream
   - Tool calls from iframe to host
   - Security sandbox prevents escapes

#### 5.2 Documentation Updates

- Add MCP-UI guide to `/docs/docs/mcp/`
- Update agent configuration docs with `type: http`
- Add example MCP server with UI resources

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              Dexto WebUI                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ MessageList.tsx                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │ Tool Result Message                                              │ │  │
│  │  │  ├─ TextPart → MarkdownText                                     │ │  │
│  │  │  ├─ ImagePart → <img> (separate bubble)                         │ │  │
│  │  │  ├─ AudioPart → <audio> (separate bubble)                       │ │  │
│  │  │  ├─ FilePart → File badge                                       │ │  │
│  │  │  └─ UIResourcePart → UIResourceRenderer (NEW)                   │ │  │
│  │  │       └─ @mcp-ui/client UIResourceRenderer                      │ │  │
│  │  │           └─ <iframe sandbox> with HTML/URL content             │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    │ SSE: llm:tool-result                   │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ useChat.ts                                                            │  │
│  │  └─ processEvent() → updates message with SanitizedToolResult        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/SSE
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           Dexto Server (Hono)                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ /api/message-stream                                                   │  │
│  │  └─ Forwards events from agentBus → SSE                              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Event Bus
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           Dexto Core                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ LLM Service (anthropic.ts)                                            │  │
│  │  └─ Tool execution → sanitizeToolResult() → emit('llm:tool-result')  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Context Utils (utils.ts)                                              │  │
│  │  └─ sanitizeToolResult()                                             │  │
│  │       └─ normalizeToolResult() - detects UI resources (NEW)          │  │
│  │           └─ Returns UIResourcePart in content array                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ MCP Manager (manager.ts)                                              │  │
│  │  └─ executeTool() → MCPClient.callTool() → raw result                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ MCP Protocol (stdio/SSE/HTTP)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        MCP Server (e.g., GameBoy)                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ /mcp endpoint - MCP Streamable HTTP                                   │  │
│  │  └─ Tool: start_game_view → returns UIResource with embedded HTML    │  │
│  │  └─ Tool: press_a, press_b, etc. → returns ImageContent              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ /stream endpoint - MJPEG video stream                                 │  │
│  │  └─ Continuous frame push at ~15 FPS                                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Transport Requirement**: Should UI resources require HTTP transport, or can we support them over stdio too?
   - **Recommendation**: Support both. The UI resource itself is just data in the tool result. MJPEG streaming requires HTTP, but inline HTML works with any transport.

2. **Security Policy**: What CSP should we enforce?
   - **Recommendation**: Start strict (`sandbox="allow-scripts"`), relax as needed.

3. **Layout Options**: Inline in chat vs dedicated panel?
   - **Recommendation**: Start inline (like images), add panel option later for persistent UIs.

4. **Resource Lifecycle**: Persist across sessions?
   - **Recommendation**: Ephemeral by default, tied to message lifetime.

5. **Concurrent Resources**: Multiple UI resources at once?
   - **Recommendation**: Support multiple, render as separate bubbles.

---

## Timeline Estimate

| Phase | Scope | Dependencies |
|-------|-------|--------------|
| Phase 1 | Core type extensions | None |
| Phase 2 | MCP client detection | Phase 1 |
| Phase 3 | WebUI integration | Phase 1, Phase 2 |
| Phase 4 | GameBoy enhancement | Phase 1, 2, 3 |
| Phase 5 | Testing & docs | All phases |

---

## Resources

- [MCP-UI Official Site](https://mcpui.dev/)
- [MCP-UI GitHub](https://github.com/MCP-UI-Org/mcp-ui)
- [MCP Apps Extension Blog](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [Shopify MCP-UI Implementation](https://shopify.engineering/mcp-ui-breaking-the-text-wall)
- [MCP Streamable HTTP Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [@mcp-ui/server npm](https://www.npmjs.com/package/@mcp-ui/server)
- [@mcp-ui/client npm](https://www.npmjs.com/package/@mcp-ui/client)

---

## Key Files Reference

### Dexto Core
| File | Purpose |
|------|---------|
| `packages/core/src/mcp/mcp-client.ts` | MCP client with transport support |
| `packages/core/src/mcp/manager.ts` | Server lifecycle and tool execution |
| `packages/core/src/context/types.ts` | Content part types, SanitizedToolResult |
| `packages/core/src/context/utils.ts` | Sanitization pipeline |
| `packages/core/src/events/index.ts` | Event types and bus |

### Dexto Server
| File | Purpose |
|------|---------|
| `packages/server/src/hono/schemas/responses.ts` | API response schemas |
| `packages/server/src/events/a2a-sse-subscriber.ts` | Event forwarding |

### Dexto WebUI
| File | Purpose |
|------|---------|
| `packages/webui/components/MessageList.tsx` | Primary rendering |
| `packages/webui/components/hooks/useChat.ts` | State management |
| `packages/webui/components/hooks/useResourceContent.ts` | Resource fetching |

### GameBoy MCP Server
| File | Purpose |
|------|---------|
| `src/gameboy/index.ts` | Main server implementation |
| `src/gameboy/package.json` | Dependencies |

---

## Package-Level Analysis

### Architecture: Pass-Through Design

Dexto's architecture is designed for **pass-through of tool results**. Once `UIResourcePart` is added to core types, it automatically flows through all layers without additional changes.

```
Core (types) → Server (schemas) → SSE → Client SDK → WebUI
     ↓              ↓                      ↓           ↓
 UIResourcePart  Zod schema         (pass-through)  Render
```

### Changes Required Per Package

#### packages/core (REQUIRED)

**File: `src/context/types.ts`**
```typescript
// Add new type
export interface UIResourcePart {
    type: 'ui-resource';
    uri: string;                    // ui://component/instance
    mimeType: string;               // text/html, text/uri-list, etc.
    content?: string;               // Inline HTML or URL
    blob?: string;                  // Base64 content
    metadata?: {
        title?: string;
        preferredSize?: { width: number; height: number };
    };
}

// Update SanitizedToolResult
export interface SanitizedToolResult {
    content: Array<TextPart | ImagePart | FilePart | UIResourcePart>;  // Add UIResourcePart
    // ... rest unchanged
}
```

**File: `src/context/utils.ts`**
- Add detection logic for `ui://` URIs in `normalizeToolResult()`
- Convert MCP resources to `UIResourcePart` format

**File: `src/index.browser.ts`** (optional)
```typescript
// Consider exporting for browser consumers
export type { UIResourcePart } from './context/types.js';
```

#### packages/server (REQUIRED)

**File: `src/hono/schemas/responses.ts`**
```typescript
// Add schema
export const UIResourcePartSchema = z.object({
    type: z.literal('ui-resource'),
    uri: z.string().startsWith('ui://'),
    mimeType: z.string(),
    content: z.string().optional(),
    blob: z.string().optional(),
    metadata: z.object({
        title: z.string().optional(),
        preferredSize: z.object({
            width: z.number(),
            height: z.number(),
        }).optional(),
    }).optional(),
}).strict();

// Update ContentPartSchema
export const ContentPartSchema = z.discriminatedUnion('type', [
    TextPartSchema,
    ImagePartSchema,
    FilePartSchema,
    UIResourcePartSchema,  // Add
]);
```

**Other server files: NO CHANGES NEEDED**
- SSE routes pass events through unchanged
- A2A subscriber forwards full `sanitized` payload

#### packages/client-sdk (NO CHANGES NEEDED)

The client SDK already:
- Streams events unchanged via `createMessageStream()`
- Provides typed `StreamingEvent` that includes full `SanitizedToolResult`
- Automatically inherits new types from core via TypeScript

**Optional enhancement:**
```typescript
// src/index.ts - Re-export types for SDK consumers
export type { TextPart, ImagePart, FilePart, UIResourcePart } from '@dexto/core';
```

### Summary Table

| Package | Changes | Effort |
|---------|---------|--------|
| `packages/core` | Add `UIResourcePart` type, update union, add detection logic | Medium |
| `packages/server` | Add Zod schema, update `ContentPartSchema` | Low |
| `packages/client-sdk` | None required (optional: re-export types) | None |
| `packages/webui` | Add `UIResourceRenderer` component, integrate into `MessageList.tsx` | Medium |

### Event Flow Verification

The `llm:tool-result` event already carries full `SanitizedToolResult`:

```typescript
// packages/core/src/events/index.ts
'llm:tool-result': {
    toolName: string;
    callId?: string;
    success: boolean;
    sanitized: SanitizedToolResult;  // ← Includes content array with all part types
    rawResult?: unknown;
    sessionId: string;
};
```

This event is:
1. Emitted by LLM services (anthropic.ts, vercel.ts)
2. Forwarded by server SSE routes unchanged
3. Parsed by client SDK `createMessageStream()`
4. Consumed by WebUI `useChat.ts`

No changes needed in the event flow itself - only the type definitions and rendering.
