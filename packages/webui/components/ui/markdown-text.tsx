'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { TooltipIconButton } from '@/components/ui/tooltip-icon-button';

// Helper functions for media validation (copied from MessageList to avoid circular imports)
function isValidDataUri(src: string, expectedType?: 'image' | 'video' | 'audio'): boolean {
    const typePattern = expectedType ? `${expectedType}/` : '[a-z0-9.+-]+/';
    const dataUriRegex = new RegExp(
        `^data:${typePattern}[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$`,
        'i'
    );
    return dataUriRegex.test(src);
}

function isSafeHttpUrl(src: string): boolean {
    try {
        const url = new URL(src);
        const hostname = url.hostname.toLowerCase();

        // Check protocol
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return false;
        }

        // Block localhost and common local names
        if (hostname === 'localhost' || hostname === '::1') {
            return false;
        }

        // Check for IPv4 addresses
        const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const ipv4Match = hostname.match(ipv4Regex);
        if (ipv4Match) {
            const [, a, b, c, d] = ipv4Match.map(Number);

            // Validate IP range (0-255)
            if (a > 255 || b > 255 || c > 255 || d > 255) {
                return false;
            }

            // Block loopback (127.0.0.0/8)
            if (a === 127) {
                return false;
            }

            // Block private networks (RFC 1918)
            // 10.0.0.0/8
            if (a === 10) {
                return false;
            }

            // 172.16.0.0/12
            if (a === 172 && b >= 16 && b <= 31) {
                return false;
            }

            // 192.168.0.0/16
            if (a === 192 && b === 168) {
                return false;
            }

            // Block link-local (169.254.0.0/16)
            if (a === 169 && b === 254) {
                return false;
            }

            // Block 0.0.0.0
            if (a === 0 && b === 0 && c === 0 && d === 0) {
                return false;
            }
        }

        // Check for IPv6 addresses
        if (hostname.includes(':')) {
            // Block IPv6 loopback
            if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
                return false;
            }

            // Block IPv6 unique-local (fc00::/7)
            if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
                return false;
            }

            // Block IPv6 link-local (fe80::/10)
            if (
                hostname.startsWith('fe8') ||
                hostname.startsWith('fe9') ||
                hostname.startsWith('fea') ||
                hostname.startsWith('feb')
            ) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

function isSafeMediaUrl(src: string, expectedType?: 'image' | 'video' | 'audio'): boolean {
    if (src.startsWith('blob:') || isSafeHttpUrl(src)) return true;
    if (src.startsWith('data:')) {
        return expectedType ? isValidDataUri(src, expectedType) : isValidDataUri(src);
    }
    return false;
}

function isVideoUrl(url: string): boolean {
    // Check for video file extensions
    if (url.match(/\.(mp4|webm|mov|m4v|avi|mkv)(\?.*)?$/i)) {
        return true;
    }
    // Check for video MIME types in URL or common video hosting patterns
    if (url.includes('/video/') || url.includes('video_')) {
        return true;
    }
    return false;
}

function isImageUrl(url: string): boolean {
    // Check for image file extensions
    if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i)) {
        return true;
    }
    // Check for image patterns in URL
    if (url.includes('/image/') || url.includes('image_') || url.includes('/avatar/')) {
        return true;
    }
    return false;
}

function isAudioUrl(url: string): boolean {
    // Check for audio file extensions
    if (url.match(/\.(mp3|wav|ogg|m4a|aac|flac|wma)(\?.*)?$/i)) {
        return true;
    }
    // Check for audio patterns in URL
    if (url.includes('/audio/') || url.includes('audio_')) {
        return true;
    }
    return false;
}

// Auto-linkify plain text URLs
function linkifyText(text: string): React.ReactNode {
    // URL regex that matches http(s) URLs
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
        if (part.match(urlRegex)) {
            // Validate URL safety before rendering as link
            if (!isSafeHttpUrl(part)) {
                return (
                    <span
                        key={index}
                        className="text-muted-foreground underline decoration-dotted"
                        title="Unsafe URL"
                    >
                        {part}
                    </span>
                );
            }
            return (
                <a
                    key={index}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline-offset-2 hover:underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium break-all overflow-wrap-anywhere max-w-full inline"
                    title={part}
                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                >
                    {part}
                </a>
            );
        }
        return part;
    });
}

