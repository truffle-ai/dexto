import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    createLogger,
    DextoAgent,
    LoggerConfigSchema,
    type BlobData,
    type BlobInput,
    type BlobMetadata,
    type BlobReference,
    type BlobStats,
    type BlobStore,
    type Cache,
    type Database,
    type DextoAgentOptions,
    type StoredBlobMetadata,
    type Tool,
} from '@dexto/core';
import { builtinToolsFactory } from '@dexto/tools-builtins';
import { enrichAgentConfig } from './config-enrichment.js';
import { creatorToolsFactory } from '../tool-factories/creator-tools/factory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_SKILL_DIR = path.resolve(__dirname, '../../../../examples/skills/echo-custom-mcp');

class InMemoryCache implements Cache {
    private connected = false;
    private readonly entries = new Map<string, { value: unknown; expiresAt?: number }>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.entries.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async get<T>(key: string): Promise<T | undefined> {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }

        if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }

        return entry.value as T;
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined;
        this.entries.set(key, expiresAt === undefined ? { value } : { value, expiresAt });
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }
}

class InMemoryDatabase implements Database {
    private connected = false;
    private readonly entries = new Map<string, unknown>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.entries.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.entries.get(key) as T | undefined;
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.entries.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }

    async list(prefix: string): Promise<string[]> {
        return Array.from(this.entries.keys()).filter((key) => key.startsWith(prefix));
    }

    async append<T>(key: string, item: T): Promise<void> {
        const existing = this.entries.get(key);
        const next = Array.isArray(existing) ? [...existing, item] : [item];
        this.entries.set(key, next);
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        const existing = this.entries.get(key);
        if (!Array.isArray(existing)) {
            return [];
        }

        return (existing as T[]).slice(start, start + count);
    }
}

class InMemoryBlobStore implements BlobStore {
    private connected = false;
    private readonly blobs = new Map<string, { data: Buffer; metadata: StoredBlobMetadata }>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.blobs.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    async store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference> {
        const data = coerceBlobInputToBuffer(input);
        const id = randomUUID();
        const storedMetadata: StoredBlobMetadata = {
            id,
            mimeType: metadata?.mimeType ?? 'application/octet-stream',
            originalName: metadata?.originalName,
            createdAt: metadata?.createdAt ?? new Date(),
            size: data.length,
            hash: id,
            source: metadata?.source,
        };

        this.blobs.set(id, { data, metadata: storedMetadata });

        return {
            id,
            uri: `blob:${id}`,
            metadata: storedMetadata,
        };
    }

    async retrieve(
        reference: string,
        format: 'base64' | 'buffer' | 'path' | 'stream' | 'url' = 'buffer'
    ): Promise<BlobData> {
        const stored = this.blobs.get(normalizeBlobReference(reference));
        if (!stored) {
            throw new Error(`Blob not found: ${reference}`);
        }

        if (format === 'base64') {
            return {
                format,
                data: stored.data.toString('base64'),
                metadata: stored.metadata,
            };
        }

        if (format === 'buffer') {
            return {
                format,
                data: stored.data,
                metadata: stored.metadata,
            };
        }

        if (format === 'stream') {
            return {
                format,
                data: Readable.from(stored.data),
                metadata: stored.metadata,
            };
        }

        if (format === 'url') {
            return {
                format,
                data: `data:${stored.metadata.mimeType};base64,${stored.data.toString('base64')}`,
                metadata: stored.metadata,
            };
        }

        const blobPath = path.join(os.tmpdir(), `dexto-skill-blob-${stored.metadata.id}`);
        await fs.writeFile(blobPath, stored.data);
        return {
            format,
            data: blobPath,
            metadata: stored.metadata,
        };
    }

    async exists(reference: string): Promise<boolean> {
        return this.blobs.has(normalizeBlobReference(reference));
    }

    async delete(reference: string): Promise<void> {
        this.blobs.delete(normalizeBlobReference(reference));
    }

    async cleanup(olderThan?: Date): Promise<number> {
        if (!olderThan) {
            const count = this.blobs.size;
            this.blobs.clear();
            return count;
        }

        let deleted = 0;
        for (const [id, blob] of this.blobs.entries()) {
            if (blob.metadata.createdAt < olderThan) {
                this.blobs.delete(id);
                deleted += 1;
            }
        }

        return deleted;
    }

    async getStats(): Promise<BlobStats> {
        let totalSize = 0;
        for (const blob of this.blobs.values()) {
            totalSize += blob.data.length;
        }

        return {
            count: this.blobs.size,
            totalSize,
            backendType: 'in-memory',
            storePath: 'memory://',
        };
    }

