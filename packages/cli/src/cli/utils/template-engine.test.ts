import { describe, it, expect } from 'vitest';
import {
    generateIndexForImage,
    generateDextoImageFile,
    generateDextoConfigFile,
    generateImageReadme,
    generateExampleTool,
    generateAppReadme,
} from './template-engine.js';

describe('template-engine', () => {
    describe('generateIndexForImage', () => {
        it('should generate index.ts for image-based app', () => {
            const result = generateIndexForImage({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
                imageName: '@dexto/image-local',
            });

            expect(result).toMatch(
                /import\s*\{[\s\S]*AgentConfigSchema,[\s\S]*\}\s*from '@dexto\/agent-config';/
            );
            expect(result).toContain("import { DextoAgent } from '@dexto/core'");
            expect(result).toContain(
                "import { enrichAgentConfig, loadAgentConfig } from '@dexto/agent-management'"
            );
            expect(result).toContain('setImageImporter((specifier) => import(specifier));');
            expect(result).toContain('Starting my-app');
            expect(result).toContain("const configPath = './agents/default.yml';");
            expect(result).toContain('const config = await loadAgentConfig(configPath);');
            expect(result).toContain(
                'const validatedConfig = AgentConfigSchema.parse(enrichedConfig)'
            );
            expect(result).toContain('const agent = new DextoAgent(toDextoAgentOptions({');
            expect(result).toContain('await agent.start()');
        });

        it('should use image harness terminology in comments', () => {
            const result = generateIndexForImage({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
                imageName: '@dexto/image-local',
            });

            expect(result).toContain('// Standalone Dexto app (image-based)');
            expect(result).toContain(
                '// Loads an image module and resolves DI services from config.'
            );
        });
    });

    describe('generateDextoImageFile', () => {
        it('should generate basic dexto.image.ts', () => {
            const result = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
            });

            expect(result).toContain("import type { ImageDefinition } from '@dexto/image-bundler'");
            expect(result).toContain('const image = {');
            expect(result).toContain("name: 'my-image'");
            expect(result).toContain("version: '1.0.0'");
            expect(result).toContain("description: 'Test image'");
            expect(result).toContain('} satisfies ImageDefinition;');
            expect(result).toContain('export default image;');
        });

        it('should include convention-based auto-discovery comments', () => {
            const result = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
            });

            expect(result).toContain(
                '// Providers are AUTO-DISCOVERED from convention-based folders'
            );
            expect(result).toContain('//   tools/<type>/index.ts');
            expect(result).toContain('//   storage/blob/<type>/index.ts');
            expect(result).toContain('//   storage/database/<type>/index.ts');
            expect(result).toContain('//   storage/cache/<type>/index.ts');
            expect(result).toContain('//   plugins/<type>/index.ts');
            expect(result).toContain('//   compaction/<type>/index.ts');
        });

        it('should include extends field when baseImage provided', () => {
            const result = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                baseImage: '@dexto/image-local',
            });

            expect(result).toContain("extends: '@dexto/image-local'");
        });

        it('should not include extends field when no baseImage', () => {
            const result = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
            });

            expect(result).not.toContain('extends:');
        });

        it('should use target from context or default', () => {
            const resultWithTarget = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                target: 'cloud-production',
            });

            expect(resultWithTarget).toContain("target: 'cloud-production'");

            const resultDefault = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
            });

            expect(resultDefault).toContain("target: 'local-development'");
        });

        it('should include default configurations', () => {
            const result = generateDextoImageFile({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
            });

            expect(result).toContain('defaults: {');
            expect(result).toContain('storage: {');
            expect(result).toContain("type: 'local'");
            expect(result).toContain("type: 'sqlite'");
            expect(result).toContain('logger: {');
        });
    });

    describe('generateDextoConfigFile', () => {
        it('should generate dexto.config.ts', () => {
            const result = generateDextoConfigFile({
                projectName: 'my-project',
                packageName: 'my-project',
                description: 'Test project',
            });

            expect(result).toContain('import {');
            expect(result).toContain('blobStoreRegistry');
            expect(result).toContain('customToolRegistry');
            expect(result).toContain("} from '@dexto/core'");
        });

        it('should include project metadata', () => {
            const result = generateDextoConfigFile({
                projectName: 'my-project',
                packageName: 'my-project',
                description: 'Test project',
            });

            expect(result).toContain('export const projectConfig = {');
            expect(result).toContain("name: 'my-project'");
            expect(result).toContain("version: '1.0.0'");
            expect(result).toContain("description: 'Test project'");
        });

        it('should include registerProviders function', () => {
            const result = generateDextoConfigFile({
                projectName: 'my-project',
                packageName: 'my-project',
                description: 'Test project',
            });

            expect(result).toContain('export function registerProviders() {');
            expect(result).toContain('// Example: Register blob storage provider');
            expect(result).toContain('// blobStoreRegistry.register(myBlobProvider)');
        });

        it('should include initialize and cleanup functions', () => {
            const result = generateDextoConfigFile({
                projectName: 'my-project',
                packageName: 'my-project',
                description: 'Test project',
            });

            expect(result).toContain('export async function initialize() {');
            expect(result).toContain('export async function cleanup() {');
        });
    });

    describe('generateImageReadme', () => {
        it('should generate README for image', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image description',
                imageName: 'my-image',
            });

            expect(result).toContain('# my-image');
            expect(result).toContain('Test image description');
        });

        it('should use image terminology for artifacts', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
            });

            expect(result).toContain('A **Dexto image**');
            expect(result).toContain('# Build the image');
            expect(result).toContain('pnpm add my-image');
        });

        it('should describe the DextoImageModule contract', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
            });

            expect(result).toContain('exports a typed `DextoImageModule`');
            expect(result).toContain('plain object');
        });

        it('should include extends note when baseImage provided', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
                baseImage: '@dexto/image-local',
            });

            expect(result).toContain('This image extends `@dexto/image-local`');
        });

        it('should include bundler documentation', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
            });

            expect(result).toContain('pnpm run build');
            expect(result).toContain('dexto-bundle build');
            expect(result).toContain('Discovers providers from convention-based folders');
        });

        it('should document convention folders', () => {
            const result = generateImageReadme({
                projectName: 'my-image',
                packageName: 'my-image',
                description: 'Test image',
                imageName: 'my-image',
            });

            expect(result).toContain('storage/blob/<type>/');
            expect(result).toContain('compaction/<type>/');
        });
    });

    describe('generateExampleTool', () => {
        it('should generate example tool with default name', () => {
            const result = generateExampleTool();

            expect(result).toContain("import { z } from 'zod'");
            expect(result).toContain("import type { ToolFactory } from '@dexto/agent-config'");
            expect(result).toContain('InternalTool');
            expect(result).toContain("type: z.literal('example-tool')");
            expect(result).toContain('export const provider: ToolFactory');
        });

        it('should generate tool with custom name', () => {
            const result = generateExampleTool('weather-api');

            expect(result).toContain("type: z.literal('weather-api')");
            expect(result).toContain('export const provider: ToolFactory');
            expect(result).toContain("id: 'weather-api'");
        });

        it('should include zod schemas', () => {
            const result = generateExampleTool('test-tool');

            expect(result).toContain('const ConfigSchema = z');
            expect(result).toContain('.object({');
            expect(result).toContain('.strict()');
            expect(result).toContain('configSchema: ConfigSchema');
        });

        it('should include metadata', () => {
            const result = generateExampleTool('test-tool');

            expect(result).toContain('metadata: {');
            expect(result).toContain('displayName:');
            expect(result).toContain('description:');
            expect(result).toContain('category:');
        });

        it('should include create function with tool definition', () => {
            const result = generateExampleTool('test-tool');

            expect(result).toContain('create: (_config)');
            expect(result).toContain('const tool: InternalTool = {');
            expect(result).toContain('inputSchema: z.object({');
            expect(result).toContain(
                'execute: async (input: unknown, context: ToolExecutionContext)'
            );
        });
    });

    describe('generateAppReadme', () => {
        it('should generate README for app', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app description',
            });

            expect(result).toContain('# my-app');
            expect(result).toContain('Test app description');
        });

        it('should include quick start instructions', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
            });

            expect(result).toContain('## Quick Start');
            expect(result).toContain('pnpm install');
            expect(result).toContain('pnpm start');
        });

        it('should include image section when using image', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
                imageName: '@dexto/image-local',
            });

            expect(result).toContain('## Image');
            expect(result).toContain('This app uses the `@dexto/image-local` image');
            expect(result).toContain('Pre-configured providers');
            expect(result).toContain('Runtime orchestration');
        });

        it('should not include image section when not using image', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
            });

            expect(result).not.toContain('## Image');
        });

        it('should include project structure', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
            });

            expect(result).toContain('## Project Structure');
            expect(result).toContain('src/');
            expect(result).toContain('agents/');
        });

        it('should include configuration section', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
            });

            expect(result).toContain('## Configuration');
            expect(result).toContain('agents/default.yml');
        });

        it('should include learn more section', () => {
            const result = generateAppReadme({
                projectName: 'my-app',
                packageName: 'my-app',
                description: 'Test app',
            });

            expect(result).toContain('## Learn More');
            expect(result).toContain('Dexto Documentation');
        });
    });
});
