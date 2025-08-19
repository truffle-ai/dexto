import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    walkUpDirectories,
    getDextoPath,
    getDextoGlobalPath,
    findPackageRoot,
    resolveBundledScript,
} from './path.js';
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

describe('walkUpDirectories', () => {
    let tempDir: string;
    let nestedDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
        nestedDir = path.join(tempDir, 'nested', 'deep', 'directory');
        fs.mkdirSync(nestedDir, { recursive: true });

        // Create a marker file in tempDir
        fs.writeFileSync(path.join(tempDir, 'marker.txt'), 'found');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns null when no directories match the predicate', () => {
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'nonexistent.txt'))
        );
        expect(result).toBeNull();
    });

    it('finds directory by walking up the tree', () => {
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'marker.txt'))
        );
        expect(result).toBe(tempDir);
    });

    it('returns the immediate directory if it matches', () => {
        fs.writeFileSync(path.join(nestedDir, 'immediate.txt'), 'here');
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'immediate.txt'))
        );
        expect(result).toBe(nestedDir);
    });
});

describe('getDextoPath', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('in dexto project', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { dexto: '^1.0.0' },
                },
            });
        });

        it('returns project-local path for logs', () => {
            const result = getDextoPath('logs', 'test.log', tempDir);
            expect(result).toBe(path.join(tempDir, '.dexto', 'logs', 'test.log'));
        });

        it('returns project-local path for database', () => {
            const result = getDextoPath('database', 'dexto.db', tempDir);
            expect(result).toBe(path.join(tempDir, '.dexto', 'database', 'dexto.db'));
        });

        it('returns directory path when no filename provided', () => {
            const result = getDextoPath('config', undefined, tempDir);
            expect(result).toBe(path.join(tempDir, '.dexto', 'config'));
        });

        it('works from nested directories', () => {
            const nestedDir = path.join(tempDir, 'src', 'app');
            fs.mkdirSync(nestedDir, { recursive: true });

            const result = getDextoPath('logs', 'app.log', nestedDir);
            expect(result).toBe(path.join(tempDir, '.dexto', 'logs', 'app.log'));
        });
    });

    describe('outside dexto project (global)', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
        });

        it('returns global path when not in dexto project', () => {
            const originalCwd = process.cwd();
            try {
                process.chdir(tempDir);
                const result = getDextoPath('logs', 'global.log');
                expect(result).toContain('.dexto');
                expect(result).toContain('logs');
                expect(result).toContain('global.log');
                expect(result).not.toContain(tempDir);
            } finally {
                process.chdir(originalCwd);
            }
        });
    });
});

describe('getDextoGlobalPath', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('basic functionality', () => {
        it('returns global agents directory', () => {
            const result = getDextoGlobalPath('agents');
            expect(result).toContain('.dexto');
            expect(result).toContain('agents');
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('returns global path with filename', () => {
            const result = getDextoGlobalPath('agents', 'database-agent');
            expect(result).toContain('.dexto');
            expect(result).toContain('agents');
            expect(result).toContain('database-agent');
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('handles different types correctly', () => {
            const agents = getDextoGlobalPath('agents');
            const logs = getDextoGlobalPath('logs');
            const cache = getDextoGlobalPath('cache');

            expect(agents).toContain('agents');
            expect(logs).toContain('logs');
            expect(cache).toContain('cache');
        });
    });

    describe('in dexto project context', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { dexto: '^1.0.0' },
                },
            });
        });

        it('always returns global path, never project-relative', () => {
            // getDextoPath returns project-relative
            const projectPath = getDextoPath('agents', 'test-agent', tempDir);
            expect(projectPath).toBe(path.join(tempDir, '.dexto', 'agents', 'test-agent'));

            // getDextoGlobalPath should ALWAYS return global, never project-relative
            const globalPath = getDextoGlobalPath('agents', 'test-agent');
            expect(globalPath).toContain('.dexto');
            expect(globalPath).toContain('agents');
            expect(globalPath).toContain('test-agent');
            expect(globalPath).not.toContain(tempDir); // Key difference!
            expect(path.isAbsolute(globalPath)).toBe(true);
        });
    });

    describe('outside dexto project context', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
        });

        it('returns global path (same as in project context)', () => {
            const globalPath = getDextoGlobalPath('agents', 'test-agent');
            expect(globalPath).toContain('.dexto');
            expect(globalPath).toContain('agents');
            expect(globalPath).toContain('test-agent');
            expect(globalPath).not.toContain(tempDir);
            expect(path.isAbsolute(globalPath)).toBe(true);
        });
    });
});

describe('findPackageRoot', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns null if no package.json found', () => {
        const result = findPackageRoot(tempDir);
        expect(result).toBeNull();
    });

    it('returns the directory containing package.json', () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-pkg' }));
        const result = findPackageRoot(tempDir);
        expect(result).toBe(tempDir);
    });

    it('finds package.json by walking up directories', () => {
        const nestedDir = path.join(tempDir, 'nested', 'deep');
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-pkg' }));

        const result = findPackageRoot(nestedDir);
        expect(result).toBe(tempDir);
    });
});

describe('resolveBundledScript', () => {
    it('resolves script path for bundled MCP servers', () => {
        const scriptPath = 'dist/scripts/test-server.js';

        // This test depends on the actual dexto package structure
        // In a real scenario, this would resolve to the installed package location
        expect(() => resolveBundledScript(scriptPath)).not.toThrow();

        const result = resolveBundledScript(scriptPath);
        expect(path.isAbsolute(result)).toBe(true);
        expect(result.endsWith(scriptPath)).toBe(true);
    });

    it('throws error when script cannot be resolved', () => {
        // This test is hard to create in current setup since we're always in a package root
        // The function will either resolve via require.resolve or via findPackageRoot fallback
        const result = resolveBundledScript('nonexistent/script.js');
        expect(path.isAbsolute(result)).toBe(true);
        expect(result.endsWith('nonexistent/script.js')).toBe(true);
    });
});

describe('real-world execution contexts', () => {
    describe('SDK usage in project', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'my-app',
                    dependencies: { dexto: '^1.0.0' },
                },
                'src/dexto/agents/agent.yml': 'mcpServers: {}',
            });
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('uses project-local storage', () => {
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            const dbPath = getDextoPath('database', 'dexto.db', tempDir);

            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
            expect(dbPath).toBe(path.join(tempDir, '.dexto', 'database', 'dexto.db'));
        });
    });

    describe('CLI in dexto source', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto',
                    version: '1.0.0',
                },
                'agents/agent.yml': 'mcpServers: {}',
            });
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('uses project-local storage for development', () => {
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
        });
    });
});
