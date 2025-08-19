// src/app/cli/commands/index.ts

// Project setup commands
export {
    createDextoProject,
    createTsconfigJson,
    addDextoScriptsToPackageJson,
    postCreateDexto,
} from './create-app.js';

export { getUserInputToInitDextoApp, initDexto, postInitDexto } from './init-app.js';

export { handleSetupCommand, type CLISetupOptions } from './setup.js';
export { handleInstallCommand, type InstallCommandOptions } from './install.js';
