'use client';

import React, { useState, useEffect } from 'react';
import { McpServerConfig, StdioServerConfig, SseServerConfig, HttpServerConfig } from '@dexto/core';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyValueEditor } from './ui/key-value-editor';

interface ConnectServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onServerConnected?: () => void;
    initialName?: string;
    initialConfig?: Partial<StdioServerConfig> | Partial<SseServerConfig> | Partial<HttpServerConfig>;
    lockName?: boolean;
}


export default function ConnectServerModal({ isOpen, onClose, onServerConnected, initialName, initialConfig, lockName }: ConnectServerModalProps) {
    const [serverName, setServerName] = useState('');
    const [serverType, setServerType] = useState<'stdio' | 'sse' | 'http'>('stdio');
    const [command, setCommand] = useState('');
    const [args, setArgs] = useState('');
    const [url, setUrl] = useState('');
    const [headerPairs, setHeaderPairs] = useState<Array<{key: string; value: string; id: string}>>([]);
    const [envPairs, setEnvPairs] = useState<Array<{key: string; value: string; id: string}>>([]);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Helper function to convert header pairs to record
    const headersToRecord = (pairs: Array<{key: string; value: string; id: string}>): Record<string, string> => {
        const headers: Record<string, string> = {};
        pairs.forEach((pair) => {
            if (pair.key.trim() && pair.value.trim()) {
                headers[pair.key.trim()] = pair.value.trim();
            }
        });
        return headers;
    };

    // Helper function to convert env pairs to record
    const envToRecord = (pairs: Array<{key: string; value: string; id: string}>): Record<string, string> => {
        const env: Record<string, string> = {};
        for (const { key, value } of pairs) {
            const k = key.trim();
            const v = value.trim();
            if (k && v) env[k] = v;
        }
        return env;
    };

    // Helper function to mask sensitive environment values for logging
    const maskSensitiveEnv = (env: Record<string, string>): Record<string, string> => {
        const sensitiveKeys = ['api_key', 'secret', 'token', 'password', 'key'];
        const masked: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) {
            const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
            masked[key] = isSensitive ? '***masked***' : value;
        }
        return masked;
    };

    // Helper to mask sensitive headers for logging
    const maskSensitiveHeaders = (headers: Record<string, string>): Record<string, string> => {
        const sensitive = ['authorization', 'proxy-authorization', 'api-key', 'x-api-key', 'token', 'cookie', 'set-cookie'];
        const masked: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers)) {
            const key = k.toLowerCase();
            const isSensitive = sensitive.some(s => key === s || key.includes(s));
            masked[k] = isSensitive ? '***masked***' : v;
        }
        return masked;
    };

    useEffect(() => {
        if (!isOpen) {
            const timer = setTimeout(() => {
                setServerName('');
                setServerType('stdio');
                setCommand('');
                setArgs('');
                setUrl('');
                setHeaderPairs([]);
                setEnvPairs([]);
                setError(null);
                setIsSubmitting(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Apply initialName/initialConfig when they change and modal opens
    useEffect(() => {
        if (!isOpen) return;
        setServerName(initialName ?? '');
        const type = initialConfig?.type ?? 'stdio';
        setServerType(type);
        if (type === 'stdio') {
            const std = (initialConfig ?? {}) as Partial<StdioServerConfig>;
            setCommand(typeof std.command === 'string' ? std.command : '');
            setArgs(Array.isArray(std.args) ? std.args.join(', ') : '');
            const envEntries = Object.entries(std.env ?? {});
            setEnvPairs(envEntries.map(([key, value], idx) => ({ key, value: String(value ?? ''), id: `env-${idx}` })));
            // clear URL/header state
            setUrl('');
            setHeaderPairs([]);
        } else {
            const net = (initialConfig ?? {}) as Partial<SseServerConfig | HttpServerConfig>;
            setUrl(typeof net.url === 'string' ? net.url : '');
            const hdrEntries = Object.entries(net.headers ?? {});
            setHeaderPairs(hdrEntries.map(([key, value], idx) => ({ key, value: String(value ?? ''), id: `hdr-${idx}` })));
            // clear stdio state
            setCommand('');
            setArgs('');
            setEnvPairs([]);
        }
    }, [isOpen, initialName, initialConfig]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        // Validate server name
        if (!serverName.trim()) {
            setError('Server name is required.');
            setIsSubmitting(false);
            return;
        }

        // Validate required fields based on server type
        if (serverType === 'stdio') {
            if (!command.trim()) {
                setError('Command is required for stdio servers.');
                setIsSubmitting(false);
                return;
            }
            
            // Validate environment variables
            const requiredKeys = envPairs.map((p) => p.key.trim()).filter(Boolean);
            if (requiredKeys.length) {
                const dupes = requiredKeys.filter((k, i) => requiredKeys.indexOf(k) !== i);
                if (dupes.length) {
                    setError(`Duplicate environment variables: ${Array.from(new Set(dupes)).join(', ')}`);
                    setIsSubmitting(false);
                    return;
                }
                const missing = envPairs.filter((p) => p.key.trim() && !p.value.trim()).map((p) => p.key.trim());
                if (missing.length) {
                    setError(`Please set required environment variables: ${missing.join(', ')}`);
                    setIsSubmitting(false);
                    return;
                }
            }
        } else {
            if (!url.trim()) {
                setError(`URL is required for ${serverType.toUpperCase()} servers.`);
                setIsSubmitting(false);
                return;
            }
            try {
                new URL(url.trim());
            } catch (_) {
                setError(`Invalid URL format for ${serverType.toUpperCase()} server.`);
                setIsSubmitting(false);
                return;
            }
        }

        // Create config after all validation passes
        let config: McpServerConfig;
        if (serverType === 'stdio') {
            config = {
                type: 'stdio',
                command: command.trim(),
                args: args
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                env: envToRecord(envPairs),
                timeout: 30000,
                connectionMode: 'lenient',
            };
        } else if (serverType === 'sse') {
            config = {
                type: 'sse',
                url: url.trim(),
                headers: headerPairs.length ? headersToRecord(headerPairs) : {},
                timeout: 30000,
                connectionMode: 'lenient',
            };
        } else {
            config = {
                type: 'http',
                url: url.trim(),
                headers: headerPairs.length ? headersToRecord(headerPairs) : {},
                timeout: 30000,
                connectionMode: 'lenient',
            };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch('/api/connect-server', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: serverName.trim(), config }),
                signal: controller.signal,
            });
            const result = await res.json();
            if (!res.ok) {
                // Server returned error JSON in { error: string }
                setError(result.error || `Server returned status ${res.status}`);
                setIsSubmitting(false);
                return;
            }
            if (process.env.NODE_ENV === 'development') {
                // Create a safe version for logging with masked sensitive values
                const safeConfig = { ...config };
                if (safeConfig.type === 'stdio' && safeConfig.env) {
                    safeConfig.env = maskSensitiveEnv(safeConfig.env);
                } else if ((safeConfig.type === 'sse' || safeConfig.type === 'http') && safeConfig.headers) {
                    safeConfig.headers = maskSensitiveHeaders(safeConfig.headers);
                }
                console.debug(`[ConnectServerModal.handleSubmit] Connect server response: ${JSON.stringify({ ...result, config: safeConfig })}`);
            }
            // Notify parent component that server was connected successfully
            if (onServerConnected) {
                onServerConnected();
            }
            onClose();
        } catch (err: unknown) {
            let message = 'Failed to connect server';
            if (err instanceof DOMException && err.name === 'AbortError') {
                message = 'Connection timed out';
            } else if (err instanceof Error) {
                message = err.message || message;
            } else if (typeof err === 'string') {
                message = err;
            }
            setError(message);
        } finally {
            clearTimeout(timeoutId);
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Connect New MCP Server</DialogTitle>
                    <DialogDescription>
                        Configure connection details for a new MCP server (stdio, SSE, or HTTP).
                    </DialogDescription>
                </DialogHeader>
                <form id="connectServerForm" onSubmit={handleSubmit} className="grid gap-4 py-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="serverName" className="text-right">
                            Server Name
                        </Label>
                        <Input
                            id="serverName"
                            value={serverName}
                            onChange={(e) => setServerName(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g., My Local Tools"
                            required
                            disabled={isSubmitting || !!lockName}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="serverType" className="text-right">
                            Server Type
                        </Label>
                        <Select
                            value={serverType}
                            onValueChange={(value: 'stdio' | 'sse' | 'http') =>
                                setServerType(value)
                            }
                            disabled={isSubmitting}
                        >
                            <SelectTrigger id="serverType" className="col-span-3">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="stdio">stdio</SelectItem>
                                <SelectItem value="sse">sse</SelectItem>
                                <SelectItem value="http">http</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {serverType === 'stdio' ? (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="command" className="text-right">
                                    Command
                                </Label>
                                <Input
                                    id="command"
                                    value={command}
                                    onChange={(e) => setCommand(e.target.value)}
                                    className="col-span-3"
                                    placeholder="e.g., /path/to/executable or python"
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="args" className="text-right">
                                    Arguments
                                </Label>
                                <Input
                                    id="args"
                                    value={args}
                                    onChange={(e) => setArgs(e.target.value)}
                                    className="col-span-3"
                                    placeholder="Comma-separated, e.g., -m,script.py,--port,8080"
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label className="text-right mt-2">Environment</Label>
                                <div className="col-span-3">
                                    <KeyValueEditor
                                        pairs={envPairs}
                                        onChange={setEnvPairs}
                                        placeholder={{
                                            key: 'API_KEY',
                                            value: 'your-secret-key',
                                        }}
                                        disabled={isSubmitting}
                                        keyLabel="Variable"
                                        valueLabel="Value"
                                    />
                                </div>
                            </div>
                        </>
                    ) : serverType === 'sse' ? (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="url" className="text-right">
                                    URL
                                </Label>
                                <Input
                                    id="url"
                                    type="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="col-span-3"
                                    placeholder="e.g., http://localhost:8000/events"
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label className="text-right mt-2">Headers</Label>
                                <div className="col-span-3">
                                    <KeyValueEditor
                                        pairs={headerPairs}
                                        onChange={setHeaderPairs}
                                        placeholder={{
                                            key: 'Authorization',
                                            value: 'Bearer your-token',
                                        }}
                                        disabled={isSubmitting}
                                        keyLabel="Header"
                                        valueLabel="Value"
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="url" className="text-right">
                                    URL
                                </Label>
                                <Input
                                    id="url"
                                    type="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="col-span-3"
                                    placeholder="e.g., http://localhost:8080"
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label className="text-right mt-2">Headers</Label>
                                <div className="col-span-3">
                                    <KeyValueEditor
                                        pairs={headerPairs}
                                        onChange={setHeaderPairs}
                                        placeholder={{
                                            key: 'Authorization',
                                            value: 'Bearer your-token',
                                        }}
                                        disabled={isSubmitting}
                                        keyLabel="Header"
                                        valueLabel="Value"
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </form>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline" disabled={isSubmitting}>
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button type="submit" form="connectServerForm" disabled={isSubmitting}>
                        {isSubmitting ? 'Connecting...' : 'Connect'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
