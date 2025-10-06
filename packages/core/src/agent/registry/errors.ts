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

    static agentAlreadyExists(agentName: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentName}' already exists in user registry`,
            { agentName },
            'Choose a different name or uninstall the existing agent first'
        );
    }

    static customAgentNameConflict(agentName: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Cannot create custom agent '${agentName}': name conflicts with builtin agent`,
            { agentName, conflictType: 'builtin' },
            'Choose a different name for your custom agent'
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

    // Uninstallation errors
    static agentNotInstalled(agentName: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentName}' is not installed`,
            { agentName },
            'Use "dexto list-agents --installed" to see installed agents'
        );
    }

    static agentProtected(agentName: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_PROTECTED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentName}' is protected and cannot be uninstalled. Use --force to override (not recommended for critical agents)`,
            { agentName },
            'Use --force to override (not recommended for critical agents)'
        );
    }

    static uninstallationFailed(agentName: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.UNINSTALLATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to uninstall agent '${agentName}': ${cause}`,
            { agentName, cause },
            'Check file permissions and ensure no processes are using the agent'
        );
    }

    // Registry file errors
    static registryNotFound(registryPath: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.REGISTRY_NOT_FOUND,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Agent registry not found: ${registryPath}: ${cause}`,
            { registryPath },
            'This indicates a problem with the Dexto installation - please reinstall or report this issue'
        );
    }

    static registryParseError(registryPath: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.REGISTRY_PARSE_ERROR,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to parse agent registry from ${registryPath}: ${cause}`,
            { registryPath, cause },
            'This indicates a corrupted registry file - please reinstall Dexto'
        );
    }

    // Auto-install control errors
    static agentNotInstalledAutoInstallDisabled(agentName: string, availableAgents: string[]) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED_AUTO_INSTALL_DISABLED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentName}' is not installed locally and auto-install is disabled`,
            { agentName, availableAgents },
            `Use 'dexto install ${agentName}' to install it manually, or use a file path for custom agents`
        );
    }
}
