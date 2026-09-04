# Parqet MCP Proxy

A local MCP (Model Context Protocol) proxy that bridges AI tools to the [Parqet MCP server](https://mcp.parqet.com). It handles OAuth 2.0 authentication locally, so you can use Parqet's portfolio tools with any MCP client — even those that don't support OAuth natively.

## Why?

The Parqet MCP server uses OAuth 2.0 for authentication, which some MCP clients (like certain local AI tools) don't support. This proxy runs as a local stdio MCP server that:

1. Handles the OAuth 2.0 PKCE flow and token management for you
2. Forwards all tool calls to the remote Parqet MCP server with proper authentication
3. Automatically refreshes expired tokens

## Available Tools

Once connected, your AI agent gets access to all Parqet MCP tools (read-only):

| Tool | Description |
|---|---|
| `parqet_get_user` | Get your user info and portfolio IDs |
| `parqet_list_portfolios` | List all portfolios with names, currencies, and brokers |
| `parqet_get_holdings` | Current positions, market values, and weights |
| `parqet_get_performance` | XIRR, TTWROR, gains, dividends, fees, and taxes |
| `parqet_get_activities` | Transaction history with filtering and pagination |

## Setup

### 1. Create a Parqet Integration

1. Go to the [Parqet Developer Console](https://developer.parqet.com/console)
2. Create a new integration
3. Set the **Redirect URI** to `http://127.0.0.1:18392/callback`
4. Enable the **read portfolio** scope
5. Copy your **Client ID**

### 2. Install

```bash
git clone https://github.com/YOUR_USERNAME/parqet-mcp-tool.git
cd parqet-mcp-tool
npm install
```

### 3. Configure

Create a `.env` file with your Client ID:

```bash
PARQET_CLIENT_ID=your-client-id-here
```

### 4. Authenticate

```bash
npm run auth
```

This opens your browser to authorize the integration. Tokens are saved locally in `credentials/tokens.json`.

### 5. Add to your MCP client

Add the following to your MCP client's configuration:

```json
{
  "mcpServers": {
    "parqet": {
      "command": "node",
      "args": ["/absolute/path/to/parqet-mcp-tool/src/index.js"],
      "env": {
        "PARQET_CLIENT_ID": "your-client-id-here"
      }
    }
  }
}
```

## How It Works

```
┌─────────────┐    stdio     ┌──────────────┐   HTTPS + Bearer   ┌──────────────────┐
│  MCP Client  │ ◄──────────► │  Local Proxy  │ ◄────────────────► │  mcp.parqet.com  │
│  (AI Agent)  │              │  (this tool)  │                    │  (remote MCP)    │
└─────────────┘              └──────────────┘                    └──────────────────┘
```

The proxy sits between your MCP client and Parqet's remote MCP server. It intercepts `listTools` and `callTool` requests, injects a valid Bearer token, and forwards them upstream. Token refresh and retry on auth errors are handled automatically.

## Scripts

| Command | Description |
|---|---|
| `npm run auth` | Run the OAuth flow to authenticate with Parqet |
| `npm start` | Start the MCP proxy server |

## Security

- Tokens are stored locally in `credentials/tokens.json` (gitignored)
- The `.env` file with your Client ID is gitignored
- All Parqet MCP tools are **read-only** — the proxy cannot modify your portfolio
- OAuth uses PKCE (Proof Key for Code Exchange) for security

## License

MIT

