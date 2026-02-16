import type { DextoImageModule, HookFactory } from '@dexto/agent-config';
import imageLocal from '@dexto/image-local';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { RequestLoggerPlugin } from './hooks/request-logger.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name?: string; version?: string };

const requestLoggerConfigSchema = z
    .object({
        type: z.literal('request-logger'),
        logDir: z.string().optional(),
        logFileName: z.string().optional(),
    })
    .strict();

const requestLoggerFactory: HookFactory<z.output<typeof requestLoggerConfigSchema>> = {
    configSchema: requestLoggerConfigSchema,
    create: (_config) => new RequestLoggerPlugin(),
};

const imageLoggerAgent: DextoImageModule = {
    ...imageLocal,
    metadata: {
        name: packageJson.name ?? '@dexto/image-logger-agent',
        version: packageJson.version ?? '0.0.0',
        description:
            'Example image for the Logger Agent (adds request-logger plugin which logs requests)',
        target: 'local-development',
        constraints: ['filesystem-required'],
    },
    hooks: {
        ...imageLocal.hooks,
        'request-logger': requestLoggerFactory,
    },
};

export default imageLoggerAgent;
