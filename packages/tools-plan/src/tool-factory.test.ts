/**
 * Plan Tools Factory Tests
 *
 * Validates the plan tools factory schema and tool creation.
 */

import { describe, it, expect } from 'vitest';
import { planToolsFactory } from './tool-factory.js';

describe('planToolsFactory', () => {
    describe('factory metadata', () => {
        it('should have metadata', () => {
            expect(planToolsFactory.metadata).toBeDefined();
            expect(planToolsFactory.metadata?.displayName).toBe('Plan Tools');
            expect(planToolsFactory.metadata?.category).toBe('planning');
        });
    });

    describe('config schema', () => {
        it('should validate minimal config', () => {
            const result = planToolsFactory.configSchema.safeParse({
                type: 'plan-tools',
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.basePath).toBe('.dexto/plans');
            }
        });

        it('should validate config with custom basePath', () => {
            const result = planToolsFactory.configSchema.safeParse({
                type: 'plan-tools',
                basePath: '/custom/path',
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.basePath).toBe('/custom/path');
            }
        });

        it('should validate config with enabledTools', () => {
            const result = planToolsFactory.configSchema.safeParse({
                type: 'plan-tools',
                enabledTools: ['plan_create', 'plan_read'],
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.enabledTools).toEqual(['plan_create', 'plan_read']);
            }
        });

        it('should reject invalid tool names', () => {
            const result = planToolsFactory.configSchema.safeParse({
                type: 'plan-tools',
                enabledTools: ['invalid_tool'],
            });

            expect(result.success).toBe(false);
        });

        it('should reject unknown properties', () => {
            const result = planToolsFactory.configSchema.safeParse({
                type: 'plan-tools',
                unknownProp: 'value',
            });

            expect(result.success).toBe(false);
        });
    });

    describe('create', () => {
        it('should create all tools by default', () => {
            const config = planToolsFactory.configSchema.parse({
                type: 'plan-tools',
            });

            const tools = planToolsFactory.create(config);

            expect(tools).toHaveLength(4);
            const toolIds = tools.map((t) => t.id);
            expect(toolIds).toContain('plan_create');
            expect(toolIds).toContain('plan_read');
            expect(toolIds).toContain('plan_update');
            expect(toolIds).toContain('plan_review');
        });

        it('should create only enabled tools', () => {
            const config = planToolsFactory.configSchema.parse({
                type: 'plan-tools',
                enabledTools: ['plan_create', 'plan_read'],
            });

            const tools = planToolsFactory.create(config);

            expect(tools).toHaveLength(2);
            const toolIds = tools.map((t) => t.id);
            expect(toolIds).toContain('plan_create');
            expect(toolIds).toContain('plan_read');
            expect(toolIds).not.toContain('plan_update');
        });
    });

    describe('tool definitions', () => {
        it('should have descriptions and input schemas for all tools', () => {
            const config = planToolsFactory.configSchema.parse({
                type: 'plan-tools',
            });

            const tools = planToolsFactory.create(config);

            for (const tool of tools) {
                expect(tool.description).toBeDefined();
                expect(tool.description.length).toBeGreaterThan(0);
                expect(tool.inputSchema).toBeDefined();
            }
        });
    });
});
