import type { ValidatedAgentConfig } from '@dexto/agent-config';
import type { DextoAgent } from '@dexto/core';
import type { UpdateInfo } from '../utils/version-check.js';

export interface MainModeOptions {
    mode?: string;
    port?: string;
    resume?: string;
    continue?: boolean;
    bypassPermissions?: boolean;
}

export interface MainModeContext {
    agent: DextoAgent;
    opts: MainModeOptions;
    validatedConfig: ValidatedAgentConfig;
    resolvedPath: string;
    derivedAgentId: string;
    initialPrompt: string | undefined;
    getVersionCheckResult: () => Promise<UpdateInfo | null>;
}
