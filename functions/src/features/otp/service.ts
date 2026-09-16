import * as admin from "firebase-admin";
import { randomInt, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { hashId } from "./identity";

// Custom OTP verification for dispute intake, independent of Firebase Auth.
// Each code is generated per-request, hashed at rest, single-use, and lives
// in Firestore (`disputeOtps/{phone}`) instead of a Firebase Auth session —
// so verifying a phone number never creates a signed-in user or auth token.

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const VERIFIED_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;
export class OtpRateLimitError extends Error {}

function hashValue(scope: string, value: string, secret: string): string {
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("hex");
}

export const verificationKey = (token: string, secret: string) => hashValue("token", token, secret);

// Hash comparison must not leak how many leading characters matched: an
// attacker controls one side of it, so an early-exit compare is a timing
// oracle for the digest.
function safeEqualHex(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// Zero-padded so every draw is a distinct 6-digit string ("007123", not "7123"),
// and unique per phone by construction: each call replaces that phone's only
// live code, so two codes for the same number can never be valid at once.
function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function normalizePhone(phone: unknown): string {
  const value = typeof phone === "string" ? phone.trim() : "";
  if (!/^\+[1-9]\d{6,14}$/.test(value)) {
    throw new Error("Enter a valid phone number in international format.");
  }
  return value;
}

export async function issueOtp(
  db: admin.firestore.Firestore,
  phone: string,
  secret: string
): Promise<string> {
  const ref = db.collection("disputeOtps").doc(phone);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const now = Date.now();
    const windowStartedAt = typeof data?.sendWindowStartedAt === "number" ? data.sendWindowStartedAt : 0;
    const sendsInWindow = windowStartedAt > now - SEND_WINDOW_MS && typeof data?.sendCount === "number" ? data.sendCount : 0;
    if (sendsInWindow >= MAX_SENDS_PER_WINDOW) {
      throw new OtpRateLimitError("Too many codes requested for this number. Please try again later.");
    }
    let nextCode = generateCode();
    while (safeEqualHex(data?.codeHash, hashValue("code", `${phone}:${nextCode}`, secret))) {
      nextCode = generateCode();
    }
    transaction.set(ref, {
      phone,
      codeHash: hashValue("code", `${phone}:${nextCode}`, secret),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      verified: false,
      verifiedAt: null,
      verificationTokenHash: null,
      used: false,
      sendCount: sendsInWindow + 1,
      sendWindowStartedAt: sendsInWindow === 0 ? now : windowStartedAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return nextCode;
  });
}

const IP_SENDS_PER_WINDOW = 10;

// The per-phone cap alone still lets one caller walk a list of numbers and
// bill the project for a WhatsApp message to each. This bounds the whole
// endpoint per source address as well.
export async function assertIpUnderSendLimit(
  db: admin.firestore.Firestore,
  ipHash: string
): Promise<void> {
  const ref = db.collection("otpSendLimits").doc(ipHash);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const now = Date.now();
    const windowStartedAt = typeof data?.windowStartedAt === "number" ? data.windowStartedAt : 0;
    const count = windowStartedAt > now - SEND_WINDOW_MS && typeof data?.count === "number" ? data.count : 0;
    if (count >= IP_SENDS_PER_WINDOW) {
      throw new OtpRateLimitError("Too many verification codes requested. Please try again later.");
    }
    transaction.set(ref, {
      count: count + 1,
      windowStartedAt: count === 0 ? now : windowStartedAt,
    }, { merge: true });
  });
}

export interface ConfirmResult {
  ok: boolean;
  /** Bearer proof that THIS caller completed verification. Only set when ok. */
  token?: string;
  reason?: string;
}

