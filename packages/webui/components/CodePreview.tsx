/**
 * CodePreview Component
 *
 * Displays code with syntax highlighting, scrollable preview,
 * and option to expand to full-screen Monaco editor.
 */

import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Copy, Check, Maximize2, X, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './hooks/useTheme';
import hljs from 'highlight.js/lib/core';

// Register common languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);

// Lazy load Monaco for full editor view
const Editor = lazy(() => import('@monaco-editor/react'));

interface CodePreviewProps {
    /** Code content to display */
    content: string;
    /** File path for language detection and display */
    filePath?: string;
    /** Override detected language */
    language?: string;
    /** Maximum lines before showing "show more" (default: 10) */
    maxLines?: number;
    /** Whether to show line numbers (default: true) */
    showLineNumbers?: boolean;
    /** Maximum height in pixels for the preview (default: 200) */
    maxHeight?: number;
    /** Optional title/label */
    title?: string;
    /** Show icon before title */
    showIcon?: boolean;
    /** Show header with title/actions (default: true) */
    showHeader?: boolean;
}

// Map file extensions to hljs/monaco languages
const EXT_TO_LANG: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    json: 'json',
    py: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    css: 'css',
    scss: 'css',
    less: 'css',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    mdx: 'markdown',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    toml: 'yaml',
    ini: 'yaml',
    env: 'bash',
    dockerfile: 'bash',
    makefile: 'bash',
};

function getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const filename = filePath.split('/').pop()?.toLowerCase() || '';

    // Check special filenames
    if (filename === 'dockerfile') return 'bash';
    if (filename === 'makefile') return 'bash';
    if (filename.startsWith('.env')) return 'bash';

    return EXT_TO_LANG[ext] || 'plaintext';
}

function getShortPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

