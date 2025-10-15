// packages/cli/src/cli/commands/index.ts

// Project setup commands
export {
    createDextoProject,
    createTsconfigJson,
    addDextoScriptsToPackageJson,
    postCreateDexto,
} from './create-app.js';

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

// Authentication commands
export {
    handleLoginCommand,
    handleLogoutCommand,
    handleStatusCommand,
    handleWhoamiCommand,
    handleBrowserLogin,
} from './auth/index.js';
export { isAuthenticated, getAuthToken } from '../utils/auth-service.js';
