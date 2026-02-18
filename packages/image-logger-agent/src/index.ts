import type { DextoImage, HookFactory } from '@dexto/agent-config';
import imageLocal from '@dexto/image-local';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { RequestLoggerHook } from './hooks/request-logger.js';

declare const DEXTO_CLI_VERSION: string | undefined;

function resolveImageVersion(): string {
    if (process.env.DEXTO_CLI_VERSION && process.env.DEXTO_CLI_VERSION.length > 0) {
        return process.env.DEXTO_CLI_VERSION;
    }

    if (typeof DEXTO_CLI_VERSION === 'string' && DEXTO_CLI_VERSION.length > 0) {
        return DEXTO_CLI_VERSION;
    }

    try {
        const require = createRequire(import.meta.url);
        const pkg = require('../package.json') as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {
        // ignore
    }

    throw new Error('Could not determine @dexto/image-logger-agent version');
}

const imageVersion = resolveImageVersion();

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
        name: '@dexto/image-logger-agent',
        version: imageVersion,
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
