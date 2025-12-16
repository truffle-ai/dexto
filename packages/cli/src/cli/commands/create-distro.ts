import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { executeWithTimeout } from '../utils/execute.js';
import * as p from '@clack/prompts';
import { getPackageManager, getPackageManagerInstallCommand } from '../utils/package-mgmt.js';

/**
 * Creates a Dexto distribution project with organized folder structure
 * for building custom distributions (storage providers, tools, agents)
 * @param name - The name of the distribution project
 * @returns The absolute path to the created project directory
 */
export async function createDistribution(name?: string): Promise<string> {
    // Basic regex: must start with a letter, contain only letters, numbers, hyphens or underscores
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9-_]*$/;

    let projectName: string;
    if (name) {
        // Validate provided project name
        if (!nameRegex.test(name)) {
            console.log(
                chalk.red(
                    'Invalid project name. Must start with a letter and contain only letters, numbers, hyphens or underscores.'
                )
            );
            process.exit(1);
        }
        projectName = name;
    } else {
        let input;
        do {
            input = await p.text({
                message: 'What do you want to name your Dexto distribution?',
                placeholder: 'my-dexto-distribution',
                defaultValue: 'my-dexto-distribution',
            });

            if (p.isCancel(input)) {
                p.cancel('Project creation cancelled');
                process.exit(0);
            }

            if (!nameRegex.test(input)) {
                console.log(
                    chalk.red(
                        'Invalid project name. Must start with a letter and contain only letters, numbers, hyphens or underscores.'
                    )
                );
            }
        } while (!nameRegex.test(input));
        projectName = input;
    }

    const spinner = p.spinner();
    const projectPath = path.resolve(process.cwd(), projectName);

    spinner.start(`Creating Dexto distribution in ${projectPath}...`);
    try {
        await fs.mkdir(projectPath);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            spinner.stop(
                `Directory "${projectName}" already exists. Please choose a different name or delete the existing directory.`
            );
            process.exit(1);
        } else {
            spinner.stop(`Failed to create project: ${error}`);
            throw error;
        }
    }

    // Move to the new project directory
    process.chdir(projectPath);

    // Create directory structure
    await fs.mkdir('src');
    await fs.mkdir('agents');
    await fs.mkdir('storage');
    await fs.mkdir('tools');
    await fs.mkdir('shared');

    // Create placeholder files to keep directories in git
    await fs.writeFile('storage/.gitkeep', '');
    await fs.writeFile('tools/.gitkeep', '');

    // Create dexto.config.ts
    const dextoConfig = `/**
 * Dexto Distribution Configuration
 *
 * This file registers all custom providers before agent initialization.
 * Add your custom storage providers, tools, and other extensions here.
 */

import { blobStoreRegistry, customToolRegistry } from '@dexto/core';

/**
 * Project metadata
 */
export const projectConfig = {
    name: '${projectName}',
    version: '1.0.0',
    description: 'Custom Dexto distribution',
};

/**
 * Register all custom providers
 * This function is called at application startup (before loading agent configs)
 */
export function registerProviders() {
    // Register your blob storage providers here
    // Example: blobStoreRegistry.register(myStorageProvider);

    // Register your custom tool providers here
    // Example: customToolRegistry.register(myToolProvider);

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
 */
export async function cleanup() {
    console.log(\`✓ Cleaned up \${projectConfig.name}\`);
}
`;
    await fs.writeFile('dexto.config.ts', dextoConfig);

    // Create src/index.ts
    const srcIndex = `#!/usr/bin/env node
/**
 * ${projectName} - Entry Point
 *
 * This demonstrates how to build a complete Dexto distribution with custom providers.
 */

import { DextoAgent } from '@dexto/core';
import { registerProviders, initialize, cleanup, projectConfig } from '../dexto.config.js';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
    console.log(\`🚀 Starting \${projectConfig.name} v\${projectConfig.version}\\n\`);
    console.log(\`\${projectConfig.description}\\n\`);

    try {
        // Step 1: Initialize the distribution
        await initialize();

        // Step 2: Register all custom providers
        registerProviders();
        console.log();

        // Step 3: Load agent configuration from YAML
        const agentPath = process.argv[2] || join(__dirname, '../agents/default.yml');
        console.log(\`📋 Loading agent configuration: \${agentPath}\`);

        const configYaml = readFileSync(agentPath, 'utf-8');
        const config = parse(configYaml);

        // Step 4: Create the agent
        console.log(\`🤖 Creating agent with \${config.llm?.provider}/\${config.llm?.model}...\`);
        const agent = new DextoAgent(config);

        // Step 5: Start the agent
        await agent.start();
        console.log(\`✓ Agent started successfully\\n\`);

        // Step 6: Run a sample interaction
        const message = process.argv[3] || 'Hello! How can you help me?';
        console.log(\`💬 User: \${message}\\n\`);

        const response = await agent.run(message, undefined, undefined, 'example-session');
        console.log(\`🤖 Agent: \${response}\\n\`);

        // Step 7: Cleanup
        await agent.stop();
        await cleanup();

        console.log(\`\\n✓ \${projectConfig.name} completed successfully\`);
    } catch (error) {
        console.error('\\n❌ Error:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.url === \`file://\${process.argv[1]}\`) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
`;
    await fs.writeFile('src/index.ts', srcIndex);

    // Create agents/default.yml
    const defaultAgent = `# Default Agent Configuration
# This is a basic agent configuration. Customize it for your needs.

systemPrompt:
  contributors:
    - id: primary
      type: static
      content: You are a helpful AI assistant.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514
  apiKey: $ANTHROPIC_API_KEY

storage:
  cache:
    type: in-memory
  database:
    type: sqlite
  blob:
    type: local  # Change to your custom storage provider

internalTools:
  - read_file
  - write_file

# Add your custom tools here
customTools: []
`;
    await fs.writeFile('agents/default.yml', defaultAgent);

    // Create shared/utils.ts
    const sharedUtils = `/**
 * Shared utility functions
 */

export function formatDate(date: Date, timezone: string = 'UTC'): string {
    return date.toLocaleString('en-US', { timeZone: timezone });
}

export function validateEnv(requiredVars: string[]): void {
    const missing = requiredVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0) {
        throw new Error(
            \`Missing required environment variables: \${missing.join(', ')}\\n\` +
            \`Please check your .env file or environment configuration.\`
        );
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
    await fs.writeFile('shared/utils.ts', sharedUtils);

    // Create shared/constants.ts
    const sharedConstants = `/**
 * Project-wide constants
 */

