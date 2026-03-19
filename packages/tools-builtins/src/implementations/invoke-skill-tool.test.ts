import type { PromptInfo, ToolExecutionContext } from '@dexto/core';
import { describe, expect, it, vi } from 'vitest';
import { createInvokeSkillTool } from './invoke-skill-tool.js';

function createPromptInfo(): PromptInfo {
    return {
        name: 'echo-custom-mcp',
        displayName: 'echo-custom-mcp',
        commandName: 'echo-custom-mcp',
        source: {
            type: 'file',
            file: '/tmp/skills/echo-custom-mcp/SKILL.md',
        },
        metadata: {
            mcpServers: {
                skill_echo_demo: {
                    type: 'stdio',
                    command: 'node',
                    args: ['scripts/echo-mcp-server.mjs'],
                },
            },
        },
    } as unknown as PromptInfo;
}

describe('invoke_skill tool', () => {
    it('retries previously registered bundled MCP servers before returning an error', async () => {
        const promptInfo = createPromptInfo();
        const promptManager = {
            listAutoInvocablePrompts: vi
                .fn()
                .mockResolvedValue({ 'config:echo-custom-mcp': promptInfo }),
            getPromptDefinition: vi.fn().mockResolvedValue(undefined),
            getPrompt: vi.fn().mockResolvedValue({
                messages: [
                    {
                        content: {
                            type: 'text',
                            text: 'Use the bundled echo MCP tool.',
                        },
                    },
                ],
            }),
        };

        const addMcpServer = vi.fn();
        const enableMcpServer = vi.fn().mockResolvedValue(undefined);
        const getMcpServerStatus = vi
            .fn()
            .mockReturnValueOnce({
                name: 'skill_echo_demo',
                type: 'stdio',
                enabled: true,
                status: 'error',
                error: 'Request timed out',
            })
            .mockReturnValueOnce({
                name: 'skill_echo_demo',
                type: 'stdio',
                enabled: true,
                status: 'connected',
            });

        const tool = createInvokeSkillTool();
        const result = await tool.execute(
            {
                skill: 'echo-custom-mcp',
            },
            {
                logger: {
                    warn: vi.fn(),
                },
                services: {
                    prompts: promptManager,
                },
                agent: {
                    addMcpServer,
                    getMcpServerStatus,
                    enableMcpServer,
                },
            } as unknown as ToolExecutionContext
        );

        expect(addMcpServer).not.toHaveBeenCalled();
        expect(enableMcpServer).toHaveBeenCalledWith('skill_echo_demo');
        expect(getMcpServerStatus).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            skill: 'config:echo-custom-mcp',
            content: 'Use the bundled echo MCP tool.',
        });
    });
});