/**
 * Escape HTML entities to prevent XSS when using dangerouslySetInnerHTML
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function CodePreview({
    content,
    filePath,
    language: overrideLanguage,
    maxLines = 10,
    showLineNumbers = true,
    maxHeight = 200,
    title,
    showIcon = true,
    showHeader = true,
}: CodePreviewProps) {
    const [showAll, setShowAll] = useState(false);
    const [showFullScreen, setShowFullScreen] = useState(false);
    const [copied, setCopied] = useState(false);
    const { theme } = useTheme();

    const language = overrideLanguage || (filePath ? getLanguageFromPath(filePath) : 'plaintext');
    const lines = content.split('\n');
    const shouldTruncate = lines.length > maxLines && !showAll;
    const displayContent = shouldTruncate ? lines.slice(0, maxLines).join('\n') : content;

    // Apply HTML escaping before syntax highlighting to prevent XSS
    let highlightedContent: string;
    try {
        if (language !== 'plaintext') {
            // Escape HTML entities first, then highlight the escaped content
            const escaped = escapeHtml(displayContent);
            const result = hljs.highlight(escaped, { language, ignoreIllegals: true });
            highlightedContent = result.value;
        } else {
            // Plaintext - escape HTML entities
            highlightedContent = escapeHtml(displayContent);
        }
    } catch {
        // Highlight failed - escape HTML entities for safety
        highlightedContent = escapeHtml(displayContent);
    }

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [content]);

    // Handle escape key to close full screen modal
    useEffect(() => {
        if (!showFullScreen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowFullScreen(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [showFullScreen]);

    const displayTitle = title || (filePath ? getShortPath(filePath) : undefined);

    return (
        <>
            <div className="space-y-1">
                {/* Header */}
                {showHeader && (displayTitle || filePath) && (
                    <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            {showIcon && <FileText className="h-3 w-3" />}
                            <span className="font-mono">{displayTitle}</span>
                            <span className="text-[10px]">{lines.length} lines</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleCopy}
                                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                title="Copy to clipboard"
                                aria-label="Copy code to clipboard"
                            >
                                {copied ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                    <Copy className="h-3 w-3" />
                                )}
                            </button>
                            <button
                                onClick={() => setShowFullScreen(true)}
                                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                title="Open full view"
                                aria-label="Open code in full screen"
                            >
                                <Maximize2 className="h-3 w-3" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Code preview */}
                <div
                    className="bg-zinc-100 dark:bg-zinc-950 rounded overflow-hidden border border-zinc-200 dark:border-zinc-800"
                    style={{ maxHeight: showAll ? undefined : maxHeight }}
                >
                    <div
                        className={cn('overflow-auto', showAll ? 'max-h-[400px]' : '')}
                        style={{ maxHeight: showAll ? 400 : maxHeight - 2 }}
                    >
                        <pre className="p-2 text-[11px] font-mono leading-relaxed">
                            {showLineNumbers ? (
                                <code>
                                    {(showAll ? content : displayContent)
                                        .split('\n')
                                        .map((line, i) => (
                                            <div key={i} className="flex">
                                                <span className="w-8 pr-2 text-right text-zinc-400 dark:text-zinc-600 select-none flex-shrink-0">
                                                    {i + 1}
                                                </span>
                                                <span
                                                    className="text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-all flex-1"
                                                    dangerouslySetInnerHTML={{
                                                        __html: (() => {
                                                            const lineContent = line || ' ';
                                                            // Always escape first to prevent XSS
                                                            const escaped = escapeHtml(lineContent);
                                                            try {
                                                                if (language !== 'plaintext') {
                                                                    return hljs.highlight(escaped, {
                                                                        language,
                                                                        ignoreIllegals: true,
                                                                    }).value;
                                                                }
                                                            } catch {
                                                                // fallback - already escaped above
                                                            }
                                                            return escaped;
                                                        })(),
                                                    }}
                                                />
                                            </div>
                                        ))}
                                </code>
                            ) : (
                                <code
                                    className="text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-all"
                                    dangerouslySetInnerHTML={{ __html: highlightedContent }}
                                />
                            )}
                        </pre>
                    </div>

                    {/* Show more button */}
                    {shouldTruncate && (
                        <button
                            onClick={() => setShowAll(true)}
                            className="w-full py-1 text-[10px] text-blue-600 dark:text-blue-400 bg-zinc-200 dark:bg-zinc-800 border-t border-zinc-300 dark:border-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Show {lines.length - maxLines} more lines...
                        </button>
                    )}
                    {showAll && lines.length > maxLines && (
                        <button
                            onClick={() => setShowAll(false)}
                            className="w-full py-1 text-[10px] text-blue-600 dark:text-blue-400 bg-zinc-200 dark:bg-zinc-800 border-t border-zinc-300 dark:border-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Show less
                        </button>
                    )}
                </div>
            </div>

            {/* Full screen modal with Monaco */}
            {showFullScreen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 dark:bg-black/80 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Code preview"
                >
                    <div className="relative w-[90vw] h-[85vh] bg-white dark:bg-zinc-900 rounded-lg shadow-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-700">
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                            <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                <FileText className="h-4 w-4" />
                                <span className="font-mono">{filePath || 'Code'}</span>
                                <span className="text-zinc-500 dark:text-zinc-500">
                                    ({lines.length} lines)
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                                    aria-label={copied ? 'Code copied' : 'Copy code to clipboard'}
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3.5 w-3.5 text-green-500" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3.5 w-3.5" />
                                            Copy
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => setShowFullScreen(false)}
                                    className="p-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                                    aria-label="Close full screen view"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Monaco editor */}
                        <div className="flex-1">
                            <Suspense
                                fallback={
                                    <div className="flex items-center justify-center h-full text-zinc-500">
                                        Loading editor...
                                    </div>
                                }
                            >
                                <Editor
                                    height="100%"
                                    language={language === 'plaintext' ? undefined : language}
                                    value={content}
                                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                                    options={{
                                        readOnly: true,
                                        minimap: { enabled: true },
                                        scrollBeyondLastLine: false,
                                        fontSize: 13,
                                        lineNumbers: 'on',
                                        renderLineHighlight: 'all',
                                        folding: true,
                                        automaticLayout: true,
                                        wordWrap: 'on',
                                    }}
                                />
                            </Suspense>
                        </div>
                    </div>

                    {/* Click outside to close */}
                    <div
                        className="absolute inset-0 -z-10"
                        onClick={() => setShowFullScreen(false)}
                    />
                </div>
            )}
        </>
    );
}
