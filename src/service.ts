import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildIcsBase64 } from "./ics.js";
import { canonicalJson, sign } from "./sign.js";

export type ConfirmationType = "restaurant" | "hotel" | "order" | "flight" | "appointment" | "generic";
export type ConfirmationStatus = "confirmed" | "amended" | "cancelled";

export interface NormalizedRecord {
  confirmationId: string;
  type: ConfirmationType;
  merchant: string;
  reference: string; // the original confirmation code / id
  title: string;
  when: { start: string; end?: string };
  where?: string;
  party?: number;
  amount?: { total: string; currency: string };
  status: ConfirmationStatus;
  sourceFingerprint: string; // sha256 of raw input — links record to what was submitted
  normalizedAt: string;
  extras: Record<string, unknown>;
}

export interface TrackResult {
  record: NormalizedRecord;
  ics: string; // base64 RFC 5545 invite
  ownerToken: string; // secret — lets the submitter post free status updates
  signature: string; // HMAC-SHA256 over canonical record
}

export interface StatusSnapshot {
  confirmationId: string;
  status: ConfirmationStatus;
  temporal: "upcoming" | "imminent" | "in-progress" | "past";
  minutesUntilStart: number | null;
  when: { start: string; end?: string };
  lastUpdated: string;
  history: Array<{ at: string; status: ConfirmationStatus; note?: string }>;
  signature: string;
}

interface StoredRecord {
  record: NormalizedRecord;
  ownerToken: string;
  history: Array<{ at: string; status: ConfirmationStatus; note?: string }>;
}

const DATA_FILE = join(process.cwd(), "data", "confirmations.json");
let store: Map<string, StoredRecord> | null = null;

function load(): Map<string, StoredRecord> {
  if (store) return store;
  store = new Map();
  if (existsSync(DATA_FILE)) {
    try {
      for (const r of JSON.parse(readFileSync(DATA_FILE, "utf8")) as StoredRecord[]) {
        store.set(r.record.confirmationId, r);
      }
    } catch {
      // corrupt store — start clean
    }
  }
  return store;
}

function persist(): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify([...load().values()], null, 2));
}

export class TrackError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------- normalization

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Extract the first plausible date/time from freeform text. */
function dateFromText(text: string): Date | undefined {
  const iso = text.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?/);
  if (iso) return parseDate(iso[0].replace(" ", "T"));
  const dateOnly = text.match(/\d{4}-\d{2}-\d{2}/);
  const human = text.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}/i,
  );
  const time = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  const base = dateOnly ? parseDate(dateOnly[0]) : human ? parseDate(human[0].replace(/(st|nd|rd|th)/i, "")) : undefined;
  if (!base) return undefined;
  if (time) {
    let h = Number(time[1]) % 12;
    if ((time[3] || "").toLowerCase() === "pm") h += 12;
    if (!time[3]) h = Number(time[1]);
    base.setUTCHours(h, Number(time[2]), 0, 0);
  }
  return base;
}

function detectType(obj: Record<string, unknown>, hint?: string): ConfirmationType {
  const h = (hint || "").toLowerCase();
  if (["restaurant", "hotel", "order", "flight", "appointment", "generic"].includes(h)) return h as ConfirmationType;
  if (obj.reservationId !== undefined || obj.confirmedTime !== undefined) return "restaurant";
  if (obj.checkIn !== undefined || obj.checkOut !== undefined || obj.hotel !== undefined) return "hotel";
  if (obj.orderId !== undefined || obj.sku !== undefined || obj.fulfillment !== undefined) return "order";
  if (obj.flightNumber !== undefined || obj.pnr !== undefined || obj.itineraries !== undefined) return "flight";
  if (obj.appointmentId !== undefined || obj.meetingLink !== undefined) return "appointment";
  return "generic";
}

/**
 * Normalize a confirmation submitted either as structured JSON (`confirmation`)
 * or freeform text (`rawText`). Understands the x402 suite merchant schemas
 * (x402-tablebook, x402-agent-sandbox hotel, x402-storefront) natively and
 * falls back to heuristics for everything else.
 */
