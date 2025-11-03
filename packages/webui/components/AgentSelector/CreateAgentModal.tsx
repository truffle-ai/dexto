'use client';

import React, { useState } from 'react';
import { apiFetch } from '@/lib/api-client.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import { Collapsible } from '../ui/collapsible';
import { AlertCircle, Loader2 } from 'lucide-react';
import { LLMConfigSection } from '../AgentEditor/form-sections/LLMConfigSection';
import { SystemPromptSection } from '../AgentEditor/form-sections/SystemPromptSection';
import type { AgentConfig } from '@dexto/core';

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgentCreated?: (agentName: string) => void;
}

interface RegistryMetadata {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string;
}

const initialMetadata: RegistryMetadata = {
  id: '',
  name: '',
  description: '',
  author: '',
  tags: '',
};

const initialAgentConfig: Partial<AgentConfig> = {
  llm: {
    provider: 'openai',
    model: 'gpt-5',
    apiKey: '',
  },
  systemPrompt: {
    contributors: [
      {
        id: 'primary',
        type: 'static',
        priority: 0,
        enabled: true,
        content: '',
      },
    ],
  },
};

export default function CreateAgentModal({ open, onOpenChange, onAgentCreated }: CreateAgentModalProps) {
  const [metadata, setMetadata] = useState<RegistryMetadata>(initialMetadata);
  const [config, setConfig] = useState<Partial<AgentConfig>>(initialAgentConfig);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Track which sections are open
  const [openSections, setOpenSections] = useState({
    basic: true,
    llm: true,
    systemPrompt: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateMetadataField = (field: keyof RegistryMetadata, value: string) => {
    setMetadata(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Basic Info validation
    if (!metadata.id.trim()) {
      newErrors.id = 'Agent ID is required';
    } else if (!/^[a-z0-9-]+$/.test(metadata.id)) {
      newErrors.id = 'Agent ID must contain only lowercase letters, numbers, and hyphens';
    }

    if (!metadata.name.trim()) {
      newErrors.name = 'Agent name is required';
    }

    if (!metadata.description.trim()) {
      newErrors.description = 'Description is required';
    }

    // LLM Config validation
    if (!config.llm?.provider) {
      newErrors['llm.provider'] = 'Provider is required';
    }

    if (!config.llm?.model?.trim()) {
      newErrors['llm.model'] = 'Model is required';
    }

    // System Prompt validation - check if at least one static contributor has content
    // Note: This modal only supports static contributors; dynamic/file contributors are not handled
    const systemPrompt = config.systemPrompt;
    if (systemPrompt && typeof systemPrompt === 'object' && 'contributors' in systemPrompt) {
      const contributors = systemPrompt.contributors;
      if (Array.isArray(contributors)) {
        const hasContent = contributors.some((c: Record<string, unknown>) => {
          if (c.type === 'static' && typeof c.content === 'string' && c.content.trim()) return true;
          return false;
        });
        if (!hasContent) {
          newErrors.systemPrompt = 'At least one static contributor with content is required';
        }
      }
    } else if (typeof systemPrompt === 'string' && !systemPrompt.trim()) {
      newErrors.systemPrompt = 'System prompt is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      // Extract system prompt content from contributors
      let systemPromptContent = '';
      if (config.systemPrompt && typeof config.systemPrompt === 'object' && 'contributors' in config.systemPrompt) {
        const contributors = config.systemPrompt.contributors;
        if (Array.isArray(contributors)) {
          // Find the first static contributor with content
          const staticContributor = contributors.find((c: Record<string, unknown>) => c.type === 'static' && c.content);
          if (staticContributor && 'content' in staticContributor && typeof staticContributor.content === 'string') {
            systemPromptContent = staticContributor.content.trim();
          }
        }
      } else if (typeof config.systemPrompt === 'string') {
        systemPromptContent = config.systemPrompt.trim();
      }
      
      // Ensure we have a valid system prompt
      if (!systemPromptContent) {
        systemPromptContent = 'You are a helpful AI assistant.';
      }

      const data = await apiFetch<{ id: string }>('/api/agents/custom/create', {
        method: 'POST',
        body: JSON.stringify({
          // Registry metadata
          id: metadata.id.trim(),
          name: metadata.name.trim(),
          description: metadata.description.trim(),
          author: metadata.author.trim() || undefined,
          tags: metadata.tags.split(',').map(t => t.trim()).filter(Boolean),

          // Agent config
          llm: {
            provider: config.llm?.provider,
            model: config.llm?.model?.trim(),
            ...(config.llm?.apiKey?.trim() && { apiKey: config.llm.apiKey.trim() }),
          },
          systemPrompt: systemPromptContent,
        }),
      });

      // Reset form
      setMetadata(initialMetadata);
      setConfig(initialAgentConfig);
      setErrors({});

      // Close modal
      onOpenChange(false);

      // Notify parent with agent ID
      if (onAgentCreated && data.id) {
        onAgentCreated(data.id);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setMetadata(initialMetadata);
    setConfig(initialAgentConfig);
    setErrors({});
    setCreateError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
          <DialogDescription>
            Create a custom agent with your own configuration. 
            <br />
            <br />
            You can add more advanced configuration after creating the agent using the Edit Agent button.
          </DialogDescription>
        </DialogHeader>

        {/* Error Alert */}
        {createError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="text-sm text-destructive">{createError}</div>
          </div>
        )}

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Basic Information */}
          <Collapsible
            title="Basic Information"
            open={openSections.basic}
            onOpenChange={() => toggleSection('basic')}
          >
            <div className="space-y-4">
              <div>
                <LabelWithTooltip htmlFor="agent-id" tooltip="Unique identifier for this agent (lowercase, no spaces, hyphens only)">
                  Agent ID *
                </LabelWithTooltip>
                <Input
                  id="agent-id"
                  value={metadata.id}
                  onChange={(e) => updateMetadataField('id', e.target.value)}
                  placeholder="my-custom-agent"
                  aria-invalid={!!errors.id}
                />
                {errors.id && (
                  <p className="text-xs text-destructive mt-1">{errors.id}</p>
                )}
              </div>

              <div>
                <LabelWithTooltip htmlFor="agent-name" tooltip="Display name for this agent (shown in UI)">
                  Agent Name *
                </LabelWithTooltip>
                <Input
                  id="agent-name"
                  value={metadata.name}
                  onChange={(e) => updateMetadataField('name', e.target.value)}
                  placeholder="My Custom Agent"
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="text-xs text-destructive mt-1">{errors.name}</p>
                )}
              </div>

              <div>
                <LabelWithTooltip htmlFor="agent-description" tooltip="Brief description of what this agent does">
                  Description *
                </LabelWithTooltip>
                <Input
                  id="agent-description"
                  value={metadata.description}
                  onChange={(e) => updateMetadataField('description', e.target.value)}
                  placeholder="A custom agent for specific tasks"
                  aria-invalid={!!errors.description}
                />
                {errors.description && (
                  <p className="text-xs text-destructive mt-1">{errors.description}</p>
                )}
              </div>

              <div>
                <LabelWithTooltip htmlFor="agent-author" tooltip="Your name or organization">
                  Author
                </LabelWithTooltip>
                <Input
                  id="agent-author"
                  value={metadata.author}
                  onChange={(e) => updateMetadataField('author', e.target.value)}
                  placeholder="Your Name"
                />
              </div>

              <div>
                <LabelWithTooltip htmlFor="agent-tags" tooltip="Comma-separated tags for categorization">
                  Tags
                </LabelWithTooltip>
                <Input
                  id="agent-tags"
                  value={metadata.tags}
                  onChange={(e) => updateMetadataField('tags', e.target.value)}
                  placeholder="coding, custom, specialized"
                />
              </div>
            </div>
          </Collapsible>

          {/* LLM Configuration - Reuse existing section component */}
          <LLMConfigSection
            value={config.llm || { provider: 'openai', model: 'gpt-5', apiKey: '' }}
            onChange={(llm) => setConfig(prev => ({ ...prev, llm }))}
            errors={errors}
            open={openSections.llm}
            onOpenChange={() => toggleSection('llm')}
            errorCount={0}
            sectionErrors={[]}
          />

          {/* System Prompt - Reuse existing section component */}
          <SystemPromptSection
            value={typeof config.systemPrompt === 'object' && 'contributors' in config.systemPrompt
              ? { contributors: config.systemPrompt.contributors || [] }
              : { contributors: [] }}
            onChange={(systemPrompt) => setConfig(prev => ({ ...prev, systemPrompt }))}
            errors={errors}
            open={openSections.systemPrompt}
            onOpenChange={() => toggleSection('systemPrompt')}
            errorCount={0}
            sectionErrors={[]}
          />
        </div>

        {/* Footer */}
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
