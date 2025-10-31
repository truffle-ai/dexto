import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ConfigErrorCode } from './error-codes.js';

/**
 * Config runtime error factory methods
 * Creates properly typed errors for configuration operations
 */
export class ConfigError {
    // File operation errors
    static fileNotFound(configPath: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Configuration file not found: ${configPath}`,
            { configPath },
            'Ensure the configuration file exists at the specified path'
        );
    }

    static fileReadError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_READ_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to read configuration file: ${cause}`,
            { configPath, cause },
            'Check file permissions and ensure the file is not corrupted'
        );
    }

    static fileWriteError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_WRITE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to write configuration file '${configPath}': ${cause}`,
            { configPath, cause },
            'Check file permissions and available disk space'
        );
    }

    // Parsing errors
    static parseError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.PARSE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Failed to parse configuration file: ${cause}`,
            { configPath, cause },
            'Ensure the configuration file contains valid YAML syntax'
        );
    }

    // Resolution errors
    static noProjectDefault(projectPath: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.NO_PROJECT_DEFAULT,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `No project default-agent.yml found and no global preferences configured.\nEither create default-agent.yml in your project root (${projectPath}) or run \`dexto setup\` to configure preferences.`,
            { projectPath },
            'Run `dexto setup` or create a project-specific agent config'
        );
    }

    static noGlobalPreferences() {
        return new DextoRuntimeError(
            ConfigErrorCode.NO_GLOBAL_PREFERENCES,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `No global preferences found. Run \`dexto setup\` to get started.`,
            {},
            'Run `dexto setup` to configure your AI preferences'
        );
    }

    static setupIncomplete() {
        return new DextoRuntimeError(
            ConfigErrorCode.SETUP_INCOMPLETE,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Global preferences setup is incomplete. Run \`dexto setup\` to complete.`,
            {},
            'Run `dexto setup` to complete your configuration'
        );
    }

    static bundledNotFound(bundledPath: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.BUNDLED_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.NOT_FOUND,
            `Bundled default agent not found: ${bundledPath}. Run npm run build first.`,
            { path: bundledPath },
            'Run `npm run build` to build the bundled agents'
        );
    }

    static unknownContext(context: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.UNKNOWN_CONTEXT,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Unknown execution context: ${context}`,
            { context },
            'This is an internal error - please report it'
        );
    }

    // Validation errors
    static invalidSubAgent(reason: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.INVALID_SUB_AGENT,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Sub-agent configuration is invalid: ${reason}`,
            { reason },
            'Ensure sub-agent configuration follows security constraints'
        );
    }

    // Built-in agent errors
    static builtInAgentNotFound(agentName: string, searchPath?: string) {
        const message = searchPath
            ? `Built-in agent '${agentName}' not found at: ${searchPath}`
            : `Built-in agent '${agentName}' not found`;
        const availableAgents = ['general-purpose', 'code-reviewer', 'test-runner'].join(', ');

        return new DextoRuntimeError(
            ConfigErrorCode.FILE_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.NOT_FOUND,
            message,
            { agentName, searchPath },
            `Available built-in agents: ${availableAgents}`
        );
    }

    static builtInAgentLoadFailed(agentName: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_READ_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to load built-in agent '${agentName}': ${cause}`,
            { agentName, cause },
            'This may indicate a corrupted installation. Try reinstalling Dexto.'
        );
    }

    static loadFailed(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_READ_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to load agent config from '${configPath}': ${cause}`,
            { configPath, cause },
            'Check file permissions and ensure the file contains valid YAML'
        );
    }

    static inlineConfigMergeFailed(cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.PARSE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Failed to merge inline agent config: ${cause}`,
            { cause },
            'Ensure the inline config object is valid and compatible with AgentConfig schema'
        );
    }
}
