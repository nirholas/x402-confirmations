/** Minimal RFC 5545 ICS generation — no dependencies. */

export interface IcsEvent {
  uid: string;
  start: Date;
  end?: Date;
  summary: string;
  description?: string;
  location?: string;
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines at 75 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 73) {
    let cut = 73;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 73) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const end = ev.end ?? new Date(ev.start.getTime() + 60 * 60 * 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//x402-confirmations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    ...(ev.location ? [`LOCATION:${escapeText(ev.location)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${escapeText(ev.description)}`] : []),
    `STATUS:${ev.status ?? "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function buildIcsBase64(ev: IcsEvent): string {
  return Buffer.from(buildIcs(ev), "utf8").toString("base64");
}
