import { useState } from "react";
import type { Ticket } from "../tickets/types";
import { Spinner } from "../auth/Spinner";
import { FieldError } from "./DossierActions";
import { EventTime } from "./CaseText";
import { accessLabel, assigneeText } from "./presentation";
import { MAX_ASSIGN_REASON, type SaveError, type SaveKind } from "./useOfficerPortal";
import type { StaffMember } from "./useStaffDirectory";
import { styles } from "./portal.styles";

type Action = "self" | "release" | "pick";

// Assignment is revision-checked like a status change; the request ID is kept
// per change, so a retry after a lost response cannot assign twice.
// Officers take or release a case; administrators also pick any officer.
export function AssignmentPanel({ ticket, currentUid, isAdmin, staff, reason, setReason, saveError, clearSaveError, savingKind, onAssign }: {
  ticket: Ticket;
  currentUid: string | undefined;
  isAdmin: boolean;
  staff: { officers: StaffMember[]; loading: boolean; error: string | null; reload: () => void };
  reason: string;
  setReason: (text: string) => void;
  saveError: SaveError | null;
  clearSaveError: () => void;
  savingKind: SaveKind | null;
  onAssign: (ticketId: string, assigneeUid: string | null) => Promise<void>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  // The admin picker resets when the case or its assignee changes.
  const baseKey = ticket.id + ":" + (ticket.assignedTo ?? "");
  const [pick, setPick] = useState({ key: baseKey, uid: "" });
  const picked = pick.key === baseKey ? pick.uid : "";
  const saving = savingKind !== null, savingHere = savingKind === "assign";
  const error = saveError?.kind === "assign" ? saveError : null;
  const assignee = assigneeText(ticket, currentUid);
  const mine = Boolean(currentUid) && ticket.assignedTo === currentUid;
  const canRelease = Boolean(ticket.assignedTo) && (mine || isAdmin);
  // Viewers cannot be given a case.
  const candidates = staff.officers.filter(officer => officer.access !== "viewer");
  const run = (next: Action, uid: string | null) => { setAction(next); void onAssign(ticket.id, uid); };
  const label = (next: Action, text: string) => savingHere && action === next ? <><Spinner /> Saving…</> : text;
  const lastAttempt = action === "self" ? currentUid ?? null : action === "release" ? null : picked || null;

  return (
    <form id="dossier-assign-form" style={styles.actionCard} aria-labelledby="assign-form-title"
      onSubmit={event => { event.preventDefault(); if (picked && !saving) run("pick", picked); }}>
      <h3 id="assign-form-title" style={styles.actionHeading}>Assignment</h3>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "#e5e7eb", overflowWrap: "anywhere" }}>
        {assignee ? <>Assigned to <strong>{assignee}</strong></> : <><span aria-hidden="true">○ </span>Not assigned to anyone</>}
        {assignee && typeof ticket.assignedAt === "number" && (
          <span style={{ display: "block", fontSize: "0.76rem", color: "#94a3b8" }}>Since <EventTime at={{ seconds: Math.floor(ticket.assignedAt / 1000) }} /></span>
        )}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {!mine && currentUid && (
          <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} disabled={saving} onClick={() => run("self", currentUid)}>
            {label("self", "Assign to me")}
          </button>
        )}
        {canRelease && (
          <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={saving} onClick={() => run("release", null)}>
            {label("release", "Unassign")}
          </button>
        )}
      </div>
      {isAdmin && (
        <>
          <label htmlFor="assign-to" style={styles.fieldLabel}>Assign to another officer</label>
          <select id="assign-to" value={picked} disabled={saving || (staff.loading && candidates.length === 0)}
            onChange={event => setPick({ key: baseKey, uid: event.target.value })}
            aria-describedby={staff.error ? "assign-staff-error" : undefined} style={styles.modalStatusSelect}>
            <option value="">{staff.loading && candidates.length === 0 ? "Loading staff…" : "Choose an officer"}</option>
            {candidates.map(officer => (
              <option key={officer.uid} value={officer.uid} disabled={officer.uid === ticket.assignedTo}>
                {(officer.displayName || officer.email || `Staff ·${officer.uid.slice(-4)}`) + (officer.uid === currentUid ? " (you)" : "")}
                {" · "}{accessLabel(officer.access)}{officer.uid === ticket.assignedTo ? " · assigned now" : ""}
              </option>
            ))}
          </select>
          {staff.error && (
            <div role="alert" id="assign-staff-error" style={styles.fieldError}>
              <span>{staff.error}</span>
              <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }} onClick={staff.reload}>Retry</button>
            </div>
          )}
          <button type="submit" className="portal-btn" style={{ ...styles.modalSecondaryBtn, alignSelf: "flex-start" }} disabled={saving || !picked}>
            {label("pick", "Assign")}
          </button>
        </>
      )}
      <label htmlFor="assign-reason" style={styles.fieldLabel}>Reason (optional, saved to case history)</label>
      <textarea
        id="assign-reason"
        rows={2}
        maxLength={MAX_ASSIGN_REASON}
        value={reason}
        readOnly={savingHere}
        onChange={event => setReason(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={"assign-reason-count" + (error ? " assign-error" : "")}
        style={styles.noteInput}
      />
      <div style={styles.fieldMeta}>
        <p style={styles.fieldHint}>All staff can read assignment changes in the case history.</p>
        <span id="assign-reason-count" style={styles.counter}>{reason.length}/{MAX_ASSIGN_REASON}</span>
      </div>
      {error && (
        <FieldError id="assign-error" fieldId="assign-reason" error={error} onDismiss={clearSaveError}
          onRetry={error.retryable && action && !saving && lastAttempt !== (ticket.assignedTo ?? null)
            ? () => run(action, lastAttempt) : undefined} />
      )}
    </form>
  );
}
