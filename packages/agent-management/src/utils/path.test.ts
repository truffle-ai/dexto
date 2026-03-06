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
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

function createTempDir() {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-test-'));
}

function createTempDirStructure(structure: Record<string, unknown>, baseDir?: string): string {
    const tempDir = baseDir || createTempDir();

    for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tempDir, filePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (typeof content === 'string') {
            fs.writeFileSync(fullPath, content);
        } else if (typeof content === 'object' && content !== null) {
            fs.writeFileSync(fullPath, JSON.stringify(content, null, 2));
        }
    }

    return tempDir;
}

const originalHomeDir = process.env.DEXTO_HOME_DIR;

beforeEach(() => {
    delete process.env.DEXTO_HOME_DIR;
});

afterEach(() => {
    delete process.env.DEXTO_HOME_DIR;
});

afterAll(() => {
    if (originalHomeDir !== undefined) {
        process.env.DEXTO_HOME_DIR = originalHomeDir;
    }
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

    describe('in dexto source', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
            });
        });

        it('returns source-local path', () => {
            const result = getDextoPath('logs', 'source.log', tempDir);
            expect(result).toBe(path.join(tempDir, '.dexto', 'logs', 'source.log'));
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
            const result = getDextoPath('logs', 'global.log', tempDir);
            expect(result).toBe(path.join(homedir(), '.dexto', 'logs', 'global.log'));
        });
    });

    describe('DEXTO_HOME_DIR override', () => {
        let overrideDir: string;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
            overrideDir = createTempDir();
            process.env.DEXTO_HOME_DIR = overrideDir;
        });

        afterEach(() => {
            fs.rmSync(overrideDir, { recursive: true, force: true });
        });

        it('uses override path regardless of execution context', () => {
            const result = getDextoPath('logs', 'override.log', tempDir);
            expect(result).toBe(path.join(overrideDir, 'logs', 'override.log'));
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
        it('returns an absolute path', () => {
            const result = getDextoGlobalPath('agents');
            expect(path.isAbsolute(result)).toBe(true);
            expect(result).toContain('agents');
        });
    });

    describe('in dexto source', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
            });
        });

        it('uses repo-local .dexto for global paths', () => {
            const result = getDextoGlobalPath('sounds', 'ping.wav', tempDir);
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

        it('returns home-global path, not project-relative path', () => {
            const projectPath = getDextoPath('agents', 'test-agent', tempDir);
            expect(projectPath).toBe(path.join(tempDir, '.dexto', 'agents', 'test-agent'));

            const globalPath = getDextoGlobalPath('agents', 'test-agent', tempDir);
            expect(globalPath).toBe(path.join(homedir(), '.dexto', 'agents', 'test-agent'));
        });
    });

    describe('DEXTO_HOME_DIR override', () => {
        let overrideDir: string;

        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
            });
            overrideDir = createTempDir();
            process.env.DEXTO_HOME_DIR = overrideDir;
        });

        afterEach(() => {
            fs.rmSync(overrideDir, { recursive: true, force: true });
        });

        it('uses override path even in source context', () => {
            const result = getDextoGlobalPath('cache', 'models.json', tempDir);
            expect(result).toBe(path.join(overrideDir, 'cache', 'models.json'));
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
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('returns project root .env path in dexto project', () => {
        tempDir = createTempDirStructure({
            'package.json': {
                name: 'test-project',
                dependencies: { dexto: '^1.0.0' },
            },
        });

        const result = getDextoEnvPath(tempDir);
        expect(result).toBe(path.join(tempDir, '.env'));
    });

    it('returns source root .env path in dexto source', () => {
        tempDir = createTempDirStructure({
            'package.json': {
                name: 'dexto-monorepo',
                version: '1.0.0',
            },
        });

        const result = getDextoEnvPath(tempDir);
        expect(result).toBe(path.join(tempDir, '.env'));
    });

    it('returns home-global .env path in global-cli context', () => {
        tempDir = createTempDirStructure({
            'package.json': {
                name: 'regular-project',
                dependencies: { express: '^4.0.0' },
            },
        });

        const result = getDextoEnvPath(tempDir);
        expect(result).toBe(path.join(homedir(), '.dexto', '.env'));
    });

    it('uses DEXTO_HOME_DIR override when set', () => {
        tempDir = createTempDir();
        process.env.DEXTO_HOME_DIR = tempDir;

        const result = getDextoEnvPath('/any/path');
        expect(result).toBe(path.join(tempDir, '.env'));
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
        });

        it('uses local repo storage', () => {
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
        });
    });
});
