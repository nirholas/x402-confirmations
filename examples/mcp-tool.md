# Exposing x402-confirmations as an MCP tool for Claude

Wrap the two paid routes with `x402-fetch` inside a tiny MCP server, so Claude can normalize
confirmations and check statuses mid-conversation, paying per call in USDC.

> Ready-made alternative: [x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce)
> is a full MCP server for the whole x402 suite; this page shows the minimal DIY version.

## Minimal MCP server (stdio)

```ts
// mcp-confirmations.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.CONFIRMATIONS_URL || "http://localhost:4037";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

const server = new McpServer({ name: "x402-confirmations", version: "0.1.0" });

server.tool(
  "track_confirmation",
  "Normalize a booking confirmation (JSON or pasted text) into a portable record + ICS calendar invite ($0.005, x402).",
  {
    confirmation: z.record(z.unknown()).optional().describe("Structured confirmation JSON"),
    rawText: z.string().optional().describe("Freeform confirmation text, e.g. a pasted email"),
    type: z.enum(["restaurant", "hotel", "order", "flight", "appointment", "generic"]).optional(),
  },
  async (args) => {
    const res = await payFetch(`${BASE_URL}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "confirmation_status",
  "Get a signed status snapshot for a tracked confirmation ($0.001, x402).",
  { confirmationId: z.string() },
  async ({ confirmationId }) => {
    const res = await payFetch(`${BASE_URL}/status/${confirmationId}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Claude Desktop config

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-confirmations": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-confirmations.ts"],
      "env": {
        "CONFIRMATIONS_URL": "http://localhost:4037",
        "PRIVATE_KEY": "0x…funded Base Sepolia wallet…"
      }
    }
  }
}
```

Discovery for agents that browse: `GET /.well-known/x402` and `GET /skill.md` on the server.
