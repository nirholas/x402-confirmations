# For AI agents

## Discovery

Two files tell an agent everything it needs:

- [`skill.md`](https://github.com/nirholas/x402-confirmations/blob/main/skill.md) — the
  capability sheet: endpoints, prices, request/response schemas, payment details. Served live
  at `GET /skill.md`.
- `GET /.well-known/x402` — the machine-readable manifest (`x402Version`, `resources[]` with
  price, **both networks**, asset, `payTo` per rail, and an `outputSchema` per route). This is
  the format indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and
  [agentic.market](https://agentic.market).

## Paying — two rails, one 402

**Pay in USDC on Base or Solana — your client picks the rail.** Every paid route answers an
unpaid request with a single `402` whose `accepts` array carries both:

| rail | network | asset | payTo | signs |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) / `base` | USDC (`0x036C…CF7e` on Sepolia) | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | EIP-3009 `transferWithAuthorization` |
| Solana | `solana` (default) / `solana-devnet` | USDC (`EPjF…TDt1v`) | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | SPL `transferChecked` |

Verification and settlement go to that rail's facilitator (`FACILITATOR_URL` for EVM,
`SOLANA_FACILITATOR_URL` for Solana) — the server never holds a key, and the Solana lane's
sponsor pays the SOL fee, so a paying agent needs only USDC.

Any x402 client works. With `x402-fetch` on the EVM rail:

```ts
import { privateKeyToAccount } from "viem/accounts";
import { selectPaymentRequirements } from "x402/client";
import { wrapFetchWithPayment } from "x402-fetch";

// Pin the selector to the EVM entry — a viem wallet can't sign the Solana one.
const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY),
  undefined, (reqs) => selectPaymentRequirements(reqs, "base-sepolia", "exact"));

const res = await payFetch(`${BASE}/track`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirmation: merchantResponse }),
});
const { record, ics, ownerToken, signature } = await res.json();  // the artifact, in-response
const receipt = res.headers.get("x-payment-response");            // base64 settlement receipt
```

On the Solana rail, pick `accepts.find(a => a.network.startsWith("solana"))`, build and sign
the SPL transfer to its `payTo` using `extra.feePayer` as fee payer, and send the same base64
`X-PAYMENT` envelope. In a browser, `@three-ws/x402-payment-modal` does the whole Solana flow
against this challenge with no wallet code.

The flow is identical on both rails: request → `402` + requirements → client signs a USDC
payment → retry with `X-PAYMENT` → `200` with the artifact in the body and the receipt
(`{rail, network, transaction, payer}`) in `X-PAYMENT-RESPONSE`.

## Protocol version

This service speaks **x402 v1**. The challenge body is
`{ x402Version: 1, error, resource, accepts[] }`, and every `accepts[]` entry carries the
route's invocation contract in `outputSchema` — `input` (HTTP method, path/query params, JSON
body fields) and `output` (JSON Schema of the success body) — so a client can build a correct
call and validate the response straight from the 402 it just received, without fetching the
OpenAPI document first.

x402 **v2** moves those schemas to `extensions.bazaar.schema` and switches to CAIP-2 network
ids. It is a planned future upgrade for [agentcash](https://agentcash.com) compatibility;
switching today would break the `x402-fetch` clients shipped in `examples/`, so v1 remains the
wire format until the ecosystem's clients speak both.

## What you get back

- `POST /track` ($0.005) → **the normalized record, the ICS invite, and the signature**, all in
  the response body. Keep `record.confirmationId` (needed for status polls), `ownerToken`
  (secret — authorizes free updates), and `signature` (HMAC over the canonical record, so a
  third party can verify you did not edit it).
- `GET /status/:id` ($0.001) → **the current snapshot plus the full history**. `temporal` and
  `minutesUntilStart` are precomputed so you don't have to do date math to decide whether to
  remind the user.

Nothing is delivered "later" — every payment produces its artifact in the same response.

## The polling pattern

Status is a moving target, but this service never makes you wait on a webhook. Each
`GET /status/:id` is a **snapshot purchase**: it returns the state as of that instant plus the
history array, so the delta since your last poll is always visible. Poll as often as the
booking matters — hourly a week out, every few minutes on the day — and pay exactly for what
you asked. A cancelled booking shows up as `status: "cancelled"` with the merchant's note in
`history`.

## Chaining with the rest of the suite

This is the normalization layer between the merchants and the agent's memory:

```
x402-tablebook / x402-agent-sandbox / x402-storefront   →  POST /track  →  record + ICS
                                                              ↓
                                                      GET /status/:id  (poll)
```

Feed a merchant's booking response straight into `POST /track` — the suite's own schemas are
recognized without a `type` hint. [x402-agent-sandbox](https://github.com/nirholas/x402-agent-sandbox)
emits the same shapes on testnet, so you can build and test the whole chain before spending
mainnet USDC.

## MCP integration

See [`examples/mcp-tool.md`](https://github.com/nirholas/x402-confirmations/blob/main/examples/mcp-tool.md)
for a minimal MCP server exposing `track_confirmation` and `check_status` to Claude, including
a `claude_desktop_config.json` snippet. For a full commerce toolbox across the whole suite, use
[x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce).

## Listing this service

Operators: to make your deployment discoverable, keep `/.well-known/x402` reachable at your
public origin and submit the URL to x402scan.com, the x402 Bazaar, and agentic.market. The
manifest already carries prices, **both networks**, assets, `payTo` per rail, and output
schemas in their expected shape.

## Contact

**nichxbt@gmail.com**
