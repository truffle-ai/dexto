/**
 * Template Engine for Dexto Project Scaffolding
 *
 * Provides code generation functions for various project types.
 *
 * Note: create-app/init-app scaffolds are programmatic (no YAML/images).
 * Image scaffolds are generated via `dexto create-image`.
 */

interface TemplateContext {
    projectName: string;
    packageName: string;
    description: string;
    imageName?: string;
    baseImage?: string;
    target?: string;
    llmProvider?: string;
    llmModel?: string;
    [key: string]: any;
}

/**
 * Generates src/index.ts for an app using programmatic configuration.
 */
export function generateIndexForCodeFirstDI(context: TemplateContext): string {
    const defaultProvider = context.llmProvider ?? 'openai';
    const defaultModel = context.llmModel ?? 'gpt-4o';
    return `// Standalone Dexto app (programmatic)
import 'dotenv/config';

import { DextoAgent, createLogger } from '@dexto/core';
import { MemoryBlobStore, MemoryCacheStore, MemoryDatabaseStore } from '@dexto/storage';

const agentId = '${context.projectName}';
const logger = createLogger({
    agentId,
    config: { level: 'info', transports: [{ type: 'console', colorize: true }] },
});

const agent = new DextoAgent({
    agentId,
    llm: { provider: '${defaultProvider}', model: '${defaultModel}' },
    systemPrompt: 'You are a helpful AI assistant.',
    logger,
    storage: {
        cache: new MemoryCacheStore(),
        database: new MemoryDatabaseStore(),
        blob: new MemoryBlobStore({}, logger),
    },
});

await agent.start();
const session = await agent.createSession();
console.log((await agent.generate('Hello! What can you do?', session.id)).content);
await agent.stop();
`;
}

/**
 * Generates src/index.ts for a web server application using programmatic configuration.
 */
export function generateWebServerIndexForCodeFirstDI(context: TemplateContext): string {
    const defaultProvider = context.llmProvider ?? 'openai';
    const defaultModel = context.llmModel ?? 'gpt-4o';
    return `// Dexto Web Server (programmatic)
import 'dotenv/config';

import { DextoAgent, createLogger } from '@dexto/core';
import { MemoryBlobStore, MemoryCacheStore, MemoryDatabaseStore } from '@dexto/storage';
import { startDextoServer } from '@dexto/server';
import { resolve } from 'node:path';

const agentId = '${context.projectName}';
const logger = createLogger({
    agentId,
    config: { level: 'info', transports: [{ type: 'console', colorize: true }] },
});

const agent = new DextoAgent({
    agentId,
    llm: { provider: '${defaultProvider}', model: '${defaultModel}' },
    systemPrompt: 'You are a helpful AI assistant.',
    logger,
    storage: {
        cache: new MemoryCacheStore(),
        database: new MemoryDatabaseStore(),
        blob: new MemoryBlobStore({}, logger),
    },
});

const { stop } = await startDextoServer(agent, {
    port: 3000,
    webRoot: resolve(process.cwd(), 'app'),
    agentCard: { name: '${context.projectName}', description: '${context.description}' },
});

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
`;
}

/**
 * Generates HTML for web app
 */
export function generateWebAppHTML(projectName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName}</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🤖 ${projectName}</h1>
            <p class="subtitle">AI-Powered Assistant</p>
            <div class="session-info">
                <span id="session-status">Initializing...</span>
            </div>
        </header>

        <div class="chat-container">
            <div id="messages" class="messages"></div>

            <div class="input-container">
                <input
                    type="text"
                    id="message-input"
                    placeholder="Type your message..."
                    disabled
                />
                <button id="send-button" disabled>Send</button>
            </div>
        </div>
    </div>

    <script src="/assets/main.js"></script>
</body>
</html>
`;
}

/**
 * Generates JavaScript for web app
 */
export function generateWebAppJS(): string {
    return `// Dexto Chat - Frontend
// Use relative URL so it works regardless of hostname/port
const API_BASE = '/api';

let sessionId = null;
let isProcessing = false;

// DOM elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const sessionStatus = document.getElementById('session-status');

