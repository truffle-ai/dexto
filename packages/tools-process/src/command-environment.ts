import { buildShellEnvironment, pickHostVariables } from '@dexto/core/workspace';
import type { ProcessConfig } from './types.js';

type CommandEnvironmentConfig = Pick<ProcessConfig, 'environment' | 'passEnvironment'>;

/**
 * The variables the user asked to add: host variables named in `passEnvironment`, then
 * `environment`, then the per-call `env`. None of the host's own variables are included.
 */
export function explicitCommandEnvironment(
    config: CommandEnvironmentConfig,
    perCall: Record<string, string> | undefined
): Record<string, string> {
    return {
        ...pickHostVariables(process.env, config.passEnvironment),
        ...config.environment,
        ...perCall,
    };
}

/**
 * Full environment for a command run on this machine: the allowlisted host variables plus the
 * explicit layers.
 */
export function buildCommandEnvironment(
    config: CommandEnvironmentConfig,
    perCall: Record<string, string> | undefined
): Record<string, string> {
    return buildShellEnvironment(process.env, explicitCommandEnvironment(config, perCall));
}
