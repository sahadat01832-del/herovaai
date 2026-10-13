#!/usr/bin/env node
const { z } = require('zod');
const { closeBrowserContext, generateImage } = require('../services/googleFlowService');

async function main() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({
    name: 'contentbot-google-flow',
    version: '1.0.0',
  });
  let shutdownPromise;
  const shutdown = () => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        await closeBrowserContext();
        await server.close();
      })();
    }
    return shutdownPromise;
  };

  server.tool(
    'google_flow_generate_image',
    'Generate an image with the signed-in Google Flow website. Provide a local reference image path to edit or guide the generated image.',
    {
      prompt: z.string().min(1).max(4000).describe('Image generation prompt.'),
      model: z.string().min(1).max(100).optional().describe('Optional exact model name shown in Google Flow.'),
      aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional().describe('Optional ratio offered by Flow, for example 1:1, 16:9, or 9:16.'),
      referenceImagePath: z.string().min(1).optional().describe('Optional local PNG, JPEG, or WebP path to attach as an editing/reference image.'),
    },
    async (input) => {
      try {
        const result = await generateImage(input);
        return {
          content: [
            {
              type: 'text',
              text: `Image generated successfully and saved to ${result.path}`,
            },
            {
              type: 'image',
              data: result.image,
              mimeType: result.mimeType,
            },
          ],
        };
      } catch (error) {
        console.error(`Google Flow generation failed: ${error.message}`);
        return {
          isError: true,
          content: [{ type: 'text', text: `Google Flow generation failed: ${error.message}` }],
        };
      }
    },
  );

  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => {
    shutdown().catch((error) => {
      console.error(`Google Flow MCP server shutdown failed: ${error.message}`);
      process.exitCode = 1;
    });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown().then(
        () => { process.exitCode = 0; },
        (error) => {
          console.error(`Google Flow MCP server shutdown failed: ${error.message}`);
          process.exitCode = 1;
        },
      );
    });
  }
}

main().catch((error) => {
  console.error(`Google Flow MCP server could not start: ${error.message}`);
  process.exitCode = 1;
});
