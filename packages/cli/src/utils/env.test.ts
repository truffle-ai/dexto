import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock agent-management to control execution context and env path behavior in tests
vi.mock('@dexto/agent-management', async () => {
    const actual =
        await vi.importActual<typeof import('@dexto/agent-management')>('@dexto/agent-management');
    return {
        ...actual,
        getDextoEnvPath: vi.fn((startPath: string = process.cwd()) => {
            return path.join(startPath, '.env');
        }),
        getExecutionContext: vi.fn((startPath: string = process.cwd()) => {
            const pkgPath = path.join(startPath, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                if (pkg.name === 'dexto-monorepo' || pkg.name === 'dexto') {
                    return 'dexto-source';
                }
                if (pkg.dependencies?.dexto || pkg.devDependencies?.dexto) {
                    return 'dexto-project';
                }
            }
            return 'global-cli';
        }),
        ensureDextoGlobalDirectory: vi.fn(async () => {
            // No-op in tests to avoid creating real directories
        }),
    };
});

import { loadEnvironmentVariables, applyLayeredEnvironmentLoading } from './env.js';
import { updateEnvFile } from '@dexto/agent-management';

function createTempDir() {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-env-test-'));
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

        // Write file content
        if (typeof content === 'string') {
            fs.writeFileSync(fullPath, content, 'utf-8');
        } else {
            fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf-8');
        }
    }

    return tempDir;
}

function cleanupTempDir(dir: string) {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (error) {
        // Ignore cleanup errors in tests to avoid masking real test failures
        console.warn(`Failed to cleanup temp dir ${dir}:`, error);
    }
}

