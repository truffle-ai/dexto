import { AgentEventBus, createLogger, WorkspaceManager } from '@dexto/core';
import { InMemoryDextoStores } from '@dexto/core/storage';
import type { ToolExecutionContext, ToolServices } from '@dexto/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createBlockedPathCheck } from './blocked-path-check.js';
import { createEditFileTool } from './edit-file-tool.js';
import { createGrepContentTool } from './grep-content-tool.js';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';

const blockedPathCheck = createBlockedPathCheck({
    allowedPaths: ['.'],
    blockedPaths: ['.git', '.env'],
    blockedExtensions: ['.so'],
    maxFileSize: 1024,
    enableBackups: false,
    backupRetentionDays: 7,
});

async function createContext(files: Map<string, string>): Promise<ToolExecutionContext> {
    const stores = new InMemoryDextoStores();
    await stores.connect();
    const logger = createLogger({
        agentId: 'test-agent',
        config: { level: 'error', transports: [{ type: 'silent' }] },
    });
    const workspaceManager = new WorkspaceManager(
        stores.getStore('workspaces'),
        new AgentEventBus(),
        logger,
        {
            open: vi.fn(async ({ context }) => ({
                context,
                capabilities: ['files' as const],
                files: {
                    readFile: async (file: string) => files.get(file) ?? '',
                    readText: async (file: string) => files.get(file) ?? '',
                    glob: async () => [...files.keys()],
                    writeFile: async (file: string, content: string) => {
                        files.set(file, content);
                    },
                    listFiles: async () => [...files.keys()],
                },
            })),
        }
    );
    await workspaceManager.setWorkspace({ path: '/repo' });
    return {
        logger,
        services: {
            approval: {} as ToolServices['approval'],
            search: {} as ToolServices['search'],
            resources: {} as ToolServices['resources'],
            prompts: {} as ToolServices['prompts'],
            skills: {} as ToolServices['skills'],
            mcp: {} as ToolServices['mcp'],
            taskForker: null,
            workspaceManager,
        },
    };
}

describe('blocked paths in file tools', () => {
    it('reports a blocked path and an allowed one', async () => {
        const logger = (await createContext(new Map())).logger;
        expect(await blockedPathCheck('/repo', '.env', logger)).not.toBeNull();
        expect(await blockedPathCheck('/repo', '.git/hooks/pre-commit', logger)).not.toBeNull();
        expect(await blockedPathCheck('/repo', 'lib/native.so', logger)).not.toBeNull();
        expect(await blockedPathCheck('/repo', 'src/index.ts', logger)).toBeNull();
    });

    it('read_file refuses a blocked file', async () => {
        const context = await createContext(new Map([['.env', 'SECRET=1']]));
        const tool = createReadFileTool(vi.fn(), blockedPathCheck);
        await expect(tool.execute({ file_path: '.env' }, context)).rejects.toThrow(/blocked/);
    });

    it('write_file and edit_file refuse a blocked file', async () => {
        const files = new Map([['.git/config', 'x']]);
        const context = await createContext(files);
        const write = createWriteFileTool(vi.fn(), blockedPathCheck);
        const edit = createEditFileTool(vi.fn(), blockedPathCheck);
        await expect(
            write.execute({ file_path: '.git/config', content: 'y', encoding: 'utf-8' }, context)
        ).rejects.toThrow(/blocked/);
        await expect(
            edit.execute(
                {
                    file_path: '.git/config',
                    old_string: 'x',
                    new_string: 'y',
                    replace_all: false,
                },
                context
            )
        ).rejects.toThrow(/blocked/);
        expect(files.get('.git/config')).toBe('x');
    });

    it('grep_content skips blocked files', async () => {
        const context = await createContext(
            new Map([
                ['.env', 'API_KEY=hidden'],
                ['src/a.ts', 'API_KEY=visible'],
            ])
        );
        const tool = createGrepContentTool(vi.fn(), blockedPathCheck);
        const result = JSON.stringify(
            await tool.execute(
                {
                    pattern: 'API_KEY',
                    glob: '**/*',
                    context_lines: 0,
                    case_insensitive: false,
                    max_results: 10,
                },
                context
            )
        );
        expect(result).toContain('visible');
        expect(result).not.toContain('hidden');
    });
});
