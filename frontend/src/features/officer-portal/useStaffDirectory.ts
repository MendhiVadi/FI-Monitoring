import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import type { StaffMember } from "../tickets/types";

// listOfficers (officer+) → at most 200 allow-listed accounts (vault/Wave-2-Spec.md §2).
export type { StaffMember };
// Created once, with the same bounded wait as the other staff calls.
const requestOfficers = httpsCallable<Record<string, never>, { officers?: StaffMember[] }>(functions, "listOfficers", { timeout: 30_000 });

const NONE: never[] = [];
const byName = (a: StaffMember, b: StaffMember) =>
  (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid, "en", { sensitivity: "base" });

// The admin assignment picker and the per-officer registry filter. Loaded once
// per page while `enabled`; Retry asks again.
export function useStaffDirectory(enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; officers: StaffMember[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    requestOfficers({}).then(({ data }) => {
      if (!live) return;
      const officers = (Array.isArray(data.officers) ? data.officers : []).filter(officer => officer && typeof officer.uid === "string");
      setResult({ attempt, officers: officers.sort(byName), error: null });
    }, () => {
      // Keep any list already shown; only say that the refresh failed.
      if (live) setResult(previous => ({ attempt, officers: previous?.officers ?? [], error: "The staff list could not be loaded. Check your connection and retry." }));
    });
    return () => { live = false; };
  }, [enabled, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  const settled = result?.attempt === attempt;
  return {
    officers: enabled ? result?.officers ?? NONE : NONE,
    loading: enabled && !settled,
    error: enabled && settled ? result?.error ?? null : null,
    reload,
  };
}
