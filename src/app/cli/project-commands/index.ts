// Project setup commands - run once and exit
export {
    createDextoProject,
    createTsconfigJson,
    addDextoScriptsToPackageJson,
    postCreateDexto,
} from './create.js';

export {
    getUserInputToInitDextoApp,
    initDexto,
    postInitDexto,
    createDextoDirectories,
    createDextoConfigFile,
    createDextoExampleFile,
} from './init.js';