export const PROJECT = {
    NAME: '${projectName}',
    VERSION: '1.0.0',
} as const;
`;
    await fs.writeFile('shared/constants.ts', sharedConstants);

    // Create .env.example
    const envExample = `# API Keys
ANTHROPIC_API_KEY=sk-ant-...

# Add your custom provider configuration here
`;
    await fs.writeFile('.env.example', envExample);

    // Create .gitignore
    await fs.writeFile('.gitignore', 'node_modules\n.env\ndist\n.dexto\n*.log\n');

    // Create README.md
    const readme = `# ${projectName}

> A custom Dexto distribution

## Quick Start

\`\`\`bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run
pnpm start
\`\`\`

## Project Structure

\`\`\`
${projectName}/
├── src/index.ts          # Entry point
├── dexto.config.ts       # Provider registration
├── agents/               # Agent configurations (YAML)
│   └── default.yml
├── storage/              # Custom storage providers
├── tools/                # Custom tools
└── shared/               # Shared utilities
\`\`\`

## Adding Custom Providers

### Add a Storage Provider

1. Create \`storage/my-storage.ts\`
2. Implement the \`BlobStoreProvider\` interface
3. Register in \`dexto.config.ts\`:

\`\`\`typescript
import { myStorageProvider } from './storage/my-storage.js';

export function registerProviders() {
    blobStoreRegistry.register(myStorageProvider);
}
\`\`\`

### Add a Custom Tool

1. Create \`tools/my-tool.ts\`
2. Implement the \`CustomToolProvider\` interface
3. Register in \`dexto.config.ts\`:

\`\`\`typescript
import { myToolProvider } from './tools/my-tool.js';

export function registerProviders() {
    customToolRegistry.register(myToolProvider);
}
\`\`\`

## Adding Agents

Create new YAML files in \`agents/\` (no rebuild needed):

\`\`\`yaml
# agents/code-reviewer.yml
systemPrompt:
  contributors:
    - id: primary
      type: static
      content: You are a code review expert...

llm:
  provider: anthropic
  model: claude-opus-4-5-20251101
\`\`\`

Run with:
\`\`\`bash
pnpm start agents/code-reviewer.yml
\`\`\`

## Learn More

- [Dexto Documentation](https://docs.dexto.ai)
- [Examples](https://github.com/anthropics/dexto/tree/main/examples)
`;
    await fs.writeFile('README.md', readme);

    // Detect package manager
    const packageManager = getPackageManager();

    // Initialize package.json with detected package manager
    if (packageManager === 'pnpm') {
        await executeWithTimeout('pnpm', ['init'], { cwd: projectPath });
    } else if (packageManager === 'yarn') {
        await executeWithTimeout('yarn', ['init', '-y'], { cwd: projectPath });
    } else {
        await executeWithTimeout('npm', ['init', '-y'], { cwd: projectPath });
    }

    // Update package.json with proper configuration
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    packageJson.name = projectName;
    packageJson.version = '1.0.0';
    packageJson.description = 'Custom Dexto distribution';
    packageJson.type = 'module';
    packageJson.bin = {
        [projectName]: './dist/src/index.js',
    };
    packageJson.scripts = {
        build: 'tsc',
        dev: 'tsc --watch',
        typecheck: 'tsc --noEmit',
        start: 'node dist/src/index.js',
        'start:dev': 'tsc && node dist/src/index.js',
        clean: 'rm -rf dist',
    };
    packageJson.keywords = ['dexto', 'distribution', 'ai-agent'];
    await fs.writeFile('package.json', JSON.stringify(packageJson, null, 2));

    // Create tsconfig.json
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            lib: ['ES2022'],
            moduleResolution: 'bundler',
            outDir: './dist',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            allowSyntheticDefaultImports: true,
            types: ['node'],
        },
        include: ['src/**/*', 'storage/**/*', 'tools/**/*', 'shared/**/*', 'dexto.config.ts'],
        exclude: ['node_modules', 'dist'],
    };
    await fs.writeJSON('tsconfig.json', tsconfig, { spaces: 2 });

    // Initialize git repository
    await executeWithTimeout('git', ['init'], { cwd: projectPath });

    spinner.stop('Project structure created successfully!');

    spinner.start('Installing dependencies...');
    const installCommand = getPackageManagerInstallCommand(packageManager);

    // Install core dependencies
    await executeWithTimeout(packageManager, [installCommand, '@dexto/core', 'yaml', 'zod'], {
        cwd: projectPath,
    });

    // Install dev dependencies
    await executeWithTimeout(
        packageManager,
        [installCommand, 'typescript', '@types/node', '--save-dev'],
        { cwd: projectPath }
    );

    spinner.stop('Dependencies installed!');

    return projectPath;
}

/** Shows next steps for the created distribution */
export async function postCreateDistro(projectName: string) {
    const nextSteps = [
        `1. Go to the project directory: ${chalk.cyan(`cd ${projectName}`)}`,
        `2. Set up environment variables: ${chalk.cyan('cp .env.example .env')}`,
        `3. Add your API keys to ${chalk.cyan('.env')}`,
        `4. Build the project: ${chalk.cyan('pnpm run build')}`,
        `5. Run the default agent: ${chalk.cyan('pnpm start')}`,
        `6. Add custom storage providers in ${chalk.cyan('storage/')}`,
        `7. Add custom tools in ${chalk.cyan('tools/')}`,
        `8. Create new agents in ${chalk.cyan('agents/')} (no rebuild needed)`,
        `9. Learn more: ${chalk.cyan('https://docs.dexto.ai')}`,
    ].join('\n');
    p.note(nextSteps, chalk.yellow('Next steps:'));
}
