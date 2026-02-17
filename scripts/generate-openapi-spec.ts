#!/usr/bin/env bun
/**
 * Syncs OpenAPI specification from Hono server routes to docs
 *
 * Usage:
 *   bun run sync-openapi-docs        # Update the docs file
 *   bun run sync-openapi-docs:check  # Verify docs are up-to-date (CI)
 *
 * This script creates a mock agent and Hono app instance to extract
 * the OpenAPI schema without needing a running server or real agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHECK_MODE = process.argv.includes('--check');
const OUTPUT_PATH = path.join(__dirname, '../docs/static/openapi/openapi.json');
const SERVER_DIST_PATH = path.join(__dirname, '../packages/server/dist/hono/index.js');

async function syncOpenAPISpec() {
    try {
        if (CHECK_MODE) {
            console.log('🔍 Checking if OpenAPI docs are up-to-date...\n');
        } else {
            console.log('📝 Syncing OpenAPI specification to docs...\n');
        }

        // Build server package if not built or check mode
        if (!fs.existsSync(SERVER_DIST_PATH)) {
            console.log('📦 Server package not built, building now...\n');
            try {
                execSync('bun run build:server', {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '..'),
                });
                console.log('✓ Server package built successfully\n');
            } catch (err) {
                throw new Error(
                    'Failed to build server package. Please fix build errors and try again.'
                );
            }
        }

        // Import server package
        let createDextoApp: any;
        try {
            const serverModule = await import(SERVER_DIST_PATH);
            createDextoApp = serverModule.createDextoApp;
            if (!createDextoApp) {
                throw new Error('createDextoApp not exported from server package');
            }
        } catch (err) {
            if (err instanceof Error && err.message.includes('Cannot find module')) {
                throw new Error('Failed to import server package. Run: bun run build:server');
            }
            throw err;
        }

        // Create mock event bus (WebhookSubscriber needs this)
        const mockEventBus = {
            on: () => {},
            off: () => {},
            emit: () => {},
            once: () => {},
            removeAllListeners: () => {},
        };

        // Create mock agent using Proxy - handles all method calls gracefully
        const mockAgent: any = new Proxy(
            { agentEventBus: mockEventBus },
            {
                get: (target, prop) => {
                    if (prop === 'agentEventBus') return mockEventBus;
                    if (prop === 'getCard') {
                        return () => ({
                            name: 'Dexto',
                            description: 'AI Agent Framework',
                            version: '1.0.0',
                        });
                    }
                    return () => Promise.resolve(null);
                },
            }
        );

        // Create mock agents context for agent management routes
        const mockAgentsContext = {
            switchAgentById: async (agentId: string) => ({ id: agentId, name: agentId }),
            switchAgentByPath: async (filePath: string) => ({
                id: 'custom',
                name: filePath,
            }),
            resolveAgentInfo: async (agentId: string) => ({ id: agentId, name: agentId }),
            ensureAgentAvailable: () => {},
            getActiveAgentId: () => 'default',
        };

        // Create Hono app with mock agent and agents context
        const app = createDextoApp({
            getAgent: () => mockAgent,
            getAgentCard: () => mockAgent.getCard(),
            agentsContext: mockAgentsContext,
        });

        // Fetch OpenAPI spec via app.fetch (no server needed!)
        const req = new globalThis.Request('http://localhost/openapi.json');
        const res = await app.fetch(req);

        if (!res.ok) {
            throw new Error(
                `OpenAPI endpoint returned ${res.status} ${res.statusText}\n` +
                    '  This indicates a problem with the Hono app configuration'
            );
        }

        // Parse JSON response
        let spec: any;
        try {
            spec = await res.json();
        } catch (err) {
            throw new Error(
                'OpenAPI endpoint returned invalid JSON\n' +
                    `  Response status: ${res.status}\n` +
                    `  Response type: ${res.headers.get('content-type')}`
            );
        }

        // Validate spec structure
        if (!spec || typeof spec !== 'object') {
            throw new Error('OpenAPI spec is not an object');
        }
        if (!spec.openapi) {
            throw new Error('OpenAPI spec missing "openapi" version field');
        }
        if (!spec.paths || typeof spec.paths !== 'object') {
            throw new Error('OpenAPI spec missing "paths" object');
        }

        const routeCount = Object.keys(spec.paths).length;
        const newContent = JSON.stringify(spec, null, 2) + '\n';

        console.log(`✓ Generated OpenAPI spec (${routeCount} routes)`);

        // Check mode: verify file is up-to-date
        if (CHECK_MODE) {
            if (!fs.existsSync(OUTPUT_PATH)) {
                console.error(`\n❌ OpenAPI docs file not found`);
                console.error(`   Expected: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
                console.error('   Run: bun run sync-openapi-docs\n');
                process.exit(1);
            }

            let existingContent: string;
            try {
                existingContent = fs.readFileSync(OUTPUT_PATH, 'utf-8');
            } catch (err) {
                throw new Error(
                    `Failed to read existing OpenAPI docs file\n` +
                        `  Path: ${OUTPUT_PATH}\n` +
                        `  Error: ${err instanceof Error ? err.message : String(err)}`
                );
            }

            if (existingContent !== newContent) {
                console.error('\n❌ OpenAPI docs are out of sync!');
                console.error(`   File: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
                console.error('   Run: bun run sync-openapi-docs\n');
                process.exit(1);
            }

            console.log('✅ OpenAPI docs are up-to-date!\n');
            process.exit(0);
        }

        // Sync mode: write the file
        const outputDir = path.dirname(OUTPUT_PATH);

        try {
            fs.mkdirSync(outputDir, { recursive: true });
        } catch (err) {
            throw new Error(
                `Failed to create output directory\n` +
                    `  Path: ${outputDir}\n` +
                    `  Error: ${err instanceof Error ? err.message : String(err)}`
            );
        }

        try {
            fs.writeFileSync(OUTPUT_PATH, newContent, 'utf-8');
        } catch (err) {
            throw new Error(
                `Failed to write OpenAPI docs file\n` +
                    `  Path: ${OUTPUT_PATH}\n` +
                    `  Error: ${err instanceof Error ? err.message : String(err)}`
            );
        }

        console.log(`✅ Synced to: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
        console.log(`   Routes: ${routeCount}`);
        console.log(`   Version: ${spec.openapi}\n`);

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Failed to sync OpenAPI docs\n');
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(String(error));
        }
        console.error('');
        process.exit(1);
    }
}

syncOpenAPISpec();
