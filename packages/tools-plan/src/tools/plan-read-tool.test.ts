/**
 * Plan Read Tool Tests
 *
 * Tests for the plan_read tool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createPlanReadTool } from './plan-read-tool.js';
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

describe('plan_read tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-read-test-'));
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

    describe('execute', () => {
        it('should return exists: false when no plan exists', async () => {
            const tool = createPlanReadTool(planService);
            const sessionId = 'test-session';

            const result = (await tool.execute({}, { sessionId })) as {
                exists: boolean;
                message: string;
            };

            expect(result.exists).toBe(false);
            expect(result.message).toContain('No plan found');
        });

        it('should return plan content and metadata when plan exists', async () => {
            const tool = createPlanReadTool(planService);
            const sessionId = 'test-session';
            const content = '# My Plan\n\nSome content';
            const title = 'My Plan Title';

            await planService.create(sessionId, content, { title });

            const result = (await tool.execute({}, { sessionId })) as {
                exists: boolean;
                content: string;
                status: string;
                title: string;
                path: string;
            };

            expect(result.exists).toBe(true);
            expect(result.content).toBe(content);
            expect(result.status).toBe('draft');
            expect(result.title).toBe(title);
            expect(result.path).toBe(`.dexto/plans/${sessionId}/plan.md`);
        });

        it('should return ISO timestamps', async () => {
            const tool = createPlanReadTool(planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({}, { sessionId })) as {
                createdAt: string;
                updatedAt: string;
            };

            // Should be ISO format
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanReadTool(planService);

            try {
                await tool.execute({}, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });
    });
});
