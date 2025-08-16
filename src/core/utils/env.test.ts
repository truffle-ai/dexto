import * as fs from 'fs';
import * as path from 'path';
import { tmpdir, homedir } from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEnvironmentVariables, applyLayeredEnvironmentLoading, updateEnvFile } from './env.js';

// Mock homedir to control global .dexto location
vi.mock('os', async () => {
    const actual = await vi.importActual('os');
    return {
        ...actual,
        homedir: vi.fn(),
    };
});

function createTempDir() {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-env-test-'));
}

function createTempDirStructure(structure: Record<string, any>, baseDir?: string): string {
    const tempDir = baseDir || createTempDir();

    for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tempDir, filePath);
        const dirPath = path.dirname(fullPath);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        if (typeof content === 'string') {
            fs.writeFileSync(fullPath, content);
        } else if (content === null) {
            // Create empty file
            fs.writeFileSync(fullPath, '');
        }
    }

    return tempDir;
}

function cleanupTempDir(dir: string) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('Core Environment Loading', () => {
    let tempDir: string;
    let mockHomeDir: string;
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };

        // Create temp directories
        tempDir = createTempDir();
        mockHomeDir = createTempDir();

        // Mock homedir
        vi.mocked(homedir).mockReturnValue(mockHomeDir);

        // Clean up environment variables that might interfere
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.GROQ_API_KEY;
        delete process.env.DEXTO_LOG_LEVEL;
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;

        // Cleanup temp directories
        cleanupTempDir(tempDir);
        cleanupTempDir(mockHomeDir);

        vi.clearAllMocks();
    });

    describe('loadEnvironmentVariables', () => {
        it('loads from global ~/.dexto/.env when no project', async () => {
            // Setup: Global .env only
            createTempDirStructure(
                {
                    '.dexto/.env': 'OPENAI_API_KEY=global-key\nDEXTO_LOG_LEVEL=debug',
                },
                mockHomeDir
            );

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.OPENAI_API_KEY).toBe('global-key');
            expect(env.DEXTO_LOG_LEVEL).toBe('debug');
        });

        it('loads from project .env when in dexto project', async () => {
            // Setup: Dexto project with .env
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': 'OPENAI_API_KEY=project-key\nDEXTO_LOG_LEVEL=info',
                },
                tempDir
            );

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.OPENAI_API_KEY).toBe('project-key');
            expect(env.DEXTO_LOG_LEVEL).toBe('info');
        });

        it('handles comprehensive priority system: Shell > Project > Global', async () => {
            // Setup comprehensive scenario with many environment variables across all layers
            createTempDirStructure(
                {
                    '.dexto/.env': [
                        'OPENAI_API_KEY=global-openai',
                        'ANTHROPIC_API_KEY=global-anthropic',
                        'GOOGLE_GENERATIVE_AI_API_KEY=global-google',
                        'GROQ_API_KEY=global-groq',
                        'DEXTO_LOG_LEVEL=global-debug',
                        'GLOBAL_UNIQUE_KEY=preserved',
                        'SHARED_ACROSS_ALL=global-value',
                        'SHARED_GLOBAL_PROJECT=global-project',
                        'EMPTY_PROJECT_KEY=from-global',
                    ].join('\n'),
                },
                mockHomeDir
            );

            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': [
                        'OPENAI_API_KEY=project-openai',
                        'ANTHROPIC_API_KEY=project-anthropic',
                        'GROQ_API_KEY=project-groq',
                        'DEXTO_LOG_LEVEL=project-info',
                        'PROJECT_UNIQUE_KEY=project-only',
                        'SHARED_ACROSS_ALL=project-value',
                        'SHARED_GLOBAL_PROJECT=project-value',
                        // EMPTY_PROJECT_KEY not in project, should come from global
                    ].join('\n'),
                },
                tempDir
            );

            // Shell environment (highest priority) - only sets some keys
            process.env.OPENAI_API_KEY = 'shell-openai';
            process.env.GROQ_API_KEY = 'shell-groq';
            process.env.SHELL_UNIQUE_KEY = 'shell-only';
            process.env.SHARED_ACROSS_ALL = 'shell-value';
            process.env.EXISTING_VAR = 'existing-value';
            process.env.NEW_VAR = 'new-value';

            const env = await loadEnvironmentVariables(tempDir);

            // Shell wins for keys present in shell
            expect(env.OPENAI_API_KEY).toBe('shell-openai');
            expect(env.GROQ_API_KEY).toBe('shell-groq');
            expect(env.SHELL_UNIQUE_KEY).toBe('shell-only');
            expect(env.SHARED_ACROSS_ALL).toBe('shell-value');
            expect(env.EXISTING_VAR).toBe('existing-value');

            // Project wins over global where shell not present
            expect(env.ANTHROPIC_API_KEY).toBe('project-anthropic');
            expect(env.DEXTO_LOG_LEVEL).toBe('project-info');
            expect(env.SHARED_GLOBAL_PROJECT).toBe('project-value');
            expect(env.PROJECT_UNIQUE_KEY).toBe('project-only');

            // Global used when no project/shell override
            expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('global-google');
            expect(env.GLOBAL_UNIQUE_KEY).toBe('preserved');
            expect(env.EMPTY_PROJECT_KEY).toBe('from-global');
        });

        it('handles edge cases: empty files and applyLayeredEnvironmentLoading', async () => {
            // Test empty project .env with global fallback
            createTempDirStructure(
                {
                    '.dexto/.env':
                        'OPENAI_API_KEY=global-fallback\nANTHROPIC_API_KEY=global-anthropic',
                },
                mockHomeDir
            );

            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': '', // Empty project .env
                },
                tempDir
            );

            let env = await loadEnvironmentVariables(tempDir);
            expect(env.OPENAI_API_KEY).toBe('global-fallback');
            expect(env.ANTHROPIC_API_KEY).toBe('global-anthropic');

            // Test applyLayeredEnvironmentLoading preserves shell priority
            process.env.EXISTING_VAR = 'existing-value';
            process.env.OPENAI_API_KEY = 'shell-key';

            createTempDirStructure(
                {
                    '.dexto/.env': 'OPENAI_API_KEY=global-key\nNEW_VAR=new-value',
                },
                mockHomeDir
            );

            await applyLayeredEnvironmentLoading(tempDir);

            expect(process.env.OPENAI_API_KEY).toBe('shell-key'); // Shell wins
            expect(process.env.EXISTING_VAR).toBe('existing-value'); // Shell preserved
            expect(process.env.NEW_VAR).toBe('new-value'); // File vars added
        });

        it('handles missing global .dexto directory gracefully', async () => {
            // Setup: Project only, no global directory
            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': 'OPENAI_API_KEY=project-key',
                },
                tempDir
            );

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.OPENAI_API_KEY).toBe('project-key');
        });

        it('handles missing project .env file gracefully', async () => {
            // Setup: Global only, project has no .env
            createTempDirStructure(
                {
                    '.dexto/.env': 'OPENAI_API_KEY=global-key',
                },
                mockHomeDir
            );

            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    // No .env file
                },
                tempDir
            );

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.OPENAI_API_KEY).toBe('global-key');
        });

        it('handles malformed .env files gracefully', async () => {
            // Setup: Malformed global .env
            createTempDirStructure(
                {
                    '.dexto/.env': 'INVALID_LINE_WITHOUT_EQUALS\nOPENAI_API_KEY=valid-key',
                },
                mockHomeDir
            );

            const env = await loadEnvironmentVariables(tempDir);

            // Should still load valid entries
            expect(env.OPENAI_API_KEY).toBe('valid-key');
        });

        it('handles empty .env files', async () => {
            // Setup: Empty files
            createTempDirStructure(
                {
                    '.dexto/.env': '',
                },
                mockHomeDir
            );

            createTempDirStructure(
                {
                    'package.json': JSON.stringify({ dependencies: { dexto: '1.0.0' } }),
                    '.env': '',
                },
                tempDir
            );

            // Shell environment should still work
            process.env.OPENAI_API_KEY = 'shell-key';

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.OPENAI_API_KEY).toBe('shell-key');
        });

        it('filters out undefined environment variables', async () => {
            process.env.DEFINED_VAR = 'value';
            process.env.UNDEFINED_VAR = undefined;

            const env = await loadEnvironmentVariables(tempDir);

            expect(env.DEFINED_VAR).toBe('value');
            expect('UNDEFINED_VAR' in env).toBe(false);
        });
    });

    describe('applyLayeredEnvironmentLoading', () => {
        it('applies loaded environment to process.env', async () => {
            // Setup: Global .env with API key
            createTempDirStructure(
                {
                    '.dexto/.env': 'OPENAI_API_KEY=global-key\nDEXTO_LOG_LEVEL=debug',
                },
                mockHomeDir
            );

            // Ensure these are not set initially
            delete process.env.OPENAI_API_KEY;
            delete process.env.DEXTO_LOG_LEVEL;

            await applyLayeredEnvironmentLoading(tempDir);

            expect(process.env.OPENAI_API_KEY).toBe('global-key');
            expect(process.env.DEXTO_LOG_LEVEL).toBe('debug');
        });

        it('creates global .dexto directory if it does not exist', async () => {
            const dextoDir = path.join(mockHomeDir, '.dexto');
            expect(fs.existsSync(dextoDir)).toBe(false);

            await applyLayeredEnvironmentLoading(tempDir);

            expect(fs.existsSync(dextoDir)).toBe(true);
        });
    });

    describe('updateEnvFile', () => {
        it('creates new .env file with Dexto section', async () => {
            const envFilePath = path.join(tempDir, '.env');

            await updateEnvFile(envFilePath, {
                OPENAI_API_KEY: 'test-key',
                DEXTO_LOG_LEVEL: 'info',
            });

            const content = fs.readFileSync(envFilePath, 'utf8');
            expect(content).toContain('## Dexto env variables');
            expect(content).toContain('OPENAI_API_KEY=test-key');
            expect(content).toContain('DEXTO_LOG_LEVEL=info');
        });

        it('updates existing .env file preserving other content', async () => {
            const envFilePath = path.join(tempDir, '.env');

            // Create existing .env with other content
            fs.writeFileSync(envFilePath, 'OTHER_VAR=other-value\nANOTHER_VAR=another-value\n');

            await updateEnvFile(envFilePath, {
                OPENAI_API_KEY: 'test-key',
            });

            const content = fs.readFileSync(envFilePath, 'utf8');
            expect(content).toContain('OTHER_VAR=other-value');
            expect(content).toContain('ANOTHER_VAR=another-value');
            expect(content).toContain('## Dexto env variables');
            expect(content).toContain('OPENAI_API_KEY=test-key');
        });

        it('replaces existing Dexto section', async () => {
            const envFilePath = path.join(tempDir, '.env');

            // Create existing .env with old Dexto section
            const oldContent = [
                'OTHER_VAR=other-value',
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=old-key',
                'ANTHROPIC_API_KEY=old-anthropic',
                '',
                'FINAL_VAR=final-value',
            ].join('\n');

            fs.writeFileSync(envFilePath, oldContent);

            await updateEnvFile(envFilePath, {
                OPENAI_API_KEY: 'new-key',
                GROQ_API_KEY: 'new-groq',
            });

            const content = fs.readFileSync(envFilePath, 'utf8');
            expect(content).toContain('OTHER_VAR=other-value');
            expect(content).toContain('FINAL_VAR=final-value');
            expect(content).toContain('OPENAI_API_KEY=new-key');
            expect(content).toContain('GROQ_API_KEY=new-groq');
            expect(content).not.toContain('old-key');
            // ANTHROPIC_API_KEY should be preserved since we didn't update it
            expect(content).toContain('ANTHROPIC_API_KEY=old-anthropic');
        });

        it('handles empty updates gracefully', async () => {
            const envFilePath = path.join(tempDir, '.env');

            await updateEnvFile(envFilePath, {});

            const content = fs.readFileSync(envFilePath, 'utf8');
            expect(content).toContain('## Dexto env variables');
            // Should still create the section structure
        });

        it('creates directory structure if it does not exist', async () => {
            const deepPath = path.join(tempDir, 'nested', 'deep', '.env');

            await updateEnvFile(deepPath, {
                OPENAI_API_KEY: 'test-key',
            });

            expect(fs.existsSync(deepPath)).toBe(true);
            const content = fs.readFileSync(deepPath, 'utf8');
            expect(content).toContain('OPENAI_API_KEY=test-key');
        });
    });
});
