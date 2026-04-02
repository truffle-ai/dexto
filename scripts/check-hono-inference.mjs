#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const surfaces = [
    {
        name: 'greeting',
        importPath: './packages/server/src/hono/routes/greeting.ts',
        schemaType: 'GreetingRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'message',
        importPath: './packages/server/src/hono/routes/messages.ts',
        schemaType: 'MessagesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'message-sync',
        importPath: './packages/server/src/hono/routes/messages.ts',
        schemaType: 'MessagesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'reset',
        importPath: './packages/server/src/hono/routes/messages.ts',
        schemaType: 'MessagesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'sessions',
        importPath: './packages/server/src/hono/routes/sessions.ts',
        schemaType: 'SessionsRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'llm',
        importPath: './packages/server/src/hono/routes/llm.ts',
        schemaType: 'LlmRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'search',
        importPath: './packages/server/src/hono/routes/search.ts',
        schemaType: 'SearchRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'mcp',
        importPath: './packages/server/src/hono/routes/mcp.ts',
        schemaType: 'McpRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'webhooks',
        importPath: './packages/server/src/hono/routes/webhooks.ts',
        schemaType: 'WebhooksRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'prompts',
        importPath: './packages/server/src/hono/routes/prompts.ts',
        schemaType: 'PromptsRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'resources',
        importPath: './packages/server/src/hono/routes/resources.ts',
        schemaType: 'ResourcesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'memory',
        importPath: './packages/server/src/hono/routes/memory.ts',
        schemaType: 'MemoryRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'workspaces',
        importPath: './packages/server/src/hono/routes/workspaces.ts',
        schemaType: 'WorkspacesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'schedules',
        importPath: './packages/server/src/hono/routes/schedules.ts',
        schemaType: 'SchedulesRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'approvals',
        importPath: './packages/server/src/hono/routes/approvals.ts',
        schemaType: 'ApprovalsRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'agents',
        importPath: './packages/server/src/hono/routes/agents.ts',
        schemaType: 'AgentsRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'queue',
        importPath: './packages/server/src/hono/routes/queue.ts',
        schemaType: 'QueueRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'openrouter',
        importPath: './packages/server/src/hono/routes/openrouter.ts',
        schemaType: 'OpenRouterRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'models',
        importPath: './packages/server/src/hono/routes/models.ts',
        schemaType: 'ModelsRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'discovery',
        importPath: './packages/server/src/hono/routes/discovery.ts',
        schemaType: 'DiscoveryRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'system-prompt',
        importPath: './packages/server/src/hono/routes/system-prompt.ts',
        schemaType: 'SystemPromptRouterSchema',
        pathPrefix: 'dexto.api',
    },
    {
        name: 'dexto-auth',
        importPath: './packages/server/src/hono/routes/dexto-auth.ts',
        schemaType: 'DextoAuthRouterSchema',
        pathPrefix: 'dexto.api',
    },
];

function relativeImport(fromDirectory, targetPath) {
    const relativePath = path.relative(fromDirectory, targetPath);
    const normalized = relativePath.split(path.sep).join('/');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function readCheckerSuppressions() {
    const filesResult = spawnSync('git', ['ls-files'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    if (filesResult.status !== 0) {
        throw new Error(
            filesResult.stderr || filesResult.stdout || 'Failed to enumerate repo files'
        );
    }

    const suppressions = new Map();
    const errors = [];
    const trackedFiles = filesResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /\.(?:[cm]?[jt]sx?)$/.test(line))
        .filter((line) => line !== 'scripts/check-hono-inference.mjs');

    for (const relativePath of trackedFiles) {
        const absolutePath = path.resolve(repoRoot, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }

        const source = readFileSync(absolutePath, 'utf8');
        const lines = source.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line.includes('hono-inference-disable')) {
                continue;
            }

            const match =
                line.match(
                    /(?:\/\/|\/\*)\s*hono-inference-disable\s+(dexto(?:\.[A-Za-z0-9_:$-]+)+)\s+--\s+(.+?)\s*$/u
                ) ?? null;

            if (!match) {
                errors.push(
                    `${relativePath}:${index + 1} invalid Hono inference suppression. Use: hono-inference-disable dexto.route.$method -- reason`
                );
                continue;
            }

            const routeId = match[1];
            const reason = match[2]?.trim() ?? '';
            if (reason.length === 0) {
                errors.push(
                    `${relativePath}:${index + 1} is missing a suppression reason after "--".`
                );
                continue;
            }

            const existing = suppressions.get(routeId);
            if (existing) {
                errors.push(
                    `${relativePath}:${index + 1} duplicates suppression for ${routeId}; already declared at ${existing.file}:${existing.line}.`
                );
                continue;
            }

            suppressions.set(routeId, {
                file: relativePath,
                line: index + 1,
                reason,
            });
        }
    }

    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }

    return Array.from(suppressions.keys());
}

