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
 *
 * TODO: Future optimization - derive form metadata from schemas
 * Currently form sections have manual field definitions. Consider deriving:
 * - Required/optional fields from schema
 * - Default values from schema defaults
 * - Enum options from schema enums
 * - Field types from schema types
 * This would eliminate hardcoded UI metadata and reduce maintenance.
 * See packages/core/src/utils/schema-metadata.ts for the core utilities that enable this (needs runtime fixes).
 * This TODO is linked with the corresponding TODO in schema-metadata.ts tracking the same goal.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import { Button } from '../ui/button';
import { X, Save, RefreshCw, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    useAgentConfig,
    useValidateAgent,
    useSaveAgentConfig,
    type ValidationError,
    type ValidationWarning,
} from '../hooks/useAgentConfig';
import YAMLEditorView from './YAMLEditorView';
import FormEditorView from './FormEditorView';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import * as yaml from 'yaml';
import type { AgentConfig } from '@dexto/core';

interface CustomizePanelProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: 'overlay' | 'inline';
}

type EditorMode = 'form' | 'yaml';

export default function CustomizePanel({
    isOpen,
    onClose,
    variant = 'overlay',
}: CustomizePanelProps) {
    // TanStack Query hooks
    const {
        data: configData,
        isLoading,
        error: loadError,
        refetch: refetchConfig,
    } = useAgentConfig(isOpen);
    const validateMutation = useValidateAgent();
    const saveMutation = useSaveAgentConfig();

    // Content state
    const [yamlContent, setYamlContent] = useState<string>('');
    const [originalYamlContent, setOriginalYamlContent] = useState<string>('');
    const [parsedConfig, setParsedConfig] = useState<AgentConfig | null>(null);
    const [originalParsedConfig, setOriginalParsedConfig] = useState<AgentConfig | null>(null);
    const [yamlDocument, setYamlDocument] = useState<yaml.Document | null>(null);
    const [relativePath, setRelativePath] = useState<string>('');

    // Editor mode
    const [editorMode, setEditorMode] = useState<EditorMode>('yaml');
    const [parseError, setParseError] = useState<string | null>(null);

    // Validation state
    const [isValid, setIsValid] = useState(true);
    const [errors, setErrors] = useState<ValidationError[]>([]);
    const [warnings, setWarnings] = useState<ValidationWarning[]>([]);

    // Unsaved changes
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

    // Save state (for success messages)
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string>('');

    // Debounced validation
    const [debouncedYamlContent] = useDebounce(yamlContent, 500);
    const latestValidationRequestRef = useRef(0);

    // Validate YAML content via API
    const validateYaml = useCallback(
        async (yaml: string) => {
            const requestId = latestValidationRequestRef.current + 1;
            latestValidationRequestRef.current = requestId;

            try {
                const data = await validateMutation.mutateAsync({ yaml });
                if (latestValidationRequestRef.current === requestId) {
                    setIsValid(data.valid);
                    setErrors(data.errors || []);
                    setWarnings(data.warnings || []);
                }
            } catch (err: any) {
                console.warn(
                    `Validation error: ${err instanceof Error ? err.message : String(err)}`
                );
                if (latestValidationRequestRef.current === requestId) {
                    setIsValid(false);
                    setErrors([
                        { message: 'Failed to validate configuration', code: 'VALIDATION_ERROR' },
                    ]);
                }
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [validateMutation.mutateAsync]
    );

    // Initialize state when config data loads
    useEffect(() => {
        if (configData && isOpen) {
            setYamlContent(configData.yaml);
            setOriginalYamlContent(configData.yaml);
            setRelativePath(configData.relativePath);
            setHasUnsavedChanges(false);

            // Parse for form mode
            const { config, document } = parseYamlToConfig(configData.yaml);
            if (config && document) {
                setParsedConfig(config);
                setOriginalParsedConfig(config);
                setYamlDocument(document);
            }

            // Initial validation
            validateYaml(configData.yaml);
        }
    }, [configData, isOpen, validateYaml]);

    // Parse YAML to config object and document
    const parseYamlToConfig = (
        yamlString: string
    ): { config: AgentConfig | null; document: yaml.Document | null; error: string | null } => {
        console.log('[parseYamlToConfig] Starting parse');
        try {
            const document = yaml.parseDocument(yamlString);
            console.log('[parseYamlToConfig] Document created:', document);

            // Check for parse errors
            if (document.errors && document.errors.length > 0) {
                console.debug('[parseYamlToConfig] Parse errors:', document.errors);
                const message = document.errors.map((e) => e.message).join('; ');
                return { config: null, document: null, error: message };
            }

            const config = document.toJS() as AgentConfig;
            console.log('[parseYamlToConfig] Config parsed successfully:', config);
            return { config, document, error: null };
        } catch (err: unknown) {
            console.debug('[parseYamlToConfig] Exception:', err);
            const message = err instanceof Error ? err.message : 'Failed to parse YAML';
            return { config: null, document: null, error: message };
        }
    };

    // Update YAML document from config object while preserving comments
    const updateYamlDocumentFromConfig = (
        document: yaml.Document,
        config: AgentConfig
    ): yaml.Document => {
        console.log('[updateYamlDocumentFromConfig] Starting update');
        console.log('[updateYamlDocumentFromConfig] Document:', document);
        console.log('[updateYamlDocumentFromConfig] Config:', config);

        const updateNode = (node: any, value: any): any => {
            // Handle null/undefined
            if (value === null || value === undefined) {
                return document.createNode(value);
            }

            // Handle arrays - create new sequence
            if (Array.isArray(value)) {
                return document.createNode(value);
            }

            // Handle objects - update map recursively
            if (typeof value === 'object' && !Array.isArray(value)) {
                if (!node || !node.items) {
                    // Create new map if node doesn't exist
                    return document.createNode(value);
                }

                // Update existing map
                const existingKeys = new Set<string>();

                // Update existing keys and track them
                for (const pair of node.items) {
                    const key = pair.key.value;
                    existingKeys.add(key);

                    if (key in value) {
                        // Update the value while preserving the pair (and its comments)
                        pair.value = updateNode(pair.value, value[key]);
                    }
                }

                // Add new keys
                for (const [key, val] of Object.entries(value)) {
                    if (!existingKeys.has(key)) {
                        node.items.push(document.createPair(key, val));
                    }
                }

                // Remove keys not in new config
                node.items = node.items.filter((pair: any) => {
                    const key = pair.key.value;
                    return key in value;
                });

                return node;
            }

            // Handle primitives - create new scalar
            return document.createNode(value);
        };

        try {
            // Update the root contents
            document.contents = updateNode(document.contents, config);
            console.log('[updateYamlDocumentFromConfig] Update successful');
            return document;
        } catch (err) {
            console.error('[updateYamlDocumentFromConfig] Update failed:', err);
            throw err;
        }
    };

    // Generic deep cleanup to remove null/undefined/empty values
    const cleanupConfig = (config: AgentConfig): AgentConfig => {
        const isEmptyValue = (value: unknown): boolean => {
            // null and undefined are empty
            if (value === null || value === undefined) return true;
            // Empty string is empty
            if (value === '') return true;
            // Empty arrays are empty
            if (Array.isArray(value) && value.length === 0) return true;
            // Empty objects are empty (but not Date, etc)
            if (
                typeof value === 'object' &&
                value !== null &&
                Object.prototype.toString.call(value) === '[object Object]' &&
                Object.keys(value).length === 0
            ) {
                return true;
            }
            // Everything else (including false, 0, etc) is not empty
            return false;
        };

        const deepCleanup = (obj: any): any => {
            if (Array.isArray(obj)) {
                // For arrays, recursively clean each element and filter out empty ones
                return obj.map(deepCleanup).filter((item) => !isEmptyValue(item));
            }

            if (typeof obj === 'object' && obj !== null) {
                const cleaned: any = {};
                for (const [key, value] of Object.entries(obj)) {
                    // Skip empty values
                    if (isEmptyValue(value)) {
                        continue;
                    }

                    // Recursively clean objects and arrays
                    if (typeof value === 'object' && value !== null) {
                        const cleanedValue = deepCleanup(value);
                        // Only add if the cleaned value is not empty
                        if (!isEmptyValue(cleanedValue)) {
                            cleaned[key] = cleanedValue;
                        }
                    } else {
                        // Keep non-object, non-empty values
                        cleaned[key] = value;
                    }
                }
                return cleaned;
            }

            // Return primitives as-is
            return obj;
        };

        return deepCleanup(config) as AgentConfig;
    };

    // Serialize config back to YAML while preserving comments
    const serializeConfigToYaml = (config: AgentConfig, document: yaml.Document): string => {
        console.log('[serializeConfigToYaml] Starting serialization');
        console.log('[serializeConfigToYaml] Document:', document);
        console.log('[serializeConfigToYaml] Config:', config);

        // Clean up config to remove null/undefined optional fields
        const cleanedConfig = cleanupConfig(config);
        console.log('[serializeConfigToYaml] Cleaned config:', cleanedConfig);

        // Update document with new config and serialize with comments preserved
        const updatedDoc = updateYamlDocumentFromConfig(document, cleanedConfig);
        const result = updatedDoc.toString();
        console.log('[serializeConfigToYaml] Serialized result length:', result.length);
        return result;
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
        setSaveSuccess(false);

        // Update parsed config and document for potential form mode switch
        const { config, document } = parseYamlToConfig(value);
        if (config && document) {
            setParsedConfig(config);
            setYamlDocument(document);
        }
        // Validation happens automatically via debouncedYamlContent useEffect
    };

    // Handle form editor changes
    const handleFormChange = (newConfig: AgentConfig) => {
        console.log('[handleFormChange] Called with new config');
        console.log('[handleFormChange] yamlDocument exists?', !!yamlDocument);

        if (!yamlDocument) {
            console.error('[handleFormChange] No document available - this should not happen!');
            return;
        }

        setParsedConfig(newConfig);
        // Use document to preserve comments
        const newYaml = serializeConfigToYaml(newConfig, yamlDocument);
        setYamlContent(newYaml);
        // Use semantic comparison for form mode to handle YAML formatting differences
        setHasUnsavedChanges(!configsAreEqual(newConfig, originalParsedConfig));
        setSaveSuccess(false);
        // Validation happens automatically via debouncedYamlContent useEffect
    };

    // Handle mode switch
    const handleModeSwitch = (newMode: EditorMode) => {
        console.log(
            '[handleModeSwitch] Called with newMode:',
            newMode,
            'current mode:',
            editorMode
        );
        if (newMode === editorMode) {
            console.log('[handleModeSwitch] Same mode, returning');
            return;
        }

        if (newMode === 'form') {
            console.log('[handleModeSwitch] Switching to form mode, parsing YAML...');
            // Switching to form mode - ensure config is parsed
            const { config, document, error } = parseYamlToConfig(yamlContent);
            console.log('[handleModeSwitch] Parse result:', { config, document, error });
            if (error) {
                console.error('[handleModeSwitch] Parse error, not switching:', error);
                setParseError(error);
                // Don't switch modes if parsing fails
                return;
            }
            console.log('[handleModeSwitch] Parse successful, setting state');
            setParsedConfig(config);
            setYamlDocument(document);
            setParseError(null);
        }

        console.log('[handleModeSwitch] Setting editor mode to:', newMode);
        setEditorMode(newMode);
    };

    // Save configuration
    const handleSave = useCallback(async () => {
        if (!isValid || errors.length > 0) {
            return;
        }

        setSaveSuccess(false);
        setSaveMessage('');

        try {
            const data = await saveMutation.mutateAsync({ yaml: yamlContent });

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
            console.error(`Error saving agent config: ${message}`);
        }
    }, [isValid, errors, saveMutation, yamlContent]);

    // Reload configuration
    const handleReload = () => {
        if (hasUnsavedChanges) {
            setShowUnsavedDialog(true);
        } else {
            refetchConfig();
        }
    };

    // Handle close with unsaved changes check
    const handleClose = useCallback(() => {
        if (hasUnsavedChanges) {
            setShowUnsavedDialog(true);
        } else {
            onClose();
        }
    }, [hasUnsavedChanges, onClose]);

    // Confirm discard changes
    const handleDiscardChanges = () => {
        setShowUnsavedDialog(false);
        setYamlContent(originalYamlContent);
        // Also reset parsed config for form mode
        if (originalParsedConfig) {
            setParsedConfig(originalParsedConfig);
            // Re-parse document for comment preservation
            const { document } = parseYamlToConfig(originalYamlContent);
            if (document) {
                setYamlDocument(document);
            }
        }
        setHasUnsavedChanges(false);
        refetchConfig();
    };

    // Config loads automatically via useAgentConfig hook when isOpen is true

    // Trigger validation when debounced content changes
    useEffect(() => {
        if (isOpen) {
            validateYaml(debouncedYamlContent);
        }
    }, [debouncedYamlContent, isOpen, validateYaml]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+S / Ctrl+S to save
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if (!saveMutation.isPending && isValid) {
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
    }, [isOpen, saveMutation.isPending, isValid, hasUnsavedChanges, handleSave, handleClose]);

    if (!isOpen) return null;

    // Calculate save button disabled reason
    const getSaveDisabledReason = (): string | null => {
        if (saveMutation.isPending) return null; // Not really disabled, just in progress
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
    const isSaveDisabled =
        !hasUnsavedChanges || saveMutation.isPending || !isValid || errors.length > 0;

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
                                    variant={editorMode === 'yaml' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => handleModeSwitch('yaml')}
                                    className="h-7 px-3"
                                >
                                    YAML Editor
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Edit configuration in raw YAML format with full control
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={editorMode === 'form' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => handleModeSwitch('form')}
                                    className="h-7 px-3"
                                >
                                    Form Editor
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Edit configuration using user-friendly forms
                            </TooltipContent>
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
                            <Button variant="ghost" size="sm" onClick={handleClose}>
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
                            <h3 className="text-lg font-semibold mb-2">
                                Failed to load configuration
                            </h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                {loadError?.message || 'Unknown error'}
                            </p>
                            <Button onClick={() => refetchConfig()} variant="outline">
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Retry
                            </Button>
                        </div>
                    </div>
                ) : isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                            <p className="text-sm text-muted-foreground">
                                Loading configuration...
                            </p>
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
                        isValidating={validateMutation.isPending}
                        isValid={isValid}
                        errors={errors}
                        warnings={warnings}
                        hasUnsavedChanges={hasUnsavedChanges}
                    />
                ) : parsedConfig ? (
                    <FormEditorView
                        config={parsedConfig}
                        onChange={handleFormChange}
                        errors={errors.reduce(
                            (acc, err) => {
                                if (err.path) {
                                    acc[err.path] = err.message;
                                }
                                return acc;
                            },
                            {} as Record<string, string>
                        )}
                    />
                ) : null}
            </div>

            {/* Footer */}
            {!loadError && !isLoading && (
                <div className="flex flex-col border-t border-border">
                    {/* Save status messages */}
                    {(saveSuccess || saveMutation.error) && (
                        <div className="px-4 py-3 bg-muted/50 border-b border-border">
                            {saveSuccess && (
                                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>{saveMessage}</span>
                                </div>
                            )}
                            {saveMutation.error && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span>{saveMutation.error.message}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-between px-4 py-3">
                        <div />
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleClose}>
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
                                            {saveMutation.isPending ? (
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
                        <Button variant="outline" onClick={() => setShowUnsavedDialog(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDiscardChanges}>
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
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-300',
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={handleClose}
            />
            {/* Panel */}
            <div
                className={cn(
                    'fixed inset-y-0 right-0 z-50 w-full sm:w-[600px] md:w-[700px] lg:w-[800px] border-l border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300',
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                )}
            >
                {panelContent}
            </div>
        </>
    );
}
