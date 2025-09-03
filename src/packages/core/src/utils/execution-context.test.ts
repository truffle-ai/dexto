import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
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

        it('getExecutionContext returns dexto-project', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-project');
        });

        it('findDextoProjectRoot returns correct root from nested directory', () => {
            // Set up nested directory
            const nestedDir = path.join(tempDir, 'nested', 'deep');
            fs.mkdirSync(nestedDir, { recursive: true });

            const result = findDextoProjectRoot(nestedDir);
            // Normalize paths for macOS symlink differences (/var vs /private/var)
            expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(tempDir));
        });

        it('findDextoSourceRoot returns null for dexto-project context', () => {
            const result = findDextoSourceRoot(tempDir);
            expect(result).toBeNull();
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

        it('getExecutionContext returns dexto-project', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-project');
        });
    });

    describe('Dexto source project itself', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
            });
        });

        it('getExecutionContext returns dexto-source', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('dexto-source');
        });

        it('findDextoSourceRoot returns correct root', () => {
            const result = findDextoSourceRoot(tempDir);
            // Normalize paths for macOS symlink differences (/var vs /private/var)
            expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(tempDir));
        });

        it('findDextoProjectRoot returns null for dexto-source context', () => {
            const result = findDextoProjectRoot(tempDir);
            expect(result).toBeNull();
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

        it('getExecutionContext returns global-cli', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('global-cli');
        });

        it('findDextoSourceRoot returns null for global-cli context', () => {
            const result = findDextoSourceRoot(tempDir);
            expect(result).toBeNull();
        });

        it('findDextoProjectRoot returns null for global-cli context', () => {
            const result = findDextoProjectRoot(tempDir);
            expect(result).toBeNull();
        });
    });

    describe('No package.json', () => {
        beforeEach(() => {
            tempDir = createTempDir();
        });

        it('getExecutionContext returns global-cli', () => {
            const result = getExecutionContext(tempDir);
            expect(result).toBe('global-cli');
        });

        it('find functions return null for non-dexto directories', () => {
            expect(findDextoSourceRoot(tempDir)).toBeNull();
            expect(findDextoProjectRoot(tempDir)).toBeNull();
        });
    });
});