function readPackageExportPath(exportsValue) {
    if (typeof exportsValue === 'string') {
        return exportsValue;
    }
    if (!exportsValue || typeof exportsValue !== 'object') {
        return null;
    }
    if (typeof exportsValue.import === 'string') {
        return exportsValue.import;
    }
    if (typeof exportsValue.types === 'string') {
        return exportsValue.types;
    }
    if (typeof exportsValue.default === 'string') {
        return exportsValue.default;
    }
    if (exportsValue.default && typeof exportsValue.default === 'object') {
        return readPackageExportPath(exportsValue.default);
    }
    return null;
}

function buildWorkspacePaths() {
    const packagesDir = path.resolve(repoRoot, 'packages');
    const paths = {};

    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const packageDir = path.join(packagesDir, entry.name);
        const packageJsonPath = path.join(packageDir, 'package.json');
        if (!existsSync(packageJsonPath)) {
            continue;
        }

        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (typeof packageJson.name !== 'string' || !packageJson.name.startsWith('@dexto/')) {
            continue;
        }

        const mappings = [];
        const mainSourcePath = path.relative(repoRoot, path.join(packageDir, 'src/index.ts'));
        if (existsSync(path.join(packageDir, 'src/index.ts'))) {
            mappings.push([packageJson.name, mainSourcePath]);
        }

        if (packageJson.exports && typeof packageJson.exports === 'object') {
            for (const [subpath, exportValue] of Object.entries(packageJson.exports)) {
                if (subpath === '.' || !subpath.startsWith('./')) {
                    continue;
                }

                const exportPath = readPackageExportPath(exportValue);
                if (!exportPath?.startsWith('./dist/')) {
                    continue;
                }

                const sourcePath = exportPath
                    .replace(/^\.\/dist\//u, './src/')
                    .replace(/\.d\.ts$/u, '.ts')
                    .replace(/\.cjs$/u, '.ts')
                    .replace(/\.js$/u, '.ts');

                const absoluteSourcePath = path.join(packageDir, sourcePath);
                if (!existsSync(absoluteSourcePath)) {
                    continue;
                }

                mappings.push([
                    `${packageJson.name}${subpath.slice(1)}`,
                    path.relative(repoRoot, absoluteSourcePath),
                ]);
            }
        }

        for (const [specifier, sourcePath] of mappings) {
            const normalizedPath = sourcePath.split(path.sep).join('/');
            paths[specifier] = [normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`];
        }
    }

    return paths;
}

function buildAssertionFile(surface, tempDirectory, suppressedRoutes) {
    return `import type { ${surface.schemaType} } from '${relativeImport(tempDirectory, surface.importPath)}';

type JoinPath<Prefix extends string, Segment extends string> = Prefix extends ''
    ? Segment
    : \`\${Prefix}.\${Segment}\`;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = IsAny<T> extends true
    ? false
    : unknown extends T
      ? ([T] extends [unknown] ? true : false)
      : false;
type IsEmptyObject<T> = T extends object ? ([keyof T] extends [never] ? true : false) : false;
type HasStringIndex<T> = T extends object ? (string extends keyof T ? true : false) : false;

type IsOpaqueJsonValue<T> = IsAny<T> extends true
    ? true
    : IsUnknown<T> extends true
      ? true
      : IsEmptyObject<T> extends true
        ? true
        : T extends readonly (infer Element)[]
          ? IsOpaqueJsonUnion<Element>
          : T extends object
            ? HasStringIndex<T>
            : false;

type IsOpaqueJsonUnion<T> = true extends (T extends unknown ? IsOpaqueJsonValue<T> : never)
    ? true
    : false;

type ExactIgnoredRoute =
${
    suppressedRoutes.length === 0
        ? '    | never'
        : suppressedRoutes.map((routeId) => `    | ${JSON.stringify(routeId)}`).join('\n')
};

type IsIgnoredRoute<Path extends string> = Path extends ExactIgnoredRoute ? true : false;
type IsHeadRoute<Path extends string> = Path extends \`\${string}.$head\` ? true : false;

type MethodIssues<T, Path extends string> = IsIgnoredRoute<Path> extends true
    ? never
    : IsHeadRoute<Path> extends true
    ? never
    : T extends {
          status: infer Status;
          output: infer Output;
          outputFormat: infer OutputFormat;
      }
      ? OutputFormat extends 'json'
          ? Status extends 204
              ? never
              : IsOpaqueJsonUnion<Output> extends true
                ? \`\${Path} has opaque json output\`
                : never
          : never
      : never;

type IsEndpoint<T> = T extends {
    input: unknown;
    output: unknown;
    outputFormat: unknown;
    status: unknown;
}
    ? true
    : false;

type RouteIssues<T, Path extends string = ''> = MethodIssues<T, Path> | (IsEndpoint<T> extends true
    ? never
    : T extends object
      ? {
            [Key in keyof T & string]: RouteIssues<T[Key], JoinPath<Path, Key>>;
        }[keyof T & string]
      : never);

type Surface = ${surface.schemaType};
type Issues = RouteIssues<Surface, ${JSON.stringify(surface.pathPrefix)}>;
declare const issues: Issues;
const _check: never = issues;
`;
}

function buildTempTsconfig(tempDirectory, workspacePaths) {
    const extendsPath = path
        .relative(tempDirectory, path.resolve(repoRoot, 'tsconfig.json'))
        .split(path.sep)
        .join('/');

    return JSON.stringify(
        {
            extends: extendsPath.startsWith('.') ? extendsPath : `./${extendsPath}`,
            compilerOptions: {
                baseUrl: '..',
                noEmit: true,
                skipLibCheck: true,
                paths: workspacePaths,
            },
            include: ['./check-hono-inference.generated.ts'],
        },
        null,
        4
    );
}

function main() {
    const suppressions = readCheckerSuppressions();
    const workspacePaths = buildWorkspacePaths();
    for (const surface of surfaces) {
        const tempDirectory = mkdtempSync(path.join(repoRoot, '.tmp-hono-inference-'));
        const assertionFile = path.join(tempDirectory, 'check-hono-inference.generated.ts');
        const tempTsconfig = path.join(tempDirectory, 'tsconfig.json');

        try {
            console.log(`Checking ${surface.name}...`);
            writeFileSync(assertionFile, buildAssertionFile(surface, tempDirectory, suppressions));
            writeFileSync(tempTsconfig, buildTempTsconfig(tempDirectory, workspacePaths));

            const result = spawnSync(
                'pnpm',
                ['exec', 'tsc', '-p', tempTsconfig, '--pretty', 'false', '--noErrorTruncation'],
                {
                    cwd: repoRoot,
                    encoding: 'utf8',
                }
            );

            if (result.stdout.trim().length > 0) {
                process.stdout.write(result.stdout);
            }
            if (result.stderr.trim().length > 0) {
                process.stderr.write(result.stderr);
            }

            if (result.status !== 0) {
                console.error(`Hono inference check failed in surface: ${surface.name}`);
                process.exitCode = result.status ?? 1;
                return;
            }
        } finally {
            rmSync(tempDirectory, { recursive: true, force: true });
        }
    }

    console.log('Hono inference check passed.');
}

main();
