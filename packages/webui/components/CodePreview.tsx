/**
 * CodePreview Component
 *
 * Displays code with syntax highlighting using highlight.js.
 * Supports expandable view and full-screen Monaco editor modal.
 */

import { useState, useEffect, useMemo } from 'react';
import { FileText, Maximize2, Copy, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/github-dark.css';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);

// Language detection from file extension
function getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        json: 'json',
        yml: 'yaml',
        yaml: 'yaml',
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash',
        md: 'markdown',
        css: 'css',
        scss: 'css',
        html: 'html',
        xml: 'xml',
        go: 'go',
        rs: 'rust',
        sql: 'sql',
    };
    return langMap[ext] || 'plaintext';
}

export interface CodePreviewProps {
    /** The code content to display */
    content: string;
    /** File path (used for language detection and display) */
    filePath?: string;
    /** Override language for syntax highlighting */
    language?: string;
    /** Maximum lines to show before truncation (default: 10) */
    maxLines?: number;
    /** Show line numbers (default: true) */
    showLineNumbers?: boolean;
    /** Maximum height in pixels (default: 200) */
    maxHeight?: number;
    /** Custom title (overrides file path) */
    title?: string;
    /** Show file icon (default: true) */
    showIcon?: boolean;
    /** Show the header with file path (default: true) */
    showHeader?: boolean;
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
    const [expanded, setExpanded] = useState(false);
    const [showFullScreen, setShowFullScreen] = useState(false);
    const [copied, setCopied] = useState(false);

    const language = overrideLanguage || (filePath ? getLanguageFromPath(filePath) : 'plaintext');
    const lines = content.split('\n');
    const totalLines = lines.length;
    const needsTruncation = totalLines > maxLines;
    const displayLines = expanded ? lines : lines.slice(0, maxLines);

    // Highlight the code
    const highlightedCode = useMemo(() => {
        try {
            if (language !== 'plaintext' && hljs.getLanguage(language)) {
                return hljs.highlight(displayLines.join('\n'), { language }).value;
            }
        } catch {
            // Fall through to plain text
        }
        return displayLines
            .map((line) => line.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            .join('\n');
    }, [displayLines, language]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const displayTitle = title || (filePath ? (filePath.split('/').pop() ?? 'Code') : 'Code');

    return (
        <>
            <div className="bg-zinc-900 rounded-md overflow-hidden border border-zinc-800">
                {/* Header */}
                {showHeader && (
                    <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/50 border-b border-zinc-700/50">
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 truncate">
                            {showIcon && <FileText className="h-3 w-3 flex-shrink-0" />}
                            <span className="truncate font-mono">{displayTitle}</span>
                            <span className="text-zinc-500">({totalLines} lines)</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleCopy}
                                className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
                                title="Copy code"
                            >
                                {copied ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                    <Copy className="h-3 w-3" />
                                )}
                            </button>
                            <button
                                onClick={() => setShowFullScreen(true)}
                                className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
                                title="Open in full screen"
                            >
                                <Maximize2 className="h-3 w-3" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Code content */}
                <div
                    className="overflow-auto"
                    style={{ maxHeight: expanded ? undefined : maxHeight }}
                >
                    <pre className="p-2 text-[11px] leading-relaxed">
                        <code
                            className={cn('hljs', showLineNumbers && 'flex')}
                            dangerouslySetInnerHTML={{
                                __html: showLineNumbers
                                    ? displayLines
                                          .map(
                                              (_, i) =>
                                                  `<span class="select-none text-zinc-600 pr-3 text-right inline-block w-8">${i + 1}</span>`
                                          )
                                          .join('\n') +
                                      '</code><code class="hljs flex-1">' +
                                      highlightedCode
                                    : highlightedCode,
                            }}
                        />
                    </pre>
                </div>

                {/* Expand/collapse button */}
                {needsTruncation && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="w-full py-1 text-[10px] text-blue-400 bg-zinc-800/50 border-t border-zinc-700/50 hover:bg-zinc-800 flex items-center justify-center gap-1"
                    >
                        {expanded ? (
                            <>
                                <ChevronDown className="h-3 w-3" />
                                Show less
                            </>
                        ) : (
                            <>
                                <ChevronRight className="h-3 w-3" />
                                Show {totalLines - maxLines} more lines
                            </>
                        )}
                    </button>
                )}
            </div>

            {/* Full screen modal with Monaco */}
            {showFullScreen && (
                <FullScreenCodeModal
                    content={content}
                    language={language}
                    title={displayTitle}
                    onClose={() => setShowFullScreen(false)}
                />
            )}
        </>
    );
}

interface FullScreenCodeModalProps {
    content: string;
    language: string;
    title: string;
    onClose: () => void;
}

function FullScreenCodeModal({ content, language, title, onClose }: FullScreenCodeModalProps) {
    const [Editor, setEditor] = useState<typeof import('@monaco-editor/react').default | null>(
        null
    );

    useEffect(() => {
        // Dynamic import Monaco editor
        import('@monaco-editor/react').then((mod) => {
            setEditor(() => mod.default);
        });
    }, []);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    // Map our language names to Monaco language IDs
    const monacoLanguage =
        {
            javascript: 'javascript',
            typescript: 'typescript',
            python: 'python',
            json: 'json',
            yaml: 'yaml',
            bash: 'shell',
            markdown: 'markdown',
            css: 'css',
            html: 'html',
            xml: 'xml',
            go: 'go',
            rust: 'rust',
            sql: 'sql',
        }[language] || 'plaintext';

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 rounded-lg w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden border border-zinc-700"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
                    <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <FileText className="h-4 w-4" />
                        <span className="font-mono">{title}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Editor */}
                <div className="flex-1">
                    {Editor ? (
                        <Editor
                            height="100%"
                            language={monacoLanguage}
                            value={content}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 13,
                                lineNumbers: 'on',
                                scrollBeyondLastLine: false,
                                wordWrap: 'on',
                                automaticLayout: true,
                            }}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-zinc-500">
                            Loading editor...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
