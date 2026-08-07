# API reference

Base URL: your deployment (default `http://localhost:4021`). Paid routes speak x402: an unpaid
request returns `402` with `PaymentRequirements` listing **both** payment rails (USDC on Base
and USDC on Solana); pay either and retry with `X-PAYMENT`.
Full machine-readable spec: [`openapi.json`](https://github.com/nirholas/x402-confirmations/blob/main/openapi.json).

---

## POST /track — $0.005

Normalize a booking confirmation into a portable record, an ICS invite, and a signature.

**Body** — one of two forms.

Structured (the x402 suite schemas from `x402-tablebook`, `x402-agent-sandbox` and
`x402-storefront` are recognized natively, as are generic hotel/order/flight shapes):

```json
{
  "confirmation": {
    "reservationId": "res_1",
    "confirmedTime": "2026-09-01T19:00:00Z",
    "party": 4,
    "merchant": "The Golden Fork"
  }
}
```

Freeform (a pasted confirmation email):

```json
{
  "rawText": "Your reservation at Chez Nous is confirmed for Sep 1, 2026 7:00 pm. Confirmation: QX4T9B, party of 4.",
  "type": "restaurant"
}
```

| Field | Type | Notes |
|---|---|---|
| `confirmation` | object | Merchant confirmation JSON. Required unless `rawText` is given. |
| `rawText` | string | Freeform confirmation text. Required unless `confirmation` is given. |
| `type` | string | Optional hint: `restaurant`, `hotel`, `order`, `flight`, `appointment`, `generic`. Inferred from the payload's field names when omitted. |
| `merchant` | string | Optional override for the detected merchant name. |

**`201` response**

```json
{
  "record": {
    "confirmationId": "cnf_7f3a…",
    "type": "restaurant",
    "merchant": "The Golden Fork",
    "reference": "res_1",
    "title": "Table for 4 at The Golden Fork",
    "when": { "start": "2026-09-01T19:00:00.000Z", "end": "2026-09-01T21:00:00.000Z" },
    "where": "…",
    "party": 4,
    "amount": { "total": "0.00", "currency": "USD" },
    "status": "confirmed",
    "sourceFingerprint": "sha256 of the submitted input",
    "normalizedAt": "2026-08-07T12:00:00.000Z",
    "extras": { "timeParsed": true }
  },
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "ownerToken": "own_…",
  "signature": "hmac-sha256 over the canonical record"
}
```

| Field | Meaning |
|---|---|
| `record` | The canonical shape — identical fields whatever merchant the confirmation came from. `where`, `party` and `amount` are present only when the source supplied them. |
| `ics` | Base64 RFC 5545 `VCALENDAR`. `base64 -d` it straight into a calendar. |
| `ownerToken` | **Secret.** Authorizes the free `POST /update/:id`. Returned once, never again. |
| `signature` | HMAC-SHA256 over the canonical JSON of `record`, keyed by `SIGNING_SECRET`. |

**Errors**: `400 NO_INPUT` (neither `confirmation` nor `rawText`), `402` (payment required).

---

## GET /status/:id — $0.001

Buy the current status snapshot for a tracked confirmation. Each call is its own purchase and
returns the state immediately — a pay-per-poll snapshot, not a subscription.

**`200` response**

```json
{
  "confirmationId": "cnf_7f3a…",
  "status": "confirmed",
  "temporal": "upcoming",
  "minutesUntilStart": 2880,
  "when": { "start": "2026-09-01T19:00:00.000Z" },
  "lastUpdated": "2026-08-07T12:00:00.000Z",
  "history": [
    { "at": "2026-08-07T12:00:00.000Z", "status": "confirmed", "note": "tracked" }
  ],
  "signature": "…"
}
```

| Field | Values |
|---|---|
| `status` | `confirmed` · `amended` · `cancelled` |
| `temporal` | `upcoming` · `imminent` (≤2h out) · `in-progress` · `past` |
| `minutesUntilStart` | Minutes until `when.start`; negative once started, `null` if undated. |
| `history` | Every status transition, oldest first — the delta since your last poll. |
| `signature` | HMAC-SHA256 over the canonical snapshot. |

**Errors**: `402`, `404 NOT_FOUND`.

---

## POST /update/:id — free

Merchants and booking owners push status changes for free. Charging someone to tell you their
booking was cancelled would be perverse.

**Body**

```json
{ "ownerToken": "own_…", "status": "cancelled", "note": "kitchen fire" }
```

| Field | Notes |
|---|---|
| `ownerToken` | The secret from the `POST /track` response. |
| `status` | `confirmed` · `amended` · `cancelled`. |
| `note` | Optional free text, recorded in `history`. |

**`200`** — the new status snapshot, same shape as `GET /status/:id`.

**Errors**: `400 BAD_STATUS`, `401 BAD_OWNER_TOKEN`, `404 NOT_FOUND`.

---

## GET /health — free

`{ ok: true, service: "x402-confirmations", rails: ["base", "solana"] }`.

---

## GET /skill.md, GET /.well-known/x402 — free

The agent-facing capability sheet and the machine-readable discovery manifest.

---

## 402 shape (all paid routes)

Dual-rail: `accepts` always lists **both** USDC on Base and USDC on Solana. Pay either one.

```json
{
  "x402Version": 1,
  "error": "Payment required — pay in USDC on Base or Solana; your client picks the rail.",
  "resource": {
    "url": "http://localhost:4021/track",
    "description": "Normalize a booking confirmation; returns portable record + ICS base64 + signature",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/track",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact", "network": "solana", "maxAmountRequired": "5000", "amount": "5000",
      "resource": "http://localhost:4021/track",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", "name": "USDC", "decimals": 6 }
    }
  ]
}
```

Amounts are atomic units — USDC has 6 decimals, so `5000` is $0.005.

On success the `200`/`201` carries the artifact in the body and the receipt in
`X-PAYMENT-RESPONSE` (base64 JSON: `{success, rail, network, transaction, payer}`).

## Error codes

| HTTP | code | meaning |
|---|---|---|
| 400 | `NO_INPUT` / `BAD_STATUS` | missing `confirmation`/`rawText`, or an invalid status value |
| 401 | `BAD_OWNER_TOKEN` | update not authorized |
| 402 | (x402) | payment required — pay and retry |
| 404 | `NOT_FOUND` | unknown confirmation id |
| 500 | `INTERNAL` | unexpected error |
