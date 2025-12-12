import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
    addPromptToAgentConfig,
    removePromptFromAgentConfig,
    updateMcpServerField,
    removeMcpServerFromConfig,
} from './config-manager.js';

const tmpFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'temp-config-test.yml');

beforeEach(async () => {
    try {
        await fs.unlink(tmpFile);
    } catch {
        /* ignore error if file does not exist */
    }
});

afterEach(async () => {
    try {
        await fs.unlink(tmpFile);
    } catch {
        /* ignore error if file does not exist */
    }
});

describe('addPromptToAgentConfig', () => {
    it('adds a file prompt to existing prompts array', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: inline
    id: existing
    prompt: Existing prompt
`;
        await fs.writeFile(tmpFile, yamlContent);

        await addPromptToAgentConfig(tmpFile, {
            type: 'file',
            file: '/path/to/prompts/new-prompt.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('type: file');
        expect(result).toContain('/path/to/prompts/new-prompt.md');
        expect(result).toContain('type: inline'); // Original still there
        expect(result).toContain('id: existing');
    });

    it('adds an inline prompt to existing prompts array', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: file
    file: existing.md
`;
        await fs.writeFile(tmpFile, yamlContent);

        await addPromptToAgentConfig(tmpFile, {
            type: 'inline',
            id: 'new-inline',
            prompt: 'New inline prompt content',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('type: inline');
        expect(result).toContain('id: new-inline');
        expect(result).toContain('prompt: New inline prompt content');
        expect(result).toContain('type: file'); // Original still there
    });

    it('creates prompts array when none exists', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  test:
    type: stdio
    command: echo
`;
        await fs.writeFile(tmpFile, yamlContent);

        await addPromptToAgentConfig(tmpFile, {
            type: 'file',
            file: '/path/to/prompts/first.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('prompts:');
        expect(result).toContain('type: file');
        expect(result).toContain('/path/to/prompts/first.md');
    });

    it('preserves comments and formatting', async () => {
        const yamlContent = `# Main config
llm:
  provider: test
  model: test-model

# Prompts section
prompts:
  - type: inline
    id: existing
    prompt: Test
`;
        await fs.writeFile(tmpFile, yamlContent);

        await addPromptToAgentConfig(tmpFile, {
            type: 'file',
            file: 'new.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('# Main config');
        expect(result).toContain('# Prompts section');
    });
});

describe('removePromptFromAgentConfig', () => {
    it('removes a file prompt by file pattern', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: file
    file: /agent/prompts/to-remove.md
  - type: file
    file: /agent/prompts/keep.md
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'file',
            filePattern: '/prompts/to-remove.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('to-remove.md');
        expect(result).toContain('keep.md');
    });

    it('removes an inline prompt by id', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: inline
    id: to-remove
    prompt: Remove this
  - type: inline
    id: keep-this
    prompt: Keep this
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'inline',
            id: 'to-remove',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('to-remove');
        expect(result).not.toContain('Remove this');
        expect(result).toContain('keep-this');
        expect(result).toContain('Keep this');
    });

    it('removes multi-line file prompt entry', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: file
    file: /agent/prompts/multi-line.md
    showInStarters: true
  - type: inline
    id: keep
    prompt: Keep
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'file',
            filePattern: '/prompts/multi-line.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('multi-line.md');
        expect(result).not.toContain('showInStarters');
        expect(result).toContain('id: keep');
    });

    it('removes multi-line inline prompt entry', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: inline
    id: multi-field
    title: Multi Field Prompt
    description: Has many fields
    prompt: The actual prompt
    category: testing
    priority: 5
  - type: inline
    id: keep
    prompt: Keep
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'inline',
            id: 'multi-field',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('multi-field');
        expect(result).not.toContain('Multi Field Prompt');
        expect(result).not.toContain('Has many fields');
        expect(result).not.toContain('priority: 5');
        expect(result).toContain('id: keep');
    });

    it('does nothing when prompt not found', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: inline
    id: existing
    prompt: Existing
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'inline',
            id: 'nonexistent',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('id: existing');
    });

    it('handles empty prompts array', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts: []
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'inline',
            id: 'nonexistent',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).toContain('prompts: []');
    });

    it('removes file prompt with template variable in path', async () => {
        // Use a raw string to include the template syntax literally
        const yamlContent =
            'llm:\n  provider: test\n  model: test-model\nprompts:\n  - type: file\n    file: ${{dexto.agent_dir}}/prompts/test-prompt.md\n  - type: file\n    file: ${{dexto.agent_dir}}/prompts/keep.md\n';
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'file',
            filePattern: '/prompts/test-prompt.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('test-prompt.md');
        expect(result).toContain('keep.md');
    });
});

describe('updateMcpServerField', () => {
    it('updates existing field value', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  filesystem:
    type: stdio
    command: mcp-server
    enabled: true
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await updateMcpServerField(tmpFile, 'filesystem', 'enabled', false);

        expect(result).toBe(true);
        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).toContain('enabled: false');
    });

    it('adds field when it does not exist', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  filesystem:
    type: stdio
    command: mcp-server
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await updateMcpServerField(tmpFile, 'filesystem', 'enabled', false);

        expect(result).toBe(true);
        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).toContain('enabled: false');
    });

    it('returns false when server not found', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  filesystem:
    type: stdio
    command: mcp-server
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await updateMcpServerField(tmpFile, 'nonexistent', 'enabled', false);

        expect(result).toBe(false);
    });

    it('preserves other servers', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  server1:
    type: stdio
    command: cmd1
  server2:
    type: stdio
    command: cmd2
`;
        await fs.writeFile(tmpFile, yamlContent);

        await updateMcpServerField(tmpFile, 'server1', 'enabled', true);

        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).toContain('server1:');
        expect(content).toContain('server2:');
        expect(content).toContain('command: cmd1');
        expect(content).toContain('command: cmd2');
    });
});

