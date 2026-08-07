import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing over canonical JSON.
 *
 * SIGNING_SECRET should be set in production. The dev default keeps the demo
 * runnable out of the box, but every artifact signed with it is verifiable by
 * anyone who reads this source — rotate it before going live.
 */
const DEV_SECRET = "x402-confirmations-dev-secret";

export function signingSecret(): string {
  return process.env.SIGNING_SECRET || DEV_SECRET;
}

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sign(payload: unknown): string {
  return createHmac("sha256", signingSecret()).update(canonicalJson(payload)).digest("hex");
}

export function verify(payload: unknown, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A compact signed token: base64url(payload).base64url(hmac). */
export function mintToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(canonicalJson(payload)).toString("base64url");
  const mac = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readToken(token: string): Record<string, unknown> | null {
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
