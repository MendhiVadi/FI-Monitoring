import type { Request } from "firebase-functions/v2/https";

// Where the caller's address really is.
//
// Cloud Functions (2nd gen) run on the Functions Framework, which enables
// Express "trust proxy". Under that setting `req.ip` is the LEFTMOST entry of
// X-Forwarded-For — the one position a caller can write freely: Cloud Run's
// front end appends the connecting address to whatever the client already
// sent, it never replaces it. So every quota keyed on `req.ip` could be reset
// per request by sending a fresh made-up X-Forwarded-For.
//
// The trustworthy entry is the one appended by the last proxy we control,
// counted from the right. With Cloud Run alone that is the last entry; behind
// an external HTTPS load balancer there is one more trusted hop. TRUSTED_PROXY_HOPS
// names how many trailing entries our own infrastructure adds.
const DEFAULT_HOPS = 1;
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : DEFAULT_HOPS;
}

// Accepts IPv4, IPv6 (optionally bracketed, optionally with a port) and
// IPv4-mapped IPv6. Anything else is treated as absent so a garbage header can
// never become a quota key.
export function normalizeAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  value = value.split("%")[0];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every(part => Number(part) <= 255) ? value : null;
  }
  if (/^[0-9a-f:]+(?:\d{1,3}(?:\.\d{1,3}){3})?$/.test(value) && value.includes(":") && (value.match(/::/g) ?? []).length <= 1) return value;
  return null;
}

export function addressFromForwardedFor(header: unknown, hops: number, remoteAddress?: unknown): string | null {
  const raw = Array.isArray(header) ? header.join(",") : typeof header === "string" ? header : "";
  const entries = raw.split(",").map(part => part.trim()).filter(Boolean);
  if (entries.length >= hops) {
    const candidate = normalizeAddress(entries[entries.length - hops]);
    if (candidate) return candidate;
  }
  // Direct connection (emulator, tests) or an unusable header: fall back to the
  // socket, which nothing upstream of us can forge.
  return normalizeAddress(remoteAddress);
}

/** The connecting client's address, or null when it cannot be established. */
export function clientAddress(request: Pick<Request, "headers" | "socket" | "ip">, hops = trustedProxyHops()): string | null {
  const remote = request.socket?.remoteAddress ?? request.ip;
  return addressFromForwardedFor(request.headers?.["x-forwarded-for"], hops, remote);
}
