'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import ConnectServerModal from '../ConnectServerModal';
import { ServersList } from './ServersList';
import { ToolsList } from './ToolsList';
import { ToolInputForm } from './ToolInputForm';
import { ToolResult } from './ToolResult';
import { ExecutionHistory, type ExecutionHistoryItem } from './ExecutionHistory';
import type { ToolResult as ToolResultType } from '@dexto/core';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useServers, useServerTools } from '../hooks/useServers';
import type { McpServer, McpTool } from '../hooks/useServers';

export default function PlaygroundView() {
    const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
    const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
    const [toolInputs, setToolInputs] = useState<Record<string, any>>({});
    const [toolResult, setToolResult] = useState<ToolResultType | null>(null);
    const [currentError, setCurrentError] = useState<string | null>(null);
    const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
    const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
    const [executionLoading, setExecutionLoading] = useState(false);
    const [executionHistory, setExecutionHistory] = useState<ExecutionHistoryItem[]>([]);
    const [clipboardNotification, setClipboardNotification] = useState<{
        message: string;
        type: 'success' | 'error';
    } | null>(null);

    // Search states
    const [serverSearchQuery, setServerSearchQuery] = useState('');
    const [toolSearchQuery, setToolSearchQuery] = useState('');

    // Responsive sidebar states
    const [showServersSidebar, setShowServersSidebar] = useState(true);
    const [showToolsSidebar, setShowToolsSidebar] = useState(true);

    const toolsAbortControllerRef = useRef<AbortController | null>(null);
    const executionAbortControllerRef = useRef<AbortController | null>(null);

    const {
        data: servers = [],
        isLoading: serversLoading,
        error: serversError,
        refetch: refetchServers,
    } = useServers();

    const {
        data: tools = [],
        isLoading: toolsLoading,
        error: toolsError,
    } = useServerTools(
        selectedServer?.id || null,
        !!selectedServer && selectedServer.status === 'connected'
    );

    const handleError = (message: string, area?: 'servers' | 'tools' | 'execution' | 'input') => {
        console.error(`Playground Error (${area || 'general'}):`, message);
        if (area !== 'input') {
            setCurrentError(message);
        }
    };

    const handleServerSelect = useCallback((server: McpServer) => {
        setSelectedServer(server);
        setSelectedTool(null);
        setToolResult(null);
        setCurrentError(null);
        setInputErrors({});
    }, []);

    const handleToolSelect = useCallback((tool: McpTool) => {
        setSelectedTool(tool);
        setToolResult(null);
        setCurrentError(null);
        setInputErrors({});
        const defaultInputs: Record<string, any> = {};
        if (tool.inputSchema && tool.inputSchema.properties) {
            for (const key in tool.inputSchema.properties) {
                const prop = tool.inputSchema.properties[key];
                if (prop.default !== undefined) {
                    defaultInputs[key] = prop.default;
                } else {
                    if (prop.type === 'boolean') defaultInputs[key] = false;
                    else if (prop.type === 'number' || prop.type === 'integer')
                        defaultInputs[key] = '';
                    else if (prop.type === 'object' || prop.type === 'array')
                        defaultInputs[key] = '';
                    else defaultInputs[key] = '';
                }
            }
        }
        setToolInputs(defaultInputs);
    }, []);

    const handleInputChange = useCallback(
        (
            inputName: string,
            value: any,
            type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
        ) => {
            setToolInputs((prev) => ({ ...prev, [inputName]: value }));
            if (inputErrors[inputName]) {
                setInputErrors((prev) => ({ ...prev, [inputName]: '' }));
            }

            if (type === 'object' || type === 'array') {
                if (value === '') return;
                try {
                    JSON.parse(value);
                } catch (e) {
                    setInputErrors((prev) => ({ ...prev, [inputName]: 'Invalid JSON format' }));
                    return;
                }
            }
        },
        [inputErrors]
    );

    const validateInputs = useCallback((): boolean => {
        if (!selectedTool || !selectedTool.inputSchema || !selectedTool.inputSchema.properties) {
            return true;
        }
        const currentInputErrors: Record<string, string> = {};
        let allValid = true;

        for (const key in selectedTool.inputSchema.properties) {
            const prop = selectedTool.inputSchema.properties[key];
            const value = toolInputs[key];

            if (selectedTool.inputSchema.required?.includes(key)) {
                if (
                    value === undefined ||
                    value === '' ||
                    (prop.type === 'boolean' && typeof value !== 'boolean')
                ) {
                    currentInputErrors[key] = 'This field is required.';
                    allValid = false;
                    continue;
                }
            }

            if (
                (prop.type === 'number' || prop.type === 'integer') &&
                value !== '' &&
                isNaN(Number(value))
            ) {
                currentInputErrors[key] = 'Must be a valid number.';
                allValid = false;
            }

            if ((prop.type === 'object' || prop.type === 'array') && value !== '') {
                try {
                    JSON.parse(value as string);
                } catch (e) {
                    currentInputErrors[key] = 'Invalid JSON format.';
                    allValid = false;
                }
            }
        }
        setInputErrors(currentInputErrors);
        return allValid;
    }, [selectedTool, toolInputs]);

    const handleExecuteTool = useCallback(async () => {
        if (!selectedServer || !selectedTool) {
            handleError('No server or tool selected for execution.', 'execution');
            return;
        }
        executionAbortControllerRef.current?.abort();
        const controller = new AbortController();
        executionAbortControllerRef.current = controller;
        setCurrentError(null);
        setToolResult(null);

        if (!validateInputs()) {
            handleError('Please correct the input errors.', 'input');
            return;
        }

        const executionStart = Date.now();
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        setExecutionLoading(true);
        try {
            const processedInputs: Record<string, any> = {};
            if (selectedTool.inputSchema && selectedTool.inputSchema.properties) {
                for (const key in selectedTool.inputSchema.properties) {
                    const prop = selectedTool.inputSchema.properties[key];
                    let value = toolInputs[key];
                    if (prop.type === 'number') {
                        value = value === '' ? undefined : Number(value);
                    } else if (prop.type === 'integer') {
                        if (value === '') {
                            value = undefined;
                        } else {
                            const num = Number(value);
                            if (!Number.isInteger(num)) {
                                setInputErrors((prev) => ({
                                    ...prev,
                                    [key]: 'Must be a valid integer.',
                                }));
                                setExecutionLoading(false);
                                return;
                            }
                            value = num;
                        }
                    } else if (prop.type === 'boolean') {
                        if (typeof value === 'string') {
                            value = value === 'true';
                        } else {
                            value = Boolean(value);
                        }
                    } else if (
                        (prop.type === 'object' || prop.type === 'array') &&
                        typeof value === 'string' &&
                        value.trim() !== ''
                    ) {
                        try {
                            value = JSON.parse(value);
                        } catch (e) {
                            setInputErrors((prev) => ({
                                ...prev,
                                [key]: 'Invalid JSON before sending.',
                            }));
                            setExecutionLoading(false);
                            return;
                        }
                    } else if (
                        (prop.type === 'object' || prop.type === 'array') &&
                        (value === undefined || value === '')
                    ) {
                        value = undefined;
                    }
                    if (value !== undefined) {
                        processedInputs[key] = value;
                    }
                }
            }

            const response = await client.api.mcp.servers[':serverId'].tools[
                ':toolName'
            ].execute.$post({
                param: {
                    serverId: selectedServer.id,
                    toolName: selectedTool.id,
                },
                json: processedInputs,
            });

            if (!response.ok) {
                throw new Error('Tool execution failed');
            }

            const resultData = await response.json();

            const duration = Date.now() - executionStart;
            setToolResult(resultData);

            setExecutionHistory((prev) => [
                {
                    id: executionId,
                    toolName: selectedTool.name,
                    timestamp: new Date(),
                    success: true,
                    duration,
                },
                ...prev.slice(0, 9),
            ]);
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                const duration = Date.now() - executionStart;
                handleError(err.message, 'execution');
                if (
                    err.message &&
                    (!toolResult || toolResult.success || toolResult.error !== err.message)
                ) {
                    setToolResult({ success: false, error: err.message });
                }

                setExecutionHistory((prev) => [
                    {
                        id: executionId,
                        toolName: selectedTool?.name || 'Unknown',
                        timestamp: new Date(),
                        success: false,
                        duration,
                    },
                    ...prev.slice(0, 9),
                ]);
            }
        } finally {
            if (!controller.signal.aborted) {
                setExecutionLoading(false);
            }
        }
    }, [selectedServer, selectedTool, toolInputs, validateInputs, toolResult]);

    const handleModalClose = () => {
        setIsConnectModalOpen(false);
        refetchServers();
    };

    const copyToClipboard = async (text: string, successMessage?: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setClipboardNotification({
                message: successMessage || 'Copied to clipboard',
                type: 'success',
            });
            setTimeout(() => setClipboardNotification(null), 3000);
        } catch (err) {
            setClipboardNotification({
                message: 'Failed to copy to clipboard. Please check browser permissions.',
                type: 'error',
            });
            setTimeout(() => setClipboardNotification(null), 5000);
            console.error('Failed to copy to clipboard:', err);
        }
    };

    const copyToolConfiguration = () => {
        if (!selectedTool || !selectedServer) return;
        const config = {
            server: selectedServer.name,
            tool: selectedTool.name,
            inputs: toolInputs,
            timestamp: new Date().toISOString(),
        };
        copyToClipboard(JSON.stringify(config, null, 2), 'Tool configuration copied!');
    };

    const copyToolResult = () => {
        if (!toolResult) return;
        const resultText =
            typeof toolResult.data === 'object'
                ? JSON.stringify(toolResult.data, null, 2)
                : String(toolResult.data);
        copyToClipboard(resultText, 'Tool result copied!');
    };

    const shareToolConfig = () => {
        if (!selectedTool || !selectedServer) return;
        const shareText = `Check out this Dexto tool configuration:\n\nServer: ${selectedServer.name}\nTool: ${selectedTool.name}\nInputs: ${JSON.stringify(toolInputs, null, 2)}`;
        if (navigator.share) {
            navigator.share({
                title: `Dexto Tool: ${selectedTool.name}`,
                text: shareText,
            });
        } else {
            copyToClipboard(shareText, 'Tool configuration copied for sharing!');
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground antialiased">
            {/* Servers Sidebar */}
            <aside
                className={cn(
                    'w-72 flex-shrink-0 border-r border-border bg-card p-4 flex flex-col transition-all duration-300',
                    'lg:relative lg:translate-x-0',
                    showServersSidebar
                        ? 'translate-x-0'
                        : '-translate-x-full absolute lg:w-0 lg:p-0 lg:border-0'
                )}
            >
                {showServersSidebar && (
                    <>
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
                            <Link href="/">
                                <Button variant="outline" size="sm" className="gap-1.5">
                                    <ArrowLeft className="h-4 w-4" />
                                    Back
                                </Button>
                            </Link>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowServersSidebar(false)}
                                className="lg:hidden"
                            >
                                <PanelLeftClose className="h-4 w-4" />
                            </Button>
                        </div>
                        <ServersList
                            servers={servers}
                            selectedServer={selectedServer}
                            isLoading={serversLoading}
                            error={serversError?.message || currentError}
                            searchQuery={serverSearchQuery}
                            onSearchChange={setServerSearchQuery}
                            onServerSelect={handleServerSelect}
                            onConnectNew={() => setIsConnectModalOpen(true)}
                        />
                    </>
                )}
            </aside>

            {/* Tools Sidebar */}
            <aside
                className={cn(
                    'w-80 flex-shrink-0 border-r border-border bg-card p-4 flex flex-col transition-all duration-300',
                    'lg:relative lg:translate-x-0',
                    showToolsSidebar
                        ? 'translate-x-0'
                        : '-translate-x-full absolute lg:w-0 lg:p-0 lg:border-0'
                )}
            >
                {showToolsSidebar && (
                    <ToolsList
                        tools={tools}
                        selectedTool={selectedTool}
                        selectedServer={selectedServer}
                        isLoading={toolsLoading}
                        error={
                            toolsError?.message ||
                            (selectedServer?.status === 'connected' ? currentError : null)
                        }
                        searchQuery={toolSearchQuery}
                        onSearchChange={setToolSearchQuery}
                        onToolSelect={handleToolSelect}
                    />
                )}
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-6 flex flex-col bg-muted/30 overflow-y-auto">
                {/* Header */}
                <div className="pb-3 mb-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {!showServersSidebar && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowServersSidebar(true)}
                                    className="lg:hidden"
                                >
                                    <PanelLeft className="h-4 w-4" />
                                </Button>
                            )}
                            {!showToolsSidebar && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowToolsSidebar(true)}
                                    className="lg:hidden"
                                >
                                    <PanelLeft className="h-4 w-4" />
                                </Button>
                            )}
                            <h2 className="text-lg font-semibold text-foreground">Tool Runner</h2>
                        </div>
                    </div>
                </div>

                {/* Clipboard Notification */}
                {clipboardNotification && (
                    <Alert
                        variant={clipboardNotification.type === 'error' ? 'destructive' : 'default'}
                        className={cn(
                            'mb-4',
                            clipboardNotification.type === 'success' &&
                                'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400'
                        )}
                    >
                        {clipboardNotification.type === 'error' && (
                            <AlertTriangle className="h-4 w-4" />
                        )}
                        {clipboardNotification.type === 'success' && (
                            <CheckCircle className="h-4 w-4" />
                        )}
                        <AlertDescription>{clipboardNotification.message}</AlertDescription>
                    </Alert>
                )}

                {/* Error Display */}
                {currentError && selectedTool && (!toolResult || !toolResult.success) && (
                    <div className="mb-4 p-3 border border-destructive/50 bg-destructive/10 rounded-md text-destructive text-sm">
                        <p className="font-medium">Error:</p>
                        <p>{currentError}</p>
                    </div>
                )}

                {/* Empty State */}
                {!selectedTool && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center max-w-md">
                            <div className="mb-4">
                                <ArrowLeft className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Select a Tool</h3>
                            <p className="text-muted-foreground text-sm">
                                Choose a tool from the left panel to start testing and experimenting
                                with MCP capabilities.
                            </p>
                        </div>
                    </div>
                )}

                {/* Tool Content */}
                {selectedTool && (
                    <div className="space-y-6">
                        {/* Tool Info Card */}
                        <div className="p-4 border border-border rounded-lg bg-card shadow-sm">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="text-base font-semibold text-primary mb-1">
                                        {selectedTool.name}
                                    </h3>
                                    {selectedTool.description && (
                                        <p className="text-sm text-muted-foreground">
                                            {selectedTool.description}
                                        </p>
                                    )}
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                    <p>Server: {selectedServer?.name}</p>
                                    {executionHistory.filter(
                                        (h) => h.toolName === selectedTool.name
                                    ).length > 0 && (
                                        <p>
                                            Runs:{' '}
                                            {
                                                executionHistory.filter(
                                                    (h) => h.toolName === selectedTool.name
                                                ).length
                                            }
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Tool Input Form */}
                        <ToolInputForm
                            tool={selectedTool}
                            inputs={toolInputs}
                            errors={inputErrors}
                            isLoading={executionLoading}
                            onInputChange={handleInputChange}
                            onSubmit={handleExecuteTool}
                            onCopyConfig={copyToolConfiguration}
                            onShareConfig={shareToolConfig}
                        />

                        {/* Tool Result */}
                        {toolResult && (
                            <ToolResult
                                result={toolResult}
                                toolName={selectedTool.name}
                                onCopyResult={copyToolResult}
                            />
                        )}

                        {/* Execution History */}
                        <ExecutionHistory history={executionHistory} />
                    </div>
                )}
            </main>

            <ConnectServerModal isOpen={isConnectModalOpen} onClose={handleModalClose} />
        </div>
    );
}
