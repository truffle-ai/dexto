'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Loader2, Trash2, Plus } from 'lucide-react';

interface PromptArgumentForm {
  name: string;
  description?: string;
  required: boolean;
}

interface CreatePromptModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (prompt: {
    name: string;
    arguments?: Array<{ name: string; required?: boolean }>;
  }) => void;
}

interface ResourcePayload {
  base64: string;
  mimeType: string;
  filename?: string;
}

const initialArgument: PromptArgumentForm = { name: '', description: '', required: false };

export default function CreatePromptModal({ open, onClose, onCreated }: CreatePromptModalProps) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [argumentsState, setArgumentsState] = useState<PromptArgumentForm[]>([]);
  const [resource, setResource] = useState<ResourcePayload | null>(null);
  const [resourcePreview, setResourcePreview] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setTitle('');
      setDescription('');
      setContent('');
      setArgumentsState([]);
      setResource(null);
      setResourcePreview(null);
      setResourceName(null);
      setErrorMessage(null);
      setIsSaving(false);
    }
  }, [open]);

  const handleAddArgument = () => {
    setArgumentsState((prev) => [...prev, { ...initialArgument }]);
  };

  const handleArgumentChange = (
    index: number,
    field: keyof PromptArgumentForm,
    value: string | boolean
  ) => {
    setArgumentsState((prev) =>
      prev.map((arg, i) => {
        if (i !== index) return arg;

        if (field === 'required' && typeof value === 'boolean') {
          return { ...arg, required: value };
        }

        if ((field === 'name' || field === 'description') && typeof value === 'string') {
          return { ...arg, [field]: value } as PromptArgumentForm;
        }

        return arg;
      })
    );
  };

  const handleRemoveArgument = (index: number) => {
    setArgumentsState((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResourceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setResource(null);
      setResourcePreview(null);
      setResourceName(null);
      return;
    }
    try {
      const base64 = await readFileAsDataUrl(file);
      setResource({ base64, mimeType: file.type || 'application/octet-stream', filename: file.name });
      setResourcePreview(base64);
      setResourceName(file.name);
    } catch (error) {
      console.error('Failed to read file:', error);
      setErrorMessage('Failed to read file. Please try a different file.');
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
      arguments: argumentsState
        .filter((arg) => arg.name.trim())
        .map((arg) => ({
          name: arg.name.trim(),
          description: arg.description?.trim() || undefined,
          required: arg.required || undefined,
        })),
      resource: resource || undefined,
    };

    try {
      const response = await fetch('/api/prompts/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = errorBody?.message || 'Failed to create prompt.';
        throw new Error(message);
      }

      const data = await response.json();
      if (data?.prompt) {
        onCreated({
          name: data.prompt.name,
          arguments: data.prompt.arguments,
        });
      }
    } catch (error) {
      console.error('Failed to create prompt:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to create prompt. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const hasArguments = argumentsState.length > 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Custom Prompt</DialogTitle>
          <DialogDescription>
            Define reusable prompt text and optionally attach a supporting resource file.
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
                Use lowercase letters, numbers, or hyphens. This becomes your /prompt command.
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
            <p className="text-[11px] text-muted-foreground">
              You can reference dynamic values using placeholders like <code>{'{{topic}}'}</code>.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Arguments</Label>
                <p className="text-[11px] text-muted-foreground">
                  Define optional parameters that can be supplied when using the prompt.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={handleAddArgument}>
                <Plus className="h-3 w-3 mr-2" /> Add argument
              </Button>
            </div>

            {hasArguments ? (
              <div className="space-y-2">
                {argumentsState.map((arg, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                    <div className="sm:col-span-1">
                      <Label htmlFor={`arg-name-${index}`} className="text-[12px]">Name</Label>
                      <Input
                        id={`arg-name-${index}`}
                        value={arg.name}
                        onChange={(e) => handleArgumentChange(index, 'name', e.target.value)}
                        placeholder="topic"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor={`arg-desc-${index}`} className="text-[12px]">Description</Label>
                      <Input
                        id={`arg-desc-${index}`}
                        value={arg.description}
                        onChange={(e) => handleArgumentChange(index, 'description', e.target.value)}
                        placeholder="Topic to summarize"
                      />
                    </div>
                    <div className="sm:col-span-1 flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={arg.required}
                          onCheckedChange={(checked) => handleArgumentChange(index, 'required', checked)}
                        />
                        <span className="text-sm">Required</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveArgument(index)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                No arguments defined. Add arguments to parameterize this prompt.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label>Attach resource (optional)</Label>
            {resourcePreview ? (
              <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 bg-muted/40 px-4 py-3">
                <div className="text-sm">
                  <Badge variant="secondary" className="mr-2">Resource</Badge>
                  {resourceName || 'Attached file'}
                </div>
                <Button variant="ghost" size="sm" onClick={removeResource}>
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              </div>
            ) : (
              <Input type="file" onChange={handleResourceChange} />
            )}
            <p className="text-[11px] text-muted-foreground">
              The resource will be stored securely and referenced when this prompt is used.
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
