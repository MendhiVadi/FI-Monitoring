import { useSyncExternalStore } from "react";
import contract from "../../shared/contracts/dispute.json";
import type { Step } from "./types";

function emptyDraft() {
  return { step: "phone" as Step, phone: "", verificationToken: "", ticketId: null as string | null,
    submissionId: crypto.randomUUID(), reporterName: "", reporterType: contract.reporterTypes[0],
    otherPartyName: "", otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0],
    state: "", district: "", village: "", description: "", consent: false, whatsappUpdates: false,
    immediateRisk: "unknown" as "yes" | "no" | "unknown", evidenceText: "",
    location: null as { latitude: number; longitude: number } | null, locationConfirmed: false };
}
type Draft = ReturnType<typeof emptyDraft>;
let draft = emptyDraft(), cleanup: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => draft;
export function clearReportDraft() {
  if (cleanup) clearTimeout(cleanup);
  draft = emptyDraft(); notify();
}
export function useDraftField<K extends keyof Draft>(key: K): [Draft[K], (value: Draft[K]) => void] {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return [current[key], value => {
    draft = { ...draft, [key]: value };
    if (cleanup) clearTimeout(cleanup);
    cleanup = setTimeout(clearReportDraft, 30 * 60 * 1000);
    notify();
  }];
}
// Drafts stay only in this browser tab's memory, survive route navigation, and
// are erased after 30 minutes without editing. No PII is written to localStorage.
