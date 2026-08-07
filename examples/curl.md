# Raw x402 flow with curl

The 402 → pay → 200 walkthrough against a local server (`npm run dev` — both rails use the suite defaults).

## 1. Paid route without payment → 402

```bash
curl -i -X POST http://localhost:4021/track \
  -H 'Content-Type: application/json' \
  -d '{"confirmation":{"reservationId":"res_1","confirmedTime":"2026-09-01T19:00:00Z","party":4,"merchant":"The Golden Fork"}}'
```

```
HTTP/1.1 402 Payment Required

{
  "x402Version": 1,
  "error": "Payment required — pay in USDC on Base or Solana; your client picks the rail.",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "5000",          // $0.005 in 6-decimal USDC units
      "resource": "http://localhost:4021/track",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "5000",
      "amount": "5000",
      "resource": "http://localhost:4021/track",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", "name": "USDC", "decimals": 6 }
    }
  ]
}
```

Two entries, two rails. Take whichever your wallet can sign — the server settles that one.

## 2. Pay

`X-PAYMENT` is a base64 payment matching **one** `accepts` entry: an EIP-3009
`transferWithAuthorization` signature on the Base entry, or a signed SPL `transferChecked`
transaction on the Solana entry. Produce it with any x402 client rather than by hand:

```bash
PRIVATE_KEY=0x… BASE_URL=http://localhost:4021 npx tsx examples/agent-client.ts
```

## 3. Retry with X-PAYMENT → 200/201

```bash
curl -i -X POST http://localhost:4021/track \
  -H 'Content-Type: application/json' -H "X-PAYMENT: $PAYMENT_B64" \
  -d '{"rawText":"Reservation at Chez Nous confirmed for 2026-09-01 19:30. Confirmation: QX4T9B. Table for 2."}'
```

Body: normalized `record` + base64 `ics` + `ownerToken` + `signature`.
Header `X-PAYMENT-RESPONSE`: base64 settlement receipt (tx hash, network, payer).

Decode the purchased calendar invite:

```bash
jq -r .ics response.json | base64 -d > booking.ics
```

## Status snapshot ($0.001) and free owner update

```bash
curl -H "X-PAYMENT: $PAYMENT_B64" http://localhost:4021/status/cnf_…
curl -X POST http://localhost:4021/update/cnf_… \
  -H 'Content-Type: application/json' \
  -d '{"ownerToken":"own_…","status":"cancelled","note":"plans changed"}'
```

## Solana rail

The second `accepts` entry is USDC on Solana. Build and sign an SPL `transferChecked` to its
`payTo` using `extra.feePayer` as the transaction fee payer (so you need no SOL), then send the
same base64 `X-PAYMENT` envelope. In a browser, `@three-ws/x402-payment-modal` reads this exact
challenge and drives Phantom for you.

```bash
# see both rails at a glance
curl -s -X POST http://localhost:4021/ -H 'content-type: application/json' -d '{}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```
