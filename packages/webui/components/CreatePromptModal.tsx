'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client.js';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Loader2, Trash2, Upload, FileText } from 'lucide-react';

interface CreatePromptModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: (prompt: { name: string }) => void;
}

interface ResourcePayload {
    base64: string;
    mimeType: string;
    filename?: string;
}

export default function CreatePromptModal({ open, onClose, onCreated }: CreatePromptModalProps) {
    const [name, setName] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [content, setContent] = useState('');
    const [resource, setResource] = useState<ResourcePayload | null>(null);
    const [resourcePreview, setResourcePreview] = useState<string | null>(null);
    const [resourceName, setResourceName] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    useEffect(() => {
        if (!open) {
            setName('');
            setTitle('');
            setDescription('');
            setContent('');
            setResource(null);
            setResourcePreview(null);
            setResourceName(null);
            setErrorMessage(null);
            setIsSaving(false);
            setIsDragOver(false);
        }
    }, [open]);

    const handleFile = async (file: File) => {
        try {
            const base64 = await readFileAsDataUrl(file);
            setResource({
                base64,
                mimeType: file.type || 'application/octet-stream',
                filename: file.name,
            });
            setResourcePreview(base64);
            setResourceName(file.name);
        } catch (error) {
            console.error('Failed to read file:', error);
            setErrorMessage('Failed to read file. Please try a different file.');
        }
    };

    const handleResourceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            setResource(null);
            setResourcePreview(null);
            setResourceName(null);
            return;
        }
        await handleFile(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await handleFile(files[0]);
        }
    };

    const removeResource = () => {
        setResource(null);
        setResourcePreview(null);
        setResourceName(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!name.trim() || !content.trim()) {
            setErrorMessage('Name and content are required.');
            return;
        }

        setIsSaving(true);
        setErrorMessage(null);

        const payload = {
            name: name.trim(),
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            content,
            resource: resource || undefined,
        };

        try {
            const data = await apiFetch<{ prompt: { name: string } }>('/api/prompts/custom', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            if (data?.prompt) {
                onCreated({
                    name: data.prompt.name,
                });
            }
        } catch (error) {
            console.error('Failed to create prompt:', error);
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : 'Failed to create prompt. Please try again.'
            );
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Create Custom Prompt</DialogTitle>
                    <DialogDescription>
                        Define reusable prompt text and optionally attach a supporting resource
                        file.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {errorMessage && (
                        <Alert variant="destructive">
                            <AlertDescription>{errorMessage}</AlertDescription>
                        </Alert>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="prompt-name">Prompt Name</Label>
                            <Input
                                id="prompt-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="research-summary"
                                required
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Use lowercase letters, numbers, or hyphens. This becomes your
                                /prompt command.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="prompt-title">Title</Label>
                            <Input
                                id="prompt-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Research Summary"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="prompt-description">Description</Label>
                        <Input
                            id="prompt-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Summarize research papers with key findings"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="prompt-content">Prompt Content</Label>
                        <Textarea
                            id="prompt-content"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Write the instructions for this prompt..."
                            className="min-h-[160px]"
                            required
                        />
                    </div>

                    <div className="space-y-3">
                        <Label>Attach resource (optional)</Label>
                        {resourcePreview ? (
                            <div className="flex items-center justify-between rounded-lg border border-dashed border-border/60 bg-muted/40 px-4 py-3">
                                <div className="flex items-center text-sm">
                                    <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                                    <Badge variant="secondary" className="mr-2">
                                        Resource
                                    </Badge>
                                    {resourceName || 'Attached file'}
                                </div>
                                <Button variant="ghost" size="sm" onClick={removeResource}>
                                    <Trash2 className="h-4 w-4 mr-1" /> Remove
                                </Button>
                            </div>
                        ) : (
                            <div
                                className={`relative rounded-lg border-2 border-dashed transition-colors ${
                                    isDragOver
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border/60 hover:border-border/80'
                                } px-6 py-8 text-center`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                <input
                                    type="file"
                                    onChange={handleResourceChange}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    accept="*/*"
                                />
                                <div className="flex flex-col items-center justify-center space-y-2">
                                    <Upload
                                        className={`h-8 w-8 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`}
                                    />
                                    <div className="text-sm">
                                        <span className="font-medium">
                                            {isDragOver ? 'Drop file here' : 'Click to upload'}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {' '}
                                            or drag and drop
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Any file type supported
                                    </p>
                                </div>
                            </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                            The resource will be stored securely and referenced when this prompt is
                            used.
                        </p>
                    </div>

                    <DialogFooter className="flex items-center justify-between gap-2">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                                </>
                            ) : (
                                'Save Prompt'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
            } else {
                reject(new Error('Failed to read file'));
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}
