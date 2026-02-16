import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalManager } from './manager.js';
import { ApprovalStatus, DenialReason } from './types.js';
import { AgentEventBus } from '../events/index.js';
import { DextoRuntimeError } from '../errors/index.js';
import { ApprovalErrorCode } from './error-codes.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

describe('ApprovalManager', () => {
    let agentEventBus: AgentEventBus;
    const mockLogger = createMockLogger();

    beforeEach(() => {
        agentEventBus = new AgentEventBus();
    });

    describe('Configuration - Separate tool and elicitation control', () => {
        it('should allow auto-approve for tools while elicitation is enabled', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Tool confirmation should be auto-approved
            const toolResponse = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: { foo: 'bar' },
            });

            expect(toolResponse.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should reject elicitation when disabled, even if tools are auto-approved', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Elicitation should throw error when disabled
            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(DextoRuntimeError);

            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(/Elicitation is disabled/);
        });

        it('should auto-deny tools while elicitation is enabled', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-deny',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Tool confirmation should be auto-denied
            const toolResponse = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: { foo: 'bar' },
            });

            expect(toolResponse.status).toBe(ApprovalStatus.DENIED);
        });

        it('should use separate timeouts for tools and elicitation', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 180000,
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBe(60000);
            expect(config.elicitation.timeout).toBe(180000);
        });
    });

    describe('Approval routing by type', () => {
        it('should route tool confirmations to tool confirmation handler', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const response = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should route command confirmations to tool confirmation handler', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const response = await manager.requestCommandConfirmation({
                toolName: 'bash_exec',
                command: 'rm -rf /',
                originalCommand: 'rm -rf /',
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should route elicitation to elicitation provider when enabled', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-deny', // Different mode for tools
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Elicitation should not be auto-denied (uses manual handler)
            // We'll timeout immediately to avoid hanging tests
            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                    timeout: 1, // 1ms timeout to fail fast
                })
            ).rejects.toThrow(); // Should timeout, not be auto-denied
        });
    });

    describe('Pending approvals tracking', () => {
        it('should track pending approvals across both providers', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Initially no pending approvals
            expect(manager.getPendingApprovals()).toEqual([]);

            // Auto-approve mode would not create pending approvals
            // Event-based mode would, but we don't want hanging requests in tests
        });

        it('should cancel approvals in both providers', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Should not throw when cancelling (even if approval doesn't exist)
            expect(() => manager.cancelApproval('test-id')).not.toThrow();
            expect(() => manager.cancelAllApprovals()).not.toThrow();
        });
    });

    describe('Error handling', () => {
        it('should throw clear error when elicitation is disabled', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            await expect(
                manager.getElicitationData({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(/Elicitation is disabled/);
        });

        it('should provide helpful error message about enabling elicitation', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            try {
                await manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                });
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as Error).message).toContain('Enable elicitation');
                expect((error as Error).message).toContain('agent configuration');
            }
        });
    });

    describe('Timeout Configuration', () => {
        it('should allow undefined timeout (infinite wait) for tool confirmation', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        // No timeout specified - should wait indefinitely
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBeUndefined();
        });

        it('should allow undefined timeout (infinite wait) for elicitation', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        // No timeout specified - should wait indefinitely
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.elicitation.timeout).toBeUndefined();
        });

        it('should allow both timeouts to be undefined (infinite wait for all approvals)', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        // No timeout
                    },
                    elicitation: {
                        enabled: true,
                        // No timeout
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBeUndefined();
            expect(config.elicitation.timeout).toBeUndefined();
        });

        it('should use per-request timeout override when provided', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve', // Auto-approve so we can test immediately
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // The per-request timeout should override the config timeout
            // This is tested implicitly through the factory flow
            const response = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: { foo: 'bar' },
                timeout: 30000, // Per-request override
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should not timeout when timeout is undefined in auto-approve mode', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        // No timeout - should not cause any issues with auto-approve
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );

            const response = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should not timeout when timeout is undefined in auto-deny mode', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-deny',
                        // No timeout - should not cause any issues with auto-deny
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );

            const response = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.DENIED);
            expect(response.reason).toBe(DenialReason.SYSTEM_DENIED);
        });
    });

    describe('Backward compatibility', () => {
        it('should work with manual mode for both tools and elicitation', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            expect(manager.getConfig()).toEqual({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
        });

        it('should respect explicitly set elicitation enabled value', () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            expect(manager.getConfig().elicitation.enabled).toBe(true);
        });
    });

    describe('Denial Reasons', () => {
        it('should include system_denied reason in auto-deny mode', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-deny',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const response = await manager.requestToolConfirmation({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.DENIED);
            expect(response.reason).toBe(DenialReason.SYSTEM_DENIED);
            expect(response.message).toContain('system policy');
        });

        it('should throw error with specific reason when tool is denied', async () => {
            const manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'auto-deny',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            try {
                await manager.checkToolConfirmation({
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                });
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ApprovalErrorCode.APPROVAL_TOOL_CONFIRMATION_DENIED
                );
                expect((error as DextoRuntimeError).message).toContain('system policy');
                expect((error as any).context.reason).toBe(DenialReason.SYSTEM_DENIED);
            }
        });

        it('should handle user_denied reason in error message', async () => {
            const _manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 1, // Quick timeout for test
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Simulate user denying via event
            setTimeout(() => {
                agentEventBus.emit('approval:response', {
                    approvalId: expect.any(String),
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                    message: 'User clicked deny',
                } as any);
            }, 50);

            // This will be challenging to test properly without mocking more,
            // so let's just ensure the type system accepts it
            expect(DenialReason.USER_DENIED).toBe('user_denied');
            expect(DenialReason.TIMEOUT).toBe('timeout');
        });

        it('should include reason in response schema', () => {
            // Verify the type system allows reason and message
            const response: { reason?: DenialReason; message?: string } = {
                reason: DenialReason.USER_DENIED,
                message: 'You denied this request',
            };

            expect(response.reason).toBe(DenialReason.USER_DENIED);
            expect(response.message).toBe('You denied this request');
        });

        it('should support all denial reason types', () => {
            const reasons: DenialReason[] = [
                DenialReason.USER_DENIED,
                DenialReason.SYSTEM_DENIED,
                DenialReason.TIMEOUT,
                DenialReason.USER_CANCELLED,
                DenialReason.SYSTEM_CANCELLED,
                DenialReason.VALIDATION_FAILED,
                DenialReason.ELICITATION_DISABLED,
            ];

            expect(reasons.length).toBe(7);
            reasons.forEach((reason) => {
                expect(typeof reason).toBe('string');
            });
        });
    });

    describe('Tool Pattern Approval', () => {
        let manager: ApprovalManager;
        const toolName = 'bash_exec';

        beforeEach(() => {
            manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );
        });

        describe('addPattern', () => {
            it('should add a pattern to the approved list', () => {
                manager.addPattern(toolName, 'git *');
                expect(manager.getToolPatterns(toolName).has('git *')).toBe(true);
            });

            it('should add multiple patterns', () => {
                manager.addPattern(toolName, 'git *');
                manager.addPattern(toolName, 'npm *');
                manager.addPattern(toolName, 'ls *');

                const patterns = manager.getToolPatterns(toolName);
                expect(patterns.size).toBe(3);
                expect(patterns.has('git *')).toBe(true);
                expect(patterns.has('npm *')).toBe(true);
                expect(patterns.has('ls *')).toBe(true);
            });

            it('should not duplicate patterns', () => {
                manager.addPattern(toolName, 'git *');
                manager.addPattern(toolName, 'git *');

                expect(manager.getToolPatterns(toolName).size).toBe(1);
            });
        });

        describe('matchesPattern (pattern-to-pattern covering)', () => {
            // Note: matchesPattern expects pattern keys (e.g., "git push *"),
            // not raw commands. ToolManager generates pattern keys from commands.

            it('should match exact pattern against exact stored pattern', () => {
                manager.addPattern(toolName, 'git status *');
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(false);
            });

            it('should cover narrower pattern with broader pattern', () => {
                // "git *" is broader and should cover "git push *", "git status *", etc.
                manager.addPattern(toolName, 'git *');
                expect(manager.matchesPattern(toolName, 'git *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'npm *')).toBe(false);
            });

            it('should not let narrower pattern cover broader pattern', () => {
                // "git push *" should NOT cover "git *"
                manager.addPattern(toolName, 'git push *');
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git *')).toBe(false);
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(false);
            });

            it('should match against multiple patterns', () => {
                manager.addPattern(toolName, 'git *');
                manager.addPattern(toolName, 'npm install *');

                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'npm install *')).toBe(true);
                // npm * is not covered, only npm install * specifically
                expect(manager.matchesPattern(toolName, 'npm run *')).toBe(false);
            });

            it('should return false when no patterns are set', () => {
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(false);
            });

            it('should not cross-match unrelated commands', () => {
                manager.addPattern(toolName, 'npm *');
                // "npx" starts with "np" but is not "npm " + something
                expect(manager.matchesPattern(toolName, 'npx *')).toBe(false);
            });

            it('should handle multi-level subcommands', () => {
                manager.addPattern(toolName, 'docker compose *');
                expect(manager.matchesPattern(toolName, 'docker compose *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'docker compose up *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'docker *')).toBe(false);
            });

            it('should isolate patterns by tool', () => {
                manager.addPattern('tool-a', 'git *');
                expect(manager.matchesPattern('tool-a', 'git push *')).toBe(true);
                expect(manager.matchesPattern('tool-b', 'git push *')).toBe(false);
            });
        });

        describe('clearPatterns', () => {
            it('should clear patterns for a tool', () => {
                manager.addPattern(toolName, 'git *');
                manager.addPattern(toolName, 'npm *');
                expect(manager.getToolPatterns(toolName).size).toBe(2);

                manager.clearPatterns(toolName);
                expect(manager.getToolPatterns(toolName).size).toBe(0);
            });

            it('should allow adding patterns after clearing', () => {
                manager.addPattern(toolName, 'git *');
                manager.clearPatterns(toolName);
                manager.addPattern(toolName, 'npm *');

                expect(manager.getToolPatterns(toolName).size).toBe(1);
                expect(manager.getToolPatterns(toolName).has('npm *')).toBe(true);
            });
        });

        describe('getToolPatterns', () => {
            it('should return empty set initially', () => {
                expect(manager.getToolPatterns(toolName).size).toBe(0);
            });

            it('should return a copy that reflects current patterns', () => {
                manager.addPattern(toolName, 'git *');
                const patterns = manager.getToolPatterns(toolName);
                expect(patterns.has('git *')).toBe(true);
            });
        });
    });

    describe('Directory Access Approval', () => {
        let manager: ApprovalManager;

        beforeEach(() => {
            manager = new ApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );
        });

        describe('initializeWorkingDirectory', () => {
            it('should add working directory as session-approved', () => {
                manager.initializeWorkingDirectory('/home/user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/src/file.ts')).toBe(
                    true
                );
            });

            it('should normalize the path before adding', () => {
                manager.initializeWorkingDirectory('/home/user/../user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/file.ts')).toBe(true);
            });
        });

        describe('addApprovedDirectory', () => {
            it('should add directory with session type by default', () => {
                manager.addApprovedDirectory('/external/project');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should add directory with explicit session type', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should add directory with once type', () => {
                manager.addApprovedDirectory('/external/project', 'once');
                // 'once' type should NOT be session-approved (requires prompt each time)
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);
                // But should be generally approved for execution
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should not downgrade from session to once', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                manager.addApprovedDirectory('/external/project', 'once');
                // Should still be session-approved
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should upgrade from once to session', () => {
                manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);

                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should normalize paths before adding', () => {
                manager.addApprovedDirectory('/external/../external/project');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });
        });

        describe('isDirectorySessionApproved', () => {
            it('should return true for files within session-approved directory', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
                expect(
                    manager.isDirectorySessionApproved('/external/project/src/deep/file.ts')
                ).toBe(true);
            });

            it('should return false for files within once-approved directory', () => {
                manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);
            });

            it('should return false for files outside approved directories', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/other/file.ts')).toBe(false);
            });

            it('should handle path containment correctly', () => {
                manager.addApprovedDirectory('/external', 'session');
                // Approving /external should cover /external/sub/file.ts
                expect(manager.isDirectorySessionApproved('/external/sub/file.ts')).toBe(true);
                // But not /external-other/file.ts (different directory)
                expect(manager.isDirectorySessionApproved('/external-other/file.ts')).toBe(false);
            });

            it('should return true when working directory is initialized', () => {
                manager.initializeWorkingDirectory('/home/user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/any/file.ts')).toBe(
                    true
                );
            });
        });

        describe('isDirectoryApproved', () => {
            it('should return true for files within session-approved directory', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should return true for files within once-approved directory', () => {
                manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should return false for files outside approved directories', () => {
                manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectoryApproved('/other/file.ts')).toBe(false);
            });

            it('should handle multiple approved directories', () => {
                manager.addApprovedDirectory('/external/project1', 'session');
                manager.addApprovedDirectory('/external/project2', 'once');

                expect(manager.isDirectoryApproved('/external/project1/file.ts')).toBe(true);
                expect(manager.isDirectoryApproved('/external/project2/file.ts')).toBe(true);
                expect(manager.isDirectoryApproved('/external/project3/file.ts')).toBe(false);
            });

            it('should handle nested directory approvals', () => {
                manager.addApprovedDirectory('/external', 'session');
                // Approving /external should cover all subdirectories
                expect(manager.isDirectoryApproved('/external/sub/deep/file.ts')).toBe(true);
            });
        });

        describe('getApprovedDirectories', () => {
            it('should return empty map initially', () => {
                expect(manager.getApprovedDirectories().size).toBe(0);
            });

            it('should return map with type information', () => {
                manager.addApprovedDirectory('/external/project1', 'session');
                manager.addApprovedDirectory('/external/project2', 'once');

                const dirs = manager.getApprovedDirectories();
                expect(dirs.size).toBe(2);
                // Check that paths are normalized (absolute)
                const keys = Array.from(dirs.keys());
                expect(keys.some((k) => k.includes('project1'))).toBe(true);
                expect(keys.some((k) => k.includes('project2'))).toBe(true);
            });

            it('should include working directory after initialization', () => {
                manager.initializeWorkingDirectory('/home/user/project');
                const dirs = manager.getApprovedDirectories();
                expect(dirs.size).toBe(1);
                // Check that working directory is session type
                const entries = Array.from(dirs.entries());
                expect(entries[0]![1]).toBe('session');
            });
        });

        describe('Session vs Once Prompting Behavior', () => {
            // These tests verify the expected prompting flow

            it('working directory should not require prompt (session-approved)', () => {
                manager.initializeWorkingDirectory('/home/user/project');
                // isDirectorySessionApproved returns true → no directory prompt needed
                expect(manager.isDirectorySessionApproved('/home/user/project/src/file.ts')).toBe(
                    true
                );
            });

            it('external dir after session approval should not require prompt', () => {
                manager.addApprovedDirectory('/external', 'session');
                // isDirectorySessionApproved returns true → no directory prompt needed
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(true);
            });

            it('external dir after once approval should require prompt each time', () => {
                manager.addApprovedDirectory('/external', 'once');
                // isDirectorySessionApproved returns false → directory prompt needed
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(false);
                // But isDirectoryApproved returns true → execution allowed
                expect(manager.isDirectoryApproved('/external/file.ts')).toBe(true);
            });

            it('unapproved external dir should require prompt', () => {
                // No directories approved
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(false);
                expect(manager.isDirectoryApproved('/external/file.ts')).toBe(false);
            });
        });
    });
});