// Initialize the app
async function init() {
    try {
        sessionStatus.textContent = 'Creating session...';

        // Create a new session
        const response = await fetch(\`\${API_BASE}/sessions\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(\`Failed to create session: \${response.statusText}\`);
        }

        const data = await response.json();
        sessionId = data.session.id;

        sessionStatus.textContent = \`Session: \${sessionId.substring(0, 12)}...\`;

        // Enable input
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();

        // Add welcome message
        addMessage('assistant', "Hello! I'm your Dexto assistant. How can I help you today?");
    } catch (error) {
        console.error('Initialization error:', error);
        const errorMsg = error.message || String(error);
        showError(\`Failed to initialize: \${errorMsg}\`);
        sessionStatus.textContent = \`Error: \${errorMsg}\`;

        // Log more details for debugging
        console.error('Full error details:', {
            error,
            apiBase: API_BASE,
            url: \`\${API_BASE}/sessions\`,
        });
    }
}

// Send a message to the agent
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isProcessing) return;

    // Add user message to UI
    addMessage('user', text);
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    isProcessing = true;

    // Add loading indicator
    const loadingId = addMessage('assistant', 'Thinking...', true);

    try {
        const response = await fetch(\`\${API_BASE}/message-sync\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: text,
                sessionId: sessionId,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || response.statusText);
        }

        const data = await response.json();

        // Remove loading indicator
        removeMessage(loadingId);

        // Add agent response
        addMessage('assistant', data.response);

        // Show token usage in console
        if (data.tokenUsage) {
            console.log('Token usage:', data.tokenUsage);
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeMessage(loadingId);
        showError(\`Failed to send message: \${error.message}\`);
    } finally {
        isProcessing = false;
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// Add a message to the chat UI
function addMessage(role, content, isLoading = false) {
    const messageId = \`msg-\${Date.now()}-\${Math.random()}\`;
    const messageEl = document.createElement('div');
    messageEl.className = \`message \${role}\`;
    messageEl.id = messageId;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const contentEl = document.createElement('div');
    contentEl.className = \`message-content \${isLoading ? 'loading' : ''}\`;
    contentEl.textContent = content;

    messageEl.appendChild(avatar);
    messageEl.appendChild(contentEl);

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageId;
}

// Remove a message from the UI
function removeMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

// Show an error message
function showError(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = \`Error: \${message}\`;
    messagesContainer.appendChild(errorEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Auto-remove after 5 seconds
    setTimeout(() => errorEl.remove(), 5000);
}

// Event listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);
`;
}

/**
 * Generates CSS for web app
 */
export function generateWebAppCSS(): string {
    return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.container {
    width: 100%;
    max-width: 800px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 90vh;
    max-height: 700px;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 24px;
    text-align: center;
}

header h1 {
    font-size: 28px;
    margin-bottom: 8px;
}

.subtitle {
    font-size: 14px;
    opacity: 0.9;
    margin-bottom: 12px;
}

.session-info {
    font-size: 12px;
    opacity: 0.8;
    font-family: 'Monaco', 'Courier New', monospace;
}

.chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.message {
    display: flex;
    gap: 12px;
    animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.message.user {
    flex-direction: row-reverse;
}

.message-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
}

.message.user .message-avatar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.message.assistant .message-avatar {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.message-content {
    max-width: 70%;
    padding: 12px 16px;
    border-radius: 12px;
    line-height: 1.5;
}

.message.user .message-content {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
    background: #f5f5f5;
    color: #333;
    border-bottom-left-radius: 4px;
}

.message-content.loading {
    font-style: italic;
    opacity: 0.7;
}

.input-container {
    display: flex;
    gap: 12px;
    padding: 20px 24px;
    border-top: 1px solid #e5e5e5;
    background: white;
}

#message-input {
    flex: 1;
    padding: 12px 16px;
    border: 2px solid #e5e5e5;
    border-radius: 24px;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s;
}

#message-input:focus {
    border-color: #667eea;
}

#message-input:disabled {
    background: #f5f5f5;
    cursor: not-allowed;
}

#send-button {
    padding: 12px 28px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 24px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s, opacity 0.2s;
}

