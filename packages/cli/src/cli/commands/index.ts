// packages/cli/src/cli/commands/index.ts

// Project setup commands
export { createDextoProject, type CreateAppOptions } from './create-app.js';

export { createImage } from './create-image.js';

export { getUserInputToInitDextoApp, initDexto, postInitDexto } from './init-app.js';

export { handleSetupCommand, type CLISetupOptions, type CLISetupOptionsInput } from './setup.js';
export { handleInstallCommand, type InstallCommandOptions } from './install.js';
export { handleUninstallCommand, type UninstallCommandOptions } from './uninstall.js';
export {
    handleListAgentsCommand,
    type ListAgentsCommandOptions,
    type ListAgentsCommandOptionsInput,
} from './list-agents.js';
export { handleWhichCommand, type WhichCommandOptions } from './which.js';
export {
    handleSyncAgentsCommand,
    shouldPromptForSync,
    markSyncDismissed,
    clearSyncDismissed,
    type SyncAgentsCommandOptions,
} from './sync-agents.js';
export {
    handlePluginListCommand,
    handlePluginInstallCommand,
    handlePluginUninstallCommand,
    handlePluginValidateCommand,
    handlePluginImportCommand,
    type PluginListCommandOptions,
    type PluginListCommandOptionsInput,
    type PluginInstallCommandOptions,
    type PluginInstallCommandOptionsInput,
    type PluginUninstallCommandOptions,
    type PluginUninstallCommandOptionsInput,
    type PluginValidateCommandOptions,
    type PluginValidateCommandOptionsInput,
    type PluginImportCommandOptions,
    type PluginImportCommandOptionsInput,
} from './plugin.js';
