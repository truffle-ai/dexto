/**
 * CustomizePanel - Parent coordinator for agent configuration editing
 *
 * Responsibilities:
 * - Load/save configuration via API
 * - Mode switching (Form ↔ YAML)
 * - YAML ↔ Config object conversion
 * - Unsaved changes detection
 * - Validation orchestration
 *
 * The actual editing is delegated to:
 * - YAMLEditorView - for YAML mode
 * - FormEditorView - for Form mode
 */
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { X, Save, RefreshCw, FileCode, FormInput, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import YAMLEditorView from './YAMLEditorView';
import FormEditorView from './FormEditorView';
import type { editor } from 'monaco-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import yaml from 'js-yaml';
import type { AgentConfig } from '@dexto/core';

interface CustomizePanelProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'overlay' | 'inline';
}

const API_BASE_URL = '/api';

interface ValidationError {
  line?: number;
  column?: number;
  path?: string;
  message: string;
  code: string;
}

interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

interface AgentConfigResponse {
  yaml: string;
  path: string;
  relativePath: string;
  lastModified: string;
  warnings: string[];
}

interface ValidationResponse {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface SaveConfigResponse {
  ok: boolean;
  path: string;
  reloaded: boolean;
  restarted: boolean;
  changesApplied: string[];
  message: string;
}

type EditorMode = 'form' | 'yaml';

export default function CustomizePanel({ isOpen, onClose, variant = 'overlay' }: CustomizePanelProps) {
  // Content state
  const [yamlContent, setYamlContent] = useState<string>('');
  const [originalYamlContent, setOriginalYamlContent] = useState<string>('');
  const [parsedConfig, setParsedConfig] = useState<AgentConfig | null>(null);
  const [originalParsedConfig, setOriginalParsedConfig] = useState<AgentConfig | null>(null);
  const [relativePath, setRelativePath] = useState<string>('');

  // Editor mode
  const [editorMode, setEditorMode] = useState<EditorMode>('yaml');
  const [parseError, setParseError] = useState<string | null>(null);

  // Loading/saving state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>('');

  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);

  // Unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Debounce timer for validation
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestValidationRequestRef = useRef(0);

