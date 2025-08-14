import React from 'react';
import MDXContent from '@theme-original/MDXContent';
import CopyMarkdown from '../../components/CopyMarkdown';

export default function MDXContentWrapper(props: any) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ 
        position: 'absolute', 
        top: '1rem', 
        right: '1rem', 
        zIndex: 10
      }}>
        <CopyMarkdown />
      </div>
      <MDXContent {...props} />
    </div>
  );
}
