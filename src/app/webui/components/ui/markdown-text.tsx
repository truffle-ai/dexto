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
      className="prose max-w-none dark:prose-invert [&>p]:my-5 [&>p]:leading-7 [&>p]:first:mt-0 [&>p]:last:mb-0 [&>h1]:mb-8 [&>h1]:text-4xl [&>h1]:font-extrabold [&>h1]:tracking-tight [&>h1]:last:mb-0 [&>h2]:mb-4 [&>h2]:mt-8 [&>h2]:text-3xl [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:first:mt-0 [&>h2]:last:mb-0 [&>h3]:mb-4 [&>h3]:mt-6 [&>h3]:text-2xl [&>h3]:font-semibold [&>h3]:tracking-tight [&>h3]:first:mt-0 [&>h3]:last:mb-0 [&>h4]:mb-4 [&>h4]:mt-6 [&>h4]:text-xl [&>h4]:font-semibold [&>h4]:tracking-tight [&>h4]:first:mt-0 [&>h4]:last:mb-0 [&>ul]:my-5 [&>ul]:ml-6 [&>ul]:list-disc [&>ul>li]:mt-2 [&>ol]:my-5 [&>ol]:ml-6 [&>ol]:list-decimal [&>ol>li]:mt-2 [&_ul]:my-5 [&_ul]:ml-6 [&_ul]:list-disc [&_ul>li]:mt-2 [&_ol]:my-5 [&_ol]:ml-6 [&_ol]:list-decimal [&_ol>li]:mt-2 [&>blockquote]:border-l-2 [&>blockquote]:pl-6 [&>blockquote]:italic [&>hr]:my-5 [&>hr]:border-b"
    >
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        skipHtml={true}
        components={{
          table: ({ className, children, ...props }) => (
            <div className="my-4 overflow-x-auto -mx-1 px-1">
              <table
                className={[
                  "w-full border-separate border-spacing-0",
                  className,
                ].filter(Boolean).join(" ")}
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ className, ...props }) => (
            <thead className={className} {...props} />
          ),
          tr: ({ className, ...props }) => (
            <tr
              className={[
                "m-0 border-b first:border-t",
                "[&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
                className,
              ].filter(Boolean).join(" ")}
              {...props}
            />
          ),
          th: ({ className, ...props }) => (
            <th
              className={[
                "bg-muted text-left font-bold align-top",
                "px-4 py-2 first:rounded-tl-lg last:rounded-tr-lg",
                "[&[align=center]]:text-center [&[align=right]]:text-right",
                className,
              ].filter(Boolean).join(" ")}
              {...props}
            />
          ),
          td: ({ className, ...props }) => (
            <td
              className={[
                "border-b border-l last:border-r text-left align-top",
                "px-4 py-2 whitespace-normal break-words",
                "[&[align=center]]:text-center [&[align=right]]:text-right",
                className,
              ].filter(Boolean).join(" ")}
              {...props}
            />
          ),
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
