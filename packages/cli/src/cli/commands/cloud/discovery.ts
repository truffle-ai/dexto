import { CloudClientError, createDextoCloudClient } from '@dexto/client-sdk/cloud';
import { ZodError } from 'zod';
import { DEFAULT_DEXTO_PLATFORM_URL } from '../../auth/constants.js';
import { getIncomingEnvironmentVariable } from '../../../utils/env.js';
import { loadAuth } from '../../auth/service.js';

export type CloudDiscoveryCommand =
    | { command: 'sources' }
    | { command: 'search'; query: string }
    | { command: 'describe'; path: string };
export interface CloudDiscoveryOptions {
    json?: boolean;
    limit?: string;
    offset?: string;
    platformUrl?: string;
}

export async function runCloudDiscovery(
    command: CloudDiscoveryCommand,
    options: CloudDiscoveryOptions
): Promise<number> {
    try {
        const environmentToken = getIncomingEnvironmentVariable('DEXTO_API_KEY')?.trim();
        const environmentOrigin = getIncomingEnvironmentVariable('DEXTO_PLATFORM_URL') || undefined;
        const requestedOrigin =
            options.platformUrl ?? environmentOrigin ?? DEFAULT_DEXTO_PLATFORM_URL;
        const hasOriginOverride =
            options.platformUrl !== undefined || environmentOrigin !== undefined;
        const auth = await loadAuth();
        const savedToken = auth?.dextoApiKey?.trim();
        const token = environmentToken || savedToken;
        if (!token)
            throw new CloudClientError(
                'configuration_error',
                'Run dexto login or supply DEXTO_API_KEY to discover Cloud capabilities.'
            );
        let origin = requestedOrigin;
        if (savedToken === token) {
            const credentialOrigin = auth?.dextoPlatformUrl;
            if (!credentialOrigin) {
                throw new CloudClientError(
                    'configuration_error',
                    'Saved credential has no platform origin. Run dexto login --platform-url <application-origin> again before discovering Cloud capabilities.'
                );
            }
            if (hasOriginOverride && new URL(origin).origin !== new URL(credentialOrigin).origin) {
                throw new CloudClientError(
                    'configuration_error',
                    'Saved credential belongs to a different platform origin. Login to the requested platform or supply a different DEXTO_API_KEY issued by it.'
                );
            }
            origin = credentialOrigin;
        }
        const client = createDextoCloudClient({ origin, token, fetch: globalThis.fetch });
        const pagination = {
            ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
            ...(options.offset === undefined ? {} : { offset: Number(options.offset) }),
        };
        switch (command.command) {
            case 'sources': {
                const result = await client.sources(pagination);
                console.log(
                    options.json
                        ? JSON.stringify(result)
                        : result.sources
                              .map(
                                  (source) =>
                                      `${source.id}\t${source.title}\t${source.kind}${source.toolCount === undefined ? '' : `\t${source.toolCount} tools`}`
                              )
                              .join('\n') || 'No capability sources available.'
                );
                break;
            }
            case 'search': {
                const result = await client.search({ ...pagination, query: command.query });
                const rows = result.items.map(
                    (tool) =>
                        `${tool.aliases.join(', ') || tool.name}\t${tool.description}\t${tool.invocable.mode}`
                );
                console.log(
                    options.json
                        ? JSON.stringify(result)
                        : [
                              ...rows,
                              `${result.total} matches${result.nextOffset === null ? '' : `; next page: --offset ${result.nextOffset}`}`,
                          ].join('\n')
                );
                break;
            }
            case 'describe': {
                const result = await client.describe(command.path);
                console.log(
                    options.json
                        ? JSON.stringify(result)
                        : result.found
                          ? JSON.stringify(result.tool, null, 2)
                          : `Capability ${result.path} was not found.`
                );
                break;
            }
        }
        return 0;
    } catch (error) {
        const failure =
            error instanceof CloudClientError
                ? {
                      code: error.code,
                      message: error.message,
                      ...(error.status === undefined ? {} : { status: error.status }),
                  }
                : error instanceof ZodError
                  ? {
                        code: 'invalid_input',
                        message:
                            'Check the query, capability path, and pagination (limit 1–100; offset 0 or greater).',
                    }
                  : {
                        code: 'cloud_discovery_error',
                        message:
                            'Cloud discovery failed. Check the platform origin and credential configuration.',
                    };
        if (options.json) console.log(JSON.stringify({ error: failure }));
        else console.error(failure.message);
        return 1;
    }
}
