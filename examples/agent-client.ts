/**
 * Full x402 payment flow against x402-confirmations using x402-fetch.
 *
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4037 npx tsx examples/agent-client.ts
 *
 * The wallet needs testnet USDC on Base Sepolia — faucet: https://faucet.circle.com
 *
 * This service is DUAL-RAIL: every 402 offers USDC on Base *and* USDC on Solana.
 * This example takes the EVM rail (see the Solana note at the bottom of the file).
 */
import { privateKeyToAccount } from "viem/accounts";
import { selectPaymentRequirements } from "x402/client";
import type { PaymentRequirements } from "x402/types";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.BASE_URL || "http://localhost:4037";
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("Set PRIVATE_KEY to a funded Base Sepolia wallet (testnet USDC: https://faucet.circle.com)");
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);
// The 402 lists both rails. A viem wallet can only sign the EVM one, so pin the
// selector to the EVM network instead of letting the default picker choose.
const EVM_NETWORK = (process.env.NETWORK || "base-sepolia") as "base" | "base-sepolia";
const payFetch = wrapFetchWithPayment(fetch, account, undefined, (reqs: PaymentRequirements[]) =>
  selectPaymentRequirements(reqs, EVM_NETWORK, "exact"),
);

function receipt(res: Response): string {
  const h = res.headers.get("x-payment-response");
  if (!h) return "(no X-PAYMENT-RESPONSE header)";
  try {
    return JSON.stringify(JSON.parse(Buffer.from(h, "base64").toString("utf8")));
  } catch {
    return h;
  }
}

async function main() {
  console.log(`agent wallet: ${account.address}\n`);

  // 1. Paid: normalize a structured confirmation from another suite merchant ($0.005)
  console.log("POST /track  ($0.005) — structured x402-tablebook confirmation …");
  const trackRes = await payFetch(`${BASE_URL}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmation: {
        reservationId: "res_demo_123",
        confirmedTime: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        party: 4,
        merchant: "The Golden Fork",
        refundTerms: "refundable until 2h before",
      },
    }),
  });
  const tracked = await trackRes.json();
  console.log(JSON.stringify({ ...tracked, ics: tracked.ics.slice(0, 40) + "…" }, null, 2));
  console.log("payment receipt:", receipt(trackRes), "\n");

  // Decode the purchased ICS invite
  console.log("decoded ICS (first lines):");
  console.log(Buffer.from(tracked.ics, "base64").toString("utf8").split("\r\n").slice(0, 8).join("\n"), "\n");

  // 2. Paid: status snapshot ($0.001)
  const id = tracked.record.confirmationId;
  console.log(`GET /status/${id}  ($0.001) …`);
  const statusRes = await payFetch(`${BASE_URL}/status/${id}`);
  console.log(JSON.stringify(await statusRes.json(), null, 2));
  console.log("payment receipt:", receipt(statusRes), "\n");

  // 3. Free: the booking owner cancels; next paid snapshot would reflect it.
  const updateRes = await fetch(`${BASE_URL}/update/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerToken: tracked.ownerToken, status: "cancelled", note: "plans changed" }),
  });
  console.log("POST /update (free) →", JSON.stringify(await updateRes.json(), null, 2));

  // 4. Paid: freeform text also normalizes ($0.005)
  console.log("\nPOST /track  ($0.005) — freeform email text …");
  const rawRes = await payFetch(`${BASE_URL}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText:
        "Your reservation at Chez Nous is confirmed for 2026-09-01 19:30. Confirmation: QX4T9B. Table for 2.",
      type: "restaurant",
    }),
  });
  const raw = await rawRes.json();
  console.log(JSON.stringify(raw.record, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Paying on the SOLANA rail instead
 *
 * The same 402 also offers `{ scheme: "exact", network: "solana", asset: <USDC
 * mint>, payTo: <base58>, maxAmountRequired, extra: { feePayer } }`. A Solana
 * agent builds an SPL `transferChecked` for that amount to `payTo` with the
 * facilitator's `feePayer` as fee payer (so it needs no SOL), signs it, and
 * retries with the base64 X-PAYMENT envelope:
 *
 *   const challenge = await (await fetch(`${BASE_URL}/track`)).json();
 *   const accept    = challenge.accepts.find((a) => a.network.startsWith("solana"));
 *   // build + sign the SPL transfer with @solana/web3.js, or let the browser
 *   // modal do it: @three-ws/x402-payment-modal drives Phantom end to end.
 *   const xPayment  = Buffer.from(JSON.stringify({
 *     x402Version: 1, scheme: "exact", network: accept.network,
 *     payload: { transaction: signedTxBase64 },
 *   })).toString("base64");
 *   // then retry the same request with { headers: { "X-PAYMENT": xPayment } }
 *
 * Raw dual-rail 402 body, for reference:
 *   curl -s http://localhost:4037/track | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
 * ───────────────────────────────────────────────────────────────────────────── */
