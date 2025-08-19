// src/core/preferences/index.ts

export type {
    GlobalPreferences,
    PreferenceLLM,
    PreferenceDefaults,
    PreferenceSetup,
} from './schemas.js';

export {
    GlobalPreferencesSchema,
    PreferenceLLMSchema,
    PreferenceDefaultsSchema,
    PreferenceSetupSchema,
} from './schemas.js';

export { PREFERENCES_FILE } from './constants.js';

export { injectLLMPreferences, injectPreferencesToAgent, type LLMOverrides } from './injection.js';

export {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
} from './loader.js';

export { PreferenceError, PreferenceErrorCode } from './errors.js';