#send-button:hover:not(:disabled) {
    transform: translateY(-2px);
}

#send-button:active:not(:disabled) {
    transform: translateY(0);
}

#send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.error-message {
    background: #fee;
    color: #c33;
    padding: 12px 16px;
    border-radius: 8px;
    margin: 16px 24px;
    border-left: 4px solid #c33;
}

/* Scrollbar styling */
.messages::-webkit-scrollbar {
    width: 8px;
}

.messages::-webkit-scrollbar-track {
    background: #f1f1f1;
}

.messages::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
}

.messages::-webkit-scrollbar-thumb:hover {
    background: #555;
}
`;
}

/**
 * Generates dexto.image.ts file for an image project
 */
export function generateDextoImageFile(context: TemplateContext): string {
    const extendsField = context.baseImage ? `    extends: '${context.baseImage}',\n` : '';
    const storageDefaults = context.baseImage
        ? `        storage: {
            blob: {
                type: 'local',
                storePath: './data/blobs',
            },
            database: {
                type: 'sqlite',
                path: './data/agent.db',
            },
            cache: {
                type: 'in-memory',
            },
        },`
        : `        storage: {
            blob: {
                type: 'example-blob',
            },
            database: {
                type: 'example-database',
            },
            cache: {
                type: 'example-cache',
            },
        },`;

    return `import type { ImageDefinition } from '@dexto/image-bundler';

const image = {
    name: '${context.imageName || context.projectName}',
    version: '1.0.0',
    description: '${context.description}',
    target: '${context.target || 'local-development'}',
${extendsField}
    // Factories are AUTO-DISCOVERED from convention-based folders:
    //   tools/<type>/index.ts
    //   storage/blob/<type>/index.ts
    //   storage/database/<type>/index.ts
    //   storage/cache/<type>/index.ts
    //   hooks/<type>/index.ts
    //   compaction/<type>/index.ts
    //
    // Each factory module must export a factory constant (export const factory = ...).

    defaults: {
${storageDefaults}
        logger: {
            level: 'info',
            transports: [{ type: 'console', colorize: true }],
        },
    },

    constraints: ['filesystem-required', 'offline-capable'],
} satisfies ImageDefinition;

export default image;
`;
}

/**
 * Generates README.md for an image project
 */
export function generateImageReadme(context: TemplateContext): string {
    const imageName = context.imageName || context.projectName;
    const extendsNote = context.baseImage
        ? `\n\nThis image extends \`${context.baseImage}\`, inheriting its factories and adding custom ones.\n`
        : '';

    return `# ${imageName}

${context.description}${extendsNote}

## What is this?

A **Dexto image** is a distributable npm module that exports a typed \`DextoImage\` (a plain object)
describing tool/storage/hook/compaction factories + optional default config.

## What's Included

This package contains:
- ✅ Factories (auto-discovered from convention-based folders)
- ✅ Optional defaults (\`image.defaults\`) that merge into agent config (config wins)

## Quick Start

\`\`\`bash
# Build the image
pnpm run build

# Install into the Dexto CLI (local)
npm pack
dexto image install ./<generated-file>.tgz
\`\`\`

## Usage

Set \`image: '${imageName}'\` in your agent config (or pass \`--image\` in the CLI), then run Dexto.

## Adding Factories

Add your custom factories to convention-based folders:
- \`tools/<type>/\` - Tool factories
- \`storage/blob/<type>/\` - Blob storage factories
- \`storage/database/<type>/\` - Database factories
- \`storage/cache/<type>/\` - Cache factories
- \`hooks/<type>/\` - Hook factories
- \`compaction/<type>/\` - Compaction factories

**Convention:** Each factory lives in its own folder with an \`index.ts\` file.
Each \`index.ts\` must export a \`factory\` constant (e.g. \`export const factory = myToolFactory;\`).

Example:
\`\`\`
tools/
  my-tool/
    index.ts       # Factory implementation (auto-discovered)
    helpers.ts     # Optional helper functions
    types.ts       # Optional type definitions
\`\`\`

## Building

\`\`\`bash
pnpm run build
\`\`\`

This runs \`dexto-bundle build\`, which:
1. Discovers factories from convention-based folders
2. Compiles factory source files to \`dist/\`
3. Generates \`dist/index.js\` exporting a \`DextoImage\` (no side effects)

## Publishing

\`\`\`bash
npm publish
\`\`\`

Users can then:
\`\`\`bash
dexto image install ${imageName}
\`\`\`
`;
}

