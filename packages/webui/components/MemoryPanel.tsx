import React, { useState } from 'react';
import { useMemories, useDeleteMemory, type Memory } from './hooks/useMemories';
import { formatRelativeTime } from '@/lib/date-utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Brain, Plus, Trash2, Calendar, Tag, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from './ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import CreateMemoryModal from './CreateMemoryModal';

interface MemoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: 'inline' | 'modal';
}

export default function MemoryPanel({ isOpen, onClose, variant = 'modal' }: MemoryPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedMemoryForDelete, setSelectedMemoryForDelete] = useState<Memory | null>(null);

    const { data: memories = [], isLoading: loading, error } = useMemories(isOpen);

    const deleteMemoryMutation = useDeleteMemory();

    const handleDeleteMemory = async (memoryId: string) => {
        await deleteMemoryMutation.mutateAsync({ memoryId });
        setDeleteDialogOpen(false);
        setSelectedMemoryForDelete(null);
    };

    const truncateContent = (content: string, maxLength: number = 120) => {
        if (content.length <= maxLength) return content;
        return content.slice(0, maxLength) + '...';
    };

    // Filter memories based on search query
    const filteredMemories = memories.filter((memory: Memory) => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            memory.content.toLowerCase().includes(query) ||
            memory.tags?.some((tag: string) => tag.toLowerCase().includes(query))
        );
    });

    const content = (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center space-x-2">
                    <Brain className="h-4 w-4" />
                    <h2 className="text-base font-semibold">Memories</h2>
                    <Badge variant="secondary" className="text-xs">
                        {memories.length}
                    </Badge>
                </div>
            </div>

            {/* Search Bar with Create Button */}
            <div className="p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search memories..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 h-8 text-sm"
                        />
                    </div>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCreateModalOpen(true)}
                                    className="h-8 w-8 p-0 shrink-0"
                                    aria-label="Create new memory"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Create Memory</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{error.message}</AlertDescription>
                    </Alert>
                </div>
            )}

            {/* Memories List */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <RefreshCw className="h-6 w-6 animate-spin" />
                        </div>
                    ) : filteredMemories.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            {searchQuery.trim() ? (
                                <>
                                    <p>No memories found</p>
                                    <p className="text-sm">Try a different search term</p>
                                </>
                            ) : (
                                <>
                                    <p>No memories yet</p>
                                    <p className="text-sm">
                                        Type # in chat or use the + button above
                                    </p>
                                </>
                            )}
                        </div>
                    ) : (
                        filteredMemories.map((memory: Memory) => (
                            <div
                                key={memory.id}
                                className={cn(
                                    'group p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all',
                                    memory.metadata?.pinned && 'ring-1 ring-primary/30 bg-primary/5'
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0 space-y-2">
                                        {/* Content */}
                                        <p className="text-sm leading-relaxed">
                                            {truncateContent(memory.content)}
                                        </p>

                                        {/* Tags */}
                                        {memory.tags && memory.tags.length > 0 && (
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <Tag className="h-3 w-3 text-muted-foreground" />
                                                {memory.tags.map((tag: string, idx: number) => (
                                                    <Badge
                                                        key={idx}
                                                        variant="outline"
                                                        className="text-xs px-1.5 py-0"
                                                    >
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}

                                        {/* Metadata */}
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                <span>{formatRelativeTime(memory.updatedAt)}</span>
                                            </div>
                                            {memory.metadata?.source && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-xs px-1.5 py-0"
                                                >
                                                    {memory.metadata.source}
                                                </Badge>
                                            )}
                                            {memory.metadata?.pinned && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-xs px-1.5 py-0"
                                                >
                                                    Pinned
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setSelectedMemoryForDelete(memory);
                                                setDeleteDialogOpen(true);
                                            }}
                                            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete memory"
                                        >
                                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>

            {/* Create Memory Modal */}
            <CreateMemoryModal open={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} />

            {/* Delete Confirmation Dialog */}
            <Dialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center space-x-2">
                            <Trash2 className="h-5 w-5 text-destructive" />
                            <span>Delete Memory</span>
                        </DialogTitle>
                        <DialogDescription>
                            This will permanently delete this memory. This action cannot be undone.
                            {selectedMemoryForDelete && (
                                <span className="block mt-2 text-sm font-medium max-h-20 overflow-y-auto">
                                    {truncateContent(selectedMemoryForDelete.content, 100)}
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() =>
                                selectedMemoryForDelete &&
                                handleDeleteMemory(selectedMemoryForDelete.id)
                            }
                            disabled={deleteMemoryMutation.isPending}
                            className="flex items-center space-x-2"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>
                                {deleteMemoryMutation.isPending ? 'Deleting...' : 'Delete Memory'}
                            </span>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );

    if (variant === 'inline') {
        return <div className="h-full">{content}</div>;
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-lg h-[600px] flex flex-col p-0">
                <DialogHeader className="sr-only">
                    <DialogTitle>Memories</DialogTitle>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    );
}