describe('removePromptFromAgentConfig - edge cases', () => {
    it('removes file prompt at end of prompts section followed by comment and other section', async () => {
        // This matches the actual format in default-agent.yml
        const yamlContent = `llm:
  provider: test
  model: test-model
prompts:
  - type: inline
    id: connect-tools
    title: "Connect New Tools"
    prompt: Some prompt
    category: tools
    priority: 3
    showInStarters: true
  - type: file
    file: \${{dexto.agent_dir}}/prompts/test-prompt.md

# Telemetry configuration
telemetry:
  enabled: false
`;
        await fs.writeFile(tmpFile, yamlContent);

        await removePromptFromAgentConfig(tmpFile, {
            type: 'file',
            filePattern: '/prompts/test-prompt.md',
        });

        const result = await fs.readFile(tmpFile, 'utf-8');
        expect(result).not.toContain('test-prompt.md');
        expect(result).toContain('connect-tools'); // Other prompt should remain
        expect(result).toContain('telemetry:'); // Following section should remain
    });
});

describe('removeMcpServerFromConfig', () => {
    it('removes server from config', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  toRemove:
    type: stdio
    command: remove-me
  toKeep:
    type: stdio
    command: keep-me
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await removeMcpServerFromConfig(tmpFile, 'toRemove');

        expect(result).toBe(true);
        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).not.toContain('toRemove');
        expect(content).not.toContain('remove-me');
        expect(content).toContain('toKeep');
        expect(content).toContain('keep-me');
    });

    it('removes multi-line server entry', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  complexServer:
    type: stdio
    command: complex-cmd
    args:
      - arg1
      - arg2
    env:
      KEY: value
    enabled: true
  simpleServer:
    type: stdio
    command: simple
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await removeMcpServerFromConfig(tmpFile, 'complexServer');

        expect(result).toBe(true);
        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).not.toContain('complexServer');
        expect(content).not.toContain('complex-cmd');
        expect(content).not.toContain('arg1');
        expect(content).not.toContain('KEY: value');
        expect(content).toContain('simpleServer');
    });

    it('returns false when server not found', async () => {
        const yamlContent = `llm:
  provider: test
  model: test-model
mcpServers:
  existing:
    type: stdio
    command: cmd
`;
        await fs.writeFile(tmpFile, yamlContent);

        const result = await removeMcpServerFromConfig(tmpFile, 'nonexistent');

        expect(result).toBe(false);
        const content = await fs.readFile(tmpFile, 'utf-8');
        expect(content).toContain('existing');
    });
});
