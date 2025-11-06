import React, { useState } from 'react';
import { Badge } from './Badge';
import type { Trace } from '../lib/types';

interface TraceTreeProps {
    traces: Trace[];
    onTraceClick?: (trace: Trace) => void;
}

interface TraceNode extends Trace {
    children: TraceNode[];
    level: number;
}

export function TraceTree({ traces, onTraceClick }: TraceTreeProps) {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    // Build trace hierarchy
    const buildTree = (): TraceNode[] => {
        const traceMap = new Map<string, TraceNode>();
        const roots: TraceNode[] = [];

        // First pass: create all nodes
        traces.forEach((trace) => {
            traceMap.set(trace.id, { ...trace, children: [], level: 0 });
        });

        // Second pass: build parent-child relationships
        traces.forEach((trace) => {
            const node = traceMap.get(trace.id)!;

            if (trace.parentSpanId) {
                const parent = traceMap.get(trace.parentSpanId);
                if (parent) {
                    node.level = parent.level + 1;
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            } else {
                roots.push(node);
            }
        });

        // Sort children by start time
        const sortChildren = (node: TraceNode) => {
            node.children.sort((a, b) => a.startTime - b.startTime);
            node.children.forEach(sortChildren);
        };
        roots.forEach(sortChildren);
        roots.sort((a, b) => a.startTime - b.startTime);

        return roots;
    };

    const toggleNode = (nodeId: string) => {
        const newExpanded = new Set(expandedNodes);
        if (newExpanded.has(nodeId)) {
            newExpanded.delete(nodeId);
        } else {
            newExpanded.add(nodeId);
        }
        setExpandedNodes(newExpanded);
    };

    const renderNode = (node: TraceNode): React.ReactNode => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedNodes.has(node.id);
        const indent = node.level * 24;

        const getSpanColor = (name: string) => {
            if (name.startsWith('agent.')) return 'text-blue-600';
            if (name.startsWith('llm.')) return 'text-green-600';
            if (name.startsWith('mcp.tool.')) return 'text-purple-600';
            return 'text-gray-600';
        };

        return (
            <div key={node.id}>
                <div
                    className="flex items-center py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                    style={{ paddingLeft: `${indent + 12}px` }}
                    onClick={() => onTraceClick?.(node)}
                >
                    {hasChildren && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleNode(node.id);
                            }}
                            className="mr-2 text-gray-400 hover:text-gray-600"
                        >
                            {isExpanded ? '▼' : '▶'}
                        </button>
                    )}
                    {!hasChildren && <span className="mr-2 w-4" />}

                    <div className="flex-1 flex items-center justify-between min-w-0">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span
                                className={`text-sm font-medium truncate ${getSpanColor(node.name)}`}
                            >
                                {node.name}
                            </span>
                            {node.toolName && (
                                <Badge variant="info" className="text-xs">
                                    {node.toolName}
                                </Badge>
                            )}
                            {node.provider && (
                                <span className="text-xs text-gray-500 capitalize">
                                    {node.provider}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-4 flex-shrink-0">
                            <span className="text-xs text-gray-500">{node.duration}ms</span>
                            <Badge variant={node.status.code === 0 ? 'success' : 'error'}>
                                {node.status.code === 0 ? 'OK' : 'ERR'}
                            </Badge>
                        </div>
                    </div>
                </div>

                {hasChildren && isExpanded && (
                    <div>{node.children.map((child) => renderNode(child))}</div>
                )}
            </div>
        );
    };

    const tree = buildTree();

    if (tree.length === 0) {
        return <div className="text-center py-12 text-gray-500">No traces found</div>;
    }

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            {tree.map((root) => renderNode(root))}
        </div>
    );
}
