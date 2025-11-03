'use client';

import React, { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';

interface CreateMemoryModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CreateMemoryModal({ open, onClose, onSuccess }: CreateMemoryModalProps) {
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('Memory content is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        content: content.trim(),
        ...(tags.trim() && {
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
        metadata: {
          source: 'user',
        },
      };

      await apiFetch('/api/memory', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Success - reset and close
      setContent('');
      setTags('');
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create memory');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setContent('');
      setTags('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Memory</DialogTitle>
          <DialogDescription>
            Memories are automatically included in every conversation to help Dexto remember your
            preferences and important information.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label htmlFor="memory-content">Memory Content *</Label>
            <Textarea
              id="memory-content"
              placeholder="e.g., I prefer concise responses without explanations"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px] resize-none"
              disabled={isSubmitting}
              autoFocus
            />
            <p className="text-sm text-muted-foreground">
              {content.length} / 10,000 characters
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="memory-tags">Tags (optional)</Label>
            <Input
              id="memory-tags"
              placeholder="e.g., preferences, work, coding-style"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Comma-separated tags for organizing memories
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !content.trim()}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Memory'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
