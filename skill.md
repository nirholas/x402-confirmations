# x402-confirmations — agent skill

Normalize any booking confirmation into a portable record. Feed it structured JSON from any
merchant (the x402 suite schemas — x402-tablebook, x402-agent-sandbox, x402-storefront — are
understood natively) or freeform text (a pasted confirmation email); get back one canonical
record, an RFC 5545 ICS calendar invite (base64), and an HMAC signature. Then buy signed
status snapshots per query. Every paid call returns its artifact in the 200 body.

**Base URL**: `{BASE_URL}` (self-hosted — e.g. `http://localhost:4021`)

## Endpoints

### POST /track — $0.005 (paid via x402)
Normalize a confirmation.

Request body — either form:
```json
{ "confirmation": { "reservationId": "res_1", "confirmedTime": "2026-08-09T19:00:00Z", "party": 4, "merchant": "The Golden Fork" } }
```
```json
{ "rawText": "Your reservation at Chez Nous is confirmed for Aug 9, 2026 7:00 pm. Confirmation: QX4T9B, party of 4.", "type": "restaurant" }
```
Optional: `type` hint (`restaurant|hotel|order|flight|appointment|generic`), `merchant` override.

Response `201`:
```json
{
  "record": {
    "confirmationId": "cnf_…",
    "type": "restaurant",
    "merchant": "The Golden Fork",
    "reference": "res_1",
    "title": "Table for 4 at The Golden Fork",
    "when": { "start": "2026-08-09T19:00:00.000Z" },
    "party": 4,
    "status": "confirmed",
    "sourceFingerprint": "sha256-of-input",
    "normalizedAt": "2026-08-07T…",
    "extras": { "timeParsed": true }
  },
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "ownerToken": "own_… (secret — authorizes free status updates)",
  "signature": "hmac-sha256 over canonical record"
}
```

### GET /status/:id — $0.001 (paid via x402)
Signed status snapshot for a tracked confirmation.

Response `200`:
```json
{
  "confirmationId": "cnf_…",
  "status": "confirmed",
  "temporal": "upcoming",
  "minutesUntilStart": 2880,
  "when": { "start": "2026-08-09T19:00:00.000Z" },
  "lastUpdated": "2026-08-07T…",
  "history": [{ "at": "2026-08-07T…", "status": "confirmed", "note": "tracked" }],
  "signature": "…"
}
```
`temporal` ∈ `upcoming | imminent (≤2h) | in-progress | past`; `status` ∈ `confirmed | amended | cancelled`.

### Free routes
- `POST /update/:id` `{ownerToken, status, note?}` — push a status change (cancelled/amended); returns the new snapshot.
- `GET /health`.

## Payment

x402 protocol (HTTP 402). **Pay in USDC on Base or Solana — your client picks the rail.**

Every paid route answers an unpaid request with one `402` whose `accepts` array lists both rails:

| rail | network | asset | payTo | facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) or `base` | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (default) or `solana-devnet` | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

Flow: call the route → receive `402` with `accepts` → pick the entry your wallet supports → sign
the USDC payment (EIP-3009 authorization on EVM, SPL `transferChecked` on Solana) → retry with
the base64 `X-PAYMENT` header. The artifact comes back in the `200` body and the settlement
receipt (`{rail, network, transaction, payer}`) in the `X-PAYMENT-RESPONSE` header.

Pay with `x402-fetch` + `viem` (EVM), any x402 Solana client, or `@three-ws/x402-payment-modal`
in a browser.

Contact: **nichxbt@gmail.com**

## Error codes

| HTTP | code | meaning |
|---|---|---|
| 400 | NO_INPUT / BAD_STATUS | missing confirmation/rawText, or invalid status value |
| 401 | BAD_OWNER_TOKEN | update not authorized |
| 402 | (x402) | payment required — pay and retry |
| 404 | NOT_FOUND | unknown confirmation id |

Machine-readable manifest: [`/.well-known/x402`]({BASE_URL}/.well-known/x402)
