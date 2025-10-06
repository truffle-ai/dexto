'use client';

import React from 'react';
import { LLMConfigSection } from './form-sections/LLMConfigSection';
import { SystemPromptSection } from './form-sections/SystemPromptSection';
import { McpServersSection } from './form-sections/McpServersSection';
import { StorageSection } from './form-sections/StorageSection';
import { ToolConfirmationSection } from './form-sections/ToolConfirmationSection';
import { Collapsible } from './ui/collapsible';
import { Input } from './ui/input';
import { LabelWithTooltip } from './ui/label-with-tooltip';
import { AlertCircle } from 'lucide-react';
import type { AgentConfig } from '@dexto/core';

interface FormEditorProps {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  errors?: Record<string, string>;
}

export default function FormEditor({ config, onChange, errors = {} }: FormEditorProps) {
  // Extract system prompt string (form editor only supports string format)
  const systemPromptValue = typeof config.systemPrompt === 'string' ? config.systemPrompt : '';

  // Handle section updates
  const updateLLM = (llm: AgentConfig['llm']) => {
    onChange({ ...config, llm });
  };

  const updateSystemPrompt = (value: string) => {
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

  const updateBasicInfo = (field: 'name' | 'description' | 'greeting', value: string) => {
    if (field === 'greeting') {
      onChange({ ...config, greeting: value });
    } else {
      onChange({
        ...config,
        agentCard: {
          ...config.agentCard,
          [field]: value,
        } as AgentConfig['agentCard'],
      });
    }
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
                Some advanced features may not be editable in form mode. Switch to YAML editor for full
                control.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Form Sections */}
      <div className="flex-1 p-4 space-y-4">
        {/* Basic Info Section */}
        <Collapsible title="Basic Information" defaultOpen={true}>
          <div className="space-y-4">
            <div>
              <LabelWithTooltip htmlFor="agent-name" tooltip="The unique identifier for this agent">
                Agent Name
              </LabelWithTooltip>
              <Input
                id="agent-name"
                value={config.agentCard?.name || ''}
                onChange={(e) => updateBasicInfo('name', e.target.value)}
                placeholder="my-custom-agent"
              />
            </div>

            <div>
              <LabelWithTooltip htmlFor="agent-description" tooltip="A brief description of what this agent does">
                Description
              </LabelWithTooltip>
              <Input
                id="agent-description"
                value={config.agentCard?.description || ''}
                onChange={(e) => updateBasicInfo('description', e.target.value)}
                placeholder="A brief description of what this agent does"
              />
            </div>

            <div>
              <LabelWithTooltip htmlFor="agent-greeting" tooltip="The initial message shown to users when they start a conversation">
                Greeting Message
              </LabelWithTooltip>
              <Input
                id="agent-greeting"
                value={config.greeting || ''}
                onChange={(e) => updateBasicInfo('greeting', e.target.value)}
                placeholder="Hello! How can I help you today?"
              />
            </div>
          </div>
        </Collapsible>

        {/* LLM Configuration */}
        <LLMConfigSection value={config.llm} onChange={updateLLM} errors={errors} />

        {/* System Prompt */}
        <SystemPromptSection value={systemPromptValue} onChange={updateSystemPrompt} errors={errors} />

        {/* MCP Servers */}
        <McpServersSection
          value={config.mcpServers || {}}
          onChange={updateMcpServers}
          errors={errors}
        />

        {/* Storage Configuration */}
        <StorageSection
          value={config.storage || { cache: { type: 'in-memory' }, database: { type: 'in-memory' } }}
          onChange={updateStorage}
          errors={errors}
        />

        {/* Tool Confirmation */}
        <ToolConfirmationSection
          value={config.toolConfirmation || {}}
          onChange={updateToolConfirmation}
          errors={errors}
        />
      </div>
    </div>
  );
}

/**
 * Check if config has advanced features that aren't well-supported in form mode
 */
function checkForAdvancedFeatures(config: AgentConfig): boolean {
  // Check for complex system prompt config (not just a string)
  if (typeof config.systemPrompt === 'object' && config.systemPrompt !== null) {
    const keys = Object.keys(config.systemPrompt);
    // If it has keys other than 'instructions', it's advanced
    if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'instructions')) {
      return true;
    }
  }

  // Check for session config customization
  if (config.sessions && Object.keys(config.sessions).length > 0) {
    return true;
  }

  // Check for internal tools customization
  if (config.internalTools) {
    return true;
  }

  return false;
}
