import { DextoRuntimeError } from '@core/errors/index.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { RegistryErrorCode } from './error-codes.js';

/**
 * Registry runtime error factory methods
 * Creates properly typed errors for registry operations
 */
export class RegistryError {
    // Agent lookup errors
    static agentNotFound(agentId: string, availableAgents: string[]) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_FOUND,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentId}' not found in registry`,
            { agentId, availableAgents },
            `Available agents: ${availableAgents.join(', ')}. Use a file path for custom agents.`
        );
    }

    static agentInvalidEntry(agentId: string, reason: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_INVALID_ENTRY,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Registry entry for '${agentId}' is invalid: ${reason}`,
            { agentId, reason },
            'This indicates a problem with the agent registry - please report this issue'
        );
    }

    static agentAlreadyExists(agentId: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentId}' already exists in user registry`,
            { agentId },
            'Choose a different name or uninstall the existing agent first'
        );
    }

    static customAgentNameConflict(agentId: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Cannot create custom agent '${agentId}': name conflicts with builtin agent`,
            { agentId, conflictType: 'builtin' },
            'Choose a different name for your custom agent'
        );
    }

    // Installation errors
    static installationFailed(agentId: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.INSTALLATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to install agent '${agentId}': ${cause}`,
            { agentId, cause },
            'Check network connection and available disk space'
        );
    }

    static installationValidationFailed(agentId: string, missingPath: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.INSTALLATION_VALIDATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Installation validation failed for '${agentId}': missing main config`,
            { agentId, missingPath },
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

    static mainConfigMissing(agentId: string, expectedPath: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.MAIN_CONFIG_MISSING,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Main config file not found for agent '${agentId}': ${expectedPath}`,
            { agentId, expectedPath },
            'This indicates a problem with the agent bundle structure'
        );
    }

    // Uninstallation errors
    static agentNotInstalled(agentId: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentId}' is not installed`,
            { agentId },
            'Use "dexto list-agents --installed" to see installed agents'
        );
    }

    static agentProtected(agentId: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_PROTECTED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentId}' is protected and cannot be uninstalled. Use --force to override (not recommended for critical agents)`,
            { agentId },
            'Use --force to override (not recommended for critical agents)'
        );
    }

    static uninstallationFailed(agentId: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.UNINSTALLATION_FAILED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to uninstall agent '${agentId}': ${cause}`,
            { agentId, cause },
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

    static registryWriteError(registryPath: string, cause: string) {
        return new DextoRuntimeError(
            RegistryErrorCode.REGISTRY_WRITE_ERROR,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.SYSTEM,
            `Failed to save agent registry to ${registryPath}: ${cause}`,
            { registryPath, cause },
            'Check file permissions and available disk space'
        );
    }

    // Auto-install control errors
    static agentNotInstalledAutoInstallDisabled(agentId: string, availableAgents: string[]) {
        return new DextoRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED_AUTO_INSTALL_DISABLED,
            ErrorScope.AGENT_REGISTRY,
            ErrorType.USER,
            `Agent '${agentId}' is not installed locally and auto-install is disabled`,
            { agentId, availableAgents },
            `Use 'dexto install ${agentId}' to install it manually, or use a file path for custom agents`
        );
    }
}
