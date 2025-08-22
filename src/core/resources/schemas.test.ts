import { describe, it, expect } from 'vitest';
import { InternalResourcesSchema, isInternalResourcesEnabled } from './schemas.js';

describe('InternalResourcesSchema - New Auto-Enable Logic', () => {
    describe('Configuration Parsing', () => {
        it('should auto-enable when resources are specified', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['.', 'src/'],
                },
            ];

            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources).toHaveLength(1);
            expect(result.resources[0]!.type).toBe('filesystem');
            expect(result.resources[0]!.paths).toEqual(['.', 'src/']);
        });

        it('should disable when empty array provided', () => {
            const input: any[] = [];

            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(false);
            expect(result.resources).toHaveLength(0);
        });

        it('should disable when undefined (default)', () => {
            const result = InternalResourcesSchema.parse(undefined);

            expect(result.enabled).toBe(false);
            expect(result.resources).toHaveLength(0);
        });

        it('should handle multiple resource configurations', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['.'],
                    maxDepth: 2,
                    maxFiles: 500,
                },
                {
                    type: 'filesystem' as const,
                    paths: ['data/'],
                    includeHidden: true,
                    includeExtensions: ['.md', '.txt'],
                },
            ];

            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources).toHaveLength(2);
            expect(result.resources[0]!.maxDepth).toBe(2);
            expect(result.resources[0]!.maxFiles).toBe(500);
            expect(result.resources[1]!.includeHidden).toBe(true);
            expect(result.resources[1]!.includeExtensions).toEqual(['.md', '.txt']);
        });
    });

    describe('Helper Functions', () => {
        it('isInternalResourcesEnabled should return true for enabled config', () => {
            const config = {
                enabled: true,
                resources: [{ type: 'filesystem' as const, paths: ['.'] }],
            };

            expect(isInternalResourcesEnabled(config)).toBe(true);
        });

        it('isInternalResourcesEnabled should return false for disabled config', () => {
            const config = {
                enabled: false,
                resources: [],
            };

            expect(isInternalResourcesEnabled(config)).toBe(false);
        });

        it('isInternalResourcesEnabled should return false when enabled but no resources', () => {
            const config = {
                enabled: true,
                resources: [],
            };

            expect(isInternalResourcesEnabled(config)).toBe(false);
        });
    });

    describe('Validation', () => {
        it('should validate filesystem resource configuration', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['src/', 'README.md'],
                    maxDepth: 5,
                    maxFiles: 2000,
                    includeHidden: false,
                    includeExtensions: ['.ts', '.js', '.md'],
                },
            ];

            expect(() => InternalResourcesSchema.parse(input)).not.toThrow();
        });

        it('should reject invalid maxDepth', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['.'],
                    maxDepth: 15, // Too high
                },
            ];

            expect(() => InternalResourcesSchema.parse(input)).toThrow();
        });

        it('should reject invalid maxFiles', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['.'],
                    maxFiles: 0, // Too low
                },
            ];

            expect(() => InternalResourcesSchema.parse(input)).toThrow();
        });

        it('should reject empty paths array', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: [], // Empty paths
                },
            ];

            expect(() => InternalResourcesSchema.parse(input)).toThrow();
        });
    });

    describe('Hybrid Input Format Support', () => {
        it('should handle legacy object format with explicit enabled', () => {
            const input = {
                enabled: true,
                resources: [{ type: 'filesystem' as const, paths: ['.'] }],
            };
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources).toHaveLength(1);
        });

        it('should handle legacy object format with auto-enable logic', () => {
            const input = {
                resources: [{ type: 'filesystem' as const, paths: ['src/'] }],
            };
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true); // Auto-enabled because resources present
            expect(result.resources).toHaveLength(1);
        });

        it('should handle legacy object format disabled', () => {
            const input = {
                enabled: false,
                resources: [{ type: 'filesystem' as const, paths: ['.'] }],
            };
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(false); // Explicitly disabled
            expect(result.resources).toHaveLength(1);
        });

        it('should prefer array format over object format', () => {
            const input = [{ type: 'filesystem' as const, paths: ['docs/'] }];
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources).toHaveLength(1);
            expect(result.resources[0]!.paths).toEqual(['docs/']);
        });
    });

    describe('Clean Configuration Examples', () => {
        it('should handle simple current directory config', () => {
            const input = [{ type: 'filesystem' as const, paths: ['.'] }];
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources[0]!.paths).toEqual(['.']);
        });

        it('should handle multiple paths config', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['.', 'src/', 'data/', 'README.md'],
                },
            ];
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources[0]!.paths).toEqual(['.', 'src/', 'data/', 'README.md']);
        });

        it('should handle safe defaults', () => {
            const input = [
                {
                    type: 'filesystem' as const,
                    paths: ['src/'],
                    maxDepth: 3, // Safe depth
                    maxFiles: 1000, // Reasonable limit
                    includeHidden: false, // Skip hidden files
                },
            ];
            const result = InternalResourcesSchema.parse(input);

            expect(result.enabled).toBe(true);
            expect(result.resources[0]!.maxDepth).toBe(3);
            expect(result.resources[0]!.maxFiles).toBe(1000);
            expect(result.resources[0]!.includeHidden).toBe(false);
        });
    });
});
