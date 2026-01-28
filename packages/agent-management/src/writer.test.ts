import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    writeConfigFile,
    writeLLMPreferences,
    writePreferencesToAgent,
    type LLMOverrides,
} from './writer.js';
import { type AgentConfig, ErrorScope, ErrorType } from '@dexto/core';
import { ConfigErrorCode } from './config/index.js';
import { type GlobalPreferences } from './preferences/schemas.js';

describe('Config Writer', () => {
    let tempDir: string;
    let tempConfigPath: string;
    let sampleConfig: AgentConfig;
    let samplePreferences: GlobalPreferences;

    beforeEach(async () => {
        // Create temporary directory for each test
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-config-test-'));
        tempConfigPath = path.join(tempDir, 'test-agent.yml');

        // Sample agent configuration
        sampleConfig = {
            agentCard: {
                name: 'Test Agent',
                description: 'A test agent',
                url: 'https://example.com',
                version: '1.0.0',
            },
            llm: {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: '$OPENAI_API_KEY',
            },
            systemPrompt: 'You are a helpful assistant.',
            internalTools: ['search_history'],
        };

        // Sample global preferences
        samplePreferences = {
            llm: {
                provider: 'anthropic',
                model: 'claude-4-sonnet-20250514',
                apiKey: '$ANTHROPIC_API_KEY',
            },
            defaults: {
                defaultAgent: 'test-agent',
                defaultMode: 'web',
            },
            setup: {
                completed: true,
                apiKeyPending: false,
                baseURLPending: false,
            },
            sounds: {
                enabled: true,
                onApprovalRequired: true,
                onTaskComplete: true,
            },
        };
    });

    afterEach(async () => {
        // Clean up temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('writeConfigFile', () => {
        it('should write agent config to YAML file', async () => {
            await writeConfigFile(tempConfigPath, sampleConfig);

            // Verify file was created
            expect(
                await fs.access(tempConfigPath).then(
                    () => true,
                    () => false
                )
            ).toBe(true);

            // Verify content is valid YAML
            const writtenContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(writtenContent).toContain('name: Test Agent');
            expect(writtenContent).toContain('provider: openai');
            expect(writtenContent).toContain('model: gpt-5');
            expect(writtenContent).toContain('apiKey: $OPENAI_API_KEY');
        });

        it('should handle relative paths by converting to absolute', async () => {
            const relativePath = path.relative(process.cwd(), tempConfigPath);
            await writeConfigFile(relativePath, sampleConfig);

            // File should exist
            expect(
                await fs.access(tempConfigPath).then(
                    () => true,
                    () => false
                )
            ).toBe(true);
        });

        it('should throw ConfigError when directory does not exist', async () => {
            const invalidPath = path.join(tempDir, 'nonexistent', 'config.yml');

            await expect(writeConfigFile(invalidPath, sampleConfig)).rejects.toThrow(
                expect.objectContaining({
                    code: ConfigErrorCode.FILE_WRITE_ERROR,
                    scope: ErrorScope.CONFIG,
                    type: ErrorType.SYSTEM,
                })
            );
        });

        it('should preserve complex nested structures', async () => {
            const complexConfig = {
                ...sampleConfig,
                tools: {
                    bash: { maxOutputChars: 30000 },
                    read: { maxLines: 2000, maxLineLength: 2000 },
                },
                // Test deep nesting via mcpServers which supports complex structures
                mcpServers: {
                    customServer: {
                        type: 'stdio' as const,
                        command: 'node',
                        args: ['server.js'],
                        env: {
                            NESTED_CONFIG: 'test-value',
                        },
                    },
                },
            };

            await writeConfigFile(tempConfigPath, complexConfig);
            const content = await fs.readFile(tempConfigPath, 'utf-8');

            expect(content).toContain('maxOutputChars: 30000');
            expect(content).toContain('NESTED_CONFIG: test-value');
        });
    });

    describe('writeLLMPreferences', () => {
        beforeEach(async () => {
            // Create initial config file
            await writeConfigFile(tempConfigPath, sampleConfig);
        });

        it('should update LLM section with preferences', async () => {
            await writeLLMPreferences(tempConfigPath, samplePreferences);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('provider: anthropic');
            expect(updatedContent).toContain('model: claude-4-sonnet-20250514');
            expect(updatedContent).toContain('apiKey: $ANTHROPIC_API_KEY');
        });

        it('should preserve non-LLM sections when updating', async () => {
            await writeLLMPreferences(tempConfigPath, samplePreferences);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('name: Test Agent');
            expect(updatedContent).toContain('You are a helpful assistant');
            expect(updatedContent).toContain('search_history');
        });

        it('should apply CLI overrides over preferences', async () => {
            const overrides: LLMOverrides = {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                apiKey: '$CUSTOM_API_KEY',
            };

            await writeLLMPreferences(tempConfigPath, samplePreferences, overrides);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('provider: openai');
            expect(updatedContent).toContain('model: gpt-3.5-turbo');
            expect(updatedContent).toContain('apiKey: $CUSTOM_API_KEY');
        });

        it('should apply partial overrides correctly', async () => {
            const overrides: LLMOverrides = {
                model: 'claude-sonnet-4-5-20250929',
                // provider and apiKey from preferences
            };

            await writeLLMPreferences(tempConfigPath, samplePreferences, overrides);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('provider: anthropic'); // from preferences
            expect(updatedContent).toContain('model: claude-sonnet-4-5-20250929'); // from override
            expect(updatedContent).toContain('apiKey: $ANTHROPIC_API_KEY'); // from preferences
        });

        it('should preserve existing LLM settings not in preferences', async () => {
            // Add extra LLM settings to original config
            const configWithExtras = {
                ...sampleConfig,
                llm: {
                    ...sampleConfig.llm,
                    temperature: 0.7,
                    maxTokens: 4000,
                },
            };

            await writeConfigFile(tempConfigPath, configWithExtras);
            await writeLLMPreferences(tempConfigPath, samplePreferences);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('temperature: 0.7');
            expect(updatedContent).toContain('maxTokens: 4000');
        });

        it('should throw ConfigError for non-existent file', async () => {
            const nonExistentPath = path.join(tempDir, 'missing.yml');

            await expect(writeLLMPreferences(nonExistentPath, samplePreferences)).rejects.toThrow(
                expect.objectContaining({
                    code: ConfigErrorCode.FILE_READ_ERROR,
                    scope: ErrorScope.CONFIG,
                    type: ErrorType.SYSTEM,
                })
            );
        });

        it('should throw ConfigError for invalid YAML file', async () => {
            // Write invalid YAML
            await fs.writeFile(tempConfigPath, 'invalid: yaml: content: [}', 'utf-8');

            await expect(writeLLMPreferences(tempConfigPath, samplePreferences)).rejects.toThrow(
                expect.objectContaining({
                    code: ConfigErrorCode.PARSE_ERROR,
                    scope: ErrorScope.CONFIG,
                    type: ErrorType.USER,
                })
            );
        });
    });

    describe('writePreferencesToAgent', () => {
        it('should handle single YAML file agents', async () => {
            await writeConfigFile(tempConfigPath, sampleConfig);

            await writePreferencesToAgent(tempConfigPath, samplePreferences);

            const updatedContent = await fs.readFile(tempConfigPath, 'utf-8');
            expect(updatedContent).toContain('provider: anthropic');
            expect(updatedContent).toContain('model: claude-4-sonnet-20250514');
        });

        it('should skip non-YAML files', async () => {
            const txtFilePath = path.join(tempDir, 'readme.txt');
            await fs.writeFile(txtFilePath, 'This is not a config file', 'utf-8');

            // Should not throw, just warn and skip
            await expect(
                writePreferencesToAgent(txtFilePath, samplePreferences)
            ).resolves.not.toThrow();
        });

        it('should handle directory-based agents with multiple configs', async () => {
            const agentDir = path.join(tempDir, 'multi-agent');
            await fs.mkdir(agentDir, { recursive: true });

            // Create multiple config files
            const config1Path = path.join(agentDir, 'agent1.yml');
            const config2Path = path.join(agentDir, 'agent2.yaml');
            const readmePath = path.join(agentDir, 'README.md');

            const config1 = {
                ...sampleConfig,
                agentCard: { ...sampleConfig.agentCard!, name: 'Agent 1' },
            };
            const config2 = {
                ...sampleConfig,
                agentCard: { ...sampleConfig.agentCard!, name: 'Agent 2' },
            };
            await writeConfigFile(config1Path, config1);
            await writeConfigFile(config2Path, config2);
            await fs.writeFile(readmePath, '# Agent Documentation', 'utf-8');

            await writePreferencesToAgent(agentDir, samplePreferences);

            // Both YAML files should be updated
            const content1 = await fs.readFile(config1Path, 'utf-8');
            const content2 = await fs.readFile(config2Path, 'utf-8');

            expect(content1).toContain('provider: anthropic');
            expect(content2).toContain('provider: anthropic');

            // Names should be preserved
            expect(content1).toContain('name: Agent 1');
            expect(content2).toContain('name: Agent 2');
        });

        it('should handle nested directory structure', async () => {
            const agentDir = path.join(tempDir, 'nested-agent');
            const subDir = path.join(agentDir, 'configs');
            await fs.mkdir(subDir, { recursive: true });

            const mainConfigPath = path.join(agentDir, 'main.yml');
            const subConfigPath = path.join(subDir, 'sub.yml');

            const mainConfig = {
                ...sampleConfig,
                agentCard: { ...sampleConfig.agentCard!, name: 'Main Agent' },
            };
            const subConfig = {
                ...sampleConfig,
                agentCard: { ...sampleConfig.agentCard!, name: 'Sub Agent' },
            };
            await writeConfigFile(mainConfigPath, mainConfig);
            await writeConfigFile(subConfigPath, subConfig);

            await writePreferencesToAgent(agentDir, samplePreferences);

            const mainContent = await fs.readFile(mainConfigPath, 'utf-8');
            const subContent = await fs.readFile(subConfigPath, 'utf-8');

            expect(mainContent).toContain('provider: anthropic');
            expect(subContent).toContain('provider: anthropic');
        });

        it('should skip docs and data directories', async () => {
            const agentDir = path.join(tempDir, 'agent-with-docs');
            const docsDir = path.join(agentDir, 'docs');
            const dataDir = path.join(agentDir, 'data');

            await fs.mkdir(docsDir, { recursive: true });
            await fs.mkdir(dataDir, { recursive: true });

            // These should be ignored
            const docConfigPath = path.join(docsDir, 'doc-config.yml');
            const dataConfigPath = path.join(dataDir, 'data-config.yml');

            // This should be processed
            const mainConfigPath = path.join(agentDir, 'main.yml');

            await writeConfigFile(docConfigPath, sampleConfig);
            await writeConfigFile(dataConfigPath, sampleConfig);
            await writeConfigFile(mainConfigPath, sampleConfig);

            await writePreferencesToAgent(agentDir, samplePreferences);

            // Main config should be updated
            const mainContent = await fs.readFile(mainConfigPath, 'utf-8');
            expect(mainContent).toContain('provider: anthropic');

            // Docs and data configs should remain unchanged
            const docContent = await fs.readFile(docConfigPath, 'utf-8');
            const dataContent = await fs.readFile(dataConfigPath, 'utf-8');
            expect(docContent).toContain('provider: openai'); // original
            expect(dataContent).toContain('provider: openai'); // original
        });

        it('should throw ConfigError for non-existent path', async () => {
            const nonExistentPath = path.join(tempDir, 'missing-agent');

            await expect(
                writePreferencesToAgent(nonExistentPath, samplePreferences)
            ).rejects.toThrow(
                expect.objectContaining({
                    code: ConfigErrorCode.FILE_READ_ERROR,
                    scope: ErrorScope.CONFIG,
                    type: ErrorType.SYSTEM,
                })
            );
        });

        it('should handle empty directories gracefully', async () => {
            const emptyDir = path.join(tempDir, 'empty-agent');
            await fs.mkdir(emptyDir);

            // Should not throw, just warn about no configs found
            await expect(
                writePreferencesToAgent(emptyDir, samplePreferences)
            ).resolves.not.toThrow();
        });
    });
});
