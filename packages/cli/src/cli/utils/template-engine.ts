/**
 * Template Engine for Dexto Project Scaffolding
 *
 * Provides code generation functions for various project types.
 * Uses the image/harness terminology strategy:
 * - "Image" for distributable artifacts, packages, composition
 * - "Harness" for runtime behavior, what it provides
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
 * Generates src/index.ts for an app using an image
 */
export function generateIndexForImage(context: TemplateContext): string {
    return `// Load image environment (Pattern 1: Static Import)
// This auto-registers providers as a side-effect
import '${context.imageName}';

// Import from core packages
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
    console.log('🚀 Starting ${context.projectName}\\n');

    // Load agent configuration
    const config = await loadAgentConfig('./agents/default.yml');

    // Create agent - providers already registered by image environment
    const agent = new DextoAgent(config, './agents/default.yml');

    await agent.start();
    console.log('✅ Agent started\\n');

    // Create a session
    const session = await agent.createSession();

    // Example interaction
    const response = await agent.run(
        'Hello! What can you help me with?',
        undefined, // imageDataInput
        undefined, // fileDataInput
        session.id // sessionId
    );

    console.log('Agent response:', response);

    // Cleanup
    await agent.stop();
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
`;
}

/**
 * Generates src/index.ts for a web server application using an image
 */
