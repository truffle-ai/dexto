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
import type { FileDisplayData, Logger, ToolExecutionContext } from '@dexto/core';

// Create mock logger
const createMockLogger = (): Logger => {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
};

function createToolContext(
    logger: Logger,
    overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
    return { logger, ...overrides };
}

describe('plan_create tool', () => {
    let logger: Logger;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        logger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-create-test-'));
        tempDir = await fs.realpath(rawTempDir);

        planService = new PlanService({ basePath: tempDir }, logger);

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
            const tool = createPlanCreateTool(async () => planService);
            const sessionId = 'test-session';
            const content = '# Implementation Plan\n\n## Steps\n1. First step';

            const previewFn = tool.presentation?.preview;
            expect(previewFn).toBeDefined();

            const preview = (await previewFn!(
                { title: 'Test Plan', content },
                createToolContext(logger, { sessionId })
            )) as FileDisplayData;

            expect(preview.type).toBe('file');
            expect(preview.title).toBe('Create Plan');
            expect(preview.operation).toBe('create');
            // Path is now absolute, check it ends with the expected suffix
            expect(preview.path).toContain(sessionId);
            expect(preview.path).toMatch(/plan\.md$/);
            expect(preview.content).toBe(content);
            expect(preview.lineCount).toBe(4);
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanCreateTool(async () => planService);

            const previewFn = tool.presentation?.preview;
            expect(previewFn).toBeDefined();

            try {
                await previewFn!({ title: 'Test', content: '# Plan' }, createToolContext(logger));
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should throw error when plan already exists', async () => {
            const tool = createPlanCreateTool(async () => planService);
            const sessionId = 'test-session';

            const previewFn = tool.presentation?.preview;
            expect(previewFn).toBeDefined();

            // Create existing plan
            await planService.create(sessionId, '# Existing Plan');

            try {
                await previewFn!(
                    { title: 'New Plan', content: '# New Content' },
                    createToolContext(logger, { sessionId })
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
            const tool = createPlanCreateTool(async () => planService);
            const sessionId = 'test-session';
            const content = '# Implementation Plan';
            const title = 'My Plan';

            const result = (await tool.execute(
                { title, content },
                createToolContext(logger, { sessionId })
            )) as {
                success: boolean;
                path: string;
                status: string;
                title: string;
            };

            expect(result.success).toBe(true);
            // Path is now absolute, check it ends with the expected suffix
            expect(result.path).toContain(sessionId);
            expect(result.path).toMatch(/plan\.md$/);
            expect(result.status).toBe('draft');
            expect(result.title).toBe(title);
        });

        it('should throw error when plan already exists', async () => {
            const tool = createPlanCreateTool(async () => planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Existing Plan');

            try {
                await tool.execute(
                    { title: 'New Plan', content: '# New content' },
                    createToolContext(logger, { sessionId })
                );
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_ALREADY_EXISTS);
            }
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanCreateTool(async () => planService);

            try {
                await tool.execute({ title: 'Test', content: '# Plan' }, createToolContext(logger));
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });

        it('should include _display data in result', async () => {
            const tool = createPlanCreateTool(async () => planService);
            const sessionId = 'test-session';
            const content = '# Plan\n## Steps';

            const result = (await tool.execute(
                { title: 'Plan', content },
                createToolContext(logger, { sessionId })
            )) as {
                _display: FileDisplayData;
            };

            expect(result._display).toBeDefined();
            expect(result._display.type).toBe('file');
            expect(result._display.title).toBe('Create Plan');
            expect(result._display.operation).toBe('create');
            expect(result._display.lineCount).toBe(2);
        });
    });
});