// Code block component with copy functionality
const CodeBlock = ({
    className,
    children,
    ...props
}: {
    className?: string;
    children?: React.ReactNode;
    [key: string]: any;
}) => {
    const [copied, setCopied] = useState(false);
    const text = String(children ?? '').replace(/\n$/, '');
    const isInline = !className;

    if (isInline) {
        return (
            <code
                className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono break-all overflow-wrap-anywhere"
                {...props}
            >
                {children}
            </code>
        );
    }

    return (
        <div className="relative group my-4 min-w-0 max-w-full">
            <TooltipIconButton
                tooltip={copied ? 'Copied!' : 'Copy code'}
                onClick={() => {
                    navigator.clipboard
                        .writeText(text)
                        .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        })
                        .catch(() => {});
                }}
                className="absolute right-2 top-2 z-10 opacity-70 hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
            >
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            </TooltipIconButton>
            <pre className="overflow-auto bg-muted p-3 rounded-lg text-sm max-w-full">
                <code className={className}>{text}</code>
            </pre>
        </div>
    );
};

// Enhanced markdown component with proper emoji support and spacing
const MarkdownTextImpl = ({ children }: { children: string }) => {
    const blobUrlsRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        // Capture the current ref value for cleanup
        const blobUrls = blobUrlsRef.current;
        return () => {
            // Clean up any created blob URLs on unmount
            blobUrls.forEach((url) => {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // Silently fail if revoke fails
                }
            });
        };
    }, []);

    return (
        <div className="prose max-w-none dark:prose-invert min-w-0 overflow-hidden break-words overflow-wrap-anywhere [&>p]:my-5 [&>p]:leading-7 [&>p]:first:mt-0 [&>p]:last:mb-0 [&>p]:break-words [&>p]:overflow-wrap-anywhere [&>h1]:mb-8 [&>h1]:text-4xl [&>h1]:font-extrabold [&>h1]:tracking-tight [&>h1]:last:mb-0 [&>h1]:break-words [&>h2]:mb-4 [&>h2]:mt-8 [&>h2]:text-3xl [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:first:mt-0 [&>h2]:last:mb-0 [&>h2]:break-words [&>h3]:mb-4 [&>h3]:mt-6 [&>h3]:text-2xl [&>h3]:font-semibold [&>h3]:tracking-tight [&>h3]:first:mt-0 [&>h3]:last:mb-0 [&>h3]:break-words [&>h4]:mb-4 [&>h4]:mt-6 [&>h4]:text-xl [&>h4]:font-semibold [&>h4]:tracking-tight [&>h4]:first:mt-0 [&>h4]:last:mb-0 [&>h4]:break-words [&>ul]:my-5 [&>ul]:ml-6 [&>ul]:list-disc [&>ul>li]:mt-2 [&>ol]:my-5 [&>ol]:ml-6 [&>ol]:list-decimal [&>ol>li]:mt-2 [&_ul]:my-5 [&_ul]:ml-6 [&_ul]:list-disc [&_ul>li]:mt-2 [&_ol]:my-5 [&_ol]:ml-6 [&_ol]:list-decimal [&_ol>li]:mt-2 [&>blockquote]:border-l-2 [&>blockquote]:pl-6 [&>blockquote]:italic [&>blockquote]:break-words [&>hr]:my-5 [&>hr]:border-b">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                skipHtml={true}
                components={{
                    a: ({ href, children, ...props }) => {
                        const url = (href as string | undefined) ?? '';
                        const isHttp = /^https?:\/\//i.test(url);
                        const isAllowed = isHttp; // extend if you want: || url.startsWith('mailto:') || url.startsWith('tel:')
                        if (!isAllowed || !isSafeHttpUrl(url)) {
                            return (
                                <span
                                    className="text-muted-foreground underline decoration-dotted"
                                    {...props}
                                >
                                    {children}
                                </span>
                            );
                        }
                        // Regular link rendering with better overflow handling (no truncation)
                        return (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 underline-offset-2 hover:underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium break-all overflow-wrap-anywhere max-w-full inline"
                                title={url}
                                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },
                    img: ({ src, alt, ...props }) => {
                        if (!src) {
                            return (
                                <span className="text-xs text-muted-foreground">
                                    No media source provided
                                </span>
                            );
                        }

                        // Handle Blob sources - validate and convert to string URL
                        let srcString: string | null = null;

                        if (typeof src === 'string') {
                            srcString = src;
                        } else if ((src as any) instanceof Blob || (src as any) instanceof File) {
                            // Safe to convert Blob or File to object URL
                            try {
                                const objectUrl = URL.createObjectURL(src as Blob | File);
                                srcString = objectUrl;
                                // Track the URL for cleanup
                                blobUrlsRef.current.add(objectUrl);
                            } catch (error) {
                                // URL.createObjectURL failed, treat as invalid
                                srcString = null;
                            }
                        } else if (
                            typeof src === 'object' &&
                            src !== null &&
                            (src as any) instanceof MediaSource
                        ) {
                            // MediaSource objects can also be used with createObjectURL
                            try {
                                const objectUrl = URL.createObjectURL(
                                    src as unknown as MediaSource
                                );
                                srcString = objectUrl;
                                // Track the URL for cleanup
                                blobUrlsRef.current.add(objectUrl);
                            } catch (error) {
                                // URL.createObjectURL failed, treat as invalid
                                srcString = null;
                            }
                        } else {
                            // Invalid or unsafe type - not a string, Blob, File, or MediaSource
                            srcString = null;
                        }

                        // If we couldn't get a valid source string, show error
                        if (!srcString) {
                            return (
                                <span className="text-xs text-muted-foreground">
                                    Invalid or unsafe media source
                                </span>
                            );
                        }

                        // Check if this is a video URL - render video player
                        if (isVideoUrl(srcString) && isSafeMediaUrl(srcString, 'video')) {
                            return (
                                <div className="my-4 max-w-full overflow-hidden">
                                    <video
                                        controls
                                        src={srcString}
                                        className="w-full max-h-[360px] rounded-lg bg-black"
                                        preload="metadata"
                                    >
                                        Your browser does not support the video tag.
                                    </video>
                                    {alt && (
                                        <p className="text-xs text-muted-foreground mt-1">{alt}</p>
                                    )}
                                </div>
                            );
                        }

                        // Check if this is an audio URL - render audio player
                        if (isAudioUrl(srcString) && isSafeMediaUrl(srcString, 'audio')) {
                            return (
                                <div className="my-4 max-w-full overflow-hidden">
                                    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                        <audio
                                            controls
                                            src={srcString}
                                            className="flex-1 min-w-0 h-10"
                                        >
                                            Your browser does not support the audio tag.
                                        </audio>
                                    </div>
                                    {alt && (
                                        <p className="text-xs text-muted-foreground mt-1">{alt}</p>
                                    )}
                                </div>
                            );
                        }

                        // Default to image rendering
                        if (!isSafeMediaUrl(srcString, 'image')) {
                            return (
                                <span className="text-xs text-muted-foreground">
                                    Invalid or unsafe media source
                                </span>
                            );
                        }
                        return (
                            <img
                                src={srcString}
                                alt={alt || 'Image'}
                                className="max-w-full max-h-[500px] object-contain rounded-lg border border-border my-4"
                                loading="lazy"
                                {...props}
                            />
                        );
                    },
                    p: ({ children, ...props }) => {
                        // Auto-linkify plain text URLs in paragraphs
                        if (typeof children === 'string') {
                            return <p {...props}>{linkifyText(children)}</p>;
                        }
                        return <p {...props}>{children}</p>;
                    },
                    table: ({ className, children, ...props }) => (
                        <div className="my-4 overflow-x-auto -mx-1 px-1">
                            <table
                                className={['w-full border-separate border-spacing-0', className]
                                    .filter(Boolean)
                                    .join(' ')}
                                {...props}
                            >
                                {children}
                            </table>
                        </div>
                    ),
                    thead: ({ className, ...props }) => <thead className={className} {...props} />,
                    tr: ({ className, ...props }) => (
                        <tr
                            className={[
                                'm-0 border-b first:border-t',
                                '[&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg',
                                className,
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            {...props}
                        />
                    ),
                    th: ({ className, ...props }) => (
                        <th
                            className={[
                                'bg-muted text-left font-bold align-top',
                                'px-4 py-2 first:rounded-tl-lg last:rounded-tr-lg',
                                '[&[align=center]]:text-center [&[align=right]]:text-right',
                                className,
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            {...props}
                        />
                    ),
                    td: ({ className, ...props }) => (
                        <td
                            className={[
                                'border-b border-l last:border-r text-left align-top',
                                'px-4 py-2 whitespace-normal break-words',
                                '[&[align=center]]:text-center [&[align=right]]:text-right',
                                className,
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            {...props}
                        />
                    ),
                    code: CodeBlock,
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
};

export const MarkdownText = memo(MarkdownTextImpl);
