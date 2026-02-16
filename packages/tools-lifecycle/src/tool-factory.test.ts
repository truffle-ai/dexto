/**
 * Lifecycle Tools Factory Tests
 */

import { describe, it, expect } from 'vitest';
import { lifecycleToolsFactory } from './tool-factory.js';

describe('lifecycleToolsFactory', () => {
    describe('factory metadata', () => {
        it('should have metadata', () => {
            expect(lifecycleToolsFactory.metadata).toBeDefined();
            expect(lifecycleToolsFactory.metadata?.displayName).toBe('Lifecycle Tools');
            expect(lifecycleToolsFactory.metadata?.category).toBe('lifecycle');
        });
    });

    describe('config schema', () => {
        it('should validate minimal config', () => {
            const result = lifecycleToolsFactory.configSchema.safeParse({
                type: 'lifecycle-tools',
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.maxLogLines).toBe(200);
                expect(result.data.maxLogBytes).toBe(200_000);
            }
        });

        it('should validate enabledTools', () => {
            const result = lifecycleToolsFactory.configSchema.safeParse({
                type: 'lifecycle-tools',
                enabledTools: ['view_logs', 'memory_list'],
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.enabledTools).toEqual(['view_logs', 'memory_list']);
            }
        });

        it('should reject unknown properties', () => {
            const result = lifecycleToolsFactory.configSchema.safeParse({
                type: 'lifecycle-tools',
                unknownProp: 'value',
            });

            expect(result.success).toBe(false);
        });
    });

    describe('create', () => {
        it('should create all tools by default', () => {
            const config = lifecycleToolsFactory.configSchema.parse({
                type: 'lifecycle-tools',
            });

            const tools = lifecycleToolsFactory.create(config);

            const ids = tools.map((t) => t.id);
            expect(ids).toContain('view_logs');
            expect(ids).toContain('memory_list');
            expect(ids).toContain('memory_get');
            expect(ids).toContain('memory_create');
            expect(ids).toContain('memory_update');
            expect(ids).toContain('memory_delete');
        });

        it('should create only enabled tools', () => {
            const config = lifecycleToolsFactory.configSchema.parse({
                type: 'lifecycle-tools',
                enabledTools: ['memory_list', 'memory_get'],
            });

            const tools = lifecycleToolsFactory.create(config);

            expect(tools).toHaveLength(2);
            const ids = tools.map((t) => t.id);
            expect(ids).toEqual(['memory_list', 'memory_get']);
        });
    });

    describe('tool definitions', () => {
        it('should have descriptions and input schemas for all tools', () => {
            const config = lifecycleToolsFactory.configSchema.parse({
                type: 'lifecycle-tools',
            });

            const tools = lifecycleToolsFactory.create(config);

            for (const tool of tools) {
                expect(tool.description).toBeDefined();
                expect(tool.description.length).toBeGreaterThan(0);
                expect(tool.inputSchema).toBeDefined();
            }
        });
    });
});
