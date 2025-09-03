import React from 'react';
import MDXContent from '@theme-original/MDXContent';
import CopyMarkdown from '../../components/CopyMarkdown';

export default function MDXContentWrapper(props: React.ComponentProps<typeof MDXContent>) {
  return (
    <div className="mdx-content-wrapper">
      <div className="copy-markdown-header">
        <CopyMarkdown />
      </div>
      <MDXContent {...props} />
    </div>
  );
}
