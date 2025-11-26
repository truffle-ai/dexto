import React, { useState } from 'react';
import { useCreateMemory } from './hooks/useMemories';
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
}

export default function CreateMemoryModal({ open, onClose }: CreateMemoryModalProps) {
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');

    const createMemoryMutation = useCreateMemory();

    const handleSuccess = () => {
        setContent('');
        setTags('');
        onClose();
    };

    const handleSubmit = async () => {
        if (!content.trim()) return;

        const payload = {
            content: content.trim(),
            ...(tags.trim() && {
                tags: tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
            }),
            metadata: { source: 'user' },
        };

        createMemoryMutation.mutate(payload, {
            onSuccess: handleSuccess,
        });
    };

    const handleClose = () => {
        if (!createMemoryMutation.isPending) {
            setContent('');
            setTags('');
            createMemoryMutation.reset();
            onClose();
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    handleClose();
                }
            }}
        >
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create Memory</DialogTitle>
                    <DialogDescription>
                        Memories are automatically included in every conversation to help Dexto
                        remember your preferences and important information.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {createMemoryMutation.error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                {createMemoryMutation.error instanceof Error
                                    ? createMemoryMutation.error.message
                                    : 'Failed to create memory'}
                            </AlertDescription>
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
                            disabled={createMemoryMutation.isPending}
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
                            disabled={createMemoryMutation.isPending}
                        />
                        <p className="text-sm text-muted-foreground">
                            Comma-separated tags for organizing memories
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={createMemoryMutation.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={createMemoryMutation.isPending || !content.trim()}
                    >
                        {createMemoryMutation.isPending ? (
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
