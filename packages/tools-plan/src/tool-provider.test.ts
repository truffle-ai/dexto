/**
 * Plan Tools Provider Tests
 *
 * Tests for the planToolsProvider configuration and tool creation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { planToolsProvider } from './tool-provider.js';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

// Create mock context with logger and minimal agent
const createMockContext = (logger: ReturnType<typeof createMockLogger>) => ({
    logger: logger as any,
    agent: {} as any, // Minimal mock - provider only uses logger
});

describe('planToolsProvider', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-provider-test-'));
        tempDir = await fs.realpath(rawTempDir);

        // Store original cwd and change to temp dir
        originalCwd = process.cwd();
        process.chdir(tempDir);

        vi.clearAllMocks();
    });

    afterEach(async () => {
        // Restore original cwd
        process.chdir(originalCwd);

        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('provider metadata', () => {
        it('should have correct type', () => {
            expect(planToolsProvider.type).toBe('plan-tools');
        });

        it('should have metadata', () => {
            expect(planToolsProvider.metadata).toBeDefined();
            expect(planToolsProvider.metadata?.displayName).toBe('Plan Tools');
            expect(planToolsProvider.metadata?.category).toBe('planning');
        });
    });

    describe('config schema', () => {
        it('should validate minimal config', () => {
            const result = planToolsProvider.configSchema.safeParse({
                type: 'plan-tools',
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.basePath).toBe('.dexto/plans');
            }
        });

        it('should validate config with custom basePath', () => {
            const result = planToolsProvider.configSchema.safeParse({
                type: 'plan-tools',
                basePath: '/custom/path',
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.basePath).toBe('/custom/path');
            }
        });

        it('should validate config with enabledTools', () => {
            const result = planToolsProvider.configSchema.safeParse({
                type: 'plan-tools',
                enabledTools: ['plan_create', 'plan_read'],
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.enabledTools).toEqual(['plan_create', 'plan_read']);
            }
        });

        it('should reject invalid tool names', () => {
            const result = planToolsProvider.configSchema.safeParse({
                type: 'plan-tools',
                enabledTools: ['invalid_tool'],
            });

            expect(result.success).toBe(false);
        });

        it('should reject unknown properties', () => {
            const result = planToolsProvider.configSchema.safeParse({
                type: 'plan-tools',
                unknownProp: 'value',
            });

            expect(result.success).toBe(false);
        });
    });

    describe('create', () => {
        it('should create all tools by default', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
            });

            const tools = planToolsProvider.create(config, createMockContext(mockLogger));

            expect(tools).toHaveLength(3);
            const toolIds = tools.map((t) => t.id);
            expect(toolIds).toContain('plan_create');
            expect(toolIds).toContain('plan_read');
            expect(toolIds).toContain('plan_update');
        });

        it('should create only enabled tools', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
                enabledTools: ['plan_create', 'plan_read'],
            });

            const tools = planToolsProvider.create(config, createMockContext(mockLogger));

            expect(tools).toHaveLength(2);
            const toolIds = tools.map((t) => t.id);
            expect(toolIds).toContain('plan_create');
            expect(toolIds).toContain('plan_read');
            expect(toolIds).not.toContain('plan_update');
        });

        it('should create single tool', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
                enabledTools: ['plan_update'],
            });

            const tools = planToolsProvider.create(config, createMockContext(mockLogger));

            expect(tools).toHaveLength(1);
            expect(tools[0]!.id).toBe('plan_update');
        });

        it('should use relative basePath from cwd', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
                basePath: '.dexto/plans',
            });

            planToolsProvider.create(config, createMockContext(mockLogger));

            // Verify debug log was called with resolved path
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining(path.join(tempDir, '.dexto/plans'))
            );
        });

        it('should use absolute basePath as-is', () => {
            const absolutePath = '/absolute/path/to/plans';
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
                basePath: absolutePath,
            });

            planToolsProvider.create(config, createMockContext(mockLogger));

            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining(absolutePath));
        });

        it('should log when creating subset of tools', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
                enabledTools: ['plan_create'],
            });

            planToolsProvider.create(config, createMockContext(mockLogger));

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Creating subset of plan tools')
            );
        });
    });

    describe('tool descriptions', () => {
        it('should have descriptions for all tools', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
            });

            const tools = planToolsProvider.create(config, createMockContext(mockLogger));

            for (const tool of tools) {
                expect(tool.description).toBeDefined();
                expect(tool.description.length).toBeGreaterThan(0);
            }
        });

        it('should have input schemas for all tools', () => {
            const config = planToolsProvider.configSchema.parse({
                type: 'plan-tools',
            });

            const tools = planToolsProvider.create(config, createMockContext(mockLogger));

            for (const tool of tools) {
                expect(tool.inputSchema).toBeDefined();
            }
        });
    });
});