  // Load agent configuration from API
  const loadAgentConfig = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/agent/config`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to load configuration' }));
        throw new Error(errorData.message || errorData.error || `Load failed: ${response.statusText}`);
      }
      const data: AgentConfigResponse = await response.json();
      setYamlContent(data.yaml);
      setOriginalYamlContent(data.yaml);
      setRelativePath(data.relativePath);
      setHasUnsavedChanges(false);

      // Parse for form mode
      const { config } = parseYamlToConfig(data.yaml);
      if (config) {
        setParsedConfig(config);
        setOriginalParsedConfig(config);
      }

      // Initial validation
      await validateYaml(data.yaml);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      console.error(`Error loading agent config: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Validate YAML content via API
  const validateYaml = async (yaml: string) => {
    const requestId = latestValidationRequestRef.current + 1;
    latestValidationRequestRef.current = requestId;
    setIsValidating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/agent/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      });

      const data: ValidationResponse = await response.json();
      if (latestValidationRequestRef.current === requestId) {
        setIsValid(data.valid);
        setErrors(data.errors || []);
        setWarnings(data.warnings || []);
      }
    } catch (err: any) {
      console.error(`Validation error: ${err instanceof Error ? err.message : String(err)}`);
      if (latestValidationRequestRef.current === requestId) {
        setIsValid(false);
        setErrors([{ message: 'Failed to validate configuration', code: 'VALIDATION_ERROR' }]);
      }
    } finally {
      if (latestValidationRequestRef.current === requestId) {
        setIsValidating(false);
      }
    }
  };

  // Parse YAML to config object
  const parseYamlToConfig = (yamlString: string): { config: AgentConfig | null; error: string | null } => {
    try {
      const config = yaml.load(yamlString) as AgentConfig;
      return { config, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to parse YAML';
      return { config: null, error: message };
    }
  };

  // Serialize config back to YAML
  const serializeConfigToYaml = (config: AgentConfig): string => {
    return yaml.dump(config, { indent: 2, lineWidth: -1 });
  };

  // Deep comparison helper for configs
  const configsAreEqual = (a: AgentConfig | null, b: AgentConfig | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  };

  // Handle YAML editor changes
  const handleYamlChange = (value: string) => {
    setYamlContent(value);
    setHasUnsavedChanges(value !== originalYamlContent);
    setSaveError(null);
    setSaveSuccess(false);

    // Update parsed config for potential form mode switch
    const { config } = parseYamlToConfig(value);
    if (config) {
      setParsedConfig(config);
    }

    // Debounce validation
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }
    validationTimerRef.current = setTimeout(() => {
      validateYaml(value);
    }, 500);
  };

  // Handle form editor changes
  const handleFormChange = (newConfig: AgentConfig) => {
    setParsedConfig(newConfig);
    const newYaml = serializeConfigToYaml(newConfig);
    setYamlContent(newYaml);
    // Use semantic comparison for form mode to handle YAML formatting differences
    setHasUnsavedChanges(!configsAreEqual(newConfig, originalParsedConfig));
    setSaveError(null);
    setSaveSuccess(false);

    // Debounce validation
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }
    validationTimerRef.current = setTimeout(() => {
      validateYaml(newYaml);
    }, 500);
  };

  // Handle mode switch
  const handleModeSwitch = (newMode: EditorMode) => {
    if (newMode === editorMode) return;

    if (newMode === 'form') {
      // Switching to form mode - ensure config is parsed
      const { config, error } = parseYamlToConfig(yamlContent);
      if (error) {
        setParseError(error);
        // Don't switch modes if parsing fails
        return;
      }
      setParsedConfig(config);
      setParseError(null);
    }

    setEditorMode(newMode);
  };

  // Save configuration
  const handleSave = async () => {
    if (!isValid || errors.length > 0) {
      setSaveError('Cannot save: configuration has errors');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setSaveMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/agent/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: yamlContent }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save configuration' }));
        throw new Error(errorData.message || errorData.error || `Save failed: ${response.statusText}`);
      }

      const data: SaveConfigResponse = await response.json();

      setOriginalYamlContent(yamlContent);
      setHasUnsavedChanges(false);
      setSaveSuccess(true);

      if (data.restarted) {
        setSaveMessage(
          `Configuration applied successfully — ${data.changesApplied.join(', ')} updated`
        );
      } else {
        setSaveMessage('Configuration saved successfully (no changes detected)');
      }

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSaveSuccess(false);
        setSaveMessage('');
      }, 5000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      console.error(`Error saving agent config: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Reload configuration
  const handleReload = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      loadAgentConfig();
    }
  };

  // Handle close with unsaved changes check
  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  };

  // Confirm discard changes
  const handleDiscardChanges = () => {
    setShowUnsavedDialog(false);
    setYamlContent(originalYamlContent);
    setHasUnsavedChanges(false);
    loadAgentConfig();
  };

  // Load config when panel opens
  useEffect(() => {
    if (isOpen) {
      loadAgentConfig();
    }
  }, [isOpen, loadAgentConfig]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S / Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!isSaving && isValid) {
          handleSave();
        }
      }
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, isValid, hasUnsavedChanges]);

  if (!isOpen) return null;

  // Calculate save button disabled reason
  const getSaveDisabledReason = (): string | null => {
    if (isSaving) return null; // Not really disabled, just in progress
    if (!hasUnsavedChanges) return 'No changes to save';
    if (errors.length > 0) {
      // Find the most relevant error
      const firstError = errors[0];
      if (firstError.path) {
        return `Configuration error in ${firstError.path}: ${firstError.message}`;
      }
      return `Configuration error: ${firstError.message}`;
    }
    if (!isValid) return 'Configuration has validation errors';
    return null;
  };

  const saveDisabledReason = getSaveDisabledReason();
  const isSaveDisabled = !hasUnsavedChanges || isSaving || !isValid || errors.length > 0;

  const panelContent = (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Customize Agent</h2>
              <a
                href="https://docs.dexto.ai/docs/guides/configuring-dexto/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                title="View configuration documentation"
              >
                View docs
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {relativePath && (
              <p className="text-xs text-muted-foreground">{relativePath}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode Toggle */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={editorMode === 'form' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleModeSwitch('form')}
                  className="h-7 px-2"
                >
                  <FormInput className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Form Editor</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={editorMode === 'yaml' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleModeSwitch('yaml')}
                  className="h-7 px-2"
                >
                  <FileCode className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>YAML Editor</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReload}
                disabled={isLoading}
              >
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload configuration</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loadError ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-center max-w-md">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Failed to load configuration</h3>
              <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
              <Button onClick={loadAgentConfig} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Loading configuration...</p>
            </div>
          </div>
        ) : parseError && editorMode === 'form' ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-center max-w-md">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Cannot parse YAML</h3>
              <p className="text-sm text-muted-foreground mb-4">{parseError}</p>
              <Button onClick={() => setEditorMode('yaml')} variant="outline">
                Switch to YAML Editor
              </Button>
            </div>
          </div>
        ) : editorMode === 'yaml' ? (
          <YAMLEditorView
            value={yamlContent}
            onChange={handleYamlChange}
            isValidating={isValidating}
            isValid={isValid}
            errors={errors}
            warnings={warnings}
            hasUnsavedChanges={hasUnsavedChanges}
          />
        ) : parsedConfig ? (
          <FormEditorView
            config={parsedConfig}
            onChange={handleFormChange}
            errors={{}}
          />
        ) : null}
      </div>

      {/* Footer */}
      {!loadError && !isLoading && (
        <div className="flex flex-col border-t border-border">
          {/* Save status messages */}
          {(saveSuccess || saveError) && (
            <div className="px-4 py-3 bg-muted/50 border-b border-border">
              {saveSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                  <CheckCircle className="h-4 w-4" />
                  <span>{saveMessage}</span>
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between px-4 py-3">
            <div />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
              >
                Close
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleSave}
                      disabled={isSaveDisabled}
                    >
                      {isSaving ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent mr-2" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save
                        </>
                      )}
                    </Button>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {saveDisabledReason || 'Save configuration (⌘S)'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes dialog */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Do you want to discard them?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUnsavedDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscardChanges}
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (variant === 'inline') {
    return panelContent;
  }

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 w-full sm:w-[600px] md:w-[700px] lg:w-[800px] border-l border-border bg-background shadow-2xl transform transition-transform duration-300',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {panelContent}
    </div>
  );
}
