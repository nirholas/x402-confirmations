import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { paywall, railSummary, type RoutePrices } from "./payments.js";
import { TrackError, status, track, update } from "./service.js";

// Paid routes. `*` stands in for a path parameter. Free routes are absent here.
const PRICES: RoutePrices = {
  "POST /track": {
    price: "$0.005",
    description: "Normalize a booking confirmation; returns portable record + ICS base64 + signature",
  },
  "GET /status/*": {
    price: "$0.001",
    description: "Signed status snapshot for a tracked confirmation",
  },
};

const app = express();
app.use(express.json({ limit: "512kb" }));

// Dual-rail x402: every paid route offers USDC on Base *and* USDC on Solana.
app.use(paywall(PRICES));

app.use(express.static(join(process.cwd(), "public"), { dotfiles: "allow" }));

// ---------------------------------------------------------------- free routes

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-confirmations", rails: ["base", "solana"] });
});

app.get("/skill.md", (_req, res) => {
  res.type("text/markdown").sendFile(join(process.cwd(), "skill.md"));
});

// Merchants/booking owners push status changes for free (auth: ownerToken from /track).
app.post("/update/:id", (req, res) => {
  try {
    const snapshot = update(
      req.params.id,
      String(req.body?.ownerToken || ""),
      String(req.body?.status || ""),
      req.body?.note ? String(req.body.note) : undefined,
    );
    res.json(snapshot);
  } catch (e) {
    handleError(res, e);
  }
});

// ---------------------------------------------------------------- paid routes

// POST /track ($0.005) — normalize any confirmation into a portable record + ICS.
app.post("/track", (req, res) => {
  try {
    res.status(201).json(track(req.body || {}));
  } catch (e) {
    handleError(res, e);
  }
});

// GET /status/:id ($0.001) — signed current status snapshot.
app.get("/status/:id", (req, res) => {
  try {
    res.json(status(req.params.id));
  } catch (e) {
    handleError(res, e);
  }
});

// -------------------------------------------------------------------- helpers

function handleError(res: express.Response, e: unknown): void {
  if (e instanceof TrackError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return;
  }
  console.error(e);
  res.status(500).json({ error: "INTERNAL", message: "unexpected error" });
}

const port = Number(process.env.PORT || 4021);
app.listen(port, () => {
  console.log(`x402-confirmations listening on :${port}`);
  for (const line of railSummary()) console.log(line);
  console.log("  paid routes:");
  for (const [route, cfg] of Object.entries(PRICES)) console.log(`    ${route}  ${cfg.price}`);
  console.log("  free routes: GET /health, POST /update/:id");
  console.log("  discovery:  GET /.well-known/x402, /skill.md");
});
