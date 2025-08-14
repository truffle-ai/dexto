import React, { useState, useCallback } from 'react';
import { useLocation } from '@docusaurus/router';

interface CopyMarkdownProps {
  className?: string;
}

export default function CopyMarkdown({ className }: CopyMarkdownProps) {
  const [copied, setCopied] = useState(false);
  const location = useLocation();

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
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = extractMarkdownFromPage();
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textarea);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`copy-markdown-button ${className || ''}`}
      title="Copy page as Markdown"
      style={{
        background: 'var(--ifm-background-surface-color)',
        border: '1px solid var(--ifm-color-emphasis-500)',
        borderRadius: '8px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--ifm-color-content-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s ease',
        minWidth: '130px',
        justifyContent: 'center',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        opacity: 0.8
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20,6 9,17 4,12"></polyline>
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5,15 L5,5 A2,2 0 0,1 7,3 L17,3"></path>
          </svg>
          Copy as Markdown
        </>
      )}
    </button>
  );
}