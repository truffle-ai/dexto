import { UIResourceRenderer } from '@mcp-ui/client';
import type { UIResourcePart } from '@dexto/core';
import { AlertTriangle } from 'lucide-react';

interface UIResourceRendererWrapperProps {
    resource: UIResourcePart;
    /** Callback when the UI resource triggers an action */
    onAction?: (action: { type: string; payload?: unknown }) => void;
}

/**
 * Wrapper component that adapts Dexto's UIResourcePart to @mcp-ui/client's UIResourceRenderer.
 * Renders interactive MCP-UI resources (HTML, external URLs, Remote DOM) in sandboxed iframes.
 */
export function UIResourceRendererWrapper({ resource, onAction }: UIResourceRendererWrapperProps) {
    // Map UIResourcePart to the format expected by @mcp-ui/client
    // MCP SDK uses discriminated unions - either text OR blob, not both
    // Store metadata in _meta since annotations has a specific schema in MCP SDK
    const mcpResource = resource.blob
        ? {
              type: 'resource' as const,
              resource: {
                  uri: resource.uri,
                  blob: resource.blob,
                  ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
                  _meta: {
                      ...(resource.metadata?.title ? { title: resource.metadata.title } : {}),
                      ...(resource.metadata?.preferredSize
                          ? { preferredSize: resource.metadata.preferredSize }
                          : {}),
                  },
              },
          }
        : {
              type: 'resource' as const,
              resource: {
                  uri: resource.uri,
                  text: resource.content || '',
                  ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
                  _meta: {
                      ...(resource.metadata?.title ? { title: resource.metadata.title } : {}),
                      ...(resource.metadata?.preferredSize
                          ? { preferredSize: resource.metadata.preferredSize }
                          : {}),
                  },
              },
          };

    // Handle UI actions from the rendered component
    const handleUIAction = async (result: { type: string; payload?: unknown }) => {
        if (onAction) {
            onAction(result);
        }
        // Return undefined to acknowledge the action
        return undefined;
    };

    return (
        <div className="ui-resource-container rounded-lg border border-border overflow-hidden">
            {resource.metadata?.title && (
                <div className="px-3 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    {resource.metadata.title}
                </div>
            )}
            <div
                className="ui-resource-content"
                style={{
                    width: resource.metadata?.preferredSize?.width
                        ? `${resource.metadata.preferredSize.width}px`
                        : '100%',
                    height: resource.metadata?.preferredSize?.height
                        ? `${resource.metadata.preferredSize.height}px`
                        : 'auto',
                    minHeight: '100px',
                    maxWidth: '100%',
                }}
            >
                <UIResourceRenderer
                    resource={mcpResource}
                    onUIAction={handleUIAction}
                    htmlProps={{
                        autoResizeIframe: !resource.metadata?.preferredSize?.height,
                        style: {
                            width: '100%',
                            border: 'none',
                        },
                    }}
                />
            </div>
        </div>
    );
}

/**
 * Fallback component shown when UI resource rendering fails or is unsupported.
 */
export function UIResourceFallback({ resource }: { resource: UIResourcePart }) {
    return (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex flex-col gap-1 min-w-0">
                <span className="font-medium text-muted-foreground">Interactive UI Resource</span>
                <span className="text-xs text-muted-foreground/80 break-all">{resource.uri}</span>
                <span className="text-xs text-muted-foreground/60">Type: {resource.mimeType}</span>
                {resource.metadata?.title && (
                    <span className="text-xs text-muted-foreground/60">
                        Title: {resource.metadata.title}
                    </span>
                )}
            </div>
        </div>
    );
}
