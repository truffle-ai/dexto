"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from "remark-gfm";
import { memo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

// Enhanced markdown component with proper emoji support and spacing
const MarkdownTextImpl = ({ children }: { children: string }) => {
  return (
    <div
      className="prose max-w-none dark:prose-invert [&>p]:mb-4 [&>p]:last:mb-0 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:mb-4 [&>h1]:mt-6 [&>h1]:first:mt-0 [&>h2]:text-lg [&>h2]:font-bold [&>h2]:mb-3 [&>h2]:mt-5 [&>h2]:first:mt-0 [&>h3]:text-base [&>h3]:font-bold [&>h3]:mb-2 [&>h3]:mt-4 [&>h3]:first:mt-0 [&>ul]:mb-4 [&>ul]:ml-6 [&>ul]:list-disc [&>ul]:space-y-1 [&>ol]:mb-4 [&>ol]:ml-6 [&>ol]:list-decimal [&>ol]:space-y-1 [&>li]:leading-relaxed [&>blockquote]:border-l-4 [&>blockquote]:border-muted [&>blockquote]:pl-4 [&>blockquote]:my-4 [&>blockquote]:italic [&>blockquote]:text-muted-foreground [&>hr]:my-6 [&>hr]:border-border [&_p]:[white-space:pre-line] [&_p]:[word-break:keep-all] [&_p]:[overflow-wrap:normal] [&_p]:[hyphens:none] [&_li]:[white-space:pre-line] [&_li]:[word-break:keep-all] [&_li]:[overflow-wrap:normal] [&_li]:[hyphens:none] [&_p]:leading-7 [&_li]:leading-7"
    >
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const [copied, setCopied] = useState(false);
            const text = String(children ?? '').replace(/\n$/, '');
            const isInline = !className;
            
            if (isInline) {
              return (
                <code className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono" {...props}>
                  {children}
                </code>
              );
            }
            
            return (
              <div className="relative group my-4">
                <TooltipIconButton
                  tooltip={copied ? "Copied!" : "Copy code"}
                  onClick={() => {
                    navigator.clipboard.writeText(text).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }).catch(() => {});
                  }}
                  className="absolute right-2 top-2 z-10 opacity-70 hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
                >
                  {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                </TooltipIconButton>
                <pre className="overflow-auto bg-muted p-3 rounded-lg text-sm">
                  <code className={className}>{text}</code>
                </pre>
              </div>
            );
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);
