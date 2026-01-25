/**
 * Plan Update Tool Tests
 *
 * Tests for the plan_update tool including diff preview generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createPlanUpdateTool } from './plan-update-tool.js';
import { PlanService } from '../plan-service.js';
import { PlanErrorCode } from '../errors.js';
import { DextoRuntimeError } from '@dexto/core';
import type { DiffDisplayData } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('plan_update tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-update-test-'));
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

    describe('generatePreview', () => {
        it('should return DiffDisplayData with unified diff', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';
            const originalContent = '# Plan\n\n## Steps\n1. First step';
            const newContent = '# Plan\n\n## Steps\n1. First step\n2. Second step';

            await planService.create(sessionId, originalContent);

            const preview = (await tool.generatePreview!(
                { content: newContent },
                { sessionId }
            )) as DiffDisplayData;

            expect(preview.type).toBe('diff');
            // Path is now absolute, check it ends with the expected suffix
            expect(preview.filename).toContain(sessionId);
            expect(preview.filename).toMatch(/plan\.md$/);
            expect(preview.unified).toContain('-1. First step');
            expect(preview.unified).toContain('+1. First step');
            expect(preview.unified).toContain('+2. Second step');
            expect(preview.additions).toBeGreaterThan(0);
        });

        it('should throw error when plan does not exist', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';

            try {
                await tool.generatePreview!({ content: '# New Content' }, { sessionId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanUpdateTool(planService);

            try {
                await tool.generatePreview!({ content: '# Content' }, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should show deletions in diff', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';
            const originalContent = '# Plan\n\nLine to remove\nKeep this';
            const newContent = '# Plan\n\nKeep this';

            await planService.create(sessionId, originalContent);

            const preview = (await tool.generatePreview!(
                { content: newContent },
                { sessionId }
            )) as DiffDisplayData;

            expect(preview.deletions).toBeGreaterThan(0);
            expect(preview.unified).toContain('-Line to remove');
        });
    });

    describe('execute', () => {
        it('should update plan content and return success', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';
            const originalContent = '# Original Plan';
            const newContent = '# Updated Plan';

            await planService.create(sessionId, originalContent);

            const result = (await tool.execute({ content: newContent }, { sessionId })) as {
                success: boolean;
                path: string;
                status: string;
            };

            expect(result.success).toBe(true);
            // Path is now absolute, check it ends with the expected suffix
            expect(result.path).toContain(sessionId);
            expect(result.path).toMatch(/plan\.md$/);

            // Verify content was updated
            const plan = await planService.read(sessionId);
            expect(plan!.content).toBe(newContent);
        });

        it('should include _display data with diff', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Original');

            const result = (await tool.execute({ content: '# Updated' }, { sessionId })) as {
                _display: DiffDisplayData;
            };

            expect(result._display).toBeDefined();
            expect(result._display.type).toBe('diff');
            expect(result._display.unified).toContain('-# Original');
            expect(result._display.unified).toContain('+# Updated');
        });

        it('should throw error when plan does not exist', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'non-existent';

            try {
                await tool.execute({ content: '# Content' }, { sessionId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanUpdateTool(planService);

            try {
                await tool.execute({ content: '# Content' }, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should preserve plan status after update', async () => {
            const tool = createPlanUpdateTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');
            await planService.updateMeta(sessionId, { status: 'approved' });

            await tool.execute({ content: '# Updated Plan' }, { sessionId });

            const plan = await planService.read(sessionId);
            expect(plan!.meta.status).toBe('approved');
        });
    });
});