// Returns a result rather than throwing on a wrong code. Throwing out of a
// Firestore transaction callback rolls the whole transaction back, which
// would silently discard the failed-attempt increment and leave MAX_ATTEMPTS
// unreachable — i.e. unlimited guesses against a 6-digit code.
export async function confirmOtp(
  db: admin.firestore.Firestore,
  phone: string,
  code: string,
  secret: string
): Promise<ConfirmResult> {
  const ref = db.collection("disputeOtps").doc(phone);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!data) return { ok: false, reason: "Request a verification code before continuing." };
    const now = Date.now();
    if (typeof data.expiresAt !== "number" || data.expiresAt < now) {
      return { ok: false, reason: "That code expired — request a new one." };
    }
    if (data.used) return { ok: false, reason: "That code was already used. Request a new one." };
    if (data.verified) return { ok: false, reason: "That code was already verified. Request a new one." };
    if (data.deliveryStatus === "failed") return { ok: false, reason: "That code could not be delivered. Request a new one." };
    const attempts = typeof data.attempts === "number" ? data.attempts : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: "Too many incorrect attempts. Request a new code." };
    }
    if (!safeEqualHex(data.codeHash, hashValue("code", `${phone}:${code}`, secret))) {
      transaction.update(ref, { attempts: attempts + 1 });
      return { ok: false, reason: "That code isn't right. Check it and try again." };
    }
    // Knowing the phone number must not be enough to spend the verification:
    // only the caller that actually entered the code receives this token, and
    // submitDispute demands it back.
    const token = randomBytes(32).toString("hex");
    transaction.update(ref, {
      verified: true,
      verifiedAt: now,
      verificationTokenHash: hashValue("token", token, secret),
    });
    // A new send replaces only the challenge. It cannot revoke a proof already
    // issued to a reporter who is filling out their form.
    transaction.create(db.collection("disputeVerifications").doc(verificationKey(token, secret)), {
      phoneHash: hashId(phone), verifiedAt: now, expiresAt: now + VERIFIED_WINDOW_MS, used: false,
    });
    return { ok: true, token };
  });
}

// A disputeOtps document is keyed on the phone number itself, so a retained
// row is a record that this person contacted the FRA grievance system. Nothing
// needs them once the code is spent or expired, so they are deleted rather
// than kept — the id is the PII, so clearing fields would not be enough.
export async function purgeExpiredRecords(db: admin.firestore.Firestore, collection: string, field: string,
  cutoff: number | admin.firestore.Timestamp, batchLimit = 200): Promise<{ deleted: number; scanned: number }> {
  const stale = await db.collection(collection).where(field, "<", cutoff).limit(batchLimit).get();
  if (stale.empty) return { deleted: 0, scanned: 0 };
  const cutoffMs = typeof cutoff === "number" ? cutoff : cutoff.toMillis();
  const deleted = await db.runTransaction(async tx => {
    const fresh = await tx.getAll(...stale.docs.map(snapshot => snapshot.ref));
    let count = 0;
    for (const snapshot of fresh) {
      const value = snapshot.data()?.[field];
      const expiry = typeof value === "number" ? value : value?.toMillis?.();
      if (snapshot.exists && typeof expiry === "number" && expiry < cutoffMs) { tx.delete(snapshot.ref); count++; }
    }
    return count;
  });
  return { deleted, scanned: stale.size };
}

export const OTP_SEND_WINDOW_MS = SEND_WINDOW_MS;

// A slow send must never overwrite the status of a newer code.
export async function recordOtpDelivery(
  db: admin.firestore.Firestore, phone: string, code: string, secret: string,
  deliveryStatus: "accepted" | "failed", messageId: string | null = null
): Promise<void> {
  const ref = db.collection("disputeOtps").doc(phone);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!safeEqualHex(snapshot.data()?.codeHash, hashValue("code", `${phone}:${code}`, secret))) return;
    transaction.update(ref, { deliveryStatus, messageId });
  });
}

// Consumes a verified code so it cannot back a second submission. Returns
// whether `phone` had a currently-verified, unused, unexpired code AND the
// caller presented the token issued to whoever passed that verification.
export async function consumeVerifiedOtp(db: admin.firestore.Firestore, phone: string, token: string, secret: string): Promise<boolean> {
  const ref = db.collection("disputeVerifications").doc(verificationKey(token, secret));
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data || data.used || data.expiresAt <= Date.now() || data.phoneHash !== hashId(phone)) return false;
    tx.update(ref, { used: true });
    return true;
  });
}
