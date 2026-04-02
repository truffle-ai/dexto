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
    const originalProjectRoot = process.env.DEXTO_PROJECT_ROOT;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        if (originalProjectRoot === undefined) {
            delete process.env.DEXTO_PROJECT_ROOT;
        } else {
            process.env.DEXTO_PROJECT_ROOT = originalProjectRoot;
        }
    });

    describe('Project with @dexto/core dependency', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'test-project',
                    dependencies: { '@dexto/core': '^1.0.0' },
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

    describe('Internal dexto packages within monorepo', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                // Root monorepo package.json
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
                // Internal webui package
                'packages/webui/package.json': {
                    name: '@dexto/webui',
                    dependencies: { '@dexto/core': 'workspace:*' },
                },
            });
        });

        it('getExecutionContext returns dexto-source when in webui package', () => {
            const webuiDir = path.join(tempDir, 'packages', 'webui');
            const result = getExecutionContext(webuiDir);
            expect(result).toBe('dexto-source');
        });

        it('findDextoSourceRoot finds monorepo root from webui package', () => {
            const webuiDir = path.join(tempDir, 'packages', 'webui');
            const result = findDextoSourceRoot(webuiDir);
            expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(tempDir));
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

    describe('Workspace markers without package.json', () => {
        it('treats Dexto workspace AGENTS.md plus authored workspace directories as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'AGENTS.md': '# Dexto Workspace\n',
                'skills/.gitkeep': '',
            });
            const nestedDir = path.join(tempDir, 'nested');
            fs.mkdirSync(nestedDir, { recursive: true });

            expect(getExecutionContext(tempDir)).toBe('dexto-project');
            expect(findDextoProjectRoot(nestedDir)).toBe(tempDir);
        });

        it('does not treat skills/*/SKILL.md alone as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'skills/release-check/SKILL.md': '# Release Check',
            });
            const srcDir = path.join(tempDir, 'src');
            fs.mkdirSync(srcDir, { recursive: true });

            expect(getExecutionContext(tempDir)).toBe('global-cli');
            expect(findDextoProjectRoot(srcDir)).toBeNull();
        });

        it('does not treat arbitrary agents/<id>/<id>.yml as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'agents/reviewer/reviewer.yml': 'agentCard:\n  name: Reviewer\n',
            });
            const nestedDir = path.join(tempDir, 'nested');
            fs.mkdirSync(nestedDir, { recursive: true });

            expect(getExecutionContext(tempDir)).toBe('global-cli');
            expect(findDextoProjectRoot(nestedDir)).toBeNull();
        });

        it('treats agents/registry.json as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'agents/registry.json': JSON.stringify({
                    agents: [
                        {
                            id: 'coding-agent',
                            name: 'Coding Agent',
                            description: 'Primary workspace agent',
                            configPath: 'coding-agent/coding-agent.yml',
                        },
                    ],
                }),
            });
            const nestedDir = path.join(tempDir, 'nested');
            fs.mkdirSync(nestedDir, { recursive: true });

            expect(getExecutionContext(tempDir)).toBe('dexto-project');
            expect(findDextoProjectRoot(nestedDir)).toBe(tempDir);
        });

        it('does not treat AGENTS.md alone as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'AGENTS.md': '# Generic agent instructions',
            });

            expect(getExecutionContext(tempDir)).toBe('global-cli');
            expect(findDextoProjectRoot(tempDir)).toBeNull();
        });

        it('does not treat generic AGENTS.md plus authored directories as a dexto-project marker', () => {
            tempDir = createTempDirStructure({
                'AGENTS.md': '# Generic agent instructions',
                'skills/.gitkeep': '',
            });

            expect(getExecutionContext(tempDir)).toBe('global-cli');
            expect(findDextoProjectRoot(tempDir)).toBeNull();
        });
    });

    describe('Forced project root override', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                '.dexto/deploy.json': {
                    version: 1,
                    agent: { type: 'cloud-default' },
                },
            });
            process.env.DEXTO_PROJECT_ROOT = tempDir;
        });

        it('treats the override as dexto-project context', () => {
            const result = getExecutionContext(path.join(tempDir, 'nested'));
            expect(result).toBe('dexto-project');
        });

        it('returns the override from findDextoProjectRoot', () => {
            const result = findDextoProjectRoot('/outside/of/project');
            expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(tempDir));
        });
    });

    describe('Forced project root override inside dexto source', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'dexto-monorepo',
                    version: '1.0.0',
                },
                'packages/webui/package.json': {
                    name: '@dexto/webui',
                    dependencies: { '@dexto/core': 'workspace:*' },
                },
            });
            process.env.DEXTO_PROJECT_ROOT = tempDir;
        });

        it('takes precedence over dexto-source detection', () => {
            const result = getExecutionContext(path.join(tempDir, 'packages', 'webui'));
            expect(result).toBe('dexto-project');
        });
    });

    describe('Invalid forced project root override', () => {
        beforeEach(() => {
            tempDir = createTempDirStructure({
                'package.json': {
                    name: 'regular-project',
                    dependencies: { express: '^4.0.0' },
                },
            });
            process.env.DEXTO_PROJECT_ROOT = path.join(tempDir, 'missing-directory');
        });

        it('ignores invalid directories', () => {
            expect(findDextoProjectRoot('/outside/of/project')).toBeNull();
            expect(getExecutionContext(tempDir)).toBe('global-cli');
        });

        it('ignores existing directories without dexto project markers', () => {
            process.env.DEXTO_PROJECT_ROOT = tempDir;

            expect(findDextoProjectRoot('/outside/of/project')).toBeNull();
            expect(getExecutionContext(tempDir)).toBe('global-cli');
        });
    });
});
