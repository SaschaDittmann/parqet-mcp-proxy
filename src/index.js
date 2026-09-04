#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getValidAccessToken, authenticate, loadTokens } from './auth.js';

const PARQET_MCP_URL = 'https://mcp.parqet.com';

let remoteClient = null;

async function connectToRemote() {
  const accessToken = await getValidAccessToken();

  const transport = new StreamableHTTPClientTransport(
    new URL(PARQET_MCP_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );

  const client = new Client(
    { name: 'parqet-mcp-proxy', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);
  return client;
}

async function getRemoteClient() {
  if (remoteClient) {
    const tokens = await loadTokens();
    if (tokens && Date.now() > tokens.expires_at - 60_000) {
      try {
        await remoteClient.close();
      } catch {
        // ignore close errors
      }
      remoteClient = null;
    }
  }

  if (!remoteClient) {
    remoteClient = await connectToRemote();
  }
  return remoteClient;
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
      try {
        await remoteClient?.close();
      } catch {
        // ignore
      }
      remoteClient = null;
      return await fn();
    }
    throw err;
  }
}

async function main() {
  const tokens = await loadTokens();
  if (!tokens) {
    console.error('No credentials found. Starting authentication flow...');
    await authenticate();
  }

  const server = new Server(
    { name: 'parqet-mcp-proxy', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const client = await getRemoteClient();
    return await withRetry(() => client.listTools());
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const client = await getRemoteClient();
    return await withRetry(() =>
      client.callTool({
        name: request.params.name,
        arguments: request.params.arguments,
      }),
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Parqet MCP proxy server started');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
