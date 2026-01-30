import React, { useState } from 'react';
import { useCreateAgent, type CreateAgentPayload } from '../hooks/useAgents';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertCircle, Loader2, Eye, EyeOff, Info } from 'lucide-react';
import { LLM_PROVIDERS } from '@dexto/core';

interface CreateAgentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAgentCreated?: (agentName: string) => void;
}

interface FormData {
    id: string;
    idManuallyEdited: boolean;
    name: string;
    description: string;
    provider: string;
    model: string;
    apiKey: string;
    systemPrompt: string;
}

const initialFormData: FormData = {
    id: '',
    idManuallyEdited: false,
    name: '',
    description: '',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: '',
    systemPrompt: '',
};

// Convert name to a valid ID (lowercase, hyphens, no special chars)
function nameToId(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-') // Spaces to hyphens
        .replace(/-+/g, '-') // Multiple hyphens to single
        .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

export default function CreateAgentModal({
    open,
    onOpenChange,
    onAgentCreated,
}: CreateAgentModalProps) {
    const [form, setForm] = useState<FormData>(initialFormData);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [createError, setCreateError] = useState<string | null>(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const createAgentMutation = useCreateAgent();
    const isCreating = createAgentMutation.isPending;

    const updateField = (field: keyof FormData, value: string) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value };

            // Auto-generate ID from name if ID hasn't been manually edited
            if (field === 'name' && !prev.idManuallyEdited) {
                next.id = nameToId(value);
            }

            // Mark ID as manually edited if user types in it
            if (field === 'id') {
                next.idManuallyEdited = true;
            }

            return next;
        });
        if (errors[field]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!form.id.trim()) {
            newErrors.id = 'Required';
        } else if (!/^[a-z0-9-]+$/.test(form.id)) {
            newErrors.id = 'Lowercase letters, numbers, and hyphens only';
        }

        if (!form.name.trim()) {
            newErrors.name = 'Required';
        }

        if (!form.description.trim()) {
            newErrors.description = 'Required';
        }

        if (!form.provider) {
            newErrors.provider = 'Required';
        }

        if (!form.model.trim()) {
            newErrors.model = 'Required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleCreate = async () => {
        if (!validateForm()) return;

        setCreateError(null);

        const payload: CreateAgentPayload = {
            id: form.id.trim(),
            name: form.name.trim(),
            description: form.description.trim(),
            config: {
                llm: {
                    provider: form.provider as CreateAgentPayload['config']['llm']['provider'],
                    model: form.model.trim(),
                    apiKey: form.apiKey.trim() || undefined,
                },
                ...(form.systemPrompt.trim() && {
                    systemPrompt: {
                        contributors: [
                            {
                                id: 'primary',
                                type: 'static' as const,
                                priority: 0,
                                enabled: true,
                                content: form.systemPrompt.trim(),
                            },
                        ],
                    },
                }),
            },
        };

        createAgentMutation.mutate(payload, {
            onSuccess: (data) => {
                setForm(initialFormData);
                setErrors({});
                onOpenChange(false);
                if (onAgentCreated && data.id) {
                    onAgentCreated(data.id);
                }
            },
            onError: (error: Error) => {
                setCreateError(error.message);
            },
        });
    };

    const handleCancel = () => {
        setForm(initialFormData);
        setErrors({});
        setCreateError(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/40">
                    <DialogTitle className="text-base">Create Agent</DialogTitle>
                    <DialogDescription className="text-sm">
                        Configure your new agent. Advanced options can be set after creation.
                    </DialogDescription>
                </DialogHeader>

                {/* Error */}
                {createError && (
                    <div className="mx-5 mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <p className="text-sm text-destructive">{createError}</p>
                    </div>
                )}

                {/* Form */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Identity */}
                    <Section title="Identity">
                        <Field label="Name" required error={errors.name}>
                            <Input
                                value={form.name}
                                onChange={(e) => updateField('name', e.target.value)}
                                placeholder="My Agent"
                                aria-invalid={!!errors.name}
                            />
                        </Field>
                        <Field
                            label="ID"
                            required
                            error={errors.id}
                            hint={!form.idManuallyEdited ? 'Auto-generated from name' : undefined}
                        >
                            <Input
                                value={form.id}
                                onChange={(e) => updateField('id', e.target.value)}
                                placeholder="my-agent"
                                aria-invalid={!!errors.id}
                                className="font-mono text-sm"
                            />
                        </Field>
                        <Field label="Description" required error={errors.description}>
                            <Input
                                value={form.description}
                                onChange={(e) => updateField('description', e.target.value)}
                                placeholder="A helpful assistant for..."
                                aria-invalid={!!errors.description}
                            />
                        </Field>
                    </Section>

                    {/* Model */}
                    <Section title="Language Model">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Provider" required error={errors.provider}>
                                <Select
                                    value={form.provider}
                                    onValueChange={(value) => updateField('provider', value)}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select provider..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LLM_PROVIDERS.map((p) => (
                                            <SelectItem key={p} value={p}>
                                                {p.charAt(0).toUpperCase() +
                                                    p.slice(1).replace(/-/g, ' ')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Model" required error={errors.model}>
                                <Input
                                    value={form.model}
                                    onChange={(e) => updateField('model', e.target.value)}
                                    placeholder="claude-sonnet-4-5-20250929"
                                    aria-invalid={!!errors.model}
                                />
                            </Field>
                        </div>
                        <Field label="API Key" hint="Leave empty to use environment variable">
                            <div className="relative">
                                <Input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={form.apiKey}
                                    onChange={(e) => updateField('apiKey', e.target.value)}
                                    placeholder="$ANTHROPIC_API_KEY"
                                    className="pr-9"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/50 transition-colors"
                                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                                >
                                    {showApiKey ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </button>
                            </div>
                        </Field>
                    </Section>

                    {/* System Prompt */}
                    <Section title="System Prompt" optional>
                        <Field>
                            <Textarea
                                value={form.systemPrompt}
                                onChange={(e) => updateField('systemPrompt', e.target.value)}
                                placeholder="You are a helpful assistant..."
                                rows={4}
                                className="font-mono text-sm resize-y"
                            />
                        </Field>
                        <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
                            <Info className="h-3 w-3" />
                            You can add MCP servers and other options after creation
                        </p>
                    </Section>
                </div>

                {/* Footer */}
                <DialogFooter className="px-5 py-4 border-t border-border/40 bg-muted/20">
                    <Button variant="outline" onClick={handleCancel} disabled={isCreating}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={isCreating}>
                        {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function Section({
    title,
    optional,
    children,
}: {
    title: string;
    optional?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="mb-2.5 flex items-baseline gap-2">
                <h3 className="text-sm font-medium text-foreground">{title}</h3>
                {optional && (
                    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                        Optional
                    </span>
                )}
            </div>
            <div className="space-y-3">{children}</div>
        </div>
    );
}

function Field({
    label,
    required,
    hint,
    error,
    children,
}: {
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            {label && (
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    {label}
                    {required && <span className="text-destructive ml-0.5">*</span>}
                </label>
            )}
            {children}
            {hint && !error && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
            {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
        </div>
    );
}
