import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { defineTool } from '../define-tool.js';
import type { Tool, ToolExecutionContext, ToolNeedsApproval } from '../types.js';
import { ToolApprovalPolicy } from './tool-approval-policy.js';

const TestInputSchema = z.object({
    value: z.string().optional(),
});

type TestInput = z.output<typeof TestInputSchema>;

function createTool(needsApproval?: ToolNeedsApproval<typeof TestInputSchema>): Tool {
    const base = {
        description: 'Test tool',
        execute: () => ({ ok: true }),
        id: 'test_tool',
        inputSchema: TestInputSchema,
    };

    return defineTool(
        needsApproval === undefined
            ? base
            : {
                  ...base,
                  needsApproval,
              }
    );
}

function createContext(sessionId?: string): ToolExecutionContext {
    return {
        logger: createMockLogger(),
        ...(sessionId !== undefined ? { sessionId } : {}),
    };
}

function createPolicy(options?: {
    approvalMode?: 'manual' | 'auto-approve';
    approvedKeys?: string[];
    explicitlyAllowedTools?: string[];
    tools?: Tool[];
}): ToolApprovalPolicy {
    const tools = new Map((options?.tools ?? [createTool()]).map((tool) => [tool.id, tool]));
    const explicitlyAllowedTools = new Set(options?.explicitlyAllowedTools ?? []);
    const approvedKeys = new Set(options?.approvedKeys ?? []);

    return new ToolApprovalPolicy({
        getApprovalMode: () => options?.approvalMode ?? 'manual',
        getLocalTool: (toolName) => tools.get(toolName),
        isApprovalKeySessionApproved: ({ approvalKey }) => approvedKeys.has(approvalKey),
        isToolExplicitlyAllowed: async ({ toolName }) => explicitlyAllowedTools.has(toolName),
    });
}

async function resolveFor(
    policy: ToolApprovalPolicy,
    options?: {
        source?: 'local' | 'mcp';
        toolName?: string;
        args?: TestInput;
        getContext?: () => ToolExecutionContext;
        sessionId?: string;
    }
) {
    return await policy.resolve({
        args: options?.args ?? {},
        getContext: options?.getContext ?? (() => createContext(options?.sessionId)),
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        source: options?.source ?? 'local',
        toolName: options?.toolName ?? 'test_tool',
    });
}

describe('ToolApprovalPolicy', () => {
    it('lets explicit tool policy override tool-authored approval', async () => {
        const getContext = vi.fn(() => createContext());
        const needsApproval = vi.fn(() => 'test-key');
        const policy = createPolicy({
            explicitlyAllowedTools: ['test_tool'],
            tools: [createTool(needsApproval)],
        });

        await expect(resolveFor(policy, { getContext })).resolves.toEqual({ kind: 'ready' });
        expect(getContext).not.toHaveBeenCalled();
        expect(needsApproval).not.toHaveBeenCalled();
    });

    it('lets global auto-approve override tool-authored approval', async () => {
        const getContext = vi.fn(() => createContext());
        const needsApproval = vi.fn(() => true);
        const policy = createPolicy({
            approvalMode: 'auto-approve',
            tools: [createTool(needsApproval)],
        });

        await expect(resolveFor(policy, { getContext })).resolves.toEqual({ kind: 'ready' });
        expect(getContext).not.toHaveBeenCalled();
        expect(needsApproval).not.toHaveBeenCalled();
    });

    it('uses tool-authored allow before manual fallback', async () => {
        const policy = createPolicy({
            tools: [createTool(false)],
        });

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'ready' });
    });

    it('requires approval when a tool-authored policy returns true', async () => {
        const policy = createPolicy({
            tools: [createTool(true)],
        });

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'approval-required' });
    });

    it('returns the tool-authored approval key when approval is required', async () => {
        const policy = createPolicy({
            tools: [createTool(() => 'scoped-key')],
        });

        await expect(resolveFor(policy)).resolves.toEqual({
            approvalKey: 'scoped-key',
            kind: 'approval-required',
        });
    });

    it('skips approval when a tool-authored approval key is already approved for the session', async () => {
        const policy = createPolicy({
            approvedKeys: ['scoped-key'],
            tools: [createTool(() => 'scoped-key')],
        });

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'ready' });
    });

    it('uses the input session for explicit policy and approval key checks', async () => {
        const getContext = vi.fn(() => createContext('session-1'));
        const isToolExplicitlyAllowed = vi.fn(() => false);
        const isApprovalKeySessionApproved = vi.fn(() => true);
        const policy = new ToolApprovalPolicy({
            getApprovalMode: () => 'manual',
            getLocalTool: () => createTool('scoped-key'),
            isApprovalKeySessionApproved,
            isToolExplicitlyAllowed,
        });

        await expect(
            policy.resolve({
                args: {},
                getContext,
                sessionId: 'session-1',
                source: 'local',
                toolName: 'test_tool',
            })
        ).resolves.toEqual({ kind: 'ready' });
        expect(getContext).not.toHaveBeenCalled();
        expect(isToolExplicitlyAllowed).toHaveBeenCalledWith({
            sessionId: 'session-1',
            toolName: 'test_tool',
        });
        expect(isApprovalKeySessionApproved).toHaveBeenCalledWith({
            approvalKey: 'scoped-key',
            sessionId: 'session-1',
        });
    });

    it('treats blank approval keys as unkeyed approval-required', async () => {
        const policy = createPolicy({
            tools: [createTool(() => '   ')],
        });

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'approval-required' });
    });

    it('treats whitespace-padded approval keys as unkeyed approval-required', async () => {
        const policy = createPolicy({
            approvedKeys: ['scoped-key'],
            tools: [createTool(() => ' scoped-key ')],
        });

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'approval-required' });
    });

    it('passes validated args and execution context to tool-authored approval functions', async () => {
        const needsApproval = vi.fn((input: TestInput, context: ToolExecutionContext) =>
            input.value === context.sessionId ? 'matching-key' : false
        );
        const policy = createPolicy({
            tools: [createTool(needsApproval)],
        });
        const context = { logger: createMockLogger(), sessionId: 'session-1' };

        await expect(
            policy.resolve({
                args: { value: 'session-1' },
                getContext: () => context,
                sessionId: 'session-1',
                source: 'local',
                toolName: 'test_tool',
            })
        ).resolves.toEqual({
            approvalKey: 'matching-key',
            kind: 'approval-required',
        });
        expect(needsApproval).toHaveBeenCalledWith({ value: 'session-1' }, context);
    });

    it('rejects a tool-authored approval context with a mismatched session', async () => {
        const policy = createPolicy({
            tools: [createTool(() => true)],
        });

        await expect(
            policy.resolve({
                args: {},
                getContext: () => createContext('other-session'),
                sessionId: 'session-1',
                source: 'local',
                toolName: 'test_tool',
            })
        ).rejects.toThrow('approval context session does not match the approval scope');
    });

    it('falls back to manual approval when no tool-authored policy exists', async () => {
        const policy = createPolicy();

        await expect(resolveFor(policy)).resolves.toEqual({ kind: 'approval-required' });
    });

    it('does not evaluate local tool-authored policy for MCP tool calls', async () => {
        const getContext = vi.fn(() => createContext());
        const needsApproval = vi.fn(() => 'local-key');
        const policy = createPolicy({
            tools: [createTool(needsApproval)],
        });

        await expect(resolveFor(policy, { getContext, source: 'mcp' })).resolves.toEqual({
            kind: 'approval-required',
        });
        expect(getContext).not.toHaveBeenCalled();
        expect(needsApproval).not.toHaveBeenCalled();
    });
});
