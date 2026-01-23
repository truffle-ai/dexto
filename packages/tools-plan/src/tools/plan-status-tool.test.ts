/**
 * Plan Status Tool Tests
 *
 * Tests for the plan_status tool including status and checkpoint updates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createPlanStatusTool } from './plan-status-tool.js';
import { PlanService } from '../plan-service.js';
import { PlanErrorCode } from '../errors.js';
import { DextoRuntimeError } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('plan_status tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-status-test-'));
        tempDir = await fs.realpath(rawTempDir);

        planService = new PlanService({ basePath: tempDir }, mockLogger as any);

        vi.clearAllMocks();
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('status updates', () => {
        it('should update plan status', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({ status: 'approved' }, { sessionId })) as {
                success: boolean;
                status: string;
            };

            expect(result.success).toBe(true);
            expect(result.status).toBe('approved');

            // Verify status was persisted
            const plan = await planService.read(sessionId);
            expect(plan!.meta.status).toBe('approved');
        });

        it('should update to in_progress status', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({ status: 'in_progress' }, { sessionId })) as {
                status: string;
            };

            expect(result.status).toBe('in_progress');
        });

        it('should update to completed status', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({ status: 'completed' }, { sessionId })) as {
                status: string;
            };

            expect(result.status).toBe('completed');
        });

        it('should update to abandoned status', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({ status: 'abandoned' }, { sessionId })) as {
                status: string;
            };

            expect(result.status).toBe('abandoned');
        });
    });

    describe('checkpoint updates', () => {
        it('should mark checkpoint as done', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [
                { id: 'cp1', description: 'First' },
                { id: 'cp2', description: 'Second' },
            ];

            await planService.create(sessionId, '# Plan', { checkpoints });

            const result = (await tool.execute(
                { checkpointId: 'cp1', checkpointStatus: 'done' },
                { sessionId }
            )) as {
                success: boolean;
                checkpoints: { total: number; done: number; pending: number; skipped: number };
            };

            expect(result.success).toBe(true);
            expect(result.checkpoints.done).toBe(1);
            expect(result.checkpoints.pending).toBe(1);
        });

        it('should mark checkpoint as skipped', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [{ id: 'cp1', description: 'First' }];

            await planService.create(sessionId, '# Plan', { checkpoints });

            const result = (await tool.execute(
                { checkpointId: 'cp1', checkpointStatus: 'skipped' },
                { sessionId }
            )) as {
                checkpoints: { skipped: number };
            };

            expect(result.checkpoints.skipped).toBe(1);
        });

        it('should throw error for non-existent checkpoint', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [{ id: 'cp1', description: 'First' }];

            await planService.create(sessionId, '# Plan', { checkpoints });

            try {
                await tool.execute(
                    { checkpointId: 'non-existent', checkpointStatus: 'done' },
                    { sessionId }
                );
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.CHECKPOINT_NOT_FOUND);
            }
        });
    });

    describe('combined updates', () => {
        it('should update both status and checkpoint', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [{ id: 'cp1', description: 'First' }];

            await planService.create(sessionId, '# Plan', { checkpoints });

            const result = (await tool.execute(
                { status: 'in_progress', checkpointId: 'cp1', checkpointStatus: 'done' },
                { sessionId }
            )) as {
                status: string;
                checkpoints: { done: number };
            };

            expect(result.status).toBe('in_progress');
            expect(result.checkpoints.done).toBe(1);
        });
    });

    describe('error handling', () => {
        it('should throw error when plan does not exist', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'non-existent';

            try {
                await tool.execute({ status: 'approved' }, { sessionId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanStatusTool(planService);

            try {
                await tool.execute({ status: 'approved' }, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });
    });

    describe('checkpoint summary', () => {
        it('should return null checkpoints when plan has no checkpoints', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({ status: 'approved' }, { sessionId })) as {
                checkpoints: null;
            };

            expect(result.checkpoints).toBeNull();
        });

        it('should return correct checkpoint counts', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [
                { id: 'cp1', description: 'First' },
                { id: 'cp2', description: 'Second' },
                { id: 'cp3', description: 'Third' },
            ];

            await planService.create(sessionId, '# Plan', { checkpoints });

            // Mark first as done, second as skipped
            await planService.updateCheckpoint(sessionId, 'cp1', 'done');
            await planService.updateCheckpoint(sessionId, 'cp2', 'skipped');

            const result = (await tool.execute({ status: 'in_progress' }, { sessionId })) as {
                checkpoints: { total: number; done: number; pending: number; skipped: number };
            };

            expect(result.checkpoints.total).toBe(3);
            expect(result.checkpoints.done).toBe(1);
            expect(result.checkpoints.pending).toBe(1);
            expect(result.checkpoints.skipped).toBe(1);
        });
    });

    describe('result metadata', () => {
        it('should return path and updatedAt', async () => {
            const tool = createPlanStatusTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan', { title: 'My Plan' });

            const result = (await tool.execute({ status: 'approved' }, { sessionId })) as {
                path: string;
                title: string;
                updatedAt: string;
            };

            expect(result.path).toBe(`.dexto/plans/${sessionId}/plan.md`);
            expect(result.title).toBe('My Plan');
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });
});
