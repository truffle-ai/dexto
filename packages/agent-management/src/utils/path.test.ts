import * as fs from 'fs';
import * as path from 'path';
import { tmpdir, homedir } from 'os';
import {
    getDextoPath,
    getDextoGlobalPath,
    getDextoEnvPath,
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

    describe('in dexto source with DEXTO_DEV_MODE=true', () => {
        let originalCwd: string;
        const originalDevMode = process.env.DEXTO_DEV_MODE;

        beforeEach(() => {
            originalCwd = process.cwd();
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
            });
            process.chdir(tempDir);
            process.env.DEXTO_DEV_MODE = 'true';
        });

        afterEach(() => {
            process.chdir(originalCwd);
            if (originalDevMode === undefined) {
                delete process.env.DEXTO_DEV_MODE;
            } else {
                process.env.DEXTO_DEV_MODE = originalDevMode;
            }
        });

        it('uses repo-local .dexto for global paths', () => {
            const result = getDextoGlobalPath('sounds', 'ping.wav');
            // On macOS, temp paths may appear as /var/... or /private/var/... depending on resolution.
            const expected = path.join(tempDir, '.dexto', 'sounds', 'ping.wav');
            const expectedReal = path.join(
                fs.realpathSync(tempDir),
                '.dexto',
                'sounds',
                'ping.wav'
            );
            expect([expected, expectedReal]).toContain(result);
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
    it('resolves a known agent registry path', () => {
        const result = resolveBundledScript('agents/agent-registry.json');
        expect(path.isAbsolute(result)).toBe(true);
        expect(result.endsWith('agents/agent-registry.json')).toBe(true);
    });

    it('throws error when script cannot be resolved', () => {
        expect(() => resolveBundledScript('nonexistent/script.js')).toThrow();
    });
});

describe('getDextoEnvPath', () => {
    describe('in dexto project', () => {
        let tempDir: string;
        let originalCwd: string;

        beforeEach(() => {
            originalCwd = process.cwd();
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { dexto: '^1.0.0' },
                },
            });
        });

        afterEach(() => {
            process.chdir(originalCwd);
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('returns project root .env path', () => {
            process.chdir(tempDir);
            const result = getDextoEnvPath(tempDir);
            expect(result).toBe(path.join(tempDir, '.env'));
        });
    });

    describe('in dexto source', () => {
        let tempDir: string;
        let originalCwd: string;
        const originalDevMode = process.env.DEXTO_DEV_MODE;

        beforeEach(() => {
            originalCwd = process.cwd();
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
                'agents/default-agent.yml': 'mcpServers: {}',
            });
        });

        afterEach(() => {
            process.chdir(originalCwd);
            fs.rmSync(tempDir, { recursive: true, force: true });
            // Restore original env
            if (originalDevMode === undefined) {
                delete process.env.DEXTO_DEV_MODE;
            } else {
                process.env.DEXTO_DEV_MODE = originalDevMode;
            }
        });

        it('returns repo .env when DEXTO_DEV_MODE=true', () => {
            process.chdir(tempDir);
            process.env.DEXTO_DEV_MODE = 'true';
            const result = getDextoEnvPath(tempDir);
            expect(result).toBe(path.join(tempDir, '.env'));
        });

        it('returns global ~/.dexto/.env when DEXTO_DEV_MODE is not set', () => {
            process.chdir(tempDir);
            delete process.env.DEXTO_DEV_MODE;
            const result = getDextoEnvPath(tempDir);
            expect(result).toBe(path.join(homedir(), '.dexto', '.env'));
        });

        it('returns global ~/.dexto/.env when DEXTO_DEV_MODE=false', () => {
            process.chdir(tempDir);
            process.env.DEXTO_DEV_MODE = 'false';
            const result = getDextoEnvPath(tempDir);
            expect(result).toBe(path.join(homedir(), '.dexto', '.env'));
        });
    });

    describe('in global-cli context', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('returns global ~/.dexto/.env path', () => {
            const result = getDextoEnvPath(tempDir);
            expect(result).toBe(path.join(homedir(), '.dexto', '.env'));
        });
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
                'src/dexto/agents/default-agent.yml': 'mcpServers: {}',
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
        const originalDevMode = process.env.DEXTO_DEV_MODE;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
                'agents/default-agent.yml': 'mcpServers: {}',
            });
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            // Restore original env
            if (originalDevMode === undefined) {
                delete process.env.DEXTO_DEV_MODE;
            } else {
                process.env.DEXTO_DEV_MODE = originalDevMode;
            }
        });

        it('uses local repo storage when DEXTO_DEV_MODE=true', () => {
            process.env.DEXTO_DEV_MODE = 'true';
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
        });

        it('uses global storage when DEXTO_DEV_MODE is not set', () => {
            delete process.env.DEXTO_DEV_MODE;
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toContain('.dexto');
            expect(logPath).toContain('logs');
            expect(logPath).toContain('dexto.log');
            expect(logPath).not.toContain(tempDir); // Should be global, not local
        });

        it('uses global storage when DEXTO_DEV_MODE=false', () => {
            process.env.DEXTO_DEV_MODE = 'false';
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toContain('.dexto');
            expect(logPath).toContain('logs');
            expect(logPath).toContain('dexto.log');
            expect(logPath).not.toContain(tempDir); // Should be global, not local
        });
    });
});