/**
 * Generates an example custom tool factory
 */
export function generateExampleTool(toolName: string = 'example-tool'): string {
    // Convert kebab-case to camelCase for a readable type name base
    const typeNameBase = toolName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return `import { z } from 'zod';
import type { ToolFactory } from '@dexto/agent-config';
import type { Tool, ToolExecutionContext } from '@dexto/core';

const ConfigSchema = z
    .object({
        type: z.literal('${toolName}'),
        // Add your configuration options here
    })
    .strict();

type ${typeNameBase.charAt(0).toUpperCase() + typeNameBase.slice(1)}Config = z.output<typeof ConfigSchema>;

/**
 * Example tool factory
 *
 * This demonstrates how to create a tool factory that can be used by an image.
 * The bundler auto-discovers this module when placed in tools/<type>/index.ts.
 *
 * Contract: export a factory constant with { configSchema, create }.
 */
export const factory: ToolFactory<${typeNameBase.charAt(0).toUpperCase() + typeNameBase.slice(1)}Config> = {
    configSchema: ConfigSchema,
    metadata: {
        displayName: 'Example Tool',
        description: 'Example tool factory',
        category: 'utilities',
    },
    create: (_config) => {
        const tool: Tool = {
            id: '${toolName}',
            description: 'An example tool that demonstrates the tool factory pattern',
            inputSchema: z.object({
                input: z.string().describe('Input text to process'),
            }),
            execute: async (input: unknown, context: ToolExecutionContext) => {
                const { input: inputText } = input as { input: string };
                context.logger.info(\`Example tool called with: \${inputText}\`);

                return {
                    result: \`Processed: \${inputText}\`,
                };
            },
        };

        return [tool];
    },
};
`;
}

/**
 * Generates an example custom hook factory
 */
export function generateExampleHook(hookName: string = 'example-hook'): string {
    return `import { z } from 'zod';
import type { HookFactory } from '@dexto/agent-config';
import type { Hook } from '@dexto/core';

const ConfigSchema = z
    .object({
        type: z.literal('${hookName}'),
    })
    .strict();

type ExampleHookConfig = z.output<typeof ConfigSchema>;

/**
 * Example hook factory
 *
 * Hooks are resolved from image factories, same as tools.
 * The bundler auto-discovers this module when placed in hooks/<type>/index.ts.
 */
export const factory: HookFactory<ExampleHookConfig> = {
    configSchema: ConfigSchema,
    create: (_config) => {
        const hook: Hook = {
            beforeLLMRequest: async (payload, context) => {
                context.logger.info(\`${hookName} saw input: \${payload.text}\`);
                return { ok: true };
            },
        };

        return hook;
    },
};
`;
}

/**
 * Generates an example custom compaction factory
 */
export function generateExampleCompaction(compactionType: string = 'example-compaction'): string {
    return `import { z } from 'zod';
import type { CompactionFactory } from '@dexto/agent-config';
import type { CompactionStrategy } from '@dexto/core';

const ConfigSchema = z
    .object({
        type: z.literal('${compactionType}'),
        enabled: z.boolean().default(true),
        maxContextTokens: z.number().positive().optional(),
        thresholdPercent: z.number().min(0.1).max(1.0).default(0.9),
    })
    .strict();

type ExampleCompactionConfig = z.output<typeof ConfigSchema>;

/**
 * Example compaction factory
 *
 * Compaction is a DI surface. Agents select exactly one strategy via \`compaction.type\`.
 * The bundler auto-discovers this module when placed in compaction/<type>/index.ts.
 */
export const factory: CompactionFactory<ExampleCompactionConfig> = {
    configSchema: ConfigSchema,
    create: (config) => {
        const strategy: CompactionStrategy = {
            name: '${compactionType}',
            getSettings: () => ({
                enabled: config.enabled,
                maxContextTokens: config.maxContextTokens,
                thresholdPercent: config.thresholdPercent,
            }),
            getModelLimits: (modelContextWindow) => ({
                contextWindow: config.maxContextTokens
                    ? Math.min(modelContextWindow, config.maxContextTokens)
                    : modelContextWindow,
            }),
            shouldCompact: () => false,
            compact: async () => [],
        };

        return strategy;
    },
};
`;
}

