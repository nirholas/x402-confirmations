# x402-confirmations

> Normalize any booking confirmation into a portable record — ICS invite and status snapshots per query.

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![x402](https://img.shields.io/badge/payments-x402-0052ff) ![USDC](https://img.shields.io/badge/asset-USDC-2775CA) ![Rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-9945FF)

**Pay in USDC on Base or Solana — your client picks the rail.**

An agent that books across several merchants ends up holding a pile of incompatible
confirmations: one JSON shape from the restaurant, another from the hotel, and a wall of text
from the airline. This service turns any of them into **one canonical record**, an RFC 5545
**ICS invite** (base64, ready to drop into a calendar), and an **HMAC signature** — then sells
signed status snapshots per query so the agent can poll for cancellations and amendments.

## Why x402 for this

Normalization is a per-item utility, not a relationship: an agent might need it four times in
one session and never again. Metering it behind an API key means signup, a dashboard, and a
minimum commitment for what should cost half a cent. With x402 the agent pays $0.005 per
record and $0.001 per status check over plain HTTP — no account, no key, no subscription — and
the operator is paid per call instead of running a free service.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-confirmations
cd x402-confirmations && npm install
npm run dev                                          # server on :4021, both rails live

# agent side (Base Sepolia USDC — faucet: https://faucet.circle.com)
PRIVATE_KEY=0xAgentWallet npm run client
```

## API

| Route | Price | What you get back |
|---|---|---|
| `POST /track` | **$0.005** | Normalized record + base64 ICS invite + HMAC signature + `ownerToken`. |
| `GET /status/:id` | **$0.001** | Signed status snapshot: `status`, `temporal`, `minutesUntilStart`, full history. |
| `POST /update/:id` | free | Owner (via `ownerToken`) pushes a status change; returns the new snapshot. |
| `GET /health` | free | Liveness. |

Every paid call returns its artifact in the same `200`/`201` body — nothing is delivered later.
Status is a **pay-per-poll snapshot**: each query buys the current state plus its history delta,
so there is no subscription and no webhook to wait on.

Full reference: [docs/api.md](docs/api.md) · [openapi.json](openapi.json)

## How x402 works

1. Call a paid route → `402 Payment Required` with an `accepts` array listing **both rails**:
   USDC on Base (EVM, EIP-3009) and USDC on Solana (SPL `transferChecked`).
2. Your client picks whichever entry its wallet supports and signs that payment.
3. Retry with the base64 `X-PAYMENT` header; the matching facilitator verifies and settles on-chain.
4. `200` — artifact in the body, settlement receipt (`{rail, network, transaction, payer}`) in `X-PAYMENT-RESPONSE`.

| rail | network (default) | mainnet | payTo | facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` | `NETWORK=base` | `PAY_TO_ADDRESS` | `FACILITATOR_URL` (default `https://x402.org/facilitator`) |
| Solana | `solana` | already mainnet; `SOLANA_NETWORK=devnet` for testing | `SOLANA_PAY_TO_ADDRESS` | `SOLANA_FACILITATOR_URL` (default `https://facilitator.payai.network`) |

Both rails ship with the suite's public receive addresses pre-filled in `.env.example`, so
`npm run dev` works with zero configuration. A rail with an invalid address is simply omitted
from `accepts` — the service still runs on the other.

## Real backend / API keys

Fully self-contained: no third-party APIs, no paid keys, nothing fixture-labeled. Normalization
and ICS generation run locally, and state lives in memory (restart clears it — put a volume
behind `data/` if you need durability). The one env that matters is **`SIGNING_SECRET`**, the
HMAC key behind every `signature` field; unset, it falls back to an insecure dev default, so set
it before anyone verifies your signatures for real.

The parser understands the x402 suite's own confirmation schemas natively
([x402-tablebook](https://github.com/nirholas/x402-tablebook),
[x402-agent-sandbox](https://github.com/nirholas/x402-agent-sandbox),
[x402-storefront](https://github.com/nirholas/x402-storefront)) and falls back to a
date/reference/party extractor for freeform text.

## For AI agents

- [`skill.md`](skill.md) — agent-facing capability sheet, served at `GET /skill.md`.
- `GET /.well-known/x402` — machine-readable manifest ([source](public/.well-known/x402)) listing
  both networks per resource, in the format indexed by [x402scan.com](https://x402scan.com), the
  x402 Bazaar, and [agentic.market](https://agentic.market).
- MCP: [`examples/mcp-tool.md`](examples/mcp-tool.md) wraps this as Claude tools
  (`track_confirmation`, `check_status`) with a `claude_desktop_config.json` example. For a full
  commerce toolbox, use [x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce).
- Guide: [docs/agents.md](docs/agents.md).

## Docs

Site: **https://nirholas.github.io/x402-confirmations/** — [tutorial](docs/tutorial.md) · [API](docs/api.md) · [agents](docs/agents.md) · [curl walkthrough](examples/curl.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, bugs, integration help: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