export function generateWebServerIndex(context: TemplateContext): string {
    return `// Load image environment (Pattern 1: Static Import)
// This auto-registers providers as a side-effect
import '${context.imageName}';

// Import from core packages
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';
import { startDextoServer } from '@dexto/server';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

async function main() {
    console.log('🚀 Starting ${context.projectName}\\n');

    // Load agent configuration
    console.log('📝 Loading configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded\\n');

    // Create agent
    console.log('🤖 Creating agent...');
    const agent = new DextoAgent(config, './agents/default.yml');
    console.log('✅ Agent created\\n');

    // Start the server
    console.log('🌐 Starting Dexto server...');

    const webRoot = resolve(process.cwd(), 'app');

    if (!existsSync(webRoot)) {
        console.error(\`❌ Error: Web root not found at \${webRoot}\`);
        console.error('   Make sure the app/ directory exists');
        process.exit(1);
    }

    console.log(\`📁 Serving static files from: \${webRoot}\`);

    const { stop } = await startDextoServer(agent, {
        port: 3000,
        webRoot,
        agentCard: {
            name: '${context.projectName}',
            description: '${context.description}',
        },
    });

    console.log('\\n✅ Server is running!\\n');
    console.log('🌐 Open your browser:');
    console.log('  http://localhost:3000\\n');
    console.log('📚 Available endpoints:');
    console.log('  • Web UI:        http://localhost:3000');
    console.log('  • REST API:      http://localhost:3000/api/*');
    console.log('  • Health Check:  http://localhost:3000/health');
    console.log('  • OpenAPI Spec:  http://localhost:3000/openapi.json');
    console.log('  • Agent Card:    http://localhost:3000/.well-known/agent-card.json\\n');

    console.log('Press Ctrl+C to stop the server...\\n');

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('\\n🛑 Shutting down...');
        await stop();
        console.log('✅ Server stopped\\n');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
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

    return `import { defineImage } from '@dexto/core';

export default defineImage({
    name: '${context.imageName || context.projectName}',
    version: '1.0.0',
    description: '${context.description}',
    target: '${context.target || 'local-development'}',
${extendsField}
    // Providers are AUTO-DISCOVERED from convention-based folders:
    //   tools/         - Custom tool providers
    //   blob-store/    - Blob storage providers
    //   compression/   - Compression strategy providers
    //   plugins/       - Plugin providers
    //
    // Each provider must export from an index.ts file in its folder.
    // The bundler will automatically register them when the image is imported.

    providers: {
        // Manual registration for built-in core providers
        // (These come from core, not from our providers/ folder)
        // TODO: This is a hack to get the local blob store provider to work. Should be auto-registered or dealt with in a better way.
        blobStore: {
            register: async () => {
                const { localBlobStoreProvider, inMemoryBlobStoreProvider } = await import(
                    '@dexto/core'
                );
                const { blobStoreRegistry } = await import('@dexto/core');

                blobStoreRegistry.register(localBlobStoreProvider);
                blobStoreRegistry.register(inMemoryBlobStoreProvider);

                console.log('✓ Registered core blob storage providers: local, in-memory');
            },
        },
    },

    defaults: {
        storage: {
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
        },
        logging: {
            level: 'info',
            fileLogging: true,
        },
    },

    constraints: ['filesystem-required', 'offline-capable'],
});
`;
}

/**
 * Generates dexto.config.ts file for manual registration projects
 */
export function generateDextoConfigFile(context: TemplateContext): string {
    return `/**
 * ${context.projectName} - Provider Registration
 *
 * This file registers all custom providers before agent initialization.
 * This is the manual registration approach - for most use cases, consider
 * using Dexto images instead (see: dexto create-image).
 */

import {
    blobStoreRegistry,
    customToolRegistry,
} from '@dexto/core';

/**
 * Project metadata
 */
export const projectConfig = {
    name: '${context.projectName}',
    version: '1.0.0',
    description: '${context.description}',
};

/**
 * Register all custom providers
 *
 * This function is called at application startup before loading agent configs.
 * Register your providers here by importing them and calling the appropriate
 * registry.register() method.
 */
export function registerProviders() {
    // Example: Register blob storage provider
    // import { myBlobProvider } from './storage/my-blob.js';
    // blobStoreRegistry.register(myBlobProvider);

    // Example: Register custom tool
    // import { myToolProvider } from './tools/my-tool.js';
    // customToolRegistry.register(myToolProvider);

    console.log(\`✓ Registered providers for \${projectConfig.name}\`);
}

/**
 * Optional: Project-wide initialization logic
 * Use this for setting up monitoring, analytics, error tracking, etc.
 */
export async function initialize() {
    console.log(\`✓ Initialized \${projectConfig.name} v\${projectConfig.version}\`);
}

/**
 * Optional: Cleanup logic
 * Called when the application shuts down
 */
export async function cleanup() {
    console.log(\`✓ Cleaned up \${projectConfig.name}\`);
}
`;
}

/**
 * Generates README.md for an image project
 */
export function generateImageReadme(context: TemplateContext): string {
    const imageName = context.imageName || context.projectName;
    const extendsNote = context.baseImage
        ? `\n\nThis image extends \`${context.baseImage}\`, inheriting its providers and adding custom ones.\n`
        : '';

    return `# ${imageName}

${context.description}${extendsNote}

## What is this?

A **Dexto image** - a pre-configured agent harness packaged as an npm module.
Install it, import it, and you have a complete runtime harness ready to use.

## What's Included

The harness provides:
- ✅ Pre-registered providers (auto-discovered from convention-based folders)
- ✅ Runtime orchestration
- ✅ Context management
- ✅ Default configurations

## Quick Start

\`\`\`bash
# Build the image
pnpm run build

# Use in your app
pnpm add ${imageName}
\`\`\`

## Usage

\`\`\`typescript
import { createAgent } from '${imageName}';
import { loadAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('./agents/default.yml');

// Import creates the harness (providers auto-registered)
const agent = createAgent(config);

// The harness handles everything
await agent.start();
\`\`\`

## Adding Providers

Add your custom providers to convention-based folders:
- \`tools/\` - Custom tool providers
- \`blob-store/\` - Blob storage providers
- \`compression/\` - Compression strategies
- \`plugins/\` - Plugin providers

**Convention:** Each provider lives in its own folder with an \`index.ts\` file.

Example:
\`\`\`
tools/
  my-tool/
    index.ts       # Provider implementation (auto-discovered)
    helpers.ts     # Optional helper functions
    types.ts       # Optional type definitions
\`\`\`

## Building

\`\`\`bash
pnpm run build
\`\`\`

This runs \`dexto-bundle build\` which:
1. Discovers providers from convention-based folders
2. Generates \`dist/index.js\` with side-effect registration
3. Exports \`createAgent()\` factory function

## Architecture

When imported, this image:
1. Auto-registers providers (side effect)
2. Exposes harness factory (\`createAgent\`)
3. Re-exports registries for runtime customization

The resulting harness manages your agent's runtime, including provider lifecycle,
context management, and tool orchestration.

## Publishing

\`\`\`bash
npm publish
\`\`\`

Users can then:
\`\`\`bash
pnpm add ${imageName}
\`\`\`

## Learn More

- [Dexto Images Guide](https://docs.dexto.ai/docs/guides/images)
- [Provider Development](https://docs.dexto.ai/docs/guides/providers)
- [Bundler Documentation](https://docs.dexto.ai/docs/tools/bundler)
`;
}

/**
 * Generates an example custom tool provider
 */
export function generateExampleTool(toolName: string = 'example-tool'): string {
    // Convert kebab-case to camelCase for provider name
    const providerName = toolName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return `import { z } from 'zod';
import type { CustomToolProvider, InternalTool, ToolCreationContext } from '@dexto/core';

const ConfigSchema = z
    .object({
        type: z.literal('${toolName}'),
        // Add your configuration options here
    })
    .strict();

type ${providerName.charAt(0).toUpperCase() + providerName.slice(1)}Config = z.output<typeof ConfigSchema>;

/**
 * Example custom tool provider
 *
 * This demonstrates how to create a custom tool that can be used by the agent.
 * The tool is auto-discovered by the bundler when placed in the tools/ folder.
 */
export const ${providerName}Provider: CustomToolProvider<'${toolName}', ${providerName.charAt(0).toUpperCase() + providerName.slice(1)}Config> = {
    type: '${toolName}',
    configSchema: ConfigSchema,

    create: (config: ${providerName.charAt(0).toUpperCase() + providerName.slice(1)}Config, context: ToolCreationContext): InternalTool[] => {
        // Create and return tools
        const tool: InternalTool = {
            id: '${providerName}',
            description: 'An example custom tool that demonstrates the tool provider pattern',
            inputSchema: z.object({
                input: z.string().describe('Input text to process'),
            }),

            execute: async (input: unknown) => {
                const { input: inputText } = input as { input: string };
                context.logger.info(\`Example tool called with: \${inputText}\`);

                // Your tool logic here
                return {
                    result: \`Processed: \${inputText}\`,
                };
            },
        };

        return [tool];
    },

    metadata: {
        displayName: 'Example Tool',
        description: 'Example custom tool provider',
        category: 'utilities',
    },
};
`;
}

/**
 * Generates README for an app project
 */
export function generateAppReadme(context: TemplateContext): string {
    const usingImage = context.imageName;
    const imageSection = usingImage
        ? `\n## Image

This app uses the \`${context.imageName}\` image, which provides a complete agent harness with:
- Pre-configured providers
- Runtime orchestration
- Context management

The harness is automatically initialized when you import the image.\n`
        : '';

    return `# ${context.projectName}

${context.description}${imageSection}

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
├── agents/
│   └── default.yml      # Agent configuration
├── .env                 # Environment variables (gitignored)
├── package.json
└── tsconfig.json
\`\`\`

## Configuration

Edit \`agents/default.yml\` to configure:
- System prompts
- LLM provider and model
- MCP servers
- Internal tools
- Custom tools

## Learn More

- [Dexto Documentation](https://docs.dexto.ai)
- [Agent Configuration Guide](https://docs.dexto.ai/docs/guides/configuration)
- [Using Images](https://docs.dexto.ai/docs/guides/images)
`;
}

/**
 * Generates auto-discovery script for from-core mode
 */
export function generateDiscoveryScript(): string {
    return `#!/usr/bin/env tsx
/**
 * Provider Auto-Discovery Script
 *
 * Scans conventional folders (tools/, blob-store/)
 * and generates src/providers.ts with import + registration statements.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

interface ProviderInfo {
    category: 'customTools' | 'blobStore';
    folderName: string;
    path: string;
    registryName: string;
}

const PROVIDER_CATEGORIES = [
    { folder: 'tools', category: 'customTools' as const, registry: 'customToolRegistry' },
    { folder: 'blob-store', category: 'blobStore' as const, registry: 'blobStoreRegistry' },
];

async function discoverProviders(): Promise<ProviderInfo[]> {
    const providers: ProviderInfo[] = [];

    for (const { folder, category, registry } of PROVIDER_CATEGORIES) {
        const folderPath = path.join(projectRoot, folder);

        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue;

                // Check if provider has index.ts
                const indexPath = path.join(folderPath, entry.name, 'index.ts');
                try {
                    await fs.access(indexPath);
                    providers.push({
                        category,
                        folderName: entry.name,
                        path: \`../\${folder}/\${entry.name}/index.js\`,
                        registryName: registry,
                    });
                } catch {
                    // No index.ts found, skip
                }
            }
        } catch {
            // Folder doesn't exist or can't be read, skip
        }
    }

    return providers;
}

function generateProvidersFile(providers: ProviderInfo[]): string {
    // Helper to convert kebab-case to camelCase for valid JS identifiers
    const toCamelCase = (str: string): string => {
        return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    };

    const imports: string[] = [];
    const registrations: string[] = [];
    const registries = new Set<string>();

    providers.forEach((provider, index) => {
        const varName = \`provider\${index}\`;
        const providerName = \`\${toCamelCase(provider.folderName)}Provider\`;
        imports.push(\`import { \${providerName} as \${varName} } from '\${provider.path}';\`);
        registrations.push(\`    \${provider.registryName}.register(\${varName});\`);
        registries.add(provider.registryName);
    });

    const registryImports = Array.from(registries).join(', ');

    return \`// AUTO-GENERATED - DO NOT EDIT
// This file is generated by scripts/discover-providers.ts
// Run 'pnpm run discover' to regenerate

import { \${registryImports} } from '@dexto/core';
\${imports.join('\\n')}

/**
 * Register all discovered providers
 * Called automatically when this module is imported
 */
export function registerProviders(): void {
\${registrations.join('\\n')}
}

// Auto-register on import
registerProviders();

console.log('✓ Registered \${providers.length} provider(s)');
\`;
}

function generateEntryPoint(): string {
    return \`// AUTO-GENERATED - DO NOT EDIT
// This file is the build entry point that wires everything together
// Run 'pnpm run discover' to regenerate

// Register providers first
import './_providers.js';

// Then run the user's app
import './index.js';
\`;
}

async function main() {
    console.log('🔍 Discovering providers...\\n');

    const providers = await discoverProviders();

    if (providers.length === 0) {
        console.log('⚠️  No providers found');
        console.log('   Add providers to: tools/, blob-store/, compression/, or plugins/\\n');
    } else {
        console.log(\`✅ Found \${providers.length} provider(s):\`);
        providers.forEach(p => {
            console.log(\`   • \${p.category}/\${p.folderName}\`);
        });
        console.log();
    }

    // Generate provider registrations
    const providersPath = path.join(projectRoot, 'src', '_providers.ts');
    const providersContent = generateProvidersFile(providers);
    await fs.writeFile(providersPath, providersContent, 'utf-8');
    console.log(\`📝 Generated: src/_providers.ts\`);

    // Generate build entry point
    const entryPath = path.join(projectRoot, 'src', '_entry.ts');
    const entryContent = generateEntryPoint();
    await fs.writeFile(entryPath, entryContent, 'utf-8');
    console.log(\`📝 Generated: src/_entry.ts\`);

    console.log();
}

main().catch(error => {
    console.error('❌ Discovery failed:', error);
    process.exit(1);
});
`;
}
