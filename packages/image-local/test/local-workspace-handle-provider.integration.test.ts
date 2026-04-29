import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentEventBus, createLogger, WorkspaceManager, WorkspaceSkillSource } from '@dexto/core';
import { InMemoryDextoStores } from '@dexto/core/storage';
import type { WorkspaceContext } from '@dexto/core/workspace';
import { LocalWorkspaceHandleProvider } from '../src/local-workspace-handle-provider.js';

describe('LocalWorkspaceHandleProvider', () => {
    let workspaceRoot: string;

    beforeEach(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dexto-workspace-'));
    });

    afterEach(async () => {
        await rm(workspaceRoot, { force: true, recursive: true });
    });

    function context(): WorkspaceContext {
        return {
            id: 'workspace-id',
            path: workspaceRoot,
            createdAt: 1,
            lastActiveAt: 1,
        };
    }

    it('reads and globs files from the local workspace root', async () => {
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'local');
        await mkdir(skillDir, { recursive: true });
        await writeFile(path.join(skillDir, 'SKILL.md'), '# Local Skill\n', 'utf-8');
        await writeFile(path.join(skillDir, 'notes.md'), 'Use the local workspace.\n', 'utf-8');
        await mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
        await writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf-8');
        await writeFile(
            path.join(workspaceRoot, 'src', 'nested', 'component.test.ts'),
            'test();\n',
            'utf-8'
        );

        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({
            context: context(),
            input: { intent: 'read' },
        });

        expect('root' in handle.context).toBe(false);
        await expect(handle.files.glob('.agents/skills/*/SKILL.md')).resolves.toEqual([
            '.agents/skills/local/SKILL.md',
        ]);
        await expect(handle.files.glob('src/**/*.ts')).resolves.toEqual([
            'src/index.ts',
            'src/nested/component.test.ts',
        ]);
        await expect(handle.files.glob('src/**/*.test.ts')).resolves.toEqual([
            'src/nested/component.test.ts',
        ]);
        await expect(handle.files.readText('.agents/skills/local/SKILL.md')).resolves.toBe(
            '# Local Skill\n'
        );
        await expect(handle.files.readText(path.join(skillDir, 'notes.md'))).resolves.toBe(
            'Use the local workspace.\n'
        );
    });

    it('honors createDirs when writing files', async () => {
        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({
            context: context(),
            input: { intent: 'write' },
        });

        await expect(handle.files.writeFile('missing/file.txt', 'nope')).rejects.toMatchObject({
            code: 'workspace/file_not_found',
        });
        await expect(
            handle.files.writeFile('created/file.txt', 'created', { createDirs: true })
        ).resolves.toBeUndefined();
        await expect(handle.files.readText('created/file.txt')).resolves.toBe('created');
    });

    it('rejects reads outside the workspace root', async () => {
        const outsideFile = path.join(os.tmpdir(), `dexto-outside-${Date.now()}.txt`);
        await writeFile(outsideFile, 'outside', 'utf-8');
        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({ context: context() });

        await expect(handle.files.readText('../outside.txt')).rejects.toThrow(
            'Workspace path escapes root'
        );
        await expect(handle.files.readText(outsideFile)).rejects.toThrow(
            'Workspace path escapes root'
        );

        await rm(outsideFile, { force: true });
    });

    it('lets WorkspaceSkillSource discover skills through WorkspaceManager.open', async () => {
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'local');
        await mkdir(path.join(skillDir, 'references'), { recursive: true });
        await writeFile(path.join(skillDir, 'SKILL.md'), '# Local Skill\n', 'utf-8');
        await writeFile(path.join(skillDir, 'references', 'guide.md'), 'Local guide.\n', 'utf-8');

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
            new LocalWorkspaceHandleProvider()
        );
        await workspaceManager.setWorkspace({ path: workspaceRoot });
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).resolves.toEqual([{ id: 'local', displayName: 'Local Skill' }]);
        await expect(source.readFile('local', 'references/guide.md')).resolves.toBe(
            'Local guide.\n'
        );
    });

    it('advertises process capability only when requested', async () => {
        const provider = new LocalWorkspaceHandleProvider();

        const readHandle = await provider.open({ context: context(), input: { intent: 'read' } });
        expect(readHandle.capabilities).toEqual(['files']);
        expect(readHandle.processes).toBeUndefined();

        const processHandle = await provider.open({
            context: context(),
            input: { intent: 'process' },
        });
        expect(processHandle.capabilities).toEqual(['files', 'processes']);
        await expect(processHandle.processes?.exec({ command: 'pwd' })).resolves.toEqual({
            stdout: `${await realpath(workspaceRoot)}\n`,
            stderr: '',
        });
    });
});
