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
