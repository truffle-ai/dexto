import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    getExecutionContext,
    isDextoProject,
    isDextoSourceCode,
    getDextoProjectRoot,
    isGlobalCLI,
} from './execution-context.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

function createTempDir() {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-test-'));
}

function createTempDirStructure(structure: Record<string, any>, baseDir?: string): string {
    const tempDir = baseDir || createTempDir();

    for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tempDir, filePath);
        const dir = path.dirname(fullPath);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (typeof content === 'string') {
            fs.writeFileSync(fullPath, content);
        } else if (typeof content === 'object') {
            fs.writeFileSync(fullPath, JSON.stringify(content, null, 2));
        }
    }

    return tempDir;
}

describe('Execution Context Detection', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Project with dexto dependency', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { dexto: '^1.0.0' },
                },
            });
        });

        it('detects project with dexto dependency', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(true);
        });

        it('returns correct project root', () => {
            const result = getDextoProjectRoot(tempDir);
            expect(result).toBe(tempDir);
        });

        it('finds project root from nested directory', () => {
            const nestedDir = path.join(tempDir, 'nested', 'deep');
            fs.mkdirSync(nestedDir, { recursive: true });

            const result = getDextoProjectRoot(nestedDir);
            expect(result).toBe(tempDir);
        });

        it('isDextoSourceCode returns false for project with dexto dependency', () => {
            const result = isDextoSourceCode(tempDir);
            expect(result).toBe(false);
        });

        it('getExecutionContext returns dexto-project', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-project');
        });

        it('isGlobalCLI returns false', () => {
            const result = isGlobalCLI(tempDir);
            expect(result).toBe(false);
        });
    });

    describe('Project with dexto devDependency', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    devDependencies: { dexto: '^1.0.0' },
                },
            });
        });

        it('detects project with dexto devDependency', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(true);
        });

        it('getExecutionContext returns dexto-project', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-project');
        });
    });

    describe('Dexto source project itself', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto',
                    version: '1.0.0',
                },
            });
        });

        it('detects dexto source project itself', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(false); // Should be false because it's source, not a regular project
        });

        it('returns correct project root for dexto source', () => {
            const result = getDextoProjectRoot(tempDir);
            expect(result).toBe(tempDir);
        });

        it('isDextoSourceCode returns true for dexto source project', () => {
            const result = isDextoSourceCode(tempDir);
            expect(result).toBe(true);
        });

        it('getExecutionContext returns dexto-source', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-source');
        });

        it('isGlobalCLI returns false', () => {
            const result = isGlobalCLI(tempDir);
            expect(result).toBe(false);
        });
    });

    describe('Non-dexto project', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
        });

        it('returns false for non-dexto project', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(false);
        });

        it('isDextoSourceCode returns false for non-dexto project', () => {
            const result = isDextoSourceCode(tempDir);
            expect(result).toBe(false);
        });

        it('returns null for non-dexto project root', () => {
            const result = getDextoProjectRoot(tempDir);
            expect(result).toBeNull();
        });

        it('getExecutionContext returns global-cli', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('global-cli');
        });

        it('isGlobalCLI returns true', () => {
            const result = isGlobalCLI(tempDir);
            expect(result).toBe(true);
        });
    });

    describe('No package.json', () => {
        beforeEach(() => {
            tempDir = createTempDir();
        });

        it('returns false when no package.json exists', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(false);
        });

        it('returns null for project root when no package.json', () => {
            const result = getDextoProjectRoot(tempDir);
            expect(result).toBeNull();
        });

        it('getExecutionContext returns global-cli', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('global-cli');
        });

        it('isGlobalCLI returns true', () => {
            const result = isGlobalCLI(tempDir);
            expect(result).toBe(true);
        });
    });
});
