import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AgentConfigSchema,
    resolveServicesFromConfig,
    toDextoAgentOptions,
    type AgentConfig,
} from '@dexto/agent-config';
import {
    ApprovalStatus,
    DextoAgent,
    type ApprovalRequest,
    type ApprovalResponse,
    type PermissionsMode,
} from '@dexto/core';
import imageLocal from '../src/index.js';

/**
 * The two permission modes, end to end through the local image's real filesystem and shell tools:
 * Asks you asks before a workspace file edit and a shell command; Full access asks for neither.
 */
describe('permission modes with the local image', () => {
    let workspaceRoot: string;
    let agent: DextoAgent | undefined;

    beforeEach(async () => {
        workspaceRoot = await realpath(
            await mkdtemp(path.join(os.tmpdir(), 'dexto-permission-modes-'))
        );
        await writeFile(path.join(workspaceRoot, 'notes.txt'), 'before\n', 'utf-8');
    });

    afterEach(async () => {
        await agent?.stop();
        agent = undefined;
        await rm(workspaceRoot, { force: true, recursive: true });
    });

    async function startAgent(mode: PermissionsMode) {
        const config: AgentConfig = {
            agentId: `permission-modes-${mode}`,
            systemPrompt: 'Test agent',
            llm: { provider: 'openai', model: 'gpt-5', apiKey: 'unused-test-key' },
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'in-memory' },
            },
            logger: { level: 'error', transports: [{ type: 'silent' }] },
            permissions: { mode, allowedToolsStorage: 'memory' },
            elicitation: { enabled: false },
            tools: [{ type: 'filesystem-tools', allowedPaths: ['.'] }, { type: 'process-tools' }],
        };
        const validated = AgentConfigSchema.parse(config);
        const services = await resolveServicesFromConfig(validated, imageLocal);
        const created = new DextoAgent(
            toDextoAgentOptions({ config: validated, services, image: imageLocal })
        );
        const handler = vi.fn(
            async (request: ApprovalRequest): Promise<ApprovalResponse> => ({
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
            })
        );
        created.setApprovalHandler(handler);
        await created.start();
        await created.setWorkspace({ path: workspaceRoot });
        agent = created;
        return { agent: created, handler };
    }

    function approvedToolNames(handler: ReturnType<typeof vi.fn>): unknown[] {
        return handler.mock.calls.map(
            ([request]) =>
                (request as ApprovalRequest & { metadata: { toolName?: unknown } }).metadata
                    .toolName
        );
    }

    it('asks you before a workspace file edit and before a shell command', async () => {
        const { agent, handler } = await startAgent('asks-you');

        await agent.executeTool('edit_file', {
            file_path: 'notes.txt',
            old_string: 'before',
            new_string: 'after',
        });
        await agent.executeTool('bash_exec', { command: 'echo asked' });

        expect(approvedToolNames(handler)).toEqual(['edit_file', 'bash_exec']);
        await expect(readFile(path.join(workspaceRoot, 'notes.txt'), 'utf-8')).resolves.toBe(
            'after\n'
        );
    }, 60_000);

    it('does not run a workspace file edit the user denies', async () => {
        const { agent, handler } = await startAgent('asks-you');
        handler.mockImplementation(async (request: ApprovalRequest) => ({
            approvalId: request.approvalId,
            status: ApprovalStatus.DENIED,
        }));

        await expect(
            agent.executeTool('edit_file', {
                file_path: 'notes.txt',
                old_string: 'before',
                new_string: 'after',
            })
        ).rejects.toThrow();

        expect(handler).toHaveBeenCalledTimes(1);
        await expect(readFile(path.join(workspaceRoot, 'notes.txt'), 'utf-8')).resolves.toBe(
            'before\n'
        );
    }, 60_000);

    it('runs a workspace file edit and a shell command without asking in full access', async () => {
        const { agent, handler } = await startAgent('full-access');

        await agent.executeTool('edit_file', {
            file_path: 'notes.txt',
            old_string: 'before',
            new_string: 'after',
        });
        await agent.executeTool('bash_exec', { command: 'echo not-asked' });

        expect(handler).not.toHaveBeenCalled();
        await expect(readFile(path.join(workspaceRoot, 'notes.txt'), 'utf-8')).resolves.toBe(
            'after\n'
        );
    }, 60_000);
});
