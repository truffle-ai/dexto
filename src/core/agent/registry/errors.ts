import { DextoRuntimeError } from '@core/errors/index.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { RegistryErrorCode } from './error-codes.js';

/**
 * Registry runtime error factory methods
 * Creates properly typed errors for registry operations
 */
export class RegistryError {
    // Agent lookup errors
    static agentNotFound(agentName: string, availableAgents: string[]) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_FOUND,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentName}' not found in registry`,
            { agentName, availableAgents },
            `Available agents: ${availableAgents.join(', ')}. Use a file path for custom agents.`
        );
    }

    static agentInvalidEntry(agentName: string, reason: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_INVALID_ENTRY,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Registry entry for '${agentName}' is invalid: ${reason}`,
            { agentName, reason },
            'This indicates a problem with the agent registry - please report this issue'
        );
    }

    // Installation errors
    static installationFailed(agentName: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.INSTALLATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to install agent '${agentName}': ${cause}`,
            { agentName, cause },
            'Check network connection and available disk space'
        );
    }

    static installationValidationFailed(agentName: string, missingPath: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.INSTALLATION_VALIDATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Installation validation failed for '${agentName}': missing main config`,
            { agentName, missingPath },
            'This indicates a problem with the agent bundle - please report this issue'
        );
    }

    // Config file errors
    static configNotFound(configPath: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.CONFIG_NOT_FOUND,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Agent config file not found: ${configPath}`,
            { configPath },
            'This indicates a problem with the agent installation'
        );
    }

    static mainConfigMissing(agentName: string, expectedPath: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.MAIN_CONFIG_MISSING,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Main config file not found for agent '${agentName}': ${expectedPath}`,
            { agentName, expectedPath },
            'This indicates a problem with the agent bundle structure'
        );
    }
}