export function track(input: {
  confirmation?: unknown;
  rawText?: unknown;
  type?: unknown;
  merchant?: unknown;
  timezone?: unknown;
}): TrackResult {
  const rawText = str(input.rawText);
  const conf =
    input.confirmation && typeof input.confirmation === "object"
      ? (input.confirmation as Record<string, unknown>)
      : undefined;
  if (!conf && !rawText) {
    throw new TrackError(400, "NO_INPUT", "provide `confirmation` (JSON object) or `rawText` (string)");
  }

  const source = conf ? canonicalJson(conf) : rawText!;
  const fingerprint = createHash("sha256").update(source).digest("hex");
  const type = conf ? detectType(conf, str(input.type)) : ((str(input.type) as ConfirmationType) || "generic");

  let merchant = str(input.merchant) || "";
  let reference = "";
  let title = "";
  let where: string | undefined;
  let party: number | undefined;
  let start: Date | undefined;
  let end: Date | undefined;
  let amount: NormalizedRecord["amount"];
  const extras: Record<string, unknown> = {};

  if (conf) {
    reference =
      str(conf.reservationId) ||
      str(conf.bookingId) ||
      str(conf.orderId) ||
      str(conf.appointmentId) ||
      str(conf.confirmationCode) ||
      str(conf.pnr) ||
      str(conf.id) ||
      `ref-${fingerprint.slice(0, 8)}`;
    merchant =
      merchant ||
      str(conf.merchant) ||
      str((conf.hotel as Record<string, unknown> | undefined)?.name) ||
      str(conf.restaurant) ||
      str(conf.vendor) ||
      "unknown-merchant";
    start =
      parseDate(conf.confirmedTime) ||
      parseDate(conf.checkIn) ||
      parseDate(conf.time) ||
      parseDate(conf.start) ||
      parseDate(conf.departureTime) ||
      parseDate(conf.date);
    end = parseDate(conf.checkOut) || parseDate(conf.end);
    party =
      num(conf.party) ||
      num(conf.guests) ||
      num((conf.party as Record<string, unknown> | undefined)?.size) ||
      num(conf.partySize);
    where =
      str(conf.location) ||
      str(conf.address) ||
      str((conf.hotel as Record<string, unknown> | undefined)?.address) ||
      str(conf.venue);
    const price = (conf.price ?? conf.amount ?? conf.total) as Record<string, unknown> | string | number | undefined;
    if (typeof price === "object" && price) {
      const total = str(price.total) ?? num(price.total)?.toString();
      if (total) amount = { total, currency: str(price.currency) || "USD" };
    } else if (typeof price === "string" || typeof price === "number") {
      amount = { total: String(price), currency: "USD" };
    }
    for (const k of ["refundTerms", "cancelPolicy", "meetingLink", "room", "item", "fulfillment", "license"]) {
      if (conf[k] !== undefined) extras[k] = conf[k];
    }
    title =
      str(conf.title) ||
      (type === "restaurant"
        ? `Table for ${party ?? "?"} at ${merchant}`
        : type === "hotel"
          ? `Stay at ${merchant}`
          : type === "order"
            ? `Order ${reference} from ${merchant}`
            : type === "flight"
              ? `Flight ${str(conf.flightNumber) || reference}`
              : type === "appointment"
                ? `Appointment at ${merchant}`
                : `Booking ${reference} at ${merchant}`);
  } else {
    const text = rawText!;
    const code = text.match(/\b(?:confirmation|conf|booking|reservation|ref(?:erence)?)[:# ]+\s*([A-Z0-9-]{4,12})\b/i);
    reference = code?.[1] || `ref-${fingerprint.slice(0, 8)}`;
    merchant = merchant || text.match(/\b(?:at|from|with)\s+([A-Z][\w'&. -]{2,40}?)(?=\s+(?:on|for|is|was)\b|[.,\n]|$)/m)?.[1]?.trim() || "unknown-merchant";
    start = dateFromText(text);
    const partyMatch = text.match(/\b(?:party of|table for|for)\s+(\d{1,2})\s*(?:people|guests|persons)?\b/i);
    party = partyMatch ? Number(partyMatch[1]) : undefined;
    title = `Booking ${reference} at ${merchant}`;
    extras.textPreview = text.slice(0, 280);
  }

  if (!start) {
    // A confirmation without a parseable time still normalizes — anchor the ICS
    // 24h out and flag it so callers know the time needs human review.
    start = new Date(Date.now() + 24 * 3600 * 1000);
    extras.timeParsed = false;
  } else {
    extras.timeParsed = true;
  }

  const record: NormalizedRecord = {
    confirmationId: `cnf_${randomUUID()}`,
    type,
    merchant,
    reference,
    title,
    when: { start: start.toISOString(), ...(end ? { end: end.toISOString() } : {}) },
    ...(where ? { where } : {}),
    ...(party !== undefined ? { party } : {}),
    ...(amount ? { amount } : {}),
    status: "confirmed",
    sourceFingerprint: fingerprint,
    normalizedAt: new Date().toISOString(),
    extras,
  };

  const stored: StoredRecord = {
    record,
    ownerToken: `own_${randomUUID()}`,
    history: [{ at: record.normalizedAt, status: "confirmed", note: "tracked" }],
  };
  load().set(record.confirmationId, stored);
  persist();

  return {
    record,
    ics: buildIcsBase64({
      uid: `${record.confirmationId}@x402-confirmations`,
      start,
      end,
      summary: title,
      location: where,
      description: `Reference ${reference} — normalized by x402-confirmations (${record.confirmationId})`,
    }),
    ownerToken: stored.ownerToken,
    signature: sign(record),
  };
}

export function status(id: string): StatusSnapshot {
  const s = load().get(id);
  if (!s) throw new TrackError(404, "NOT_FOUND", `no confirmation ${id}`);
  const startMs = Date.parse(s.record.when.start);
  const endMs = s.record.when.end ? Date.parse(s.record.when.end) : startMs + 60 * 60 * 1000;
  const now = Date.now();
  const minutes = Math.round((startMs - now) / 60000);
  const temporal = now > endMs ? "past" : now >= startMs ? "in-progress" : minutes <= 120 ? "imminent" : "upcoming";
  const body = {
    confirmationId: s.record.confirmationId,
    status: s.record.status,
    temporal: temporal as StatusSnapshot["temporal"],
    minutesUntilStart: now < startMs ? minutes : null,
    when: s.record.when,
    lastUpdated: s.history[s.history.length - 1].at,
    history: s.history,
  };
  return { ...body, signature: sign(body) };
}

export function update(id: string, ownerToken: string, newStatus: string, note?: string): StatusSnapshot {
  const s = load().get(id);
  if (!s) throw new TrackError(404, "NOT_FOUND", `no confirmation ${id}`);
  if (!ownerToken || ownerToken !== s.ownerToken) {
    throw new TrackError(401, "BAD_OWNER_TOKEN", "ownerToken does not match the one returned by POST /track");
  }
  if (!["confirmed", "amended", "cancelled"].includes(newStatus)) {
    throw new TrackError(400, "BAD_STATUS", "status must be confirmed | amended | cancelled");
  }
  s.record.status = newStatus as ConfirmationStatus;
  s.history.push({ at: new Date().toISOString(), status: s.record.status, ...(note ? { note } : {}) });
  persist();
  return status(id);
}
