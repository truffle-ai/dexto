import { useState } from 'react';
import {
    useLLMCatalog,
    useSaveApiKey,
    useProviderApiKey,
    type LLMProvider,
} from '../../hooks/useLLM';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Alert, AlertDescription } from '../../ui/alert';
import { Check, Eye, EyeOff, ExternalLink, Loader2 } from 'lucide-react';

// Provider info with display names and key URLs
const PROVIDER_INFO: Record<
    string,
    { displayName: string; keyUrl?: string; description?: string }
> = {
    openai: {
        displayName: 'OpenAI',
        keyUrl: 'https://platform.openai.com/api-keys',
        description: 'GPT models',
    },
    anthropic: {
        displayName: 'Anthropic',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        description: 'Claude models',
    },
    google: {
        displayName: 'Google AI',
        keyUrl: 'https://aistudio.google.com/apikey',
        description: 'Gemini models (Free tier available)',
    },
    groq: {
        displayName: 'Groq',
        keyUrl: 'https://console.groq.com/keys',
        description: 'Fast inference',
    },
    xai: {
        displayName: 'xAI',
        keyUrl: 'https://console.x.ai/team/default/api-keys',
        description: 'Grok models',
    },
    cohere: {
        displayName: 'Cohere',
        keyUrl: 'https://dashboard.cohere.com/api-keys',
        description: 'Command models',
    },
    openrouter: {
        displayName: 'OpenRouter',
        keyUrl: 'https://openrouter.ai/keys',
        description: 'Multi-provider gateway',
    },
    'dexto-nova': {
        displayName: 'Dexto Nova',
        description: 'Multi-provider gateway',
    },
    glama: {
        displayName: 'Glama',
        keyUrl: 'https://glama.ai/settings/api-keys',
        description: 'OpenAI-compatible',
    },
    ollama: {
        displayName: 'Ollama',
        description: 'Local models (no key needed)',
    },
    local: {
        displayName: 'Local',
        description: 'GGUF models (no key needed)',
    },
};

// Providers that don't need API keys or need special configuration
// These are handled by the ModelPicker's custom model form instead
const EXCLUDED_PROVIDERS = [
    'ollama', // Local, no key needed
    'local', // Local GGUF, no key needed
    'openai-compatible', // Needs baseURL + model name (use ModelPicker)
    'litellm', // Needs baseURL (use ModelPicker)
    'bedrock', // Uses AWS credentials, not API key
    'vertex', // Uses Google Cloud ADC, not API key
];

type ProviderRowProps = {
    provider: LLMProvider;
    hasKey: boolean;
    envVar: string;
    onSave: (key: string) => Promise<void>;
};

function ProviderRow({ provider, hasKey, envVar, onSave }: ProviderRowProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const info = PROVIDER_INFO[provider] || { displayName: provider };

    // Query for masked key value when has key
    const { data: keyData } = useProviderApiKey(hasKey ? provider : null);

    const handleSave = async () => {
        if (!apiKey.trim()) {
            setError('API key is required');
            return;
        }
        setError(null);
        setIsSaving(true);
        try {
            await onSave(apiKey);
            setApiKey('');
            setIsEditing(false);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        setApiKey('');
        setError(null);
    };

    return (
        <div className="py-3 px-4 rounded-lg border border-border">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium">{info.displayName}</span>
                        {hasKey && !isEditing && (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <Check className="h-3 w-3" />
                                Configured
                            </span>
                        )}
                        {saveSuccess && (
                            <span className="text-xs text-green-600 dark:text-green-400">
                                Saved!
                            </span>
                        )}
                    </div>
                    <div className="text-sm text-muted-foreground">{info.description}</div>
                    {hasKey && keyData?.keyValue && !isEditing && (
                        <div className="mt-1 text-xs text-muted-foreground font-mono">
                            {keyData.keyValue}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {info.keyUrl && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => window.open(info.keyUrl, '_blank')}
                        >
                            <ExternalLink className="h-4 w-4" />
                        </Button>
                    )}
                    {!isEditing ? (
                        <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                            {hasKey ? 'Update' : 'Add Key'}
                        </Button>
                    ) : null}
                </div>
            </div>

            {isEditing && (
                <div className="mt-3 space-y-3">
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">API Key ({envVar})</Label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Input
                                    type={showKey ? 'text' : 'password'}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={`Enter ${info.displayName} API key`}
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showKey ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <Alert variant="destructive" className="py-2">
                            <AlertDescription className="text-sm">{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancel}
                            disabled={isSaving}
                        >
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSave} disabled={isSaving}>
                            {isSaving ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save'
                            )}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ApiKeysSection() {
    const {
        data: catalog,
        isLoading,
        error,
    } = useLLMCatalog({
        mode: 'grouped',
        includeModels: false,
    });
    const { mutateAsync: saveApiKey } = useSaveApiKey();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertDescription>Failed to load providers: {error.message}</AlertDescription>
            </Alert>
        );
    }

    if (!catalog || !('providers' in catalog)) {
        return (
            <Alert>
                <AlertDescription>No providers available</AlertDescription>
            </Alert>
        );
    }

    const providers = Object.entries(catalog.providers) as [
        LLMProvider,
        { hasApiKey: boolean; primaryEnvVar: string },
    ][];

    // Filter out providers handled elsewhere (openai-compatible is in Default Model)
    const regularProviders = providers.filter(([id]) => !EXCLUDED_PROVIDERS.includes(id));

    // Sort: configured first, then by display name
    const sortedProviders = regularProviders.sort((a, b) => {
        const aHasKey = a[1].hasApiKey;
        const bHasKey = b[1].hasApiKey;
        if (aHasKey !== bHasKey) return bHasKey ? 1 : -1;

        const aName = PROVIDER_INFO[a[0]]?.displayName || a[0];
        const bName = PROVIDER_INFO[b[0]]?.displayName || b[0];
        return aName.localeCompare(bName);
    });

    const handleSave = async (provider: LLMProvider, apiKey: string) => {
        await saveApiKey({ provider, apiKey });
    };

    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                API keys are stored securely in your local .env file and are never shared with third
                parties.
            </p>

            {sortedProviders.map(([provider, info]) => (
                <ProviderRow
                    key={provider}
                    provider={provider}
                    hasKey={info.hasApiKey}
                    envVar={info.primaryEnvVar}
                    onSave={(key) => handleSave(provider, key)}
                />
            ))}
        </div>
    );
}
