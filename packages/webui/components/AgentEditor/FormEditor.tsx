import React, { useState, useEffect } from 'react';
import { LLMConfigSection } from './form-sections/LLMConfigSection';
import { SystemPromptSection } from './form-sections/SystemPromptSection';
import { McpServersSection } from './form-sections/McpServersSection';
import { StorageSection } from './form-sections/StorageSection';
import { ToolConfirmationSection } from './form-sections/ToolConfirmationSection';
import { Collapsible } from '../ui/collapsible';
import { Input } from '../ui/input';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import { AlertCircle } from 'lucide-react';
import type { AgentConfig } from '@dexto/agent-config';
import type { ContributorConfig } from '@dexto/core';

interface FormEditorProps {
    config: AgentConfig;
    onChange: (config: AgentConfig) => void;
    errors?: Record<string, string>;
}

type SectionKey = 'basic' | 'llm' | 'systemPrompt' | 'mcpServers' | 'storage' | 'toolConfirmation';

export default function FormEditor({ config, onChange, errors = {} }: FormEditorProps) {
    // Convert systemPrompt to contributors format for the UI
    const systemPromptValue = (() => {
        if (!config.systemPrompt) {
            return { contributors: [] };
        }
        if (typeof config.systemPrompt === 'string') {
            // Convert string to contributors array
            return {
                contributors: [
                    {
                        id: 'primary',
                        type: 'static' as const,
                        priority: 0,
                        enabled: true,
                        content: config.systemPrompt,
                    },
                ],
            };
        }
        // Already in object format with contributors - ensure contributors array exists
        return {
            contributors: config.systemPrompt.contributors || [],
        };
    })();

    // Track which sections are open
    const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
        basic: true,
        llm: false,
        systemPrompt: false,
        mcpServers: false,
        storage: false,
        toolConfirmation: false,
    });

    // Map errors to sections
    const sectionErrors = mapErrorsToSections(errors);

    // Auto-expand sections with errors
    useEffect(() => {
        // Compute derived value inside effect to avoid stale closures
        const derivedSectionErrors = mapErrorsToSections(errors);
        const sectionsWithErrors = Object.keys(derivedSectionErrors).filter(
            (section) => derivedSectionErrors[section as SectionKey].length > 0
        ) as SectionKey[];

        if (sectionsWithErrors.length > 0) {
            setOpenSections((prev) => {
                const updated = { ...prev };
                sectionsWithErrors.forEach((section) => {
                    updated[section] = true;
                });
                return updated;
            });
        }
    }, [errors]);

    const toggleSection = (section: SectionKey) => {
        setOpenSections((prev) => ({
            ...prev,
            [section]: !prev[section],
        }));
    };

    // Handle section updates
    const updateLLM = (llm: AgentConfig['llm']) => {
        onChange({ ...config, llm });
    };

    const updateSystemPrompt = (value: { contributors: ContributorConfig[] }) => {
        onChange({ ...config, systemPrompt: value });
    };

    const updateMcpServers = (mcpServers: AgentConfig['mcpServers']) => {
        onChange({ ...config, mcpServers });
    };

    const updateStorage = (storage: AgentConfig['storage']) => {
        onChange({ ...config, storage });
    };

    const updateToolConfirmation = (toolConfirmation: AgentConfig['toolConfirmation']) => {
        onChange({ ...config, toolConfirmation });
    };

    // Check if config has advanced features that aren't supported in form mode
    const hasAdvancedFeatures = checkForAdvancedFeatures(config);

    return (
        <div className="flex flex-col h-full overflow-auto">
            {/* Advanced Features Warning */}
            {hasAdvancedFeatures && (
                <div className="mx-4 mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium text-yellow-600 dark:text-yellow-500">
                                Advanced Configuration Detected
                            </p>
                            <p className="text-xs text-yellow-600/80 dark:text-yellow-500/80 mt-1">
                                Some advanced features may not be editable in form mode. Switch to
                                YAML editor for full control.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Form Sections */}
            <div className="flex-1 p-4 space-y-4">
                {/* Basic Info Section */}
                <Collapsible
                    title="Basic Information"
                    open={openSections.basic}
                    onOpenChange={() => toggleSection('basic')}
                    errorCount={sectionErrors.basic.length}
                    sectionErrors={sectionErrors.basic}
                >
                    <div className="space-y-2">
                        <LabelWithTooltip
                            htmlFor="agent-greeting"
                            tooltip="The initial message shown to users when they start a conversation"
                        >
                            Greeting Message
                        </LabelWithTooltip>
                        <Input
                            id="agent-greeting"
                            value={config.greeting || ''}
                            onChange={(e) => onChange({ ...config, greeting: e.target.value })}
                            placeholder="Hello! How can I help you today?"
                            aria-invalid={!!errors.greeting}
                        />
                        {errors.greeting && (
                            <p className="text-xs text-destructive mt-1">{errors.greeting}</p>
                        )}
                    </div>
                </Collapsible>

                {/* LLM Configuration */}
                <LLMConfigSection
                    value={config.llm}
                    onChange={updateLLM}
                    errors={errors}
                    open={openSections.llm}
                    onOpenChange={() => toggleSection('llm')}
                    errorCount={sectionErrors.llm.length}
                    sectionErrors={sectionErrors.llm}
                />

                {/* System Prompt */}
                <SystemPromptSection
                    value={systemPromptValue}
                    onChange={updateSystemPrompt}
                    errors={errors}
                    open={openSections.systemPrompt}
                    onOpenChange={() => toggleSection('systemPrompt')}
                    errorCount={sectionErrors.systemPrompt.length}
                    sectionErrors={sectionErrors.systemPrompt}
                />

                {/* MCP Servers */}
                <McpServersSection
                    value={config.mcpServers || {}}
                    onChange={updateMcpServers}
                    errors={errors}
                    open={openSections.mcpServers}
                    onOpenChange={() => toggleSection('mcpServers')}
                    errorCount={sectionErrors.mcpServers.length}
                    sectionErrors={sectionErrors.mcpServers}
                />

                {/* Storage Configuration */}
                <StorageSection
                    value={
                        config.storage || {
                            cache: { type: 'in-memory' },
                            database: { type: 'in-memory' },
                            blob: { type: 'local', storePath: '/tmp/dexto-blobs' },
                        }
                    }
                    onChange={updateStorage}
                    errors={errors}
                    open={openSections.storage}
                    onOpenChange={() => toggleSection('storage')}
                    errorCount={sectionErrors.storage.length}
                    sectionErrors={sectionErrors.storage}
                />

                {/* Tool Confirmation */}
                <ToolConfirmationSection
                    value={config.toolConfirmation || {}}
                    onChange={updateToolConfirmation}
                    errors={errors}
                    open={openSections.toolConfirmation}
                    onOpenChange={() => toggleSection('toolConfirmation')}
                    errorCount={sectionErrors.toolConfirmation.length}
                    sectionErrors={sectionErrors.toolConfirmation}
                />
            </div>
        </div>
    );
}

