---
name: x402-confirmations
description: Call the x402-confirmations HTTP service to normalize a booking confirmation (JSON or pasted email text) into one canonical record plus an ICS calendar invite, then poll signed status snapshots. Use when an agent must track or calendar a reservation, hotel, order or flight.
---

# x402-confirmations

x402-confirmations is an Express service that turns any merchant confirmation into one canonical record, an RFC 5545 ICS invite (base64) and an HMAC signature, then sells signed status snapshots per query.

## Run it

No package is published and there is no hosted instance, so run it from a clone: `git clone https://github.com/nirholas/x402-confirmations && cd x402-confirmations`, then `npm install`, `cp .env.example .env`, and `npm run dev` (tsx `src/server.ts`). It listens on `PORT`, default 4037. For production use `npm run build` then `npm start`.

Key env vars: `PORT`, `SIGNING_SECRET`, `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`, `SOLANA_NETWORK`, `FACILITATOR_URL`, `SOLANA_FACILITATOR_URL`.

## Endpoints

- `POST /track` ($0.005). Body is either `{"confirmation": {...}}` (structured JSON, for example `reservationId`, `confirmedTime`, `party`, `merchant`) or `{"rawText": "...", "type": "restaurant"}` (freeform text). Optional `type` hint (`restaurant`, `hotel`, `order`, `flight`, `appointment`, `generic`) and `merchant` override. Returns 201 with `record` (`confirmationId`, `type`, `merchant`, `when`, `status`, ...), `ics` (base64), `ownerToken` and `signature`. Keep `ownerToken` secret: it authorizes free status updates.
- `GET /status/:id` ($0.001). Signed snapshot with `status` (`confirmed`, `amended`, `cancelled`), `temporal` (`upcoming`, `imminent`, `in-progress`, `past`), `minutesUntilStart` and `history`.
- `POST /update/:id` (free). Body `{ownerToken, status, note?}` pushes a status change. 401 `BAD_OWNER_TOKEN`, 400 `BAD_STATUS`.
- `GET /health` (free).

Example body for `/track`:

```json
{"rawText": "Your reservation at Chez Nous is confirmed for Aug 9, 2026 7:00 pm. Confirmation: QX4T9B, party of 4.", "type": "restaurant"}
```

Decode `ics` from base64 and save it as a `.ics` file to hand the user a calendar invite. Errors: 400 `NO_INPUT` when neither `confirmation` nor `rawText` is sent, 404 `NOT_FOUND` for an unknown id.

## Paying

Every paid route answers an unpaid request with HTTP 402 and a body whose `accepts` array lists two rails: USDC on Base (`base-sepolia` by default, `base` via `NETWORK`) and USDC on Solana (`solana` by default, `solana-devnet` via `SOLANA_NETWORK`). Pick the entry your wallet can sign, sign the USDC payment (EIP-3009 on Base, SPL `transferChecked` on Solana), and retry with the base64 `X-PAYMENT` header. The artifact is in the 200 body and the settlement receipt is in the `X-PAYMENT-RESPONSE` header. On the EVM rail `x402-fetch` with `viem` does this for you; `npm run client` runs `examples/agent-client.ts`, which reads `BASE_URL` and `PRIVATE_KEY`.

Discovery: `GET /.well-known/x402` lists routes, prices and rails, and `GET /skill.md` serves the repo's own reference. Paying moves real USDC on the configured network, so show the user the route, amount and rail first and wait for a yes before any paid call. Use a throwaway wallet on `base-sepolia` or `solana-devnet` for testing.
