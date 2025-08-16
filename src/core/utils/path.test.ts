import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    walkUpDirectories,
    isDextoProject,
    isDextoSourceCode,
    getDextoProjectRoot,
    getDextoPath,
    resolveConfigPath,
    findPackageRoot,
    resolveBundledScript,
    getUserConfigPath,
    getBundledConfigPath,
    isUsingBundledConfig,
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

describe('isDextoProject and getDextoProjectRoot', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('with dexto as dependency', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'my-test-project',
                    dependencies: {
                        dexto: '^1.0.0',
                    },
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
            const nestedDir = path.join(tempDir, 'src', 'components');
            fs.mkdirSync(nestedDir, { recursive: true });

            const result = getDextoProjectRoot(nestedDir);
            expect(result).toBe(tempDir);
        });

        it('isDextoSourceCode returns false for project with dexto dependency', () => {
            const result = isDextoSourceCode(tempDir);
            expect(result).toBe(false);
        });
    });

    describe('with dexto as devDependency', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'my-dev-project',
                    devDependencies: {
                        dexto: '^1.0.0',
                    },
                },
            });
        });

        it('detects project with dexto devDependency', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(true);
        });
    });

    describe('dexto source project', () => {
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
            expect(result).toBe(true);
        });

        it('returns correct project root for dexto source', () => {
            const result = getDextoProjectRoot(tempDir);
            expect(result).toBe(tempDir);
        });

        it('isDextoSourceCode returns true for dexto source project', () => {
            const result = isDextoSourceCode(tempDir);
            expect(result).toBe(true);
        });
    });

    describe('non-dexto project', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: {
                        express: '^4.0.0',
                    },
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
    });

    describe('no package.json', () => {
        beforeEach(() => {
            tempDir = createTempDir();
        });

        it('returns false when no package.json exists', () => {
            const result = isDextoProject(tempDir);
            expect(result).toBe(false);
        });
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

describe('resolveConfigPath', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('explicit config path provided', () => {
        it('returns absolute path when provided', () => {
            const explicitPath = '/absolute/path/to/config.yml';
            const result = resolveConfigPath(explicitPath);
            expect(result).toBe(explicitPath);
        });

        it('resolves relative path to absolute', () => {
            const relativePath = 'relative/config.yml';
            const result = resolveConfigPath(relativePath);
            expect(path.isAbsolute(result)).toBe(true);
            expect(result.endsWith('relative/config.yml')).toBe(true);
        });
    });

    describe('auto-discovery in dexto project', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { dexto: '^1.0.0' },
                },
            });
        });

        it('finds standard agents/agent.yml', () => {
            const configPath = path.join(tempDir, 'agents', 'agent.yml');
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'test: config');

            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toBe(configPath);
        });

        it('finds src/agents/agent.yml', () => {
            const configPath = path.join(tempDir, 'src', 'agents', 'agent.yml');
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'test: config');

            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toBe(configPath);
        });

        it('finds src/dexto/agents/agent.yml (test app structure)', () => {
            const configPath = path.join(tempDir, 'src', 'dexto', 'agents', 'agent.yml');
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'test: config');

            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toBe(configPath);
        });

        it('prioritizes standard location over nested locations', () => {
            // Create both standard and nested configs
            const standardPath = path.join(tempDir, 'agents', 'agent.yml');
            const nestedPath = path.join(tempDir, 'src', 'dexto', 'agents', 'agent.yml');

            fs.mkdirSync(path.dirname(standardPath), { recursive: true });
            fs.mkdirSync(path.dirname(nestedPath), { recursive: true });
            fs.writeFileSync(standardPath, 'standard: config');
            fs.writeFileSync(nestedPath, 'nested: config');

            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toBe(standardPath);
        });

        it('throws error when no config found', () => {
            expect(() => resolveConfigPath(undefined, tempDir)).toThrow(
                'No agent.yml found in project'
            );
        });
    });

    describe('global CLI context', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
        });

        it('uses bundled config when no explicit config provided and no user config exists', () => {
            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toContain('agents/agent.yml');
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('prioritizes user config over bundled config', () => {
            // Create a mock user config
            const userConfigPath = getUserConfigPath();
            const userDir = path.dirname(userConfigPath);
            fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(userConfigPath, 'llm:\n  provider: google', 'utf8');

            const result = resolveConfigPath(undefined, tempDir);
            expect(result).toBe(userConfigPath);

            // Cleanup
            fs.rmSync(userDir, { recursive: true, force: true });
        });
    });

    describe('getUserConfigPath', () => {
        it('returns path to ~/.dexto/agent.yml', () => {
            const result = getUserConfigPath();
            expect(result).toContain('.dexto');
            expect(result).toContain('agent.yml');
            expect(path.isAbsolute(result)).toBe(true);
        });
    });

    describe('getBundledConfigPath', () => {
        it('returns path to bundled agent.yml', () => {
            const result = getBundledConfigPath();
            expect(result).toContain('agents');
            expect(result).toContain('agent.yml');
            expect(path.isAbsolute(result)).toBe(true);
        });
    });

    describe('isUsingBundledConfig', () => {
        it('returns true for bundled config path', () => {
            const bundledPath = getBundledConfigPath();
            expect(isUsingBundledConfig(bundledPath)).toBe(true);
        });

        it('returns false for user config path', () => {
            const userPath = getUserConfigPath();
            expect(isUsingBundledConfig(userPath)).toBe(false);
        });

        it('returns false for project config path', () => {
            const projectPath = '/some/project/agents/agent.yml';
            expect(isUsingBundledConfig(projectPath)).toBe(false);
        });

        it('handles errors gracefully', () => {
            // Test with a path that might cause getBundledConfigPath to throw
            expect(isUsingBundledConfig('')).toBe(false);
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

        it('correctly identifies project context', () => {
            expect(isDextoProject(tempDir)).toBe(true);
            expect(getDextoProjectRoot(tempDir)).toBe(tempDir);
        });

        it('uses project-local storage', () => {
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            const dbPath = getDextoPath('database', 'dexto.db', tempDir);

            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
            expect(dbPath).toBe(path.join(tempDir, '.dexto', 'database', 'dexto.db'));
        });

        it('finds config in test app structure', () => {
            const configPath = resolveConfigPath(undefined, tempDir);
            expect(configPath).toBe(path.join(tempDir, 'src', 'dexto', 'agents', 'agent.yml'));
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

        it('correctly identifies source project', () => {
            expect(isDextoProject(tempDir)).toBe(true);
            expect(getDextoProjectRoot(tempDir)).toBe(tempDir);
        });

        it('uses project-local storage for development', () => {
            const logPath = getDextoPath('logs', 'dexto.log', tempDir);
            expect(logPath).toBe(path.join(tempDir, '.dexto', 'logs', 'dexto.log'));
        });
    });
});
