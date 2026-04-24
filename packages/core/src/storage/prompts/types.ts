import type { StoredCustomPrompt } from '../../prompts/providers/custom-prompt-provider.js';

export interface CustomPromptStore {
    save(input: { prompt: StoredCustomPrompt }): Promise<void>;
    get(input: { name: string }): Promise<StoredCustomPrompt | undefined>;
    delete(input: { name: string }): Promise<void>;
    list(): Promise<StoredCustomPrompt[]>;
}