describe('Core Environment Loading', () => {
    let originalEnv: Record<string, string | undefined>;
    let originalCwd: string;

    beforeEach(() => {
        // Save original state
        originalEnv = { ...process.env };
        originalCwd = process.cwd();

        // Clean up environment variables that might interfere with tests
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.GROQ_API_KEY;
        delete process.env.DEXTO_LOG_LEVEL;
        delete process.env.TEST_VAR;
        delete process.env.SHELL_ONLY;
        delete process.env.CWD_ONLY;
        delete process.env.PROJECT_ONLY;
        delete process.env.SHELL_KEY;
        delete process.env.NEW_VAR;
        delete process.env.EXISTING_VAR;
        delete process.env.DEFINED_VAR;
        delete process.env.EMPTY_VAR;
        delete process.env.UNDEFINED_VAR;
    });

    afterEach(() => {
        // Restore original state
        process.env = originalEnv;

        // Ensure we're back in the original directory
        try {
            process.chdir(originalCwd);
        } catch {
            // If original CWD was deleted, go to tmpdir
            process.chdir(tmpdir());
        }
    });

    describe('loadEnvironmentVariables', () => {
        it('loads from shell environment (highest priority)', async () => {
            const tempDir = createTempDir();
            try {
                // Set shell environment
                process.env.OPENAI_API_KEY = 'shell-key';
                process.env.DEXTO_LOG_LEVEL = 'debug';

                const env = await loadEnvironmentVariables(tempDir);

                expect(env.OPENAI_API_KEY).toBe('shell-key');
                expect(env.DEXTO_LOG_LEVEL).toBe('debug');
            } finally {
                cleanupTempDir(tempDir);
            }
        });

        it('loads from CWD .env', async () => {
            // Create a CWD with .env
            const cwdDir = createTempDir();
            createTempDirStructure(
                {
                    '.env': 'OPENAI_API_KEY=cwd-key\nDEXTO_LOG_LEVEL=info',
                },
                cwdDir
            );

            try {
                process.chdir(cwdDir);
                const env = await loadEnvironmentVariables(cwdDir);

                expect(env.OPENAI_API_KEY).toBe('cwd-key');
                expect(env.DEXTO_LOG_LEVEL).toBe('info');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(cwdDir);
            }
        });

        it('loads from project .env when in dexto project', async () => {
            // Create dexto project structure
            const projectDir = createTempDir();
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': 'OPENAI_API_KEY=project-key\nDEXTO_LOG_LEVEL=warn',
                },
                projectDir
            );

            try {
                // Change to project directory so context detection works
                process.chdir(projectDir);
                const env = await loadEnvironmentVariables(projectDir);

                expect(env.OPENAI_API_KEY).toBe('project-key');
                expect(env.DEXTO_LOG_LEVEL).toBe('warn');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(projectDir);
            }
        });

        it('loads from source .env when in dexto-source', async () => {
            // Create dexto source structure
            const sourceDir = createTempDir();
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ name: 'dexto-monorepo', version: '1.0.0' }),
                    '.env': 'OPENAI_API_KEY=source-key\nDEXTO_LOG_LEVEL=error',
                    'agents/default-agent.yml': 'mcpServers: {}',
                },
                sourceDir
            );

            try {
                // Change to source directory so context detection works
                process.chdir(sourceDir);
                const env = await loadEnvironmentVariables(sourceDir);

                expect(env.OPENAI_API_KEY).toBe('source-key');
                expect(env.DEXTO_LOG_LEVEL).toBe('error');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(sourceDir);
            }
        });

        it('handles priority system: Shell > CWD > Project', async () => {
            // Create project directory
            const projectDir = createTempDir();
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': 'OPENAI_API_KEY=project-key\nANTHROPIC_API_KEY=project-anthropic\nPROJECT_ONLY=project-value',
                },
                projectDir
            );

            // Create CWD directory
            const cwdDir = createTempDir();
            createTempDirStructure(
                {
                    '.env': 'OPENAI_API_KEY=cwd-key\nCWD_ONLY=cwd-value',
                },
                cwdDir
            );

            try {
                process.chdir(cwdDir);

                // Shell environment (highest)
                process.env.OPENAI_API_KEY = 'shell-key';
                process.env.SHELL_ONLY = 'shell-value';

                const env = await loadEnvironmentVariables(projectDir);

                // Shell wins
                expect(env.OPENAI_API_KEY).toBe('shell-key');
                expect(env.SHELL_ONLY).toBe('shell-value');

                // CWD wins over project
                expect(env.CWD_ONLY).toBe('cwd-value');

                // Project used when no override
                expect(env.ANTHROPIC_API_KEY).toBe('project-anthropic');
                expect(env.PROJECT_ONLY).toBe('project-value');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(projectDir);
                cleanupTempDir(cwdDir);
            }
        });

        it('handles missing .env files gracefully', async () => {
            const projectDir = createTempDir();
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    // No .env file
                },
                projectDir
            );

            try {
                process.chdir(projectDir);
                process.env.SHELL_KEY = 'from-shell';
                const env = await loadEnvironmentVariables(projectDir);

                // Should still get shell variables
                expect(env.SHELL_KEY).toBe('from-shell');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(projectDir);
            }
        });

        it('handles empty .env files', async () => {
            const projectDir = createTempDir();
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': '',
                },
                projectDir
            );

            try {
                process.chdir(projectDir);
                // Shell environment should still work
                process.env.OPENAI_API_KEY = 'shell-key';

                const env = await loadEnvironmentVariables(projectDir);

                expect(env.OPENAI_API_KEY).toBe('shell-key');
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(projectDir);
            }
        });

        it('filters out undefined and empty environment variables', async () => {
            const tempDir = createTempDir();
            try {
                process.env.DEFINED_VAR = 'value';
                process.env.EMPTY_VAR = '';
                process.env.UNDEFINED_VAR = undefined;

                const env = await loadEnvironmentVariables(tempDir);

                expect(env.DEFINED_VAR).toBe('value');
                expect('EMPTY_VAR' in env).toBe(false); // Empty string filtered out
                expect('UNDEFINED_VAR' in env).toBe(false);
            } finally {
                cleanupTempDir(tempDir);
            }
        });
    });

    describe('applyLayeredEnvironmentLoading', () => {
        it('applies loaded environment to process.env', async () => {
            const tempDir = createTempDir();
            createTempDirStructure(
                {
                    '.env': 'NEW_VAR=new-value\nOPENAI_API_KEY=file-key',
                },
                tempDir
            );

            try {
                // Shell value should be preserved
                process.env.OPENAI_API_KEY = 'shell-key';
                process.env.EXISTING_VAR = 'existing-value';

                process.chdir(tempDir);
                await applyLayeredEnvironmentLoading(tempDir);

                expect(process.env.OPENAI_API_KEY).toBe('shell-key'); // Shell wins
                expect(process.env.EXISTING_VAR).toBe('existing-value'); // Shell preserved
                expect(process.env.NEW_VAR).toBe('new-value'); // File vars added
            } finally {
                process.chdir(originalCwd);
                cleanupTempDir(tempDir);
            }
        });

        it('creates global .dexto directory if it does not exist', async () => {
            const tempDir = createTempDir();
            try {
                // This should not throw even if ~/.dexto doesn't exist
                await applyLayeredEnvironmentLoading(tempDir);
            } finally {
                cleanupTempDir(tempDir);
            }
        });
    });

    describe('updateEnvFile', () => {
        it('creates .env file with variables', async () => {
            const tempDir = createTempDir();
            const envPath = path.join(tempDir, '.env');

            try {
                await updateEnvFile(envPath, {
                    OPENAI_API_KEY: 'test-key',
                    DEXTO_LOG_LEVEL: 'debug',
                });

                const content = fs.readFileSync(envPath, 'utf-8');
                expect(content).toContain('OPENAI_API_KEY=test-key');
                expect(content).toContain('DEXTO_LOG_LEVEL=debug');
            } finally {
                cleanupTempDir(tempDir);
            }
        });

        it('updates existing variables in .env file', async () => {
            const tempDir = createTempDir();
            const envPath = path.join(tempDir, '.env');

            try {
                // Create initial .env
                fs.writeFileSync(envPath, 'OPENAI_API_KEY=old-key\nDEXTO_LOG_LEVEL=info');

                // Update one variable
                await updateEnvFile(envPath, { OPENAI_API_KEY: 'new-key' });

                const content = fs.readFileSync(envPath, 'utf-8');
                expect(content).toContain('OPENAI_API_KEY=new-key');
                expect(content).toContain('DEXTO_LOG_LEVEL=info'); // Preserved
            } finally {
                cleanupTempDir(tempDir);
            }
        });

        it('adds new variables to existing .env file', async () => {
            const tempDir = createTempDir();
            const envPath = path.join(tempDir, '.env');

            try {
                // Create initial .env
                fs.writeFileSync(envPath, 'OPENAI_API_KEY=test-key');

                // Add new variable
                await updateEnvFile(envPath, { ANTHROPIC_API_KEY: 'anthropic-key' });

                const content = fs.readFileSync(envPath, 'utf-8');
                expect(content).toContain('OPENAI_API_KEY=test-key'); // Preserved
                expect(content).toContain('ANTHROPIC_API_KEY=anthropic-key'); // Added
            } finally {
                cleanupTempDir(tempDir);
            }
        });

        it('handles non-existent .env file', async () => {
            const tempDir = createTempDir();
            const envPath = path.join(tempDir, '.env');

            try {
                await updateEnvFile(envPath, { OPENAI_API_KEY: 'test-key' });

                expect(fs.existsSync(envPath)).toBe(true);
                const content = fs.readFileSync(envPath, 'utf-8');
                expect(content).toContain('OPENAI_API_KEY=test-key');
            } finally {
                cleanupTempDir(tempDir);
            }
        });
    });
});
