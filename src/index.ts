#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_BASE =
  process.env.REPUTATION_API_URL ||
  "https://x402-reputation-api-production.up.railway.app";

const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || "";

// ---------------------------------------------------------------------------
// Local Cache — avoids duplicate paid API calls
// ---------------------------------------------------------------------------
class LocalCache<T> {
  private store = new Map<string, { data: T; expiresAt: number }>();

  constructor(private defaultTTLMinutes: number) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMinutes?: number): void {
    const ttl = (ttlMinutes ?? this.defaultTTLMinutes) * 60 * 1000;
    this.store.set(key, { data, expiresAt: Date.now() + ttl });
  }

  get size(): number {
    return this.store.size;
  }
}

const analyzeCache = new LocalCache<unknown>(30);
const compareCache = new LocalCache<unknown>(30);
const monitorCache = new LocalCache<unknown>(10);

// ---------------------------------------------------------------------------
// x402 Fetch Client — auto-pays 402 responses with USDC
// ---------------------------------------------------------------------------
let payFetch: typeof fetch;

if (PRIVATE_KEY) {
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  const signer = toClientEvmSigner({ ...walletClient, address: account.address }, publicClient);
  const client = new x402Client()
    .register("eip155:84532", new ExactEvmScheme(signer));

  payFetch = wrapFetchWithPayment(fetch, client);
  console.error(`💰 x402 payments enabled (wallet: ${account.address})`);
} else {
  payFetch = fetch;
  console.error("⚠️  No EVM_PRIVATE_KEY set — x402 payments disabled, 402 errors expected");
}

// ---------------------------------------------------------------------------
// Helper – call the upstream Reputation API with x402 auto-payment
// ---------------------------------------------------------------------------
async function callAPI(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await payFetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "reputation-intelligence",
  version: "1.1.0",
});

// ---------------------------------------------------------------------------
// Tool 1: analyze_product
// ---------------------------------------------------------------------------
server.registerTool(
  "analyze_product",
  {
    title: "Analyze Product Reputation",
    description:
      "Get a comprehensive reputation report for any product, tool, or service. " +
      "Analyzes community sentiment from Reddit, Hacker News, and YouTube. " +
      "Returns an overall score (0-100), dimensional scores (performance, pricing, " +
      "developer experience, etc.), source breakdown, top posts, and an AI-generated summary.",
    inputSchema: z.object({
      product: z
        .string()
        .describe("Product name to analyze (e.g. 'Supabase', 'Cursor', 'Vercel', 'Stripe')"),
      context: z
        .string()
        .optional()
        .describe("Optional context to disambiguate the product (e.g. 'AI code editor', 'database platform')"),
    }),
  },
  async ({ product, context }) => {
    const cacheKey = `analyze:${product.toLowerCase()}:${context || ""}`;
    const cached = analyzeCache.get(cacheKey);
    if (cached) {
      console.error(`[Cache HIT] analyze: ${product}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }],
      };
    }

    try {
      const body: Record<string, unknown> = { product };
      if (context) body.context = context;
      const data = await callAPI("/analyze", body);
      analyzeCache.set(cacheKey, data);
      console.error(`[Cache SET] analyze: ${product}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 2: compare_products
// ---------------------------------------------------------------------------
server.registerTool(
  "compare_products",
  {
    title: "Compare Product Reputations",
    description:
      "Head-to-head comparison of 2-5 products based on community sentiment. " +
      "Returns scores, strengths, weaknesses, and a recommendation for each product. " +
      "Great for helping users decide between competing tools or services.",
    inputSchema: z.object({
      products: z
        .array(z.string())
        .min(2)
        .max(5)
        .describe("Array of 2-5 product names to compare (e.g. ['Supabase', 'Firebase', 'PlanetScale'])"),
    }),
  },
  async ({ products }) => {
    const cacheKey = `compare:${products.map(p => p.toLowerCase()).sort().join(",")}`;
    const cached = compareCache.get(cacheKey);
    if (cached) {
      console.error(`[Cache HIT] compare: ${products.join(", ")}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }],
      };
    }

    try {
      const data = await callAPI("/compare", { products });
      compareCache.set(cacheKey, data);
      console.error(`[Cache SET] compare: ${products.join(", ")}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 3: monitor_sentiment
// ---------------------------------------------------------------------------
server.registerTool(
  "monitor_sentiment",
  {
    title: "Monitor Product Sentiment",
    description:
      "Quick 7-day sentiment pulse for a product. Returns recent mention count, " +
      "average community score, top posts, and a quick AI analysis of current sentiment. " +
      "Lighter and faster than a full analysis — ideal for quick checks.",
    inputSchema: z.object({
      product: z
        .string()
        .describe("Product name to monitor (e.g. 'ChatGPT', 'Notion', 'Linear')"),
    }),
  },
  async ({ product }) => {
    const cacheKey = `monitor:${product.toLowerCase()}`;
    const cached = monitorCache.get(cacheKey);
    if (cached) {
      console.error(`[Cache HIT] monitor: ${product}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }],
      };
    }

    try {
      const data = await callAPI("/monitor", { product });
      monitorCache.set(cacheKey, data);
      console.error(`[Cache SET] monitor: ${product}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("🔍 Reputation Intelligence MCP server running on stdio");
console.error(`📦 Cache TTL: analyze=30min, compare=30min, monitor=10min`);