/**
 * Generates an example in-memory cache factory
 */
export function generateExampleCacheFactory(cacheType: string = 'example-cache'): string {
    return `import { z } from 'zod';
import type { CacheFactory } from '@dexto/agent-config';
import { MemoryCacheStore } from '@dexto/storage';

const ConfigSchema = z
    .object({
        type: z.literal('${cacheType}'),
    })
    .strict();

type ExampleCacheConfig = z.output<typeof ConfigSchema>;

/**
 * Example cache factory
 *
 * Storage backends are resolved from image factories.
 * The bundler auto-discovers this module when placed in storage/cache/<type>/index.ts.
 */
export const factory: CacheFactory<ExampleCacheConfig> = {
    configSchema: ConfigSchema,
    create: (_config, _logger) => new MemoryCacheStore(),
};
`;
}

/**
 * Generates an example in-memory database factory
 */
export function generateExampleDatabaseFactory(databaseType: string = 'example-database'): string {
    return `import { z } from 'zod';
import type { DatabaseFactory } from '@dexto/agent-config';
import { MemoryDatabaseStore } from '@dexto/storage';

const ConfigSchema = z
    .object({
        type: z.literal('${databaseType}'),
    })
    .strict();

type ExampleDatabaseConfig = z.output<typeof ConfigSchema>;

/**
 * Example database factory
 *
 * Storage backends are resolved from image factories.
 * The bundler auto-discovers this module when placed in storage/database/<type>/index.ts.
 */
export const factory: DatabaseFactory<ExampleDatabaseConfig> = {
    configSchema: ConfigSchema,
    create: (_config, _logger) => new MemoryDatabaseStore(),
};
`;
}

/**
 * Generates an example in-memory blob store factory
 */
export function generateExampleBlobStoreFactory(blobType: string = 'example-blob'): string {
    return `import { z } from 'zod';
import type { BlobStoreFactory } from '@dexto/agent-config';
import { InMemoryBlobStoreSchema, MemoryBlobStore } from '@dexto/storage';

const ConfigSchema = InMemoryBlobStoreSchema.extend({
    type: z.literal('${blobType}'),
}).strict();

type ExampleBlobStoreConfig = z.output<typeof ConfigSchema>;

/**
 * Example blob store factory
 *
 * Blob stores are resolved from image factories.
 * The bundler auto-discovers this module when placed in storage/blob/<type>/index.ts.
 */
export const factory: BlobStoreFactory<ExampleBlobStoreConfig> = {
    configSchema: ConfigSchema,
    create: (config, logger) => {
        const { type: _type, ...options } = config;
        return new MemoryBlobStore(options, logger);
    },
};
`;
}

/**
 * Generates README for an app project
 */
export function generateAppReadme(context: TemplateContext): string {
    return `# ${context.projectName}

${context.description}

## Quick Start

\`\`\`bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Run
pnpm start
\`\`\`

## Project Structure

\`\`\`
${context.projectName}/
├── src/
│   └── index.ts         # Entry point
├── .env                 # Environment variables (gitignored)
├── package.json
└── tsconfig.json
\`\`\`

## Configuration

Edit \`src/index.ts\` to configure:
- System prompt
- LLM provider/model/API keys
- Storage backends
- Tools
- External tools via MCP (\`mcpServers\`)

By default this scaffold uses in-memory storage. To add persistence, swap in a file-backed
database and blob store (e.g. SQLite + local blobs).

## Learn More

- [Dexto Documentation](https://docs.dexto.ai)
- [Agent Configuration Guide](https://docs.dexto.ai/docs/guides/configuration)
`;
}
