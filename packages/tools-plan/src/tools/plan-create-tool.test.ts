/**
 * Plan Create Tool Tests
 *
 * Tests for the plan_create tool including preview generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createPlanCreateTool } from './plan-create-tool.js';
import { PlanService } from '../plan-service.js';
import { PlanErrorCode } from '../errors.js';
import { DextoRuntimeError } from '@dexto/core';
import type { FileDisplayData } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('plan_create tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-create-test-'));
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
        it('should return FileDisplayData for new plan', async () => {
            const tool = createPlanCreateTool(planService);
            const sessionId = 'test-session';
            const content = '# Implementation Plan\n\n## Steps\n1. First step';

            const preview = (await tool.generatePreview!(
                { title: 'Test Plan', content },
                { sessionId }
            )) as FileDisplayData;

            expect(preview.type).toBe('file');
            expect(preview.operation).toBe('create');
            expect(preview.path).toBe(`.dexto/plans/${sessionId}/plan.md`);
            expect(preview.content).toBe(content);
            expect(preview.lineCount).toBe(4);
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanCreateTool(planService);

            try {
                await tool.generatePreview!({ title: 'Test', content: '# Plan' }, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should throw error when plan already exists', async () => {
            const tool = createPlanCreateTool(planService);
            const sessionId = 'test-session';

            // Create existing plan
            await planService.create(sessionId, '# Existing Plan');

            try {
                await tool.generatePreview!(
                    { title: 'New Plan', content: '# New Content' },
                    { sessionId }
                );
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_ALREADY_EXISTS);
            }
        });
    });

    describe('execute', () => {
        it('should create plan and return success', async () => {
            const tool = createPlanCreateTool(planService);
            const sessionId = 'test-session';
            const content = '# Implementation Plan';
            const title = 'My Plan';

            const result = (await tool.execute({ title, content }, { sessionId })) as {
                success: boolean;
                path: string;
                status: string;
                title: string;
                checkpoints: number;
            };

            expect(result.success).toBe(true);
            expect(result.path).toBe(`.dexto/plans/${sessionId}/plan.md`);
            expect(result.status).toBe('draft');
            expect(result.title).toBe(title);
            expect(result.checkpoints).toBe(0);
        });

        it('should create plan with checkpoints', async () => {
            const tool = createPlanCreateTool(planService);
            const sessionId = 'test-session';
            const checkpoints = [
                { id: 'cp1', description: 'Setup' },
                { id: 'cp2', description: 'Implement' },
            ];

            const result = (await tool.execute(
                { title: 'Plan', content: '# Plan', checkpoints },
                { sessionId }
            )) as { checkpoints: number };

            expect(result.checkpoints).toBe(2);
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanCreateTool(planService);

            try {
                await tool.execute({ title: 'Test', content: '# Plan' }, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should include _display data in result', async () => {
            const tool = createPlanCreateTool(planService);
            const sessionId = 'test-session';
            const content = '# Plan\n## Steps';

            const result = (await tool.execute({ title: 'Plan', content }, { sessionId })) as {
                _display: FileDisplayData;
            };

            expect(result._display).toBeDefined();
            expect(result._display.type).toBe('file');
            expect(result._display.operation).toBe('create');
            expect(result._display.lineCount).toBe(2);
        });
    });
});
