import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LocalAgentRegistry } from './registry.js';
import { writePreferencesToAgent } from '@core/config/writer.js';

vi.mock('@core/utils/path.js');
vi.mock('@core/logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('Custom Install + OpenRouter inherit mapping (integration)', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'custom-inherit-integ-'));

        // Point global dexto paths (e.g., agents dir) to the tempDir
        const pathUtils = await import('@core/utils/path.js');
        const mockGetDextoGlobalPath = vi.mocked(pathUtils.getDextoGlobalPath);
        mockGetDextoGlobalPath.mockImplementation((type: string, filename?: string) => {
            // Store e.g. ~/.dexto/agents → <tempDir>/agents
            const base = path.join(tempDir, type);
            return filename ? path.join(base, filename) : base;
        });

        // Resolve bundled scripts (agents/agent-registry.json) from the repo's agents directory
        const mockResolveBundledScript = vi.mocked(pathUtils.resolveBundledScript);
        const repoAgentsDir = path.join(process.cwd(), 'agents');
        mockResolveBundledScript.mockImplementation((scriptPath: string) => {
            const rel = scriptPath.replace(/^agents\//, '');
            return path.join(repoAgentsDir, rel);
        });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        vi.clearAllMocks();
    });

    it('installs custom agent and maps inherited model to OpenRouter id when applying preferences', async () => {
        const registry = new LocalAgentRegistry();

        // Create a custom single-file agent with an OpenAI model we will convert
        const customAgentPath = path.join(tempDir, 'my-agent.yml');
        const yaml = [
            'name: my-agent',
            'version: 1.0.0',
            'llm:',
            '  provider: openai',
            '  model: gpt-4o',
            '  router: vercel',
            '',
        ].join('\n');
        fs.writeFileSync(customAgentPath, yaml);

        // Install without auto-injecting preferences
        const mainConfigPath = await registry.installCustomAgentFromPath(
            'my-agent',
            customAgentPath,
            { description: 'Test', author: 'Test', tags: [] },
            false
        );

        // Sanity check: installed file exists and still has original provider
        expect(fs.existsSync(mainConfigPath)).toBe(true);
        const before = fs.readFileSync(mainConfigPath, 'utf-8');
        expect(before).toMatch(/provider:\s*openai/);
        expect(before).toMatch(/model:\s*gpt-4o/);

        // Apply preferences that switch to OpenRouter with no explicit model
        const installedDir = path.dirname(mainConfigPath);
        await writePreferencesToAgent(installedDir, {
            llm: {
                provider: 'openrouter',
                // intentionally omit model to trigger inherit → mapping path
            },
            defaults: { defaultAgent: 'my-agent' },
        } as any);

        const after = fs.readFileSync(mainConfigPath, 'utf-8');

        // Expect provider switched to openrouter
        expect(after).toMatch(/provider:\s*openrouter/);
        // Expect model converted to the OpenRouter id for gpt-4o
        expect(after).toMatch(/model:\s*openai\/gpt-4o/);
        // Expect baseURL injected for OpenRouter
        expect(after).toMatch(/baseURL:\s*https:\/\/openrouter\.ai\/api\/v1/);
    });
});
