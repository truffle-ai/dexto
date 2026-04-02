#!/usr/bin/env tsx
/**
 * Syncs OpenAPI specification from Hono server routes to docs
 *
 * Usage:
 *   pnpm run sync-openapi-docs        # Update the docs file
 *   pnpm run sync-openapi-docs:check  # Verify docs are up-to-date (CI)
 *
 * This script creates a mock agent and Hono app instance to extract
 * the OpenAPI schema without needing a running server or real agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { CreateDextoAppOptions } from '../packages/server/src/hono/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHECK_MODE = process.argv.includes('--check');
const OUTPUT_PATH = path.join(__dirname, '../docs/static/openapi/openapi.json');
const SERVER_DIST_PATH = path.join(__dirname, '../packages/server/dist/hono/index.js');

const JSON_VALUE_DESCRIPTION = 'Any JSON-serializable value';
const JSON_OBJECT_DESCRIPTION = 'JSON object with arbitrary serializable values';

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type CreateDextoApp = typeof import('../packages/server/src/hono/index.js').createDextoApp;
type AgentInstance = Awaited<ReturnType<CreateDextoAppOptions['getAgent']>>;

const JsonValueOpenApiComponent = {
    anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'array', items: { $ref: '#/components/schemas/JsonValue' } },
        {
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/JsonValue' },
        },
    ],
    nullable: true,
    description: JSON_VALUE_DESCRIPTION,
} as const;

const JsonObjectOpenApiComponent = {
    type: 'object',
    description: JSON_OBJECT_DESCRIPTION,
    additionalProperties: { $ref: '#/components/schemas/JsonValue' },
} as const;

function isRecord(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValuePlaceholder(node: JsonValue): node is JsonObject {
    return isRecord(node) && node.description === JSON_VALUE_DESCRIPTION;
}

function isJsonObjectPlaceholder(node: JsonValue): node is JsonObject {
    return isRecord(node) && node.description === JSON_OBJECT_DESCRIPTION;
}

function rewriteJsonSchemaPlaceholders(node: JsonValue): JsonValue {
    if (Array.isArray(node)) {
        return node.map(rewriteJsonSchemaPlaceholders);
    }

    if (!isRecord(node)) {
        return node;
    }

    if (isJsonValuePlaceholder(node)) {
        return { $ref: '#/components/schemas/JsonValue' };
    }

    if (isJsonObjectPlaceholder(node)) {
        return { $ref: '#/components/schemas/JsonObject' };
    }

    const rewritten: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
        rewritten[key] = rewriteJsonSchemaPlaceholders(value);
    }
    return rewritten;
}

function applyJsonOpenApiComponents(spec: JsonValue): JsonValue {
    const rewrittenSpec = rewriteJsonSchemaPlaceholders(spec);
    if (!isRecord(rewrittenSpec)) {
        return rewrittenSpec;
    }

    const components = isRecord(rewrittenSpec.components) ? rewrittenSpec.components : {};
    const schemas = isRecord(components.schemas) ? components.schemas : {};

    rewrittenSpec.components = {
        ...components,
        schemas: {
            ...schemas,
            JsonValue: JsonValueOpenApiComponent,
            JsonObject: JsonObjectOpenApiComponent,
        },
    };

    return rewrittenSpec;
}

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
                execSync('pnpm --filter @dexto/server... build', {
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
        let createDextoApp: CreateDextoApp;
        try {
            const serverModule = await import(SERVER_DIST_PATH);
            createDextoApp = serverModule.createDextoApp;
            if (!createDextoApp) {
                throw new Error('createDextoApp not exported from server package');
            }
        } catch (err) {
            if (err instanceof Error && err.message.includes('Cannot find module')) {
                throw new Error('Failed to import server package. Run: pnpm run build:server');
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
        const mockAgentTarget = {
            agentEventBus: mockEventBus,
            getCard: () => ({
                name: 'Dexto',
                description: 'AI Agent Framework',
                version: '1.0.0',
            }),
        };
        const mockAgent = new Proxy(mockAgentTarget, {
            get: (_target, prop) => {
                if (prop === 'agentEventBus') return mockEventBus;
                if (prop === 'getCard') {
                    return mockAgentTarget.getCard;
                }
                return () => Promise.resolve(null);
            },
        }) as AgentInstance;

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
        let spec: JsonValue;
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

        spec = applyJsonOpenApiComponents(spec);

        const routeCount = Object.keys(spec.paths).length;
        const newContent = JSON.stringify(spec, null, 2) + '\n';

        console.log(`✓ Generated OpenAPI spec (${routeCount} routes)`);

        // Check mode: verify file is up-to-date
        if (CHECK_MODE) {
            if (!fs.existsSync(OUTPUT_PATH)) {
                console.error(`\n❌ OpenAPI docs file not found`);
                console.error(`   Expected: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
                console.error('   Run: pnpm run sync-openapi-docs\n');
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
                console.error('   Run: pnpm run sync-openapi-docs\n');
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
