'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { X, Save, RefreshCw, FileCode, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentConfigEditor from './AgentConfigEditor';
import ConfigValidationStatus from './ConfigValidationStatus';
import type { editor } from 'monaco-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

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

export default function CustomizePanel({ isOpen, onClose, variant = 'overlay' }: CustomizePanelProps) {
  const [yamlContent, setYamlContent] = useState<string>('');
  const [originalYamlContent, setOriginalYamlContent] = useState<string>('');
  const [agentPath, setAgentPath] = useState<string>('');
  const [relativePath, setRelativePath] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [monacoErrors, setMonacoErrors] = useState<editor.IMarker[]>([]);

  // Unsaved changes tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Debounce timer for validation
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load agent configuration
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
      setAgentPath(data.path);
      setRelativePath(data.relativePath);
      setHasUnsavedChanges(false);

      // Initial validation
      await validateYaml(data.yaml);
    } catch (err: any) {
      setLoadError(err.message);
      console.error('Error loading agent config:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Validate YAML content
  const validateYaml = async (yaml: string) => {
    setIsValidating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/agent/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      });

      const data: ValidationResponse = await response.json();
      setIsValid(data.valid);
      setErrors(data.errors || []);
      setWarnings(data.warnings || []);
    } catch (err: any) {
      console.error('Validation error:', err);
      setIsValid(false);
      setErrors([{ message: 'Failed to validate configuration', code: 'VALIDATION_ERROR' }]);
    } finally {
      setIsValidating(false);
    }
  };

  // Handle editor changes with debounced validation
  const handleEditorChange = (value: string) => {
    setYamlContent(value);
    setHasUnsavedChanges(value !== originalYamlContent);
    setSaveError(null);
    setSaveSuccess(false);

    // Debounce validation
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }
    validationTimerRef.current = setTimeout(() => {
      validateYaml(value);
    }, 500);
  };

  // Handle Monaco editor validation
  const handleMonacoValidate = (markers: editor.IMarker[]) => {
    setMonacoErrors(markers);
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

      setOriginalYamlContent(yamlContent);
      setHasUnsavedChanges(false);
      setSaveSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.message);
      console.error('Error saving agent config:', err);
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

  const panelContent = (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <FileCode className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Customize Agent</h2>
            {relativePath && (
              <p className="text-xs text-muted-foreground">{relativePath}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReload}
            disabled={isLoading}
            title="Reload configuration"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
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
        ) : (
          <>
            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              <AgentConfigEditor
                value={yamlContent}
                onChange={handleEditorChange}
                onValidate={handleMonacoValidate}
                height="100%"
              />
            </div>

            {/* Validation Status */}
            <ConfigValidationStatus
              isValidating={isValidating}
              isValid={isValid}
              errors={errors}
              warnings={warnings}
              hasUnsavedChanges={hasUnsavedChanges}
            />
          </>
        )}
      </div>

      {/* Footer */}
      {!loadError && !isLoading && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle className="h-4 w-4" />
                <span>Saved successfully</span>
              </div>
            )}
            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>{saveError}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
            >
              Close
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving || !isValid || errors.length > 0}
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
