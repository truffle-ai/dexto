#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, relative } from 'path';

const MAX_CODE_SNIPPET = 4000;

class CodeReviewServer {
  constructor() {
    this.server = new Server(
      {
        name: 'code-review-assistant',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.roots = [];
    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'setup_project_access',
            description: 'Request filesystem roots and set up project access',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'list_project_files',
            description: 'List code files in the project roots',
            inputSchema: {
              type: 'object',
              properties: {
                extension: {
                  type: 'string',
                  description: 'File extension to filter by (e.g., .js, .ts, .py)',
                },
                max_files: {
                  type: 'number',
                  description: 'Maximum number of files to return',
                  default: 20,
                },
              },
            },
          },
          {
            name: 'review_code_file',
            description: 'Analyze a code file and provide detailed review feedback using AI',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the code file to review (relative to project root)',
                },
                focus_areas: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Areas to focus on (e.g., security, performance, readability)',
                  default: ['code_quality', 'best_practices'],
                },
              },
              required: ['file_path'],
            },
          },
          {
            name: 'suggest_improvements',
            description: 'Get specific improvement suggestions for code using AI analysis',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the code file',
                },
                improvement_type: {
                  type: 'string',
                  enum: ['performance', 'security', 'readability', 'maintainability', 'all'],
                  default: 'all',
                  description: 'Type of improvements to focus on',
                },
              },
              required: ['file_path'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'setup_project_access':
            return await this.setupProjectAccess();

          case 'list_project_files':
            return await this.listProjectFiles(args.extension, args.max_files);

          case 'review_code_file':
            return await this.reviewCodeFile(args.file_path, args.focus_areas);

          case 'suggest_improvements':
            return await this.suggestImprovements(args.file_path, args.improvement_type);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async setupProjectAccess() {
    try {
      // Request roots from the client
      const rootsResponse = await this.server.listRoots({});

      this.roots = rootsResponse.roots || [];
      
      console.error(`📁 Received ${this.roots.length} filesystem roots from client:`);
      this.roots.forEach(root => {
        console.error(`  - ${root.name || 'Unnamed'}: ${root.uri}`);
      });

      return {
        content: [
          {
            type: 'text',
            text: `✅ Project access configured!\n\n**Available Roots:**\n${this.roots.map(root => `• ${root.name || 'Unnamed'}: \`${root.uri}\``).join('\n')}\n\nYou can now use other tools to browse and analyze files in these directories.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to set up project access: ${error.message}\n\nThis may indicate that the client doesn't support MCP roots, or roots haven't been configured.`,
          },
        ],
      };
    }
  }

  async listProjectFiles(extension = '', maxFiles = 20) {
    if (this.roots.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '⚠️ No project roots available. Run `setup_project_access` first to configure filesystem access.',
          },
        ],
      };
    }

    const files = [];
    
    for (const root of this.roots) {
      try {
        // Convert file:// URI to local path
        const rootPath = root.uri.replace('file://', '');
        await this.walkDirectory(rootPath, files, extension, rootPath, maxFiles);
        
        if (files.length >= maxFiles) break;
      } catch (error) {
        console.error(`Error scanning root ${root.uri}:`, error.message);
      }
    }

    // Sort files and limit to maxFiles
    files.sort();
    const limitedFiles = files.slice(0, maxFiles);
    const truncated = files.length > maxFiles;

    const filterText = extension ? ` (${extension} files)` : '';
    const truncatedText = truncated ? `\n\n_Showing first ${maxFiles} files of ${files.length} total._` : '';

    return {
      content: [
        {
          type: 'text',
          text: limitedFiles.length > 0 
            ? `📁 **Found ${limitedFiles.length} files${filterText}:**\n\n${limitedFiles.map(f => `• \`${f}\``).join('\n')}${truncatedText}`
            : `No files found${filterText} in project roots.`,
        },
      ],
    };
  }

  async walkDirectory(dirPath, files, extension, rootPath, maxFiles) {
    if (files.length >= maxFiles) return;

    try {
      const entries = await readdir(dirPath);
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = join(dirPath, entry);
        const stats = await stat(fullPath);
        
        if (stats.isDirectory()) {
          // Skip common ignored directories
          if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.nyc_output', '__pycache__'].includes(entry)) {
            await this.walkDirectory(fullPath, files, extension, rootPath, maxFiles);
          }
        } else if (stats.isFile()) {
          if (!extension || extname(entry) === extension) {
            const relativePath = relative(rootPath, fullPath);
            files.push(relativePath);
          }
        }
      }
    } catch (error) {
      // Skip inaccessible directories
    }
  }

  async reviewCodeFile(filePath, focusAreas = ['code_quality', 'best_practices']) {
    const fullPath = await this.resolveFilePath(filePath);
    const code = await readFile(fullPath, 'utf-8');
    const fileExt = extname(filePath).slice(1) || 'text';
    
    // Create focused analysis prompt
    const focusText = focusAreas.length > 0 
      ? `Focus areas: ${focusAreas.join(', ')}`
      : 'General code review';

    const snippet =
      code.length > MAX_CODE_SNIPPET
        ? `${code.slice(0, MAX_CODE_SNIPPET)}\n... [truncated]`
        : code;

    const analysisPrompt = `Give a concise code review (a few paragraphs) for this ${fileExt} file. Focus on ${focusAreas.join(', ')} and call out the most important issues first.

File: ${filePath}
\`\`\`${fileExt}
${snippet}
\`\`\``;

    try {
      // Send sampling request to client for AI analysis
      const samplingResponse = await this.server.createMessage({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: analysisPrompt,
            },
          },
        ],
        modelPreferences: {
          intelligencePriority: 0.8,
          speedPriority: 0.3,
          costPriority: 0.5,
        },
        systemPrompt: 'You are an expert code reviewer. Provide succinct, actionable feedback.',
        maxTokens: 1200,
        metadata: {
          timeoutMs: 45000,
        },
      });

      const analysisText =
        samplingResponse.content?.type === 'text'
          ? samplingResponse.content.text
          : '[Sampling response not provided as text]';

      return {
        content: [
          {
            type: 'text',
            text: `# 🔍 Code Review: \`${filePath}\`\n\n**Focus:** ${focusAreas.join(', ')}\n\n---\n\n${analysisText}`,
          },
        ],
      };

    } catch (error) {
      // Fallback if sampling not available
      return {
        content: [
          {
            type: 'text',
            text: `# 📄 Code Analysis: \`${filePath}\`\n\n**File Size:** ${code.length} characters\n**Language:** ${fileExt}\n**Focus Areas:** ${focusAreas.join(', ')}\n\n❌ **AI Analysis Unavailable**\n\nSampling request failed: ${error.message}\n\nThis could mean:\n- Sampling capability is not enabled\n- User declined the AI analysis request\n- LLM service is not configured\n\nYou can still manually review the code or check your Dexto configuration.`,
          },
        ],
      };
    }
  }

  async suggestImprovements(filePath, improvementType = 'all') {
    const fullPath = await this.resolveFilePath(filePath);
    const code = await readFile(fullPath, 'utf-8');
    const fileExt = extname(filePath).slice(1) || 'text';

    const improvementPrompts = {
      performance: 'Focus on performance optimizations, algorithmic improvements, and efficiency gains.',
      security: 'Focus on security vulnerabilities, input validation, and secure coding practices.',
      readability: 'Focus on code clarity, naming conventions, and documentation improvements.',
      maintainability: 'Focus on code structure, modularity, and long-term maintainability.',
      all: 'Provide comprehensive improvement suggestions across all areas: performance, security, readability, and maintainability.',
    };

    const focusPrompt = improvementPrompts[improvementType] || improvementPrompts.all;

    const snippet =
      code.length > MAX_CODE_SNIPPET
        ? `${code.slice(0, MAX_CODE_SNIPPET)}\n... [truncated]`
        : code;

    const analysisPrompt = `List the top security improvements for this ${fileExt} file. ${focusPrompt}\n\nGive 3-5 high-impact fixes. For each, briefly explain the issue and a practical remediation.\n\nFile: ${filePath}\n\`\`\`${fileExt}
${snippet}
\`\`\``;

    try {
      // Send sampling request to client for AI analysis
      const samplingResponse = await this.server.createMessage({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: analysisPrompt,
            },
          },
        ],
        modelPreferences: {
          intelligencePriority: 0.9,
          speedPriority: 0.2,
          costPriority: 0.4,
        },
        systemPrompt: 'You are a senior software engineer providing improvement suggestions. Be specific and practical.',
        maxTokens: 1500,
        metadata: {
          timeoutMs: 45000,
        },
      });

      const improvementText =
        samplingResponse.content?.type === 'text'
          ? samplingResponse.content.text
          : '[Sampling response not provided as text]';

      return {
        content: [
          {
            type: 'text',
            text: `# 🔧 Improvement Suggestions: \`${filePath}\`\n\n**Focus:** ${improvementType === 'all' ? 'Comprehensive Analysis' : improvementType}\n\n---\n\n${improvementText}`,
          },
        ],
      };

    } catch (error) {
      // Provide basic static analysis as fallback
      const basicAnalysis = this.performBasicAnalysis(code, fileExt, improvementType);
      
      return {
        content: [
          {
            type: 'text',
            text: `# 🔧 Improvement Suggestions: \`${filePath}\`\n\n**Focus:** ${improvementType}\n\n❌ **AI Analysis Unavailable**\n\nSampling request failed: ${error.message}\n\n---\n\n## Basic Static Analysis\n\n${basicAnalysis}`,
          },
        ],
      };
    }
  }

  performBasicAnalysis(code, fileExt, improvementType) {
    const lines = code.split('\n');
    const analysis = [];

    // Basic metrics
    analysis.push(`**File Metrics:**`);
    analysis.push(`- Lines of code: ${lines.length}`);
    analysis.push(`- File size: ${code.length} characters`);
    analysis.push(`- Language: ${fileExt}`);

    // Basic checks based on improvement type
    if (improvementType === 'readability' || improvementType === 'all') {
      const longLines = lines.filter(line => line.length > 120).length;
      if (longLines > 0) {
        analysis.push(`\n**Readability Issues:**`);
        analysis.push(`- ${longLines} lines exceed 120 characters`);
      }
    }

    if (improvementType === 'security' || improvementType === 'all') {
      const hasEval = code.includes('eval(');
      const hasInnerHTML = code.includes('innerHTML');
      if (hasEval || hasInnerHTML) {
        analysis.push(`\n**Potential Security Concerns:**`);
        if (hasEval) analysis.push(`- Use of eval() detected`);
        if (hasInnerHTML) analysis.push(`- Use of innerHTML detected`);
      }
    }

    analysis.push(`\n*For detailed AI-powered analysis, ensure MCP sampling is properly configured.*`);

    return analysis.join('\n');
  }

  async resolveFilePath(filePath) {
    // Try to find the file in any of the roots
    for (const root of this.roots) {
      const rootPath = root.uri.replace('file://', '');
      const fullPath = join(rootPath, filePath);
      
      try {
        await stat(fullPath);
        return fullPath;
      } catch {
        continue;
      }
    }
    
    throw new Error(`File not found in any project roots: ${filePath}`);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('🚀 Code Review Assistant MCP Server started');
    console.error('🔧 Available tools: setup_project_access, list_project_files, review_code_file, suggest_improvements');
    console.error('📋 Supports: MCP Roots for filesystem access, MCP Sampling for AI analysis');
  }
}

// Start the server
const server = new CodeReviewServer();
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
