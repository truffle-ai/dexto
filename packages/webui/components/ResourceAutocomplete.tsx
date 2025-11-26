import React from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import type { ResourceMetadata } from '@dexto/core';
import { useResourceContent } from './hooks/useResourceContent';
import type { NormalizedResourceItem, ResourceState } from './hooks/useResourceContent';
import { filterAndSortResources } from '../lib/utils.js';

interface ResourceAutocompleteProps {
    resources: ResourceMetadata[];
    query: string;
    selectedIndex: number;
    onSelect: (resource: ResourceMetadata) => void;
    onHoverIndex?: (index: number) => void;
    loading?: boolean;
}

export default function ResourceAutocomplete({
    resources,
    query,
    selectedIndex,
    onSelect,
    onHoverIndex,
    loading,
}: ResourceAutocompleteProps) {
    const filtered = React.useMemo(
        () => filterAndSortResources(resources, query),
        [resources, query]
    );

    const imageResourceUris = React.useMemo(
        () => filtered.filter((r) => (r.mimeType || '').startsWith('image/')).map((r) => r.uri),
        [filtered]
    );

    const imageResources = useResourceContent(imageResourceUris);

    const itemRefs = React.useRef<HTMLLIElement[]>([]);
    React.useEffect(() => {
        const el = itemRefs.current[selectedIndex];
        if (el && el.scrollIntoView) {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex, filtered.length]);

    if (!query && filtered.length === 0 && !loading) {
        return (
            <div className="px-3 py-2 text-sm text-muted-foreground">
                <div>No resources available.</div>
                <div className="text-xs mt-1 text-muted-foreground/80">
                    Connect an MCP server or enable internal resources to attach references.
                </div>
            </div>
        );
    }

    // Generate stable IDs for ARIA
    const getOptionId = (uri: string) =>
        `resource-option-${btoa(uri).replace(/[^a-zA-Z0-9]/g, '')}`;
    const activeDescendant = filtered[selectedIndex]
        ? getOptionId(filtered[selectedIndex].uri)
        : undefined;

    return loading ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Loading resources…</div>
    ) : filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
            <div>No resources match "{query}"</div>
            <div className="text-xs mt-1 text-muted-foreground/80">
                Tip: @ references only work at start or after spaces
            </div>
        </div>
    ) : (
        <ul
            role="listbox"
            aria-label="Resource suggestions"
            aria-activedescendant={activeDescendant}
            className="py-1 text-sm max-h-64 overflow-y-auto"
        >
            <li className="px-3 py-1.5 text-xs text-muted-foreground/80 border-b border-border">
                @ references files/resources • Works at start or after spaces
            </li>
            {filtered.map((r, idx) => {
                const optionId = getOptionId(r.uri);
                return (
                    <li
                        key={r.uri}
                        id={optionId}
                        role="option"
                        aria-selected={idx === selectedIndex}
                        ref={(node) => {
                            if (node) itemRefs.current[idx] = node;
                        }}
                        className={
                            'px-3 py-2 cursor-pointer flex items-center gap-3 ' +
                            (idx === selectedIndex
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent hover:text-accent-foreground')
                        }
                        onMouseEnter={() => onHoverIndex?.(idx)}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onSelect(r);
                        }}
                    >
                        {(r.mimeType || '').startsWith('image/') && (
                            <ResourceThumbnail resourceState={imageResources[r.uri]} />
                        )}
                        <div className="min-w-0 flex-1 mr-2">
                            <div className="truncate font-medium">
                                {r.name || r.uri.split('/').pop() || r.uri}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{r.uri}</div>
                        </div>
                        {r.serverName && (
                            <span className="ml-auto shrink-0 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                {r.serverName}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

interface ResourceThumbnailProps {
    resourceState?: ResourceState;
}

function ResourceThumbnail({ resourceState }: ResourceThumbnailProps) {
    const baseClasses =
        'w-10 h-10 rounded-md border border-border bg-muted/40 flex items-center justify-center overflow-hidden flex-shrink-0';

    if (!resourceState) {
        return (
            <div className={baseClasses}>
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
        );
    }

    if (resourceState.status === 'loading') {
        return (
            <div className={baseClasses}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (resourceState.status === 'error') {
        return (
            <div className={baseClasses} title={resourceState.error}>
                <ImageIcon className="h-4 w-4 text-destructive" />
            </div>
        );
    }

    const imageItem = resourceState.data?.items.find(
        (item): item is Extract<NormalizedResourceItem, { kind: 'image' }> => item.kind === 'image'
    );

    if (!imageItem || !('src' in imageItem)) {
        return (
            <div className={baseClasses}>
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className={baseClasses}>
            <img
                src={imageItem.src}
                alt={imageItem.alt || 'Resource preview'}
                className="w-full h-full object-cover"
            />
        </div>
    );
}
