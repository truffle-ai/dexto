// packages/core/src/preferences/index.ts

export type {
    GlobalPreferences,
    PreferenceLLM,
    PreferenceDefaults,
    PreferenceSetup,
    PreferenceSounds,
} from './schemas.js';

export {
    GlobalPreferencesSchema,
    PreferenceLLMSchema,
    PreferenceDefaultsSchema,
    PreferenceSetupSchema,
    PreferenceSoundsSchema,
} from './schemas.js';

export { PREFERENCES_FILE } from './constants.js';

export {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
    type CreatePreferencesOptions,
} from './loader.js';

export { PreferenceError, PreferenceErrorCode } from './errors.js';
