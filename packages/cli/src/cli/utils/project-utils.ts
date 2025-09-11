// packages/cli/src/cli/utils/project-utils.ts

import fs from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { type LLMProvider, getDefaultModelForProvider, getPrimaryApiKeyEnvVar } from '@dexto/core';

/**
 * Updates the LLM provider information in a dexto config file
 * Used for project creation/initialization (modifies agent yml files)
 * @param filepath Path to agent config file
 * @param llmProvider LLM provider to configure
 */
export async function updateDextoConfigFile(
    filepath: string,
    llmProvider: LLMProvider
): Promise<void> {
    const fileContent = await fs.readFile(filepath, 'utf8');
    const doc = parseDocument(fileContent);
    doc.setIn(['llm', 'provider'], llmProvider);
    doc.setIn(['llm', 'apiKey'], `$${getPrimaryApiKeyEnvVar(llmProvider)}`);
    const defaultModel = getDefaultModelForProvider(llmProvider);
    if (defaultModel) {
        doc.setIn(['llm', 'model'], defaultModel);
    }
    await fs.writeFile(filepath, doc.toString(), 'utf8');
}
