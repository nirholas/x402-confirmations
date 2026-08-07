# Tutorial

From a clean clone to a paid, signed confirmation record — on Base Sepolia testnet, or on
Solana if that is what your agent holds.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-confirmations
cd x402-confirmations
npm install
```

Node 18+ required.

## 2. Configure

```bash
cp .env.example .env
```

Everything already has a working default, so you can skip straight to step 3. The values worth
knowing:

```
PAY_TO_ADDRESS=0x40252CFDF8B20Ed757D61ff157719F33Ec332402        # EVM (Base) receive address
SOLANA_PAY_TO_ADDRESS=WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  # Solana receive address
NETWORK=base-sepolia                                              # or base
SOLANA_NETWORK=mainnet-beta                                       # or devnet
SIGNING_SECRET=                                                   # HMAC key for signatures
```

Those two `payTo` values are the suite's public receive addresses. Change them to your own
wallets to be the one who gets paid. Set `SIGNING_SECRET` to anything long and random before
someone starts verifying your signatures for real.

## 3. Run the server

```bash
npm run dev
```

The banner prints both payment rails and the paid routes:

```
x402-confirmations listening on :4021
  rail evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  (facilitator https://x402.org/facilitator)
  rail solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  (facilitator https://facilitator.payai.network)
  paid routes:
    POST /track  $0.005
    GET /status/*  $0.001
```

## 4. Your first 402

```bash
curl -i -X POST http://localhost:4021/track \
  -H 'Content-Type: application/json' \
  -d '{"confirmation":{"reservationId":"res_1","confirmedTime":"2026-09-01T19:00:00Z","party":4,"merchant":"The Golden Fork"}}'
```

You get `402 Payment Required` with an `accepts` array holding **two** entries — USDC on Base
and USDC on Solana — each describing exactly what to pay (amount in atomic units, network,
asset address, `payTo`). That JSON *is* the x402 protocol. Your client picks the rail its
wallet supports; the server settles whichever one comes back in `X-PAYMENT`.

To see just the rails:

```bash
curl -s -X POST http://localhost:4021/track -H 'content-type: application/json' -d '{}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 5. Pay for it

Fund a throwaway wallet with Base Sepolia USDC (https://faucet.circle.com), then:

```bash
PRIVATE_KEY=0xAgentWallet BASE_URL=http://localhost:4021 npm run client
```

`examples/agent-client.ts` uses `x402-fetch`, which intercepts the 402, picks the EVM entry
(pinned explicitly, since a viem wallet can't sign the Solana one), signs the EIP-3009 USDC
authorization, and retries with `X-PAYMENT`. It prints the artifact and the decoded receipt.

On the Solana rail you would instead take
`accepts.find(a => a.network.startsWith("solana"))`, build an SPL `transferChecked` to its
`payTo` with `extra.feePayer` as the transaction fee payer (so your agent needs no SOL), sign
it, and send the same base64 `X-PAYMENT` envelope. In a browser,
[`@three-ws/x402-payment-modal`](https://www.npmjs.com/package/@three-ws/x402-payment-modal)
reads this exact challenge and drives Phantom for you.

## 6. Read the artifact

```json
{
  "record": {
    "confirmationId": "cnf_7f3a…",
    "type": "restaurant",
    "merchant": "The Golden Fork",
    "reference": "res_1",
    "title": "Table for 4 at The Golden Fork",
    "when": { "start": "2026-09-01T19:00:00.000Z" },
    "party": 4,
    "status": "confirmed",
    "sourceFingerprint": "…",
    "normalizedAt": "…"
  },
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "ownerToken": "own_…",
  "signature": "…"
}
```

- **`record`** is the canonical shape — the same fields whatever merchant it came from.
- **`ics`** is base64 RFC 5545. `echo "$ICS" | base64 -d > booking.ics` opens in any calendar.
- **`ownerToken`** is a secret. Keep it: it is what authorizes the free `POST /update/:id`.
- **`signature`** is HMAC-SHA256 over the canonical record, verifiable with `SIGNING_SECRET`.

The `X-PAYMENT-RESPONSE` header carries the settlement receipt:
`{"success":true,"rail":"evm","network":"base-sepolia","transaction":"0x…","payer":"0x…"}`.

## 7. Poll for changes

Each status check is its own $0.001 purchase and returns the snapshot immediately:

```bash
PRIVATE_KEY=0xAgentWallet npx tsx examples/agent-client.ts    # also does a status call
```

If the merchant cancels, they push it for free with the `ownerToken`:

```bash
curl -X POST http://localhost:4021/update/cnf_7f3a… \
  -H 'Content-Type: application/json' \
  -d '{"ownerToken":"own_…","status":"cancelled","note":"kitchen fire"}'
```

The next paid `GET /status/:id` reflects it, with the change in `history`.

## 8. Going to mainnet

- **EVM**: set `NETWORK=base` and point `FACILITATOR_URL` at a facilitator that settles Base
  mainnet (the x402.org reference facilitator is testnet-only) — e.g.
  `https://facilitator.payai.network`.
- **Solana**: already mainnet by default. Use `SOLANA_NETWORK=devnet` while testing, and set a
  dedicated `SOLANA_RPC_URL` (the public RPC is heavily rate limited).
- Set a real `SIGNING_SECRET`, set both `payTo` addresses to wallets you control, and put a
  persistent volume behind `data/` if you need records to survive a restart.
