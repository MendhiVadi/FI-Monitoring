import * as admin from "firebase-admin";

export interface DisputeInput {
  reporterName: string;
  reporterType: string;
  otherPartyName: string;
  otherPartyType: string;
  disputeType: string;
  state: string;
  district: string;
  village?: string;
  bhuvanPolygon?: string;
  description: string;
  location: { latitude: number; longitude: number };
}

const MAX_LEN = {
  reporterName: 120,
  reporterType: 80,
  otherPartyName: 120,
  otherPartyType: 80,
  disputeType: 80,
  state: 80,
  district: 80,
  village: 120,
  bhuvanPolygon: 10000,
  description: 2000,
};

const REQUIRED_FIELDS = [
  "reporterName",
  "reporterType",
  "otherPartyName",
  "otherPartyType",
  "disputeType",
  "state",
  "district",
  "description",
] as const;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateDisputeInput(data: unknown): DisputeInput {
  if (typeof data !== "object" || data === null) {
    throw new Error("Missing dispute details.");
  }
  const record = data as Record<string, unknown>;
  for (const key of REQUIRED_FIELDS) {
    if (typeof record[key] !== "string" || (record[key] as string).trim().length === 0) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  const location = record.location as Record<string, unknown> | undefined;
  if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number" ||
      !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
    throw new Error("Choose valid latitude and longitude for the disputed land.");
  }
  return {
    location: { latitude: location.latitude, longitude: location.longitude },
    reporterName: clean(record.reporterName, MAX_LEN.reporterName),
    reporterType: clean(record.reporterType, MAX_LEN.reporterType),
    otherPartyName: clean(record.otherPartyName, MAX_LEN.otherPartyName),
    otherPartyType: clean(record.otherPartyType, MAX_LEN.otherPartyType),
    disputeType: clean(record.disputeType, MAX_LEN.disputeType),
    state: clean(record.state, MAX_LEN.state),
    district: clean(record.district, MAX_LEN.district),
    village: clean(record.village, MAX_LEN.village),
    bhuvanPolygon: clean(record.bhuvanPolygon, MAX_LEN.bhuvanPolygon),
    description: clean(record.description, MAX_LEN.description),
  };
}

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

// OTP proves phone ownership, not good intent — without this, one verified
// number could still flood the tickets dashboard. Caps each phone number to
// a handful of dispute submissions per rolling day.
export async function assertUnderRateLimit(db: admin.firestore.Firestore, uid: string): Promise<void> {
  const ref = db.collection("reporterLimits").doc(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const now = Date.now();
    const windowStartedAt = typeof data?.windowStartedAt === "number" ? data.windowStartedAt : 0;
    const count = windowStartedAt > now - RATE_LIMIT_WINDOW_MS && typeof data?.count === "number" ? data.count : 0;
    if (count >= RATE_LIMIT_MAX_PER_WINDOW) {
      throw new Error("Too many disputes submitted from this number today. Please try again tomorrow.");
    }
    transaction.set(ref, { count: count + 1, windowStartedAt: count === 0 ? now : windowStartedAt }, { merge: true });
  });
}

// Dispute tickets reuse the WhatsApp ticket schema (waFrom/subject/messages/status)
// so they show up in the same /tickets dashboard, with the structured form fields
// kept alongside for the decision-support panel to read directly.
export async function createDisputeTicket(
  db: admin.firestore.Firestore,
  phone: string,
  uid: string,
  input: DisputeInput,
  phoneVerified = true
): Promise<string> {
  const subject = `${input.disputeType} — ${input.reporterName} vs ${input.otherPartyName}`.slice(0, 80);
  const firstMessage = [
    `Dispute type: ${input.disputeType}`,
    `Reporter: ${input.reporterName} (${input.reporterType})`,
    `Other party: ${input.otherPartyName} (${input.otherPartyType})`,
    `Location: ${input.village ? `${input.village}, ` : ""}${input.district}, ${input.state}`,
    ...(input.bhuvanPolygon ? [`Bhuvan AOI polygon: ${input.bhuvanPolygon}`] : []),
    "",
    input.description,
  ].join("\n");

  const ref = await db.collection("tickets").add({
    waFrom: phone,
    reporterUid: uid,
    phoneVerified,
    notificationPhone: phone,
    whatsappUpdates: phoneVerified,
    subject,
    messages: [{ body: firstMessage, from: "user", at: admin.firestore.Timestamp.now() }],
    status: "open",
    source: "web-dispute-form",
    dispute: input,
    bhuvan: input.bhuvanPolygon ? { polygonWkt: input.bhuvanPolygon, source: "Bhuvan LULC API" } : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("reporters").doc(uid).set({
    phone,
    whatsappUpdates: phoneVerified,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return ref.id;
}
