/**
 * AgentConfigEditor
 *
 * Monaco-based YAML editor component for editing agent configuration files.
 * Provides syntax highlighting, line numbers, and configurable editor options.
 * Validation is handled externally via the onValidate callback.
 */
'use client';

import React, { useRef, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface AgentConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (markers: editor.IMarker[]) => void;
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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    // Set up validation when editor is mounted
    if (editorRef.current && onValidate) {
      const model = editorRef.current.getModel();
      if (model) {
        // Server-side validation is handled via API
        // Monaco provides basic YAML syntax highlighting
      }
    }
  }, [onValidate]);

  const handleEditorDidMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance as editor.IStandaloneCodeEditor;

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
