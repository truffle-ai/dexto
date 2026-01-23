/**
 * Plan Service Tests
 *
 * Tests for the PlanService CRUD operations and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { PlanService } from './plan-service.js';
import { PlanErrorCode } from './errors.js';
import { DextoRuntimeError } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('PlanService', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let planService: PlanService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plan-test-'));
        tempDir = await fs.realpath(rawTempDir);

        planService = new PlanService({ basePath: tempDir }, mockLogger as any);

        vi.clearAllMocks();
    });

    afterEach(async () => {
        // Cleanup temp directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('exists', () => {
        it('should return false for non-existent plan', async () => {
            const exists = await planService.exists('non-existent-session');
            expect(exists).toBe(false);
        });

        it('should return true for existing plan', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Test Plan');

            const exists = await planService.exists(sessionId);
            expect(exists).toBe(true);
        });
    });

    describe('create', () => {
        it('should create a new plan with content and metadata', async () => {
            const sessionId = 'test-session';
            const content = '# Implementation Plan\n\n## Steps\n1. First step';
            const title = 'Test Plan';

            const plan = await planService.create(sessionId, content, { title });

            expect(plan.content).toBe(content);
            expect(plan.meta.sessionId).toBe(sessionId);
            expect(plan.meta.status).toBe('draft');
            expect(plan.meta.title).toBe(title);
            expect(plan.meta.createdAt).toBeGreaterThan(0);
            expect(plan.meta.updatedAt).toBeGreaterThan(0);
        });

        it('should create a plan with checkpoints', async () => {
            const sessionId = 'test-session';
            const checkpoints = [
                { id: 'cp1', description: 'Setup database' },
                { id: 'cp2', description: 'Implement API' },
            ];

            const plan = await planService.create(sessionId, '# Plan', { checkpoints });

            expect(plan.meta.checkpoints).toHaveLength(2);
            expect(plan.meta.checkpoints![0]).toEqual({
                id: 'cp1',
                description: 'Setup database',
                status: 'pending',
            });
            expect(plan.meta.checkpoints![1]).toEqual({
                id: 'cp2',
                description: 'Implement API',
                status: 'pending',
            });
        });

        it('should throw error when plan already exists', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# First Plan');

            try {
                await planService.create(sessionId, '# Second Plan');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_ALREADY_EXISTS);
            }
        });

        it('should store plan files on disk', async () => {
            const sessionId = 'test-session';
            const content = '# Test Plan';
            await planService.create(sessionId, content);

            // Verify plan.md exists
            const planPath = path.join(tempDir, sessionId, 'plan.md');
            const storedContent = await fs.readFile(planPath, 'utf-8');
            expect(storedContent).toBe(content);

            // Verify plan-meta.json exists
            const metaPath = path.join(tempDir, sessionId, 'plan-meta.json');
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaContent);
            expect(meta.sessionId).toBe(sessionId);
        });
    });

    describe('read', () => {
        it('should return null for non-existent plan', async () => {
            const plan = await planService.read('non-existent-session');
            expect(plan).toBeNull();
        });

        it('should read existing plan with content and metadata', async () => {
            const sessionId = 'test-session';
            const content = '# Test Plan';
            const title = 'My Plan';
            await planService.create(sessionId, content, { title });

            const plan = await planService.read(sessionId);

            expect(plan).not.toBeNull();
            expect(plan!.content).toBe(content);
            expect(plan!.meta.sessionId).toBe(sessionId);
            expect(plan!.meta.title).toBe(title);
        });

        it('should handle invalid metadata schema gracefully', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Test');

            // Write valid JSON but invalid schema (missing required fields)
            const metaPath = path.join(tempDir, sessionId, 'plan-meta.json');
            await fs.writeFile(metaPath, JSON.stringify({ invalidField: 'value' }));

            const plan = await planService.read(sessionId);

            // Should return with default metadata
            expect(plan).not.toBeNull();
            expect(plan!.meta.sessionId).toBe(sessionId);
            expect(plan!.meta.status).toBe('draft');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should return null for corrupted JSON metadata', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Test');

            // Corrupt the metadata with invalid JSON
            const metaPath = path.join(tempDir, sessionId, 'plan-meta.json');
            await fs.writeFile(metaPath, '{ invalid json }');

            const plan = await planService.read(sessionId);

            // Should return null and log error
            expect(plan).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('should update plan content', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Original Content');

            const result = await planService.update(sessionId, '# Updated Content');

            expect(result.oldContent).toBe('# Original Content');
            expect(result.newContent).toBe('# Updated Content');
            expect(result.meta.updatedAt).toBeGreaterThan(0);
        });

        it('should preserve metadata when updating content', async () => {
            const sessionId = 'test-session';
            const plan = await planService.create(sessionId, '# Original', { title: 'My Title' });
            const originalCreatedAt = plan.meta.createdAt;

            await planService.update(sessionId, '# Updated');

            const updatedPlan = await planService.read(sessionId);
            expect(updatedPlan!.meta.title).toBe('My Title');
            expect(updatedPlan!.meta.createdAt).toBe(originalCreatedAt);
        });

        it('should throw error when plan does not exist', async () => {
            try {
                await planService.update('non-existent', '# Content');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });
    });

    describe('updateMeta', () => {
        it('should update plan status', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Plan');

            const meta = await planService.updateMeta(sessionId, { status: 'approved' });

            expect(meta.status).toBe('approved');
        });

        it('should update plan title', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Plan');

            const meta = await planService.updateMeta(sessionId, { title: 'New Title' });

            expect(meta.title).toBe('New Title');
        });

        it('should throw error when plan does not exist', async () => {
            try {
                await planService.updateMeta('non-existent', { status: 'approved' });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });
    });

    describe('updateCheckpoint', () => {
        it('should update checkpoint status', async () => {
            const sessionId = 'test-session';
            const checkpoints = [{ id: 'cp1', description: 'First' }];
            await planService.create(sessionId, '# Plan', { checkpoints });

            const meta = await planService.updateCheckpoint(sessionId, 'cp1', 'done');

            expect(meta.checkpoints![0]!.status).toBe('done');
        });

        it('should throw error when checkpoint does not exist', async () => {
            const sessionId = 'test-session';
            const checkpoints = [{ id: 'cp1', description: 'First' }];
            await planService.create(sessionId, '# Plan', { checkpoints });

            try {
                await planService.updateCheckpoint(sessionId, 'non-existent', 'done');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.CHECKPOINT_NOT_FOUND);
            }
        });

        it('should throw error when plan has no checkpoints', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Plan');

            try {
                await planService.updateCheckpoint(sessionId, 'cp1', 'done');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.CHECKPOINT_NOT_FOUND);
            }
        });
    });

    describe('delete', () => {
        it('should delete existing plan', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Plan');

            await planService.delete(sessionId);

            const exists = await planService.exists(sessionId);
            expect(exists).toBe(false);
        });

        it('should throw error when plan does not exist', async () => {
            try {
                await planService.delete('non-existent');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(PlanErrorCode.PLAN_NOT_FOUND);
            }
        });

        it('should remove plan directory from disk', async () => {
            const sessionId = 'test-session';
            await planService.create(sessionId, '# Plan');
            const planDir = path.join(tempDir, sessionId);

            await planService.delete(sessionId);

            try {
                await fs.access(planDir);
                expect.fail('Directory should not exist');
            } catch {
                // Expected - directory should not exist
            }
        });
    });
});
