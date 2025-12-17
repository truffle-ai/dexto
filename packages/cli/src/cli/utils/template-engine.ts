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
    return `import { createAgent } from '${context.imageName}';
import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
    console.log('🚀 Starting ${context.projectName}\\n');

    // Load agent configuration
    const config = await loadAgentConfig('./agents/default.yml');

    // Create agent using the image harness
    // The image provides a complete harness with providers pre-configured
    const agent = createAgent(config, './agents/default.yml');

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
    compressionRegistry,
    pluginRegistry,
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

    // Example: Register plugin
    // import { myPluginProvider } from './plugins/my-plugin.js';
    // pluginRegistry.register(myPluginProvider);

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

- [Dexto Images Guide](https://docs.dexto.ai/guides/images)
- [Provider Development](https://docs.dexto.ai/guides/providers)
- [Bundler Documentation](https://docs.dexto.ai/tools/bundler)
`;
}

/**
 * Generates an example custom tool provider
 */
export function generateExampleTool(toolName: string = 'example-tool'): string {
    const providerName = toolName.replace(/-/g, '_');
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
- [Agent Configuration Guide](https://docs.dexto.ai/guides/configuration)
- [Using Images](https://docs.dexto.ai/guides/images)
`;
}