    async listBlobs(): Promise<BlobReference[]> {
        return Array.from(this.blobs.values()).map((blob) => ({
            id: blob.metadata.id,
            uri: `blob:${blob.metadata.id}`,
            metadata: blob.metadata,
        }));
    }
}

function coerceBlobInputToBuffer(input: BlobInput): Buffer {
    if (Buffer.isBuffer(input)) {
        return input;
    }

    if (input instanceof Uint8Array) {
        return Buffer.from(input);
    }

    if (input instanceof ArrayBuffer) {
        return Buffer.from(input);
    }

    return Buffer.from(input);
}

function normalizeBlobReference(reference: string): string {
    return reference.startsWith('blob:') ? reference.slice('blob:'.length) : reference;
}

function createInMemoryStorage(): DextoAgentOptions['storage'] {
    return {
        blob: new InMemoryBlobStore(),
        database: new InMemoryDatabase(),
        cache: new InMemoryCache(),
    };
}

function createRuntimeAgentOptions(
    enriched: ReturnType<typeof enrichAgentConfig>,
    tools: Tool[]
): DextoAgentOptions {
    if (!enriched.agentId) {
        throw new Error('enrichAgentConfig() must produce an agentId for integration tests');
    }

    const logger = createLogger({
        config: LoggerConfigSchema.parse({
            level: 'error',
            transports: [{ type: 'silent' }],
        }),
        agentId: enriched.agentId,
    });

    return {
        agentId: enriched.agentId,
        systemPrompt: enriched.systemPrompt,
        llm: enriched.llm,
        agentCard: enriched.agentCard,
        greeting: enriched.greeting,
        telemetry: enriched.telemetry,
        memories: enriched.memories,
        mcpServers: enriched.mcpServers,
        sessions: enriched.sessions,
        permissions: enriched.permissions,
        elicitation: enriched.elicitation,
        resources: enriched.resources,
        prompts: enriched.prompts,
        logger,
        storage: createInMemoryStorage(),
        tools,
        hooks: [],
    };
}

