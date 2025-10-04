'use client';

import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';

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
  const monacoRef = useRef<any>(null);

  useEffect(() => {
    // Set up validation when editor is mounted
    if (editorRef.current && onValidate) {
      const model = editorRef.current.getModel();
      if (model) {
        // Monaco YAML provides enhanced validation
        // Additional custom validation can be added here if needed
      }
    }
  }, [onValidate]);

  const handleEditorWillMount = (monaco: any) => {
    monacoRef.current = monaco;

    // Configure YAML language support with enhanced validation
    configureMonacoYaml(monaco, {
      enableSchemaRequest: false, // We'll validate against our own schema on the server
      hover: true,
      completion: true,
      validate: true,
      format: true,
      schemas: [],
    });
  };

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
      beforeMount={handleEditorWillMount}
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
