import { AgentEventBus, createLogger, ToolErrorCode, WorkspaceManager } from '@dexto/core';
import { InMemoryDextoStores } from '@dexto/core/storage';
import type { ToolExecutionContext, ToolServices } from '@dexto/core/tools';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createReadFileTool } from './read-file-tool.js';

async function createContext(
    content: string,
    readText = vi.fn(async () => content)
): Promise<ToolExecutionContext> {
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
                    readFile: vi.fn(async () => content),
                    readText,
                    glob: vi.fn(async () => []),
                    writeFile: vi.fn(async () => undefined),
                    listFiles: vi.fn(async () => []),
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

describe('read_file tool', () => {
    it('reads text through WorkspaceManager.open', async () => {
        const getFileSystemService = vi.fn(async () => {
            throw new Error('read_file execute must not use FileSystemService');
        });
        const tool = createReadFileTool(getFileSystemService);

        const result = await tool.execute({ file_path: 'local.txt' }, await createContext('alpha'));

        expect(getFileSystemService).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            content: 'alpha',
            lines: 1,
            encoding: 'utf-8',
            truncated: false,
            size: Buffer.byteLength('alpha', 'utf-8'),
        });
    });

    it('applies pagination after workspace reads', async () => {
        const tool = createReadFileTool(vi.fn());

        const result = await tool.execute(
            { file_path: 'local.txt', offset: 2, limit: 2 },
            await createContext('one\ntwo\nthree\nfour')
        );

        expect(result).toMatchObject({
            content: 'two\nthree',
            lines: 2,
            encoding: 'utf-8',
            truncated: true,
            size: Buffer.byteLength('two\nthree', 'utf-8'),
        });
    });

    it('normalizes workspace-contained absolute paths before reading', async () => {
        const readText = vi.fn(async () => 'alpha');
        const tool = createReadFileTool(vi.fn());

        await tool.execute(
            { file_path: path.join('/repo', 'local.txt') },
            await createContext('alpha', readText)
        );

        expect(readText).toHaveBeenCalledWith('local.txt');
    });

    it('rejects external absolute paths before file provider calls', async () => {
        const readText = vi.fn(async () => 'alpha');
        const tool = createReadFileTool(vi.fn());

        await expect(
            tool.execute(
                { file_path: '/outside/local.txt' },
                await createContext('alpha', readText)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(readText).not.toHaveBeenCalled();
    });
});
