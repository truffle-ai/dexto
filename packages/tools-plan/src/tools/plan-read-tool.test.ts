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
import type { Logger, ToolExecutionContext } from '@dexto/core';

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

describe('plan_read tool', () => {
    let logger: Logger;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        logger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-read-test-'));
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

    describe('execute', () => {
        it('should return exists: false when no plan exists', async () => {
            const tool = createPlanReadTool(async () => planService);
            const sessionId = 'test-session';

            const result = (await tool.execute({}, createToolContext(logger, { sessionId }))) as {
                exists: boolean;
                message: string;
            };

            expect(result.exists).toBe(false);
            expect(result.message).toContain('No plan found');
        });

        it('should return plan content and metadata when plan exists', async () => {
            const tool = createPlanReadTool(async () => planService);
            const sessionId = 'test-session';
            const content = '# My Plan\n\nSome content';
            const title = 'My Plan Title';

            await planService.create(sessionId, content, { title });

            const result = (await tool.execute({}, createToolContext(logger, { sessionId }))) as {
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
            expect(result.path).toBe(path.join(tempDir, sessionId, 'plan.md'));
        });

        it('should return ISO timestamps', async () => {
            const tool = createPlanReadTool(async () => planService);
            const sessionId = 'test-session';

            await planService.create(sessionId, '# Plan');

            const result = (await tool.execute({}, createToolContext(logger, { sessionId }))) as {
                createdAt: string;
                updatedAt: string;
            };

            // Should be ISO format
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it('should throw error when sessionId is missing', async () => {
            const tool = createPlanReadTool(async () => planService);

            try {
                await tool.execute({}, createToolContext(logger));
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.SESSION_ID_REQUIRED);
            }
        });
    });
});
