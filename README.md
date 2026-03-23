# Reputation Intelligence MCP Server

An MCP (Model Context Protocol) server that gives AI agents access to real-time product reputation intelligence from Reddit, Hacker News, and YouTube.

Built on top of the [x402 Product Reputation API](https://github.com/andichen0420/x402-reputation-api).

## Tools

| Tool | Description |
|------|-------------|
| `analyze_product` | Full reputation report with dimensional scoring (0-100) |
| `compare_products` | Head-to-head comparison of 2-5 products |
| `monitor_sentiment` | Quick 7-day sentiment pulse |

## Quick Start

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reputation": {
      "command": "npx",
      "args": ["tsx", "/path/to/reputation-mcp-server/src/index.ts"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "reputation": {
      "command": "npx",
      "args": ["tsx", "/path/to/reputation-mcp-server/src/index.ts"]
    }
  }
}
```

### Build & Run

```bash
npm install
npm run build
npm start
```

### Development

```bash
npm run dev
```

### Test with MCP Inspector

```bash
npm run inspect
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REPUTATION_API_URL` | `https://x402-reputation-api-production.up.railway.app` | API base URL |
| `REPUTATION_API_KEY` | _(empty)_ | Optional API key for authenticated access |

## Example Usage

Once connected, ask your AI assistant:

- "Analyze the reputation of Supabase"
- "Compare Vercel vs Netlify vs Cloudflare Pages"
- "What's the current sentiment around Cursor IDE?"
- "Should I use Firebase or Supabase for my new project?"

## How It Works

```
User → AI Agent (Claude/ChatGPT) → MCP Server → x402 Reputation API → Reddit + HN + YouTube
                                                                          ↓
                                                                    Claude Sonnet LLM
                                                                          ↓
                                                                 Structured Report ← ← ←
```

## Data Sources

- **Reddit** — Public JSON API, community discussions and reviews
- **Hacker News** — Algolia API, developer-focused commentary
- **YouTube** — Data API v3 + transcript extraction, video reviews

## Links

- [Live API](https://x402-reputation-api-production.up.railway.app/health)
- [x402scan](https://www.x402scan.com/server/8ae848b3-ea71-4b2a-8ea1-fa6bec508ca5)
- [API Source Code](https://github.com/andichen0420/x402-reputation-api)

## License

MIT
