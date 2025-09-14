"use client";

import React from 'react';
import type { ResourceMetadata } from './types/resources.js';

interface ResourceAutocompleteProps {
  resources: ResourceMetadata[];
  query: string;
  selectedIndex: number;
  onSelect: (resource: ResourceMetadata) => void;
  onHoverIndex?: (index: number) => void;
  loading?: boolean;
}

export default function ResourceAutocomplete({ resources, query, selectedIndex, onSelect, onHoverIndex, loading }: ResourceAutocompleteProps) {
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase();
    return resources.filter((r) =>
      (r.name || '').toLowerCase().includes(q) || r.uri.toLowerCase().includes(q) || (r.serverName || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [resources, query]);

  const itemRefs = React.useRef<HTMLLIElement[]>([]);
  React.useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filtered.length]);

  if (!query && filtered.length === 0 && !loading) return null;

  return loading ? (
    <div className="px-3 py-2 text-sm text-muted-foreground">Loading resources…</div>
  ) : filtered.length === 0 ? (
    <div className="px-3 py-2 text-sm text-muted-foreground">No resources match "{query}"</div>
  ) : (
    <ul className="py-1 text-sm max-h-64 overflow-y-auto">
      {filtered.map((r, idx) => (
        <li
          key={r.uri}
          ref={(node) => { if (node) itemRefs.current[idx] = node; }}
          className={
            'px-3 py-2 cursor-pointer flex items-center justify-between ' +
            (idx === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground')
          }
          onMouseEnter={() => onHoverIndex?.(idx)}
          onMouseDown={(e) => { e.preventDefault(); onSelect(r); }}
        >
          <div className="min-w-0 mr-2">
            <div className="truncate font-medium">{r.name || r.uri.split('/').pop() || r.uri}</div>
            <div className="truncate text-xs text-muted-foreground">{r.uri}</div>
          </div>
          {r.serverName && (
            <span className="ml-2 shrink-0 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{r.serverName}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
