'use client';

import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';

interface AgentConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (markers: any[]) => void;
  readOnly?: boolean;
  height?: string;
}

export default function AgentConfigEditor({
  value,
  onChange,
  onValidate,
  readOnly = false,
  height = '100%',
}: AgentConfigEditorProps) {
  const editorRef = useRef<any>(null);

  useEffect(() => {
    // Set up validation when editor is mounted
    if (editorRef.current && onValidate) {
      const model = editorRef.current.getModel();
      if (model) {
        // Note: Validation will be handled by Monaco's YAML language support
        // We can extend this later if needed
      }
    }
  }, [onValidate]);

  const handleEditorDidMount = (editorInstance: any) => {
    editorRef.current = editorInstance;

    // Configure editor options
    editorInstance.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      folding: true,
      automaticLayout: true,
    });
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  return (
    <Editor
      height={height}
      defaultLanguage="yaml"
      value={value}
      onChange={handleEditorChange}
      onMount={handleEditorDidMount}
      theme="vs-dark"
      options={{
        readOnly,
        wordWrap: 'on',
        tabSize: 2,
      }}
    />
  );
}
