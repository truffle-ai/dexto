import type { DextoImage, HookFactory } from '@dexto/agent-config';
import imageLocal from '@dexto/image-local';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestLoggerHook } from './hooks/request-logger.js';

function readPackageJson(packageJsonPath: string): { name?: string; version?: string } | null {
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
            name?: string;
            version?: string;
        };
    } catch {
        return null;
    }
}

function resolveImageMetadata(defaultName: string): { name: string; version: string } {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const localPackageJson = readPackageJson(path.resolve(scriptDir, '..', 'package.json'));
    if (localPackageJson) {
        return {
            name: localPackageJson.name ?? defaultName,
            version: localPackageJson.version ?? '0.0.0',
        };
    }

    const packageRoot = process.env.DEXTO_PACKAGE_ROOT;
    if (packageRoot) {
        const bundledPackageJson = readPackageJson(path.join(packageRoot, 'package.json'));
        if (bundledPackageJson) {
            return {
                name: bundledPackageJson.name ?? defaultName,
                version: bundledPackageJson.version ?? '0.0.0',
            };
        }
    }

    return {
        name: defaultName,
        version: process.env.DEXTO_CLI_VERSION ?? '0.0.0',
    };
}

const imageMetadata = resolveImageMetadata('@dexto/image-logger-agent');

const requestLoggerConfigSchema = z
    .object({
        type: z.literal('request-logger'),
        logDir: z.string().optional(),
        logFileName: z.string().optional(),
    })
    .strict();

const requestLoggerFactory: HookFactory<z.output<typeof requestLoggerConfigSchema>> = {
    configSchema: requestLoggerConfigSchema,
    create: (_config) => new RequestLoggerHook(),
};

const imageLoggerAgent: DextoImage = {
    ...imageLocal,
    metadata: {
        name: imageMetadata.name,
        version: imageMetadata.version,
        description:
            'Example image for the Logger Agent (adds request-logger hook which logs requests)',
        target: 'local-development',
        constraints: ['filesystem-required'],
    },
    hooks: {
        ...imageLocal.hooks,
        'request-logger': requestLoggerFactory,
    },
};

export default imageLoggerAgent;
