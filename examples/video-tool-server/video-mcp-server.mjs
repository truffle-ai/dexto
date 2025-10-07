#!/usr/bin/env node
// @ts-check

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SAMPLE_VIDEOS = {
  mp4: {
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    mimeType: 'video/mp4',
    filename: 'sample-flower.mp4',
    description: 'A short MP4 clip of flowers waving in the wind (CC0).'
  },
  webm: {
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
    mimeType: 'video/webm',
    filename: 'sample-flower.webm',
    description: 'A short WebM clip of flowers waving in the wind (CC0).'
  }
};

const server = new McpServer({
  name: 'video-demo-server',
  version: '1.0.0'
});

/**
 * @typedef {Object} ToolInput
 * @property {'mp4' | 'webm'} [format]
 */

server.registerTool(
  'get_sample_video',
  {
    description: 'Return a sample CC0-licensed video clip for testing video rendering in Dexto.',
    inputSchema: {
      format: z
        .enum(['mp4', 'webm'])
        .describe('Preferred container format for the sample video (mp4 or webm).')
        .optional()
    }
  },
  async (args = /** @type {ToolInput} */ ({})) => {
    const format = args.format === 'webm' ? 'webm' : 'mp4';
    const sample = SAMPLE_VIDEOS[format];

    console.error(`[video-demo-server] Returning ${format.toUpperCase()} sample video`);

    return {
      content: [
        {
          type: 'text',
          text: `Here is a ${sample.mimeType} sample video clip you can use to verify video rendering.`
        },
        {
          type: 'resource_link',
          uri: sample.url,
          mimeType: sample.mimeType,
          mediaType: sample.mimeType,
          name: sample.filename,
          title: sample.description
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[video-demo-server] MCP server is ready for connections');
