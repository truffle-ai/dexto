import React, { useState, useCallback, useRef, useEffect } from 'react';

interface CopyMarkdownProps {
  className?: string;
}

export default function CopyMarkdown({ className }: CopyMarkdownProps) {
  const [copied, setCopied] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const extractMarkdownFromPage = useCallback((): string => {
    // Get the main content area
    const article = document.querySelector('article[role="main"]') || 
                   document.querySelector('main.docMainContainer') ||
                   document.querySelector('.markdown');
    
    if (!article) {
      return 'Unable to extract content';
    }

    // Clone the article to avoid modifying the original
    const clone = article.cloneNode(true) as HTMLElement;
    
    // Remove elements that shouldn't be in markdown
    const elementsToRemove = [
      '.theme-edit-this-page',
      '.theme-last-updated',
      '.pagination-nav',
      '.theme-doc-breadcrumbs',
      '.copy-markdown-button',
      'nav',
      '.theme-doc-toc-mobile',
      '.theme-doc-toc-desktop'
    ];
    
    elementsToRemove.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    return convertHtmlToMarkdown(clone);
  }, []);

  const convertHtmlToMarkdown = (element: HTMLElement): string => {
    let markdown = '';
    
    const processNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }
      
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(processNode).join('');
      
      switch (tagName) {
        case 'h1':
          return `# ${children}\n\n`;
        case 'h2':
          return `## ${children}\n\n`;
        case 'h3':
          return `### ${children}\n\n`;
        case 'h4':
          return `#### ${children}\n\n`;
        case 'h5':
          return `##### ${children}\n\n`;
        case 'h6':
          return `###### ${children}\n\n`;
        case 'p':
          return `${children}\n\n`;
        case 'strong':
        case 'b':
          return `**${children}**`;
        case 'em':
        case 'i':
          return `*${children}*`;
        case 'code':
          // Check if it's inline code (not in a pre block)
          if (el.parentElement?.tagName.toLowerCase() !== 'pre') {
            return `\`${children}\``;
          }
          return children;
        case 'pre': {
          // Try to get the language from class
          const codeEl = el.querySelector('code');
          const className = codeEl?.className || '';
          const languageMatch = className.match(/language-(\w+)/);
          const language = languageMatch ? languageMatch[1] : '';
          return `\`\`\`${language}\n${children}\n\`\`\`\n\n`;
        }
        case 'a': {
          const href = el.getAttribute('href') || '';
          return `[${children}](${href})`;
        }
        case 'ul':
          return `${children}\n`;
        case 'ol':
          return `${children}\n`;
        case 'li': {
          // Check if parent is ol or ul
          const parent = el.parentElement;
          if (parent?.tagName.toLowerCase() === 'ol') {
            // For ordered lists, we'll use 1. for simplicity
            return `1. ${children}\n`;
          } else {
            return `- ${children}\n`;
          }
        }
        case 'blockquote':
          return `> ${children}\n\n`;
        case 'hr':
          return `---\n\n`;
        case 'br':
          return '\n';
        case 'img': {
          const src = el.getAttribute('src') || '';
          const alt = el.getAttribute('alt') || '';
          return `![${alt}](${src})`;
        }
        case 'table':
          return convertTable(el) + '\n\n';
        case 'div':
          // Handle admonitions and other special divs
          if (el.className.includes('admonition')) {
            return handleAdmonition(el);
          }
          return children;
        case 'details': {
          const summary = el.querySelector('summary');
          const summaryText = summary ? summary.textContent : 'Details';
          return `<details>\n<summary>${summaryText}</summary>\n\n${children}\n</details>\n\n`;
        }
        case 'summary':
          return ''; // Handled in details
        default:
          return children;
      }
    };

    return processNode(element).trim();
  };

  const convertTable = (table: HTMLElement): string => {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';

    let markdown = '';
    
    rows.forEach((row, index) => {
      const cells = row.querySelectorAll('td, th');
      const rowData = Array.from(cells).map(cell => cell.textContent?.trim() || '').join(' | ');
      markdown += `| ${rowData} |\n`;
      
      // Add header separator after first row if it contains th elements
      if (index === 0 && row.querySelector('th')) {
        const separator = Array.from(cells).map(() => '---').join(' | ');
        markdown += `| ${separator} |\n`;
      }
    });
    
    return markdown;
  };

  const handleAdmonition = (el: HTMLElement): string => {
    const type = el.className.match(/admonition-(\w+)/)?.[1] || 'note';
    const title = el.querySelector('.admonition-heading')?.textContent || type;
    const content = el.querySelector('.admonition-content')?.textContent || '';
    
    return `:::${type}[${title}]\n${content}\n:::\n\n`;
  };

  const handleCopy = async () => {
    try {
      const markdown = extractMarkdownFromPage();
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error in handleCopy (clipboard API): ${message}`);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = extractMarkdownFromPage();
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        const fbMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error(`Error in handleCopy (fallback copy): ${fbMessage}`);
      }
      document.body.removeChild(textarea);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleViewMarkdown = () => {
    const currentUrl = window.location.pathname;
    const markdownUrl = currentUrl + '.md';
    window.open(markdownUrl, '_blank');
    setIsDropdownOpen(false);
  };

  const handleCopyMarkdown = async () => {
    await handleCopy();
    setIsDropdownOpen(false);
  };

  return (
    <div className={`copy-markdown-container ${className || ''}`} ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* Main Copy Button */}
        <button
          onClick={handleCopyMarkdown}
          className="copy-markdown-button"
          title="Copy page as Markdown"
          style={{
            background: 'var(--ifm-background-surface-color)',
            border: '1px solid var(--ifm-color-emphasis-500)',
            borderRadius: '6px 0 0 6px',
            padding: '6px 10px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--ifm-color-content-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s ease',
            minWidth: '80px',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            opacity: 0.8,
            borderRight: 'none',
            height: '32px' // Smaller height
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--ifm-color-emphasis-200)';
            e.currentTarget.style.borderColor = 'var(--ifm-color-emphasis-400)';
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--ifm-color-content)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--ifm-background-surface-color)';
            e.currentTarget.style.borderColor = 'var(--ifm-color-emphasis-500)';
            e.currentTarget.style.opacity = '0.8';
            e.currentTarget.style.color = 'var(--ifm-color-content-secondary)';
          }}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20,6 9,17 4,12"></polyline>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5,15 L5,5 A2,2 0 0,1 7,3 L17,3"></path>
              </svg>
              Copy page
            </>
          )}
        </button>

        {/* Dropdown Toggle Button */}
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="copy-markdown-dropdown-toggle"
          title="More options"
          style={{
            background: 'var(--ifm-background-surface-color)',
            border: '1px solid var(--ifm-color-emphasis-500)',
            borderRadius: '0 6px 6px 0',
            padding: '6px 8px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--ifm-color-content-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            opacity: 0.8,
            borderLeft: 'none',
            height: '32px', // Match the main button height
            minWidth: '28px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--ifm-color-emphasis-200)';
            e.currentTarget.style.borderColor = 'var(--ifm-color-emphasis-400)';
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--ifm-color-content)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--ifm-background-surface-color)';
            e.currentTarget.style.borderColor = 'var(--ifm-color-emphasis-500)';
            e.currentTarget.style.opacity = '0.8';
            e.currentTarget.style.color = 'var(--ifm-color-content-secondary)';
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6,9 12,15 18,9"></polyline>
          </svg>
        </button>
      </div>

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'var(--ifm-background-surface-color)',
            border: '1px solid var(--ifm-color-emphasis-500)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            minWidth: '200px',
            overflow: 'hidden'
          }}
        >
          <button
            onClick={handleCopyMarkdown}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              color: 'var(--ifm-color-content-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--ifm-color-emphasis-100)';
              e.currentTarget.style.color = 'var(--ifm-color-content)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--ifm-color-content-secondary)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5,15 L5,5 A2,2 0 0,1 7,3 L17,3"></path>
            </svg>
            Copy as Markdown
          </button>

          <button
            onClick={handleViewMarkdown}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              color: 'var(--ifm-color-content-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--ifm-color-emphasis-100)';
              e.currentTarget.style.color = 'var(--ifm-color-content)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--ifm-color-content-secondary)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14,2 14,8 20,8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10,9 9,9 8,9"></polyline>
            </svg>
            View as Markdown
          </button>
        </div>
      )}
    </div>
  );
}