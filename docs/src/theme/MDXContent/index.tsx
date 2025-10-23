import React from 'react';
import MDXContent from '@theme-original/MDXContent';
import CopyMarkdown from '../../components/CopyMarkdown';
import { useLocation } from '@docusaurus/router';

export default function MDXContentWrapper(props: React.ComponentProps<typeof MDXContent>) {
  const location = useLocation();
  const isBlogPost = location.pathname.startsWith('/blog/');

  return (
    <div className="mdx-content-wrapper">
      {!isBlogPost && (
        <div className="copy-markdown-header">
          <CopyMarkdown />
        </div>
      )}
      <MDXContent {...props} />
    </div>
  );
}