describe('skill bundle integration', () => {
    let tempDir: string;
    let previousHome: string | undefined;
    let previousUserProfile: string | undefined;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-skill-bundle-'));
        previousHome = process.env.HOME;
        previousUserProfile = process.env.USERPROFILE;

        const isolatedHome = path.join(tempDir, 'home');
        await fs.mkdir(isolatedHome, { recursive: true });
        process.env.HOME = isolatedHome;
        process.env.USERPROFILE = isolatedHome;
    });

    afterEach(async () => {
        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }

        if (previousUserProfile === undefined) {
            delete process.env.USERPROFILE;
        } else {
            process.env.USERPROFILE = previousUserProfile;
        }

        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('discovers a standalone skill bundle, lazily connects its MCP server, and uses the MCP tool', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, 'skills', 'echo-custom-mcp');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.cp(SAMPLE_SKILL_DIR, skillDir, { recursive: true });
        await fs.writeFile(
            path.join(skillDir, 'mcps', 'echo.json'),
            JSON.stringify(
                {
                    mcpServers: {
                        skill_echo_demo: {
                            type: 'stdio',
                            command: 'node',
                            args: [path.join(SAMPLE_SKILL_DIR, 'scripts', 'echo-mcp-server.mjs')],
                        },
                    },
                },
                null,
                2
            ),
            'utf8'
        );

        const enriched = enrichAgentConfig(
            {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5-mini',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                permissions: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: false,
                    timeout: 120000,
                },
            },
            path.join(workspaceRoot, 'agents', 'skill-agent.yml'),
            {
                workspaceRoot,
            }
        );

        expect(enriched.prompts).toContainEqual({
            type: 'file',
            file: path.join(skillDir, 'SKILL.md'),
        });
        expect(enriched.mcpServers).toBeUndefined();

        const agent = new DextoAgent(
            createRuntimeAgentOptions(
                enriched,
                builtinToolsFactory.create({
                    type: 'builtin-tools',
                    enabledTools: ['invoke_skill'],
                })
            )
        );

        await agent.start();

        try {
            const toolsBefore = await agent.toolManager.getAllTools();
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();
            expect(
                Object.keys(toolsBefore).some((toolName) => toolName.includes('echo_message'))
            ).toBe(false);

            const session = await agent.createSession('skill-bundle-session');
            const invokeResult = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-1',
                { sessionId: session.id }
            );

            expect(invokeResult.result).toMatchObject({
                skill: 'config:echo-custom-mcp',
            });
            expect(
                (invokeResult.result as { content: string }).content.includes(
                    'bundled echo MCP tool'
                )
            ).toBe(true);
            expect(agent.getMcpServerStatus('skill_echo_demo')).toMatchObject({
                name: 'skill_echo_demo',
                status: 'connected',
                enabled: true,
            });

            const toolsAfter = await agent.toolManager.getAllTools();
            const echoToolName = Object.keys(toolsAfter).find((toolName) =>
                toolName.endsWith('echo_message')
            );

            expect(echoToolName).toBeDefined();

            const echoResult = await agent.toolManager.executeTool(
                echoToolName!,
                { message: 'dynamic skill wiring works' },
                'call-2',
                { sessionId: session.id }
            );

            expect(echoResult.result).toMatchObject({
                content: [
                    {
                        type: 'text',
                        text: 'Echo from skill MCP: dynamic skill wiring works',
                    },
                ],
            });
        } finally {
            await agent.stop();
        }
    }, 20000);

    it('refreshes a skill bundle so later mcps/ edits become usable without restarting the session', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, 'skills', 'echo-custom-mcp');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.cp(SAMPLE_SKILL_DIR, skillDir, { recursive: true });
        await fs.rm(path.join(skillDir, 'mcps', 'echo.json'));
        await fs.writeFile(
            path.join(skillDir, 'SKILL.md'),
            [
                '---',
                'name: "echo-custom-mcp"',
                'description: "Use the bundled echo MCP tool for quick MCP connectivity checks."',
                '---',
                '',
                '# Echo Custom MCP',
                '',
                '## Purpose',
                'This copy was loaded before bundled MCP config existed.',
            ].join('\n'),
            'utf8'
        );

        const enriched = enrichAgentConfig(
            {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5-mini',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                permissions: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: false,
                    timeout: 120000,
                },
            },
            path.join(workspaceRoot, 'agents', 'skill-agent.yml'),
            {
                workspaceRoot,
            }
        );

        const agent = new DextoAgent(
            createRuntimeAgentOptions(enriched, [
                ...builtinToolsFactory.create({
                    type: 'builtin-tools',
                    enabledTools: ['invoke_skill'],
                }),
                ...creatorToolsFactory.create({
                    type: 'creator-tools',
                    enabledTools: ['skill_refresh'],
                }),
            ])
        );

        await agent.start();

        try {
            const session = await agent.createSession('skill-refresh-session');

            const staleInvoke = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-stale',
                { sessionId: session.id }
            );

            expect(staleInvoke.result).toMatchObject({
                skill: 'config:echo-custom-mcp',
            });
            expect(
                (staleInvoke.result as { content: string }).content.includes(
                    'loaded before bundled MCP config existed'
                )
            ).toBe(true);
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();

            await fs.writeFile(
                path.join(skillDir, 'SKILL.md'),
                [
                    '---',
                    'name: "echo-custom-mcp"',
                    'description: "Use the bundled echo MCP tool for quick MCP connectivity checks."',
                    '---',
                    '',
                    '# Echo Custom MCP',
                    '',
                    '## Purpose',
                    'Verify that a skill bundle can carry its own MCP config and helper server implementation.',
                ].join('\n'),
                'utf8'
            );
            await fs.writeFile(
                path.join(skillDir, 'mcps', 'echo.json'),
                JSON.stringify(
                    {
                        mcpServers: {
                            skill_echo_demo: {
                                type: 'stdio',
                                command: 'node',
                                args: [
                                    path.join(SAMPLE_SKILL_DIR, 'scripts', 'echo-mcp-server.mjs'),
                                ],
                            },
                        },
                    },
                    null,
                    2
                ),
                'utf8'
            );

            const refreshResult = await agent.toolManager.executeTool(
                'skill_refresh',
                { id: 'echo-custom-mcp' },
                'call-refresh',
                { sessionId: session.id }
            );

            expect(refreshResult.result).toMatchObject({
                refreshed: true,
                id: 'echo-custom-mcp',
                bundledMcpServers: ['skill_echo_demo'],
            });

            const freshInvoke = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-fresh',
                { sessionId: session.id }
            );

            expect(
                (freshInvoke.result as { content: string }).content.includes(
                    'helper server implementation'
                )
            ).toBe(true);
            expect(agent.getMcpServerStatus('skill_echo_demo')).toMatchObject({
                name: 'skill_echo_demo',
                status: 'connected',
                enabled: true,
            });
        } finally {
            await agent.stop();
        }
    }, 20000);
});
