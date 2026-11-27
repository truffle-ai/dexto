import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const FACADE_ENTRY = path.resolve(here, 'index.ts');
const LLM_SOURCE_ENTRY = path.resolve(here, '../../../llm/src/index.ts');

const NODE_BUILTINS = new Set(builtinModules);
// The only third-party packages the facade's import graph is allowed to reach.
const ALLOWED_PACKAGES = new Set(['zod']);

/**
 * Fails the bundle on any bare import that is a Node builtin or a package outside the allowlist.
 * Everything the facade needs must come from relative schema leaves, `zod`, or `@dexto/llm`
 * (resolved from source so its graph is checked too).
 */
const rejectRuntimeImports: esbuild.Plugin = {
    name: 'reject-runtime-imports',
    setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (path.isAbsolute(args.path)) return undefined;
            const specifier = args.path;
            if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) {
                return {
                    errors: [
                        {
                            text: `Node builtin "${specifier}" reached the runtime-free config facade (imported from ${args.importer})`,
                        },
                    ],
                };
            }
            if (specifier === '@dexto/llm') {
                return { path: LLM_SOURCE_ENTRY };
            }
            if (ALLOWED_PACKAGES.has(specifier)) {
                return { path: specifier, external: true };
            }
            return {
                errors: [
                    {
                        text: `Package "${specifier}" is not allowed in the runtime-free config facade (imported from ${args.importer})`,
                    },
                ],
            };
        });
    },
};

function bundleForWorker(entry: { file: string } | { contents: string }) {
    return esbuild.build({
        ...('file' in entry
            ? { entryPoints: [entry.file] }
            : { stdin: { contents: entry.contents, resolveDir: here, loader: 'ts' } }),
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        conditions: ['workerd', 'worker', 'browser'],
        target: 'es2022',
        logLevel: 'silent',
        plugins: [rejectRuntimeImports],
    });
}

describe('@dexto/core/config facade', () => {
    it('bundles for a Worker/browser target without Node builtins or runtime packages', async () => {
        const result = await bundleForWorker({ file: FACADE_ENTRY });

        expect(result.errors).toEqual([]);
        const output = result.outputFiles[0]?.text ?? '';
        const externalImports = [...output.matchAll(/^import[^"']*["']([^"']+)["'];?$/gm)].map(
            (match) => match[1]
        );
        expect(new Set(externalImports)).toEqual(new Set(['zod']));
    });

    it('rejects an accidental runtime re-export', async () => {
        const entry = `
            export * from './index.ts';
            export { PROMPT_GENERATOR_REGISTRY } from '../systemPrompt/registry.ts';
        `;

        await expect(bundleForWorker({ contents: entry })).rejects.toMatchObject({
            errors: expect.arrayContaining([
                expect.objectContaining({
                    text: expect.stringMatching(/Node builtin "(fs|os|path)"/),
                }),
            ]),
        });
    });

    it('exposes exactly the curated config surface', async () => {
        const facade = await import('./index.js');

        expect(Object.keys(facade).sort()).toEqual(
            [
                'AgentCardSchema',
                'ElicitationConfigSchema',
                'EnvExpandedString',
                'ErrorScope',
                'ErrorType',
                'LLMConfigSchema',
                'LoggerConfigSchema',
                'MemoriesConfigSchema',
                'NonEmptyEnvExpandedString',
                'OtelConfigurationSchema',
                'PermissionsConfigSchema',
                'PromptsSchema',
                'RequiredEnvURL',
                'ResourcesConfigSchema',
                'ServersConfigSchema',
                'SessionConfigSchema',
                'StorageErrorCode',
                'SystemPromptConfigSchema',
                'createLLMConfigSchema',
            ].sort()
        );
    });
});
