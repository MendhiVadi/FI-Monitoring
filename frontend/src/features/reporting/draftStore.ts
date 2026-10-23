import { useSyncExternalStore } from "react";
import contract from "../../shared/contracts/dispute.json";
import disputeSettings from "../../../dispute-settings.json";
import { callFunction } from "./callables";
import type { Step, UploadedDocument } from "./types";

export const DRAFT_IDLE_MS = 30 * 60 * 1000;

// crypto.randomUUID exists only in secure contexts; on a plain-http LAN test
// URL it is undefined and would crash the whole route at module load. The
// fallback still satisfies the server's /^[a-zA-Z0-9_-]{20,80}$/ receipt key.
function newSubmissionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function emptyDraft() {
  return { step: "phone" as Step, phone: "", verificationToken: "", ticketId: null as string | null,
    // Client-side clocks only, used to show countdowns. The server keeps its
    // own windows and stays the authority on whether a code or proof is valid.
    verifiedAt: null as number | null, otpSentAt: null as number | null, otpCooldownUntil: 0,
    submissionId: newSubmissionId(), reporterName: "", reporterType: contract.reporterTypes[0],
    otherPartyName: "", otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0],
    state: "", district: "", village: "", description: "", consent: false, whatsappUpdates: false,
    immediateRisk: "unknown" as "yes" | "no" | "unknown", evidenceText: "",
    location: null as { latitude: number; longitude: number } | null, locationConfirmed: false,
    documents: [] as UploadedDocument[], idNumbers: {} as Partial<Record<string, string>> };
}
type Draft = ReturnType<typeof emptyDraft>;
let draft = emptyDraft(), cleanup: ReturnType<typeof setTimeout> | undefined;
// Kept apart from the draft so a countdown banner can subscribe without the
// draft's field selectors caring about it.
let expiry: { expiresAt: number | null; expiredNotice: boolean } = { expiresAt: null, expiredNotice: false };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// The server deletes unsent uploads after pendingTtlMinutes regardless; asking
// now keeps copies of ID cards around for less time. Best effort: with an
// expired verification the call fails and the TTL still applies.
function discardUploads(old: Draft) {
  const auth = disputeSettings.otpRequired ? { phone: old.phone, verificationToken: old.verificationToken } : {};
  for (const { documentId } of old.documents) {
    callFunction("removeDisputeDocument", { submissionId: old.submissionId, ...auth, documentId }).catch(() => {});
  }
}
/** After a successful submit pass `{ discardUploads: false }`: the documents are attached to the ticket. */
export function clearReportDraft({ discardUploads: discard = true } = {}) {
  if (cleanup) clearTimeout(cleanup);
  cleanup = undefined;
  if (discard && draft.documents.length > 0) discardUploads(draft);
  draft = emptyDraft();
  expiry = { expiresAt: null, expiredNotice: false };
  notify();
}
function expireDraft() {
  clearReportDraft();
  expiry = { expiresAt: null, expiredNotice: true };
  notify();
}
// A confirmation must not be wiped by the idle timer: it holds only the
// non-PII reference number, and losing it left reporters with nothing.
function schedule() {
  if (cleanup) clearTimeout(cleanup);
  cleanup = undefined;
  if (draft.step === "done") { expiry = { expiresAt: null, expiredNotice: false }; return; }
  cleanup = setTimeout(expireDraft, DRAFT_IDLE_MS);
  expiry = { expiresAt: Date.now() + DRAFT_IDLE_MS, expiredNotice: false };
}
/** Restart the idle timer without changing any answer ("Keep my draft"). */
export function touchDraft() {
  if (expiry.expiresAt === null) return;
  schedule(); notify();
}
export function dismissDraftExpiredNotice() {
  if (!expiry.expiredNotice) return;
  expiry = { ...expiry, expiredNotice: false }; notify();
}
// One setter per key for the module's lifetime, so callers can pass it to
// memoised children and effect deps without a new identity every render.
const setters = new Map<keyof Draft, (value: never) => void>();
function setterFor<K extends keyof Draft>(key: K): (value: Draft[K]) => void {
  let setter = setters.get(key) as ((value: Draft[K]) => void) | undefined;
  if (!setter) {
    setter = (value: Draft[K]) => {
      if (Object.is(draft[key], value)) return;
      draft = { ...draft, [key]: value };
      schedule();
      notify();
    };
    setters.set(key, setter);
  }
  return setter;
}
export function getDraftField<K extends keyof Draft>(key: K): Draft[K] {
  return draft[key];
}
/** For async results (an upload finishing) that must not overwrite a newer value. */
export function updateDraftField<K extends keyof Draft>(key: K, update: (current: Draft[K]) => Draft[K]) {
  setterFor(key)(update(draft[key]));
}
export function useDraftField<K extends keyof Draft>(key: K): [Draft[K], (value: Draft[K]) => void] {
  // Selecting the field (not the whole draft) means a keystroke in the
  // description no longer re-renders ReportIssue and every other subscriber.
  const read = () => draft[key];
  const current = useSyncExternalStore(subscribe, read, read);
  return [current, setterFor(key)];
}
const readExpiry = () => expiry;
export function useDraftExpiry() {
  return useSyncExternalStore(subscribe, readExpiry, readExpiry);
}
// Drafts stay only in this browser tab's memory, survive route navigation, and
// are erased after 30 minutes without editing. No PII is written to localStorage.
