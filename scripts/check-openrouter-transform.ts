import { MODELS_BY_PROVIDER } from '../packages/core/src/llm/registry/models.generated.ts';
import {
    getOpenRouterCandidateModelIds,
    transformModelNameForProvider,
} from '../packages/core/src/llm/registry/index.ts';
import type { LLMProvider } from '../packages/core/src/llm/types.ts';

type Mode = 'report' | 'check';

const args = process.argv.slice(2);
const mode: Mode = args.includes('--check') ? 'check' : 'report';

const openrouterIds = new Set(MODELS_BY_PROVIDER.openrouter.map((m) => m.name.toLowerCase()));

const providersToCheck: LLMProvider[] = [
    'openai',
    'anthropic',
    'google',
    'xai',
    'cohere',
    'minimax',
    'glm',
];

const failures: Array<{
    provider: LLMProvider;
    model: string;
    transformed: string;
    candidates: string[];
}> = [];

for (const provider of providersToCheck) {
    for (const m of MODELS_BY_PROVIDER[provider]) {
        if (m.name.includes('/')) continue;

        const candidates = getOpenRouterCandidateModelIds(m.name, provider);
        const anyCandidateExists = candidates.some((c) => openrouterIds.has(c.toLowerCase()));
        if (!anyCandidateExists) continue;

        const transformed = transformModelNameForProvider(m.name, provider, 'openrouter');
        if (!openrouterIds.has(transformed.toLowerCase())) {
            failures.push({ provider, model: m.name, transformed, candidates });
        }
    }
}

if (failures.length === 0) {
    console.log(
        `✅ OpenRouter transform matches catalog for all checked models (${providersToCheck.length} providers).`
    );
    process.exit(0);
}

console.log(`❌ ${failures.length} model(s) did not transform to a known OpenRouter ID.\n`);
for (const f of failures.slice(0, 50)) {
    console.log(
        `- ${f.provider}/${f.model} -> ${f.transformed} (candidates: ${f.candidates.join(', ')})`
    );
}
if (failures.length > 50) {
    console.log(`\n… and ${failures.length - 50} more`);
}

if (mode === 'check') {
    process.exit(1);
}