/**
 * Check if config has advanced features that aren't well-supported in form mode
 */
function checkForAdvancedFeatures(config: AgentConfig): boolean {
    // System prompt is now fully supported in form mode via contributors

    // Check for session config customization
    if (config.sessions && Object.keys(config.sessions).length > 0) {
        return true;
    }

    // Check for tools customization
    if (config.tools && config.tools.length > 0) {
        return true;
    }

    return false;
}

/**
 * Map error paths to form sections
 */
function mapErrorsToSections(errors: Record<string, string>): Record<SectionKey, string[]> {
    const sectionErrors: Record<SectionKey, string[]> = {
        basic: [],
        llm: [],
        systemPrompt: [],
        mcpServers: [],
        storage: [],
        toolConfirmation: [],
    };

    Object.entries(errors).forEach(([path, message]) => {
        if (path === 'greeting') {
            sectionErrors.basic.push(message);
        } else if (path.startsWith('llm.')) {
            sectionErrors.llm.push(message);
        } else if (path.startsWith('systemPrompt')) {
            sectionErrors.systemPrompt.push(message);
        } else if (path.startsWith('mcpServers')) {
            sectionErrors.mcpServers.push(message);
        } else if (path.startsWith('storage.')) {
            sectionErrors.storage.push(message);
        } else if (path.startsWith('toolConfirmation.')) {
            sectionErrors.toolConfirmation.push(message);
        }
    });

    return sectionErrors;
}
