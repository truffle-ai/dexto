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

// Auth commands
export { handleLoginCommand, handleLogoutCommand, handleStatusCommand } from './auth/index.js';

// Billing commands
export { handleBillingStatusCommand } from './billing/index.js';
