import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createDextoDirectories, createDextoExampleFile, postInitDexto } from './init-app.js';

describe('Init Module', () => {
    let tempDir: string;

    beforeEach(async () => {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-init-test-'));
    });

    afterEach(async () => {
        // Cleanup the temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('createDextoDirectories', () => {
        it('creates dexto and agents directories when they do not exist', async () => {
            const result = await createDextoDirectories(tempDir);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.dirPath).toBe(path.join(tempDir, 'dexto'));
            }

            // Verify directories exist
            const dextoDir = path.join(tempDir, 'dexto');
            const agentsDir = path.join(tempDir, 'dexto', 'agents');

            expect(
                await fs
                    .access(dextoDir)
                    .then(() => true)
                    .catch(() => false)
            ).toBe(true);
            expect(
                await fs
                    .access(agentsDir)
                    .then(() => true)
                    .catch(() => false)
            ).toBe(true);
        });

        it('returns false when dexto directory already exists', async () => {
            // Create the dexto directory first
            const dextoDir = path.join(tempDir, 'dexto');
            await fs.mkdir(dextoDir, { recursive: true });

            const result = await createDextoDirectories(tempDir);

            expect(result.ok).toBe(false);
        });
    });

    describe('createDextoExampleFile', () => {
        it('creates example file with correct content', async () => {
            // Change to temp directory to simulate real usage where paths are relative to cwd
            const originalCwd = process.cwd();
            process.chdir(tempDir);

            try {
                const dextoDir = path.join('src', 'dexto'); // Relative path like real usage
                await fs.mkdir(dextoDir, { recursive: true });

                const examplePath = await createDextoExampleFile(dextoDir);

                expect(examplePath).toBe(path.join(dextoDir, 'dexto-example.ts'));

                // Verify file exists
                expect(
                    await fs
                        .access(examplePath)
                        .then(() => true)
                        .catch(() => false)
                ).toBe(true);

                // Verify content contains expected elements
                const content = await fs.readFile(examplePath, 'utf8');
                expect(content).toContain('import { AgentConfigSchema, applyImageDefaults');
                expect(content).toContain("import { DextoAgent } from '@dexto/core'");
                expect(content).toContain(
                    "import { enrichAgentConfig, loadAgentConfig } from '@dexto/agent-management'"
                );
                expect(content).toContain("console.log('🚀 Starting Dexto Basic Example");
                expect(content).toContain('./src/dexto/agents/coding-agent.yml'); // Correct relative path
                expect(content).toContain(
                    'const validatedConfig = AgentConfigSchema.parse(enrichedConfig)'
                );
                expect(content).toContain('const agent = new DextoAgent(toDextoAgentOptions({');
            } finally {
                process.chdir(originalCwd);
            }
        });

        it('generates correct config path for different directory structures', async () => {
            const originalCwd = process.cwd();
            process.chdir(tempDir);

            try {
                const dextoDir = path.join('custom', 'dexto'); // Relative path
                await fs.mkdir(dextoDir, { recursive: true });

                const examplePath = await createDextoExampleFile(dextoDir);
                const content = await fs.readFile(examplePath, 'utf8');

                expect(content).toContain('./custom/dexto/agents/coding-agent.yml');
            } finally {
                process.chdir(originalCwd);
            }
        });
    });

    describe('postInitDexto', () => {
        it('runs without throwing errors', async () => {
            // This function just prints output, so we mainly test it doesn't crash
            expect(() => postInitDexto('src')).not.toThrow();
        });
    });
});
