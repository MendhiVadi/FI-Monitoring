import { createHmac } from "node:crypto";
import { DISPUTE_OTP_SECRET } from "../../platform/secrets";

// Keyed, not a bare digest. A phone number has only ~10^10 possibilities and
// an IPv4 address ~10^9, so a plain SHA-256 of either is reversible by brute
// force in seconds — and reporterUid is stored on every ticket document.
// HMAC under a server-held secret makes those ids meaningless to anyone who
// obtains the database without also obtaining the secret.
export function hashId(value: string): string {
  return createHmac("sha256", DISPUTE_OTP_SECRET.value()).update(value).digest("hex");
}

// Per-address quotas key IPv6 callers by their /64: one subscriber is normally
// delegated a whole /64, so an exact-address cap would hand a single device
// 2^64 fresh quotas. IPv4 (and IPv4-mapped IPv6) addresses stay exact.
export function addressBucket(address: string): string {
  const value = address.trim().toLowerCase().split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1];
  if (!value.includes(":")) return value;
  const [head, tail] = value.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map(group => (parseInt(group, 16) || 0).toString(16)).join(":") + "::/64";
}
